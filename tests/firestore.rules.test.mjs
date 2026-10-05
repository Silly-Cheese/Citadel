import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc
} from "firebase/firestore";

const PROJECT_ID = "citadel-rules-test";
let env;

function emulatorAddress() {
  const value = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
  const [host, port] = value.split(":");
  return { host, port: Number(port || 8080) };
}

async function seedProfile(uid, {
  employeeId = `EMP-${uid.toUpperCase()}`,
  permissions = [],
  clearanceLevel = 1,
  roles = ["GENERAL_EMPLOYEE"],
  isSystemOwner = false,
  protectedPrincipal = false
} = {}) {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "accessProfiles", uid), {
      uid,
      employeeId,
      active: true,
      clearanceLevel,
      roles,
      permissions,
      isSystemOwner,
      protectedPrincipal,
      scope: "assigned"
    });
  });
  return employeeId;
}

async function seedOwner() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "system", "ownership"), {
      primaryOwnerUid: "owner",
      primaryOwnerEmployeeId: "EMP-OWNER",
      status: "active"
    });
    await setDoc(doc(db, "accessProfiles", "owner"), {
      uid: "owner",
      employeeId: "EMP-OWNER",
      active: true,
      clearanceLevel: 10,
      roles: ["SYSTEM_OWNER"],
      permissions: ["system.manage", "access.manage", "security.manage", "employee.manage"],
      isSystemOwner: true,
      protectedPrincipal: true,
      scope: "organization"
    });
  });
}

before(async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  const { host, port } = emulatorAddress();
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules, host, port }
  });
});

beforeEach(async () => {
  await env.clearFirestore();
});

after(async () => {
  await env.cleanup();
});

test("unauthenticated users cannot read customer records", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "customers", "customer1"), {
      customerId: "CUS-000001",
      classification: "STANDARD",
      minimumClearance: 0
    });
  });
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "customers", "customer1")));
});

test("customer clearance is enforced independently from customer.view", async () => {
  await seedProfile("csr", { permissions: ["customer.view"], clearanceLevel: 1 });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "customers", "standard"), {
      customerId: "CUS-000001",
      classification: "STANDARD",
      minimumClearance: 0
    });
    await setDoc(doc(db, "customers", "restricted"), {
      customerId: "CUS-000002",
      classification: "RESTRICTED",
      minimumClearance: 6
    });
  });
  const db = env.authenticatedContext("csr").firestore();
  await assertSucceeds(getDoc(doc(db, "customers", "standard")));
  await assertFails(getDoc(doc(db, "customers", "restricted")));
});

test("delegated access admins cannot create C10 or grant reserved permissions", async () => {
  await seedProfile("accessadmin", {
    permissions: ["access.manage"],
    clearanceLevel: 9,
    roles: ["SECURITY_ADMIN"]
  });
  const db = env.authenticatedContext("accessadmin").firestore();

  await assertSucceeds(setDoc(doc(db, "accessProfiles", "employee"), {
    uid: "employee",
    employeeId: "EMP-000200",
    active: true,
    clearanceLevel: 4,
    roles: ["CUSTOMER_REP"],
    permissions: ["customer.view", "customer.edit"],
    isSystemOwner: false,
    protectedPrincipal: false,
    scope: "assigned"
  }));

  await assertFails(setDoc(doc(db, "accessProfiles", "privileged"), {
    uid: "privileged",
    employeeId: "EMP-000201",
    active: true,
    clearanceLevel: 10,
    roles: ["SYSTEM_OWNER"],
    permissions: ["system.manage"],
    isSystemOwner: true,
    protectedPrincipal: true,
    scope: "organization"
  }));

  await assertFails(setDoc(doc(db, "accessProfiles", "reserved"), {
    uid: "reserved",
    employeeId: "EMP-000202",
    active: true,
    clearanceLevel: 8,
    roles: ["SECURITY_ADMIN"],
    permissions: ["access.manage"],
    isSystemOwner: false,
    protectedPrincipal: false,
    scope: "organization"
  }));
});

test("System Owner can grant privileged permissions without creating a second owner", async () => {
  await seedOwner();
  const db = env.authenticatedContext("owner").firestore();
  await assertSucceeds(setDoc(doc(db, "accessProfiles", "admin"), {
    uid: "admin",
    employeeId: "EMP-ADMIN",
    active: true,
    clearanceLevel: 9,
    roles: ["SYSTEM_ADMIN"],
    permissions: ["system.manage", "employee.manage"],
    isSystemOwner: false,
    protectedPrincipal: false,
    scope: "organization"
  }));
});

test("notification recipients can mark read but cannot rewrite message content", async () => {
  await seedProfile("employee", { permissions: ["notification.view"] });
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "notifications", "n1"), {
      recipientUid: "employee",
      title: "Original",
      message: "Original message",
      read: false
    });
  });
  const db = env.authenticatedContext("employee").firestore();
  await assertSucceeds(updateDoc(doc(db, "notifications", "n1"), {
    read: true,
    readAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(db, "notifications", "n1"), {
    message: "Tampered"
  }));
});

