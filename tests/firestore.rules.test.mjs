import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
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

function customerRecord({
  customerId = "CUS-TEST",
  classification = "STANDARD",
  minimumClearance = 0,
  recordLocked = false,
  lockMinimumClearance = 0,
  accessLevel = minimumClearance,
  createdBy = "seed",
  createdAt = Timestamp.fromMillis(1700000000000)
} = {}) {
  return {
    customerId,
    classification,
    minimumClearance,
    recordLocked,
    lockMinimumClearance,
    lockReasonCode: recordLocked ? "Security Concern" : "",
    lockReasonDetail: recordLocked ? "Test lock" : "",
    accessLevel,
    createdBy,
    createdAt,
    updatedAt: createdAt
  };
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
    await setDoc(doc(context.firestore(), "customers", "customer1"), customerRecord({
      customerId: "CUS-000001"
    }));
  });
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "customers", "customer1")));
});

test("Citadel customer clearance query is authorized", async () => {
  await seedProfile("csrquery", {
    employeeId: "EMP-CSRQUERY",
    permissions: ["customer.view"],
    clearanceLevel: 1
  });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "customers", "standard"), customerRecord({
      customerId: "CUS-Q001",
      accessLevel: 0
    }));
    await setDoc(doc(db, "customers", "internal"), customerRecord({
      customerId: "CUS-Q002",
      classification: "INTERNAL",
      minimumClearance: 1,
      accessLevel: 1
    }));
    await setDoc(doc(db, "customers", "restricted"), customerRecord({
      customerId: "CUS-Q003",
      classification: "RESTRICTED",
      minimumClearance: 6,
      accessLevel: 6
    }));
  });

  const db = env.authenticatedContext("csrquery").firestore();
  const q = query(collection(db, "customers"), where("accessLevel", "in", [0,1]));
  const snap = await assertSucceeds(getDocs(q));
  if (snap.size !== 2) throw new Error(`Expected 2 authorized customers, received ${snap.size}`);
});

test("classified registry queries are authorized at the caller clearance", async () => {
  await seedProfile("classifiedquery", {
    employeeId: "EMP-CLASSIFIED",
    permissions: ["contract.view", "document.view", "investigation.view"],
    clearanceLevel: 4
  });

  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const collections = ["contracts", "documents", "investigations"];
    for (const name of collections) {
      await setDoc(doc(db, name, "visible"), {
        classification: "SENSITIVE",
        minimumClearance: 4
      });
      await setDoc(doc(db, name, "hidden"), {
        classification: "RESTRICTED",
        minimumClearance: 6
      });
    }
  });

  const db = env.authenticatedContext("classifiedquery").firestore();
  for (const name of ["contracts", "documents", "investigations"]) {
    const q = query(collection(db, name), where("classification", "in", ["STANDARD","INTERNAL","CONFIDENTIAL","SENSITIVE"]));
    const snap = await assertSucceeds(getDocs(q));
    if (snap.size !== 1) throw new Error(`${name}: expected 1 authorized record, received ${snap.size}`);
  }
});

test("customer clearance is enforced independently from customer.view", async () => {
  await seedProfile("csr", { permissions: ["customer.view"], clearanceLevel: 1 });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "customers", "standard"), customerRecord({
      customerId: "CUS-000001",
      accessLevel: 0
    }));
    await setDoc(doc(db, "customers", "restricted"), customerRecord({
      customerId: "CUS-000002",
      classification: "RESTRICTED",
      minimumClearance: 6,
      accessLevel: 6
    }));
  });
  const db = env.authenticatedContext("csr").firestore();
  await assertSucceeds(getDoc(doc(db, "customers", "standard")));
  await assertFails(getDoc(doc(db, "customers", "restricted")));
});

test("C7 customer locks deny lower clearance and allow C7", async () => {
  await seedProfile("c6viewer", {
    employeeId: "EMP-C6",
    permissions: ["customer.view"],
    clearanceLevel: 6
  });
  await seedProfile("c7viewer", {
    employeeId: "EMP-C7",
    permissions: ["customer.view"],
    clearanceLevel: 7
  });

  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "customers", "locked-c7"), customerRecord({
      customerId: "CUS-LOCK7",
      classification: "STANDARD",
      minimumClearance: 0,
      recordLocked: true,
      lockMinimumClearance: 7,
      accessLevel: 7
    }));
  });

  await assertFails(getDoc(doc(env.authenticatedContext("c6viewer").firestore(), "customers", "locked-c7")));
  await assertSucceeds(getDoc(doc(env.authenticatedContext("c7viewer").firestore(), "customers", "locked-c7")));
});

test("customer accessLevel queries exclude locked customers below clearance", async () => {
  await seedProfile("c4list", {
    employeeId: "EMP-C4LIST",
    permissions: ["customer.view"],
    clearanceLevel: 4
  });

  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "customers", "visible"), customerRecord({
      customerId: "CUS-VISIBLE",
      classification: "SENSITIVE",
      minimumClearance: 4,
      accessLevel: 4
    }));
    await setDoc(doc(db, "customers", "locked"), customerRecord({
      customerId: "CUS-LOCKED",
      classification: "STANDARD",
      minimumClearance: 0,
      recordLocked: true,
      lockMinimumClearance: 7,
      accessLevel: 7
    }));
  });

  const db = env.authenticatedContext("c4list").firestore();
  const q = query(collection(db, "customers"), where("accessLevel", "in", [0,1,2,3,4]));
  const snap = await assertSucceeds(getDocs(q));
  if (snap.size !== 1) throw new Error(`Expected only the C4-visible customer, received ${snap.size}`);
});