test("audit events cannot spoof the actor employee identity", async () => {
  await seedProfile("auditor", {
    employeeId: "EMP-AUDITOR",
    permissions: ["audit.view"]
  });
  const db = env.authenticatedContext("auditor").firestore();

  await assertSucceeds(setDoc(doc(db, "auditEvents", "good"), {
    actorUid: "auditor",
    actorEmployeeId: "EMP-AUDITOR",
    action: "TEST_EVENT",
    entityType: "test",
    entityId: "good",
    success: true,
    createdAt: serverTimestamp()
  }));

  await assertFails(setDoc(doc(db, "auditEvents", "bad"), {
    actorUid: "auditor",
    actorEmployeeId: "EMP-SOMEONE-ELSE",
    action: "TEST_EVENT",
    entityType: "test",
    entityId: "bad",
    success: true,
    createdAt: serverTimestamp()
  }));
});

test("temporary access requests cannot ask for owner-level authority", async () => {
  await seedProfile("requester", {
    employeeId: "EMP-REQUESTER",
    permissions: ["access.request"],
    clearanceLevel: 2
  });
  const db = env.authenticatedContext("requester").firestore();

  await assertSucceeds(setDoc(doc(db, "accessRequests", "good"), {
    requestId: "ACR-000001",
    requesterUid: "requester",
    requesterEmployeeId: "EMP-REQUESTER",
    requestedPermissions: ["customer.view"],
    requestedClearance: 4,
    requestedHours: 4,
    reason: "Case support",
    status: "Pending",
    createdAt: serverTimestamp()
  }));

  await assertFails(setDoc(doc(db, "accessRequests", "bad"), {
    requestId: "ACR-000002",
    requesterUid: "requester",
    requesterEmployeeId: "EMP-REQUESTER",
    requestedPermissions: ["system.manage"],
    requestedClearance: 9,
    requestedHours: 4,
    reason: "Escalate me",
    status: "Pending",
    createdAt: serverTimestamp()
  }));
});

test("temporary-access managers cannot self-grant or exceed 24 hours", async () => {
  await seedProfile("security", {
    employeeId: "EMP-SECURITY",
    permissions: ["access.temporary.manage"],
    clearanceLevel: 8,
    roles: ["SECURITY_ADMIN"]
  });
  await seedProfile("target", {
    employeeId: "EMP-TARGET",
    permissions: [],
    clearanceLevel: 1
  });

  const db = env.authenticatedContext("security").firestore();
  const oneHour = Timestamp.fromMillis(Date.now() + 60 * 60 * 1000);
  const twoDays = Timestamp.fromMillis(Date.now() + 48 * 60 * 60 * 1000);

  await assertFails(setDoc(doc(db, "temporaryAccess", "security"), {
    userId: "security",
    employeeId: "EMP-SECURITY",
    permissions: ["customer.view"],
    clearanceLevel: 4,
    active: true,
    grantedByUid: "security",
    grantedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    expiresAt: oneHour
  }));

  await assertSucceeds(setDoc(doc(db, "temporaryAccess", "target"), {
    userId: "target",
    employeeId: "EMP-TARGET",
    permissions: ["customer.view"],
    clearanceLevel: 4,
    active: true,
    grantedByUid: "security",
    grantedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    expiresAt: oneHour
  }));

  await assertFails(setDoc(doc(db, "temporaryAccess", "target2"), {
    userId: "target2",
    employeeId: "EMP-TARGET2",
    permissions: ["customer.view"],
    clearanceLevel: 4,
    active: true,
    grantedByUid: "security",
    grantedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    expiresAt: twoDays
  }));
});

test("enterprise record creation provenance cannot be rewritten", async () => {
  await seedProfile("assetmgr", {
    permissions: ["asset.view", "asset.manage"],
    clearanceLevel: 4
  });
  const db = env.authenticatedContext("assetmgr").firestore();

  await assertSucceeds(setDoc(doc(db, "assets", "asset1"), {
    assetId: "AST-000001",
    name: "Laptop",
    status: "Available",
    createdBy: "assetmgr",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));

  await assertSucceeds(updateDoc(doc(db, "assets", "asset1"), {
    status: "Assigned",
    updatedAt: serverTimestamp()
  }));

  await assertFails(updateDoc(doc(db, "assets", "asset1"), {
    createdBy: "someone-else",
    updatedAt: serverTimestamp()
  }));
});

test("employee managers cannot create protected owner identities", async () => {
  await seedProfile("hradmin", {
    permissions: ["employee.manage"],
    clearanceLevel: 9,
    roles: ["HR_MANAGER"]
  });
  const db = env.authenticatedContext("hradmin").firestore();

  await assertFails(setDoc(doc(db, "users", "fake-owner"), {
    uid: "fake-owner",
    employeeId: "EMP-FAKE",
    accountStatus: "active",
    protectedPrincipal: true,
    ownerStatus: "primary"
  }));
});