test("customer editors without lock authority cannot change lock fields", async () => {
  await seedProfile("editor", {
    employeeId: "EMP-EDITOR",
    permissions: ["customer.view", "customer.edit"],
    clearanceLevel: 7
  });

  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "customers", "customer"), customerRecord({
      customerId: "CUS-EDIT",
      createdBy: "seed"
    }));
  });

  const db = env.authenticatedContext("editor").firestore();
  await assertFails(updateDoc(doc(db, "customers", "customer"), {
    recordLocked: true,
    lockMinimumClearance: 7,
    lockReasonCode: "Security Concern",
    lockReasonDetail: "Unauthorized lock",
    accessLevel: 7
  }));
});

test("permanent customer lock managers can lock at or below their clearance", async () => {
  await seedProfile("lockmgr", {
    employeeId: "EMP-LOCKMGR",
    permissions: ["customer.view", "customer.edit", "customer.lock.manage"],
    clearanceLevel: 7
  });

  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "customers", "customer"), customerRecord({
      customerId: "CUS-LOCKME",
      createdBy: "seed"
    }));
  });

  const db = env.authenticatedContext("lockmgr").firestore();
  await assertSucceeds(updateDoc(doc(db, "customers", "customer"), {
    recordLocked: true,
    lockMinimumClearance: 7,
    lockReasonCode: "Security Concern",
    lockReasonDetail: "Authorized lock",
    accessLevel: 7,
    lockedByUid: "lockmgr",
    lockedByEmployeeId: "EMP-LOCKMGR",
    lockedAt: serverTimestamp()
  }));

  await assertFails(updateDoc(doc(db, "customers", "customer"), {
    recordLocked: true,
    lockMinimumClearance: 8,
    lockReasonCode: "Security Concern",
    lockReasonDetail: "Above manager clearance",
    accessLevel: 8
  }));
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

test("Citadel page list queries are query-safe", async () => {
  await seedProfile("pageuser", {
    employeeId: "EMP-PAGEUSER",
    permissions: [
      "employee.view",
      "hr.request.leave",
      "training.self",
      "service.create",
      "procurement.request",
      "finance.expense.create",
      "notification.view",
      "access.request"
    ],
    clearanceLevel: 2
  });

  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();

    await setDoc(doc(db, "employees", "pageuser"), {
      employeeId: "EMP-PAGEUSER",
      displayName: "Page User",
      createdAt: Timestamp.fromMillis(Date.now())
    });

    await setDoc(doc(db, "leaveRequests", "leave-self"), {
      requesterUid: "pageuser",
      requesterEmployeeId: "EMP-PAGEUSER",
      status: "Pending",
      createdAt: Timestamp.fromMillis(Date.now())
    });
    await setDoc(doc(db, "leaveRequests", "leave-other"), {
      requesterUid: "other",
      requesterEmployeeId: "EMP-OTHER",
      status: "Pending",
      createdAt: Timestamp.fromMillis(Date.now())
    });

    await setDoc(doc(db, "trainingRecords", "training-self"), {
      employeeId: "EMP-PAGEUSER",
      createdAt: Timestamp.fromMillis(Date.now())
    });
    await setDoc(doc(db, "trainingRecords", "training-other"), {
      employeeId: "EMP-OTHER",
      createdAt: Timestamp.fromMillis(Date.now())
    });

    for (const [collectionName, id] of [
      ["serviceTickets","service-self"],
      ["purchaseRequests","purchase-self"],
      ["expenses","expense-self"]
    ]) {
      await setDoc(doc(db, collectionName, id), {
        requesterUid: "pageuser",
        requesterEmployeeId: "EMP-PAGEUSER",
        createdAt: Timestamp.fromMillis(Date.now())
      });
      await setDoc(doc(db, collectionName, id + "-other"), {
        requesterUid: "other",
        requesterEmployeeId: "EMP-OTHER",
        createdAt: Timestamp.fromMillis(Date.now())
      });
    }

    await setDoc(doc(db, "notifications", "notification-self"), {
      recipientUid: "pageuser",
      read: false,
      createdAt: Timestamp.fromMillis(Date.now())
    });
    await setDoc(doc(db, "notifications", "notification-other"), {
      recipientUid: "other",
      read: false,
      createdAt: Timestamp.fromMillis(Date.now())
    });

    await setDoc(doc(db, "accessRequests", "access-self"), {
      requesterUid: "pageuser",
      requesterEmployeeId: "EMP-PAGEUSER",
      status: "Pending",
      createdAt: Timestamp.fromMillis(Date.now())
    });
    await setDoc(doc(db, "accessRequests", "access-other"), {
      requesterUid: "other",
      requesterEmployeeId: "EMP-OTHER",
      status: "Pending",
      createdAt: Timestamp.fromMillis(Date.now())
    });
  });

  const db = env.authenticatedContext("pageuser").firestore();

  await assertSucceeds(getDocs(query(collection(db, "employees"), orderBy("createdAt", "desc"), limit(75))));

  const selfQueries = [
    query(collection(db, "leaveRequests"), where("requesterUid", "==", "pageuser"), limit(100)),
    query(collection(db, "trainingRecords"), where("employeeId", "==", "EMP-PAGEUSER"), limit(100)),
    query(collection(db, "serviceTickets"), where("requesterUid", "==", "pageuser"), limit(120)),
    query(collection(db, "purchaseRequests"), where("requesterUid", "==", "pageuser"), limit(120)),
    query(collection(db, "expenses"), where("requesterUid", "==", "pageuser"), limit(100)),
    query(collection(db, "notifications"), where("recipientUid", "==", "pageuser"), limit(100)),
    query(collection(db, "accessRequests"), where("requesterUid", "==", "pageuser"), limit(50))
  ];

  for (const q of selfQueries) {
    await assertSucceeds(getDocs(q));
  }
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
