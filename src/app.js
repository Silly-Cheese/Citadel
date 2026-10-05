import {
  auth,
  db,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
  runTransaction,
  where
} from "./firebase.js?v=20261005-r3";
import {
  esc,
  initials,
  fmtDate,
  fmtDateTime,
  statusBadge,
  classificationBadge,
  customerDisplayName
} from "./utils.js?v=20261005-r3";
import { toast, openModal } from "./ui.js?v=20261005-r3";
import { createGeneration2, GENERATION2_NAV, GENERATION2_PERMISSIONS } from "./generation2.js?v=20261005-r3";
import { createGeneration3, GENERATION3_NAV, GENERATION3_PERMISSIONS } from "./generation3.js?v=20261005-r3";

const app = document.getElementById("app");

const state = {
  user: null,
  userRecord: null,
  profile: null,
  employee: null,
  temporaryAccess: null,
  route: "home",
  search: ""
};

const OWNER_PERMISSIONS = [
  "system.manage",
  "organization.manage",
  "employee.view",
  "employee.manage",
  "customer.view",
  "customer.create",
  "customer.edit",
  "customer.edit.contact",
  "customer.view.financial",
  "customer.restrict",
  "customer.lock.manage",
  "customer.merge",
  "case.view",
  "case.create",
  "case.assign",
  "case.close",
  "approval.view",
  "approval.manage",
  "access.manage",
  "audit.view",
  "security.manage",
  "admin.organization.manage",
  "workflow.manage",
  ...GENERATION2_PERMISSIONS,
  ...GENERATION3_PERMISSIONS
];

const ROLE_OPTIONS = [
  ["GENERAL_EMPLOYEE", "General Employee"],
  ["CUSTOMER_REP", "Customer Representative"],
  ["CUSTOMER_SUPERVISOR", "Customer Supervisor"],
  ["DEPARTMENT_MANAGER", "Department Manager"],
  ["HR_SPECIALIST", "HR Specialist"],
  ["HR_MANAGER", "HR Manager"],
  ["SERVICE_DESK", "Service Desk"],
  ["IT_ADMIN", "IT Administrator"],
  ["FINANCE_SPECIALIST", "Finance Specialist"],
  ["PROCUREMENT_SPECIALIST", "Procurement Specialist"],
  ["SECURITY_ANALYST", "Security Analyst"],
  ["SECURITY_ADMIN", "Security Administrator"],
  ["COMPLIANCE_OFFICER", "Compliance Officer"],
  ["RISK_MANAGER", "Risk Manager"],
  ["EXECUTIVE", "Executive"],
  ["SYSTEM_ADMIN", "System Administrator"],
  ["SYSTEM_OWNER", "System Owner"]
];

const ALL_PERMISSION_OPTIONS = [...new Set(OWNER_PERMISSIONS)].sort();

const PRIVILEGED_ACCESS_PERMISSIONS = new Set([
  "system.manage",
  "access.manage",
  "access.temporary.manage",
  "security.manage",
  "employee.manage",
  "organization.manage",
  "admin.organization.manage",
  "customer.lock.manage"
]);

const PERMISSION_GROUP_LABELS = [
  ["customer.", "Customers"],
  ["case.", "Cases"],
  ["employee.", "People"],
  ["hr.", "HR"],
  ["training.", "Training"],
  ["service.", "Service Desk"],
  ["asset.", "Assets"],
  ["procurement.", "Procurement"],
  ["vendor.", "Vendors"],
  ["contract.", "Contracts"],
  ["finance.", "Finance"],
  ["project.", "Projects"],
  ["document.", "Documents"],
  ["communications.", "Communications"],
  ["compliance.", "Compliance"],
  ["risk.", "Risk"],
  ["investigation.", "Investigations"],
  ["workflow.", "Workflows"],
  ["approval.", "Approvals"],
  ["analytics.", "Analytics"],
  ["report.", "Reports"],
  ["security.", "Security"],
  ["access.", "Access"],
  ["audit.", "Audit"],
  ["organization.", "Organization"],
  ["dashboard.", "Dashboard"],
  ["bulk.", "Bulk Operations"],
  ["notification.", "Notifications"],
  ["system.", "System"],
  ["admin.", "Administration"]
];

const NAV = [
  { section: "Workspace", id: "home", label: "Home", icon: "⌂" },
  { section: "Workspace", id: "customers", label: "Customers", icon: "◉", permission: "customer.view" },
  { section: "Workspace", id: "cases", label: "Cases", icon: "◇", permission: "case.view" },
  { section: "Organization", id: "people", label: "People", icon: "◎", permission: "employee.view" },
  { section: "Organization", id: "approvals", label: "Approvals", icon: "✓", permission: "approval.view" },
  ...GENERATION2_NAV,
  ...GENERATION3_NAV,
  { section: "Control", id: "security", label: "Security", icon: "◆", permission: "security.manage" },
  { section: "Control", id: "admin", label: "Administration", icon: "⚙", permission: "system.manage" }
];

function temporaryGrantActive() {
  if (!state.temporaryAccess || state.temporaryAccess.active === false) return false;
  const expires = state.temporaryAccess.expiresAt?.toDate
    ? state.temporaryAccess.expiresAt.toDate()
    : new Date(state.temporaryAccess.expiresAt || 0);
  return !Number.isNaN(expires.getTime()) && expires.getTime() > Date.now();
}

function effectiveClearance() {
  const permanent = Number(state.profile?.clearanceLevel || 0);
  const temporary = temporaryGrantActive() ? Number(state.temporaryAccess?.clearanceLevel || 0) : 0;
  return Math.max(permanent, temporary);
}

function hasPermission(permission) {
  if (!state.profile) return false;
  if (state.profile.isSystemOwner === true) return true;
  const permanent = Array.isArray(state.profile.permissions) && state.profile.permissions.includes(permission);
  const temporary = temporaryGrantActive()
    && Array.isArray(state.temporaryAccess?.permissions)
    && state.temporaryAccess.permissions.includes(permission);
  return permanent || temporary;
}

function hasPermanentPermission(permission) {
  if (!state.profile) return false;
  if (state.profile.isSystemOwner === true) return true;
  return Array.isArray(state.profile.permissions) && state.profile.permissions.includes(permission);
}

function classificationLevel(value = "STANDARD") {
  const levels = {
    STANDARD: 0,
    INTERNAL: 1,
    CONFIDENTIAL: 2,
    SENSITIVE: 4,
    RESTRICTED: 6,
    HIGHLY_RESTRICTED: 8
  };
  return levels[String(value).toUpperCase()] ?? 0;
}

function classificationsForClearance(level = effectiveClearance()) {
  const clearance = Number(level || 0);
  return [
    "STANDARD",
    clearance >= 1 && "INTERNAL",
    clearance >= 2 && "CONFIDENTIAL",
    clearance >= 4 && "SENSITIVE",
    clearance >= 6 && "RESTRICTED",
    clearance >= 8 && "HIGHLY_RESTRICTED"
  ].filter(Boolean);
}

function customerAccessLevelsForClearance(level = effectiveClearance()) {
  const clearance = Math.max(0, Math.min(10, Number(level || 0)));
  return Array.from({ length: clearance + 1 }, (_, index) => index);
}

function customerRequiredAccessLevel(classification, recordLocked = false, lockMinimumClearance = 0) {
  const base = classificationLevel(classification);
  const lock = recordLocked ? Math.max(0, Math.min(10, Number(lockMinimumClearance || 0))) : 0;
  return Math.max(base, lock);
}

let customerAccessMigrationChecked = false;
async function ensureCustomerAccessModel() {
  if (customerAccessMigrationChecked || state.profile?.isSystemOwner !== true) return;
  customerAccessMigrationChecked = true;

  try {
    const snap = await getDocs(query(
      collection(db,"customers"),
      where("classification","in",["STANDARD","INTERNAL","CONFIDENTIAL","SENSITIVE","RESTRICTED","HIGHLY_RESTRICTED"])
    ));
    const pending = snap.docs.filter(customerDoc => {
      const data = customerDoc.data();
      return !Number.isInteger(data.accessLevel)
        || typeof data.recordLocked !== "boolean"
        || !Number.isInteger(data.lockMinimumClearance);
    });

    for (let offset = 0; offset < pending.length; offset += 400) {
      const batch = writeBatch(db);
      pending.slice(offset, offset + 400).forEach(customerDoc => {
        const data = customerDoc.data();
        const recordLocked = data.recordLocked === true;
        const lockMinimumClearance = Number.isInteger(data.lockMinimumClearance) ? data.lockMinimumClearance : 0;
        batch.update(customerDoc.ref,{
          recordLocked,
          lockMinimumClearance: recordLocked ? lockMinimumClearance : 0,
          lockReasonCode: data.lockReasonCode || "",
          lockReasonDetail: data.lockReasonDetail || "",
          accessLevel: customerRequiredAccessLevel(data.classification || "STANDARD",recordLocked,lockMinimumClearance),
          updatedAt: serverTimestamp(),
          updatedBy: state.user.uid
        });
      });
      await batch.commit();
    }
    if (pending.length) {
      await audit("CUSTOMER_ACCESS_MODEL_MIGRATED","customer","customers",{ recordCount: pending.length });
    }
  } catch (error) {
    customerAccessMigrationChecked = false;
    console.warn("Customer access-level migration deferred",error);
  }
}

function accountName() {
  return state.employee?.displayName || state.userRecord?.displayName || state.user?.displayName || state.user?.email || "Citadel User";
}

function currentBuild() {
  return document.querySelector('meta[data-citadel-build]')?.getAttribute("content") || "development";
}

function shortBuild() {
  const value=currentBuild();
  return value === "development" ? "Development" : value.slice(0,12);
}

function firebaseMessage(error) {
  const code = error?.code || "";
  const map = {
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/email-already-in-use": "An account already exists for that email.",
    "auth/weak-password": "Use a stronger password with at least six characters.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/too-many-requests": "Too many attempts. Try again later.",
    "permission-denied": "Citadel security rules denied this operation."
  };
  return map[code] || error?.message?.replace("Firebase: ", "") || "Something went wrong.";
}

async function audit(action, entityType, entityId, extra = {}) {
  try {
    await addDoc(collection(db, "auditEvents"), {
      actorUid: state.user?.uid || null,
      actorEmployeeId: state.employee?.employeeId || null,
      action,
      entityType,
      entityId,
      success: true,
      createdAt: serverTimestamp(),
      ...extra
    });
  } catch (error) {
    console.warn("Audit event could not be recorded", error);
  }
}

async function nextId(counterName, prefix) {
  const ref = doc(db, "counters", counterName);
  const number = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? Number(snap.data().value || 0) : 0;
    const next = current + 1;
    tx.set(ref, { value: next, updatedAt: serverTimestamp() }, { merge: true });
    return next;
  });
  return `${prefix}-${String(number).padStart(6, "0")}`;
}

function option(value, label, selected = false) {
  return `<option value="${esc(value)}" ${selected ? "selected" : ""}>${esc(label)}</option>`;
}

async function loadReferenceData() {
  const refs = {
    employees: [],
    departments: [],
    positions: [],
    locations: [],
    vendors: [],
    customers: []
  };

  const tasks = [
    hasPermission("employee.view") || hasPermission("employee.manage")
      ? safeCollection("employees", 300).then(v => refs.employees = v)
      : Promise.resolve(),
    safeCollection("departments", 200).then(v => refs.departments = v),
    safeCollection("positions", 250).then(v => refs.positions = v),
    safeCollection("locations", 200).then(v => refs.locations = v),
    hasPermission("vendor.view") || hasPermission("vendor.manage") || hasPermission("procurement.view")
      ? safeCollection("vendors", 250).then(v => refs.vendors = v)
      : Promise.resolve(),
    hasPermission("customer.view")
      ? (async () => {
          await ensureCustomerAccessModel();
          let snap = await getDocs(query(
            collection(db,"customers"),
            where("accessLevel","in",customerAccessLevelsForClearance()),
            limit(250)
          ));
          if (snap.empty && state.profile?.isSystemOwner === true) {
            snap = await getDocs(query(
              collection(db,"customers"),
              where("classification","in",classificationsForClearance()),
              limit(250)
            ));
          }
          refs.customers = snap.docs
            .map(d => ({ id:d.id, ...d.data() }))
            .sort((a,b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        })()
      : Promise.resolve()
  ];

  await Promise.all(tasks);
  return refs;
}

function employeeSelect(refs, name, selected = "", { required = false, label = "Select employee" } = {}) {
  return `<select class="select" name="${esc(name)}" ${required ? "required" : ""}>
    <option value="">${esc(label)}</option>
    ${refs.employees.map(e => option(e.employeeId || e.id, `${e.displayName || "Employee"} — ${e.positionName || "No position"}`, String(selected) === String(e.employeeId || e.id))).join("")}
  </select>`;
}

function employeeDisplay(records, employeeId, fallback = "Unassigned") {
  if (!employeeId) return fallback;
  const employee = (records || []).find(item => String(item.employeeId || item.id) === String(employeeId));
  return employee?.displayName || fallback;
}

function employeeDisplayContext(records, employeeId) {
  if (!employeeId) return "";
  const employee = (records || []).find(item => String(item.employeeId || item.id) === String(employeeId));
  return employee ? [employee.positionName, employee.departmentName].filter(Boolean).join(" · ") : "";
}

function customerFromHumanId(records, customerId) {
  if (!customerId) return null;
  return (records || []).find(item => String(item.customerId || item.id) === String(customerId));
}

function permissionFriendlyName(permission) {
  const parts = String(permission).split(".");
  const action = parts.slice(1).join(" ");
  const replacements = {
    "view": "View",
    "create": "Create",
    "edit": "Edit",
    "edit contact": "Edit contact information",
    "view financial": "View financial information",
    "restrict": "Restrict records",
    "lock manage": "Manage customer record locks",
    "merge": "Merge records",
    "assign": "Assign",
    "close": "Close",
    "manage": "Manage",
    "request leave": "Request leave",
    "expense create": "Submit expenses",
    "self": "View own records",
    "run": "Run workflows",
    "run manage": "Manage workflow runs",
    "executive": "Executive analytics",
    "customize": "Customize",
    "alerts view": "View alerts",
    "alerts manage": "Manage alerts",
    "temporary manage": "Manage temporary access",
    "health view": "View system health",
    "export": "Export",
    "organization manage": "Manage organization"
  };
  return replacements[action] || action.split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function permissionPicker(selectedPermissions = [], { allowPrivileged = true } = {}) {
  const selected = new Set(selectedPermissions);
  return PERMISSION_GROUP_LABELS.map(([prefix, label], index) => {
    const perms = ALL_PERMISSION_OPTIONS.filter(p => p.startsWith(prefix) && (allowPrivileged || !PRIVILEGED_ACCESS_PERMISSIONS.has(p)));
    if (!perms.length) return "";
    const selectedCount = perms.filter(p => selected.has(p)).length;
    const expanded = index < 2 || selectedCount > 0;
    return `<section class="permission-group ${expanded ? "is-open" : ""}" data-permission-group>
      <button class="permission-group-head" type="button" data-toggle-permission-group aria-expanded="${expanded ? "true" : "false"}">
        <span class="permission-group-title">
          <span class="permission-group-icon">${esc(label.charAt(0))}</span>
          <span class="permission-group-text"><strong>${esc(label)}</strong><small><span data-group-selected>${selectedCount}</span> of ${perms.length} selected</small></span>
        </span>
        <span class="permission-chevron">⌄</span>
      </button>
      <div class="permission-group-body" ${expanded ? "" : "hidden"}>
        <div class="permission-group-actions">
          <button class="text-action" type="button" data-select-group>Select all</button>
          <button class="text-action" type="button" data-clear-group>Clear</button>
        </div>
        <div class="permission-list">${perms.map(p => `
          <label class="permission-row" data-permission-option="${esc((permissionFriendlyName(p) + " " + p).toLowerCase())}">
            <span class="permission-check"><input type="checkbox" name="permissions" value="${esc(p)}" ${selected.has(p) ? "checked" : ""}/><i></i></span>
            <span class="permission-copy">
              <strong>${esc(permissionFriendlyName(p))}</strong>
              <small>${esc(p)}</small>
            </span>
          </label>
        `).join("")}</div>
      </div>
    </section>`;
  }).join("");
}

function roleLabel(value) {
  return ROLE_OPTIONS.find(([role]) => role === value)?.[1]
    || String(value || "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function rolePicker(selectedRoles = [], { allowSystemOwner = true } = {}) {
  const selected = new Set(selectedRoles);
  const roles = ROLE_OPTIONS.filter(([value]) => allowSystemOwner || value !== "SYSTEM_OWNER");
  return `<div class="role-grid">${roles.map(([value,label]) => `
    <label class="role-card">
      <input type="checkbox" name="roles" value="${esc(value)}" ${selected.has(value) ? "checked" : ""}/>
      <span class="role-card-check">✓</span>
      <span><strong>${esc(label)}</strong><small>${esc(value.replaceAll("_", " "))}</small></span>
    </label>
  `).join("")}</div>`;
}

function renderAuth(mode = "signin") {
  const create = mode === "create";
  app.innerHTML = `
    <main class="auth-layout">
      <section class="auth-hero">
        <div class="auth-brand">
          <div class="brand-mark">C</div>
          <div><strong>Citadel</strong></div>
        </div>
        <div class="hero-copy">
          <div class="eyebrow">Enterprise Operations</div>
          <h1>One system.<br>Every operation.</h1>
          <p>A unified corporate workspace for people, customers, security, cases, approvals, and the operational data that connects them.</p>
        </div>
        <div class="auth-foot">Authorized access only · Access attempts may be logged</div>
      </section>
      <section class="auth-panel">
        <div class="auth-card">
          <div class="eyebrow">Secure access</div>
          <h2>${create ? "Create your account" : "Sign in to Citadel"}</h2>
          <p>${create ? "Create a Firebase Auth identity. Access to Citadel still requires provisioning or owner initialization." : "Use your authorized Citadel credentials to continue."}</p>
          <form id="auth-form">
            <div class="field">
              <label>Email address</label>
              <input class="input" name="email" type="email" autocomplete="email" required />
            </div>
            <div class="field">
              <label>Password</label>
              <input class="input" name="password" type="password" autocomplete="${create ? "new-password" : "current-password"}" minlength="6" required />
            </div>
            ${create ? `
              <div class="field">
                <label>Confirm password</label>
                <input class="input" name="confirmPassword" type="password" autocomplete="new-password" minlength="6" required />
              </div>
            ` : ""}
            <button class="btn btn-primary btn-block" type="submit">${create ? "Create account" : "Sign in"}</button>
          </form>
          <div class="auth-toggle">
            ${create
              ? `Already have an account? <button type="button" data-auth-mode="signin">Sign in</button>`
              : `Need an account? <button type="button" data-auth-mode="create">Create one</button> · <button type="button" data-reset>Password reset</button>`
            }
          </div>
        </div>
      </section>
    </main>
  `;

  app.querySelector("[data-auth-mode]")?.addEventListener("click", (e) => renderAuth(e.currentTarget.dataset.authMode));
  app.querySelector("[data-reset]")?.addEventListener("click", async () => {
    const email = app.querySelector('input[name="email"]').value.trim();
    if (!email) return toast("Email required", "Enter your email address first.");
    try {
      await sendPasswordResetEmail(auth, email);
      toast("Password reset sent", "Check your email for the reset link.");
    } catch (error) {
      toast("Could not send reset", firebaseMessage(error));
    }
  });

  app.querySelector("#auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const button = event.currentTarget.querySelector('button[type="submit"]');
    if (create && password !== form.get("confirmPassword")) {
      return toast("Passwords do not match", "Re-enter the same password in both fields.");
    }
    button.disabled = true;
    try {
      if (create) await createUserWithEmailAndPassword(auth, email, password);
      else await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      toast(create ? "Account not created" : "Sign in failed", firebaseMessage(error));
      button.disabled = false;
    }
  });
}

async function loadAccount(user) {
  state.user = user;
  const [userSnap, profileSnap, temporarySnap] = await Promise.all([
    getDoc(doc(db, "users", user.uid)).catch(() => null),
    getDoc(doc(db, "accessProfiles", user.uid)).catch(() => null),
    getDoc(doc(db, "temporaryAccess", user.uid)).catch(() => null)
  ]);

  state.userRecord = userSnap?.exists() ? userSnap.data() : null;
  state.profile = profileSnap?.exists() ? profileSnap.data() : null;
  state.temporaryAccess = temporarySnap?.exists() ? temporarySnap.data() : null;
  state.employee = null;

  if (state.userRecord?.employeeRecordId) {
    const employeeSnap = await getDoc(doc(db, "employees", state.userRecord.employeeRecordId)).catch(() => null);
    if (employeeSnap?.exists()) state.employee = { id: employeeSnap.id, ...employeeSnap.data() };
  }

  if (state.profile?.active === true && state.userRecord?.accountStatus === "active") {
    renderShell();
    return;
  }

  const bootstrapSnap = await getDoc(doc(db, "system", "bootstrap")).catch(() => null);
  const bootstrap = bootstrapSnap?.exists() ? bootstrapSnap.data() : null;

  if (
    bootstrap &&
    bootstrap.initialized !== true &&
    String(bootstrap.ownerEmail || "").toLowerCase() === String(user.email || "").toLowerCase()
  ) {
    renderOwnerBootstrap();
    return;
  }

  await ensureRegistrationRequest();
  renderPendingAccess(Boolean(bootstrap));
}

async function ensureRegistrationRequest() {
  if (!state.user) return;
  try {
    const ref = doc(db, "registrationRequests", state.user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: state.user.uid,
        email: state.user.email || "",
        displayName: state.user.displayName || "",
        status: "pending",
        requestedAt: serverTimestamp()
      });
    }
  } catch (error) {
    console.warn("Registration request unavailable", error);
  }
}

function renderOwnerBootstrap() {
  app.innerHTML = `
    <main class="access-screen">
      <section class="access-card">
        <div class="brand-mark" style="width:44px;height:44px">C</div>
        <div class="eyebrow" style="margin-top:18px">Initial system bootstrap</div>
        <h1>Initialize Citadel</h1>
        <p>Your authenticated email matches the bootstrap owner configured in Firestore. This one-time process creates the protected primary System Owner, C10 access profile, and the first Citadel personnel record.</p>
        <form id="owner-bootstrap" style="margin-top:22px">
          <div class="form-grid">
            <div class="field">
              <label>First name</label>
              <input class="input" name="firstName" required />
            </div>
            <div class="field">
              <label>Last name</label>
              <input class="input" name="lastName" required />
            </div>
            <div class="field span-2">
              <label>Display name</label>
              <input class="input" name="displayName" placeholder="How your name should appear in Citadel" />
            </div>
          </div>
          <div class="notice warning" style="margin:7px 0 18px">
            <div><strong>Protected principal</strong>This account cannot be managed like a normal employee account. All owner actions remain auditable.</div>
          </div>
          <button class="btn btn-primary" type="submit">Initialize as System Owner</button>
          <button class="btn btn-ghost" type="button" data-signout>Sign out</button>
        </form>
      </section>
    </main>
  `;

  app.querySelector("[data-signout]").addEventListener("click", () => signOut(auth));
  app.querySelector("#owner-bootstrap").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    const fd = new FormData(event.currentTarget);
    const firstName = String(fd.get("firstName") || "").trim();
    const lastName = String(fd.get("lastName") || "").trim();
    const displayName = String(fd.get("displayName") || "").trim() || `${firstName} ${lastName}`;
    try {
      const uid = state.user.uid;
      const employeeRecordId = uid;
      const batch = writeBatch(db);
      batch.set(doc(db, "employees", employeeRecordId), {
        employeeId: "EMP-000001",
        authUid: uid,
        firstName,
        lastName,
        displayName,
        searchName: displayName.toLowerCase(),
        workEmail: state.user.email || "",
        positionId: "POS-SYSTEM-OWNER",
        positionName: "System Owner",
        departmentId: "DEP-EXEC",
        departmentName: "Executive Administration",
        employmentStatus: "active",
        employmentType: "owner",
        clearanceLevel: 10,
        accountClass: "protected_principal",
        classification: "HIGHLY_RESTRICTED",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: uid,
        updatedBy: uid
      });
      batch.set(doc(db, "users", uid), {
        uid,
        employeeRecordId,
        employeeId: "EMP-000001",
        displayName,
        email: state.user.email || "",
        accountStatus: "active",
        protectedPrincipal: true,
        ownerStatus: "primary",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      batch.set(doc(db, "accessProfiles", uid), {
        uid,
        employeeId: "EMP-000001",
        active: true,
        clearanceLevel: 10,
        roles: ["SYSTEM_OWNER"],
        permissions: OWNER_PERMISSIONS,
        isSystemOwner: true,
        protectedPrincipal: true,
        scope: "organization",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      batch.set(doc(db, "system", "ownership"), {
        primaryOwnerUid: uid,
        primaryOwnerEmployeeId: "EMP-000001",
        status: "active",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      batch.set(doc(db, "counters", "employees"), {
        value: 1,
        updatedAt: serverTimestamp()
      });
      batch.update(doc(db, "system", "bootstrap"), {
        initialized: true,
        initializedBy: uid,
        initializedAt: serverTimestamp()
      });
      const auditRef = doc(collection(db, "auditEvents"));
      batch.set(auditRef, {
        actorUid: uid,
        actorEmployeeId: "EMP-000001",
        action: "SYSTEM_INITIALIZED",
        entityType: "system",
        entityId: "ownership",
        success: true,
        privilege: "SYSTEM_OWNER",
        createdAt: serverTimestamp()
      });
      await batch.commit();
      toast("Citadel initialized", "Primary System Owner created.");
      await loadAccount(state.user);
    } catch (error) {
      console.error(error);
      toast("Initialization failed", firebaseMessage(error));
      button.disabled = false;
    }
  });
}

function renderPendingAccess(bootstrapConfigured) {
  app.innerHTML = `
    <main class="access-screen">
      <section class="access-card">
        <div class="brand-mark" style="width:44px;height:44px">C</div>
        <div class="eyebrow" style="margin-top:18px">Account status</div>
        <h1>Access pending</h1>
        <p>Your Firebase account is valid, but it has not been provisioned with a Citadel employee record and access profile.</p>
        ${bootstrapConfigured ? `
          <div class="notice"><div><strong>Registration submitted</strong>An authorized Citadel administrator can approve this account from Administration → Account Requests.</div></div>
        ` : `
          <div class="notice warning"><div><strong>Bootstrap configuration required</strong>Create Firestore document <code>system/bootstrap</code> with <code>ownerEmail</code> set to the intended owner email and <code>initialized</code> set to <code>false</code>, then sign in with that account.</div></div>
        `}
        <div class="actions">
          <button class="btn" data-refresh>Check access again</button>
          <button class="btn btn-ghost" data-signout>Sign out</button>
        </div>
      </section>
    </main>
  `;
  app.querySelector("[data-refresh]").addEventListener("click", () => loadAccount(state.user));
  app.querySelector("[data-signout]").addEventListener("click", () => signOut(auth));
}

function navHtml() {
  const visible = NAV.filter((item) => {
    if (item.anyPermission) return item.anyPermission.some((permission) => hasPermission(permission));
    return !item.permission || hasPermission(item.permission);
  });

  let collapsed = {};
  try { collapsed = JSON.parse(localStorage.getItem("citadel.nav.collapsed") || "{}"); } catch {}

  const groups = new Map();
  visible.forEach(item => {
    if (!groups.has(item.section)) groups.set(item.section, []);
    groups.get(item.section).push(item);
  });

  return [...groups.entries()].map(([section, items]) => {
    const containsActive = items.some(item => item.id === state.route);
    const isCollapsed = collapsed[section] === true && !containsActive;
    return `<section class="nav-section ${isCollapsed ? "collapsed" : ""}" data-nav-section-wrap="${esc(section)}">
      <button class="nav-section-toggle" type="button" data-nav-section="${esc(section)}" aria-expanded="${isCollapsed ? "false" : "true"}">
        <span>${esc(section)}</span><span class="nav-section-chevron">⌄</span>
      </button>
      <div class="nav-section-items" ${isCollapsed ? "hidden" : ""}>
        ${items.map(item => `<button class="nav-item ${state.route === item.id ? "active" : ""}" data-route="${item.id}">
          <span class="nav-icon">${item.icon}</span><span>${esc(item.label)}</span>
        </button>`).join("")}
      </div>
    </section>`;
  }).join("");
}

function renderShell() {
  if (!NAV.some((n) => n.id === state.route) && !["search","notifications"].includes(state.route)) state.route = "home";
  app.innerHTML = `
    <div class="app-shell" id="shell">
      <div class="mobile-overlay" data-close-menu></div>
      <aside class="sidebar">
        <div class="sidebar-head">
          <div class="brand-mark">C</div>
          <div><strong>Citadel</strong><small>Enterprise Operations</small></div>
        </div>
        <nav class="sidebar-nav">${navHtml()}</nav>
        <div class="sidebar-user">
          <div class="user-chip">
            <div class="avatar">${esc(initials(accountName()))}</div>
            <div>
              <strong>${esc(accountName())}</strong>
              <span>${esc(state.employee?.positionName || state.profile?.roles?.[0] || "Employee")}</span>
            </div>
            <button class="icon-btn" style="width:30px;height:30px" data-signout title="Sign out">↪</button>
          </div>
        </div>
      </aside>
      <main class="workspace">
        <header class="topbar">
          <button class="icon-btn mobile-menu" data-menu aria-label="Open navigation">☰</button>
          <div class="global-search">
            <span class="search-icon">⌕</span>
            <input class="input" id="global-search" placeholder="Search people, customers, cases, assets…" value="${esc(state.search)}" />
            <kbd class="search-shortcut">Ctrl K</kbd>
          </div>
          <div class="top-actions">
            <button class="icon-btn hide-mobile" title="Approvals" data-route="approvals">✓</button>
            <button class="icon-btn" title="Notifications" data-route="notifications">●</button>
          </div>
        </header>
        <div id="page-content"></div>
      </main>
    </div>
  `;

  app.querySelectorAll("[data-route]").forEach((el) => el.addEventListener("click", () => navigate(el.dataset.route)));
  app.querySelectorAll("[data-nav-section]").forEach(button => button.addEventListener("click", () => {
    const section = button.dataset.navSection;
    const wrapper = button.closest("[data-nav-section-wrap]");
    const items = wrapper.querySelector(".nav-section-items");
    const open = wrapper.classList.contains("collapsed");
    wrapper.classList.toggle("collapsed", !open);
    items.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    let collapsed = {};
    try { collapsed = JSON.parse(localStorage.getItem("citadel.nav.collapsed") || "{}"); } catch {}
    collapsed[section] = !open;
    localStorage.setItem("citadel.nav.collapsed", JSON.stringify(collapsed));
  }));
  app.querySelector("[data-signout]").addEventListener("click", () => signOut(auth));
  app.querySelector("[data-menu]")?.addEventListener("click", () => app.querySelector("#shell").classList.add("menu-open"));
  app.querySelector("[data-close-menu]")?.addEventListener("click", () => app.querySelector("#shell").classList.remove("menu-open"));
  app.querySelector("#global-search").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    state.search = event.currentTarget.value.trim();
    navigate("search");
  });

  document.onkeydown = (event) => {
    const target = event.target;
    const typing = target && ["INPUT","TEXTAREA","SELECT"].includes(target.tagName);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      app.querySelector("#global-search")?.focus();
      app.querySelector("#global-search")?.select();
    } else if (event.key === "/" && !typing) {
      event.preventDefault();
      app.querySelector("#global-search")?.focus();
    }
  };

  renderPage();
}

function navigate(route) {
  state.route = route;
  app.querySelector("#shell")?.classList.remove("menu-open");
  renderShell();
}

async function renderPage() {
  const target = document.getElementById("page-content");
  target.innerHTML = `<div class="page"><div class="page-skeleton"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-subtitle"></div><div class="skeleton-grid">${Array.from({length:4},()=>'<div class="skeleton skeleton-card"></div>').join("")}</div><div class="skeleton skeleton-panel"></div></div></div>`;
  try {
    const renderers = {
      home: renderHome,
      customers: renderCustomers,
      cases: renderCases,
      people: renderPeople,
      approvals: renderApprovals,
      search: renderGlobalSearch,
      security: renderSecurity,
      admin: renderAdmin,
      ...generation2.renderers,
      ...generation3.renderers
    };
    await (renderers[state.route] || renderHome)(target);
  } catch (error) {
    console.error(error);
    target.innerHTML = `<div class="page"><div class="notice danger"><div><strong>Unable to load this area</strong>${esc(firebaseMessage(error))}</div></div></div>`;
  }
}

async function safeCollection(name, count = 50, field = "createdAt") {
  try {
    const snap = await getDocs(query(collection(db, name), orderBy(field, "desc"), limit(count)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    if (error?.code === "permission-denied") return [];
    throw error;
  }
}

function pageHeader(title, subtitle, actions = "") {
  const section = NAV.find(item => item.id === state.route)?.section || (state.route === "notifications" ? "Workspace" : "Citadel");
  return `<div class="page-head">
    <div><div class="eyebrow">${esc(section)} · Citadel</div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>
    <div class="page-actions">${actions}</div>
  </div>`;
}

async function renderGlobalSearch(target) {
  const term = state.search.trim().toLowerCase();

  if (!term) {
    target.innerHTML = `
      <div class="page">
        ${pageHeader("Search", "Search across the Citadel records your account is authorized to discover.")}
        <div class="empty"><strong>Enter a search term</strong><p>Search by name, Citadel ID, email, title, customer ID, asset tag, or other record identifier.</p></div>
      </div>
    `;
    return;
  }

  const [customerSnap, employees, cases, assets, vendors, projects] = await Promise.all([
    hasPermission("customer.view") ? customerQuery() : Promise.resolve({ docs: [] }),
    hasPermission("employee.view") ? safeCollection("employees", 150) : Promise.resolve([]),
    hasPermission("case.view") ? safeCollection("cases", 150) : Promise.resolve([]),
    hasPermission("asset.view") ? safeCollection("assets", 150) : Promise.resolve([]),
    hasPermission("vendor.view") ? safeCollection("vendors", 150) : Promise.resolve([]),
    hasPermission("project.view") ? safeCollection("projects", 150) : Promise.resolve([])
  ]);

  const customers = customerSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const filter = (records, fields) => records.filter((record) =>
    fields.some((field) => String(record[field] || "").toLowerCase().includes(term))
  ).slice(0, 20);

  const employeeMatches = filter(employees, ["employeeId","displayName","workEmail","positionName","departmentName"]);
  const caseMatches = filter(cases, ["caseId","title","customerId","category","assignedEmployeeId"]);
  const assetMatches = filter(assets, ["assetId","name","serialNumber","assetTag","assignedEmployeeId"]);
  const vendorMatches = filter(vendors, ["vendorId","name","email","category","contactName"]);
  const projectMatches = filter(projects, ["projectId","name","ownerEmployeeId","department","summary"]);

  const groups = [
    {
      label: "Customers",
      route: "customers",
      records: customers.slice(0,20),
      row: r => `<div class="grow"><strong>${esc(customerDisplayName(r))}</strong><span>${esc(r.customerId || "—")} · ${esc(r.email || "")}</span></div>${classificationBadge(r.classification || "STANDARD")}`
    },
    {
      label: "Employees",
      route: "people",
      records: employeeMatches,
      row: r => `<div class="grow"><strong>${esc(r.displayName || "Employee")}</strong><span>${esc(r.employeeId || "—")} · ${esc(r.positionName || "")}</span></div><span class="badge">C${Number(r.clearanceLevel || 0)}</span>`
    },
    {
      label: "Cases",
      route: "cases",
      records: caseMatches,
      row: r => `<div class="grow"><strong>${esc(r.title || "Case")}</strong><span>${esc(r.caseId || "—")} · ${esc(r.customerId || "")}</span></div>${statusBadge(r.status || "Open")}`
    },
    {
      label: "Assets",
      route: "assets",
      records: assetMatches,
      row: r => `<div class="grow"><strong>${esc(r.name || "Asset")}</strong><span>${esc(r.assetId || "—")} · ${esc(r.assetTag || r.serialNumber || "")}</span></div>${statusBadge(r.status || "Available")}`
    },
    {
      label: "Vendors",
      route: "vendors",
      records: vendorMatches,
      row: r => `<div class="grow"><strong>${esc(r.name || "Vendor")}</strong><span>${esc(r.vendorId || "—")} · ${esc(r.category || "")}</span></div>${statusBadge(r.status || "Active")}`
    },
    {
      label: "Projects",
      route: "projects",
      records: projectMatches,
      row: r => `<div class="grow"><strong>${esc(r.name || "Project")}</strong><span>${esc(r.projectId || "—")} · ${esc(r.ownerEmployeeId || "")}</span></div>${statusBadge(r.status || "Planning")}`
    }
  ].filter((g) => g.records.length);

  target.innerHTML = `
    <div class="page">
      ${pageHeader("Search", `Authorized results for “${state.search}”`)}
      ${groups.length ? `<div class="section-stack">${groups.map((group) => `
        <section class="card">
          <div class="card-head"><div><h2>${esc(group.label)}</h2><p>${group.records.length} result${group.records.length === 1 ? "" : "s"}</p></div><button class="btn btn-sm" data-search-route="${esc(group.route)}">Open module</button></div>
          <div class="list">${group.records.map((record) => `<div class="list-row">${group.row(record)}</div>`).join("")}</div>
        </section>
      `).join("")}</div>` : '<div class="empty"><strong>No authorized results</strong><p>Nothing visible to your current account matched this search.</p></div>'}
    </div>
  `;

  target.querySelectorAll("[data-search-route]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.searchRoute)));
}

async function renderHome(target) {
  const [customers, cases, approvals, requests, serviceTickets, notifications] = await Promise.all([
    hasPermission("customer.view") ? (async () => {
      try {
        await ensureCustomerAccessModel();
        const snap = await getDocs(query(
          collection(db,"customers"),
          where("accessLevel","in",customerAccessLevelsForClearance()),
          limit(100)
        ));
        return snap.docs
          .map(d=>({id:d.id,...d.data()}))
          .sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));
      } catch { return []; }
    })() : [],
    hasPermission("case.view") ? safeCollection("cases", 100) : [],
    hasPermission("approval.view") ? safeCollection("approvals", 100) : [],
    hasPermission("system.manage") ? safeCollection("registrationRequests", 100, "requestedAt") : [],
    hasPermission("service.view") ? safeCollection("serviceTickets", 100) : [],
    hasPermission("notification.view") ? (async () => {
      try {
        const snap = await getDocs(query(collection(db,"notifications"),where("recipientUid","==",state.user.uid),limit(100)));
        return snap.docs.map(d=>({id:d.id,...d.data()}));
      } catch { return []; }
    })() : []
  ]);

  const openCases = cases.filter((c) => !["closed","resolved"].includes(String(c.status).toLowerCase()));
  const pendingApprovals = approvals.filter((a) => ["pending","submitted"].includes(String(a.status).toLowerCase()));
  const pendingAccounts = requests.filter((r) => r.status === "pending");
  const openService = serviceTickets.filter(t => !["resolved","closed","cancelled"].includes(String(t.status).toLowerCase()));
  const unreadNotifications = notifications.filter(n => n.read !== true);

  const homeMetrics = [
    hasPermission("customer.view") && { route:"customers", label:"Customers", value:customers.length, meta:"Authorized records" },
    hasPermission("case.view") && { route:"cases", label:"Open cases", value:openCases.length, meta:"Requires attention" },
    hasPermission("approval.view") && { route:"approvals", label:"Pending approvals", value:pendingApprovals.length, meta:"Awaiting decisions" },
    hasPermission("notification.view") && { route:"notifications", label:"Unread", value:unreadNotifications.length, meta:"Notifications" },
    hasPermission("service.view") && { route:"service", label:"Service queue", value:openService.length, meta:"Open internal requests" },
    hasPermission("system.manage") && { route:"admin", label:"Account requests", value:pendingAccounts.length, meta:"Awaiting provisioning" }
  ].filter(Boolean).slice(0,4);

  const quickActions = [
    hasPermission("customer.create") && { route:"customers", icon:"+", title:"New customer", detail:"Create a Customer 360 record" },
    hasPermission("case.create") && { route:"cases", icon:"◇", title:"Open case", detail:"Start customer or operational casework" },
    hasPermission("service.create") && { route:"service", icon:"↗", title:"Service request", detail:"Request internal support" },
    hasPermission("procurement.request") && { route:"procurement", icon:"$", title:"Purchase request", detail:"Start procurement review" },
    hasPermission("finance.expense.create") && { route:"finance", icon:"↥", title:"Submit expense", detail:"Send an expense to Finance" },
    hasPermission("hr.request.leave") && { route:"hr", icon:"○", title:"Request leave", detail:"Submit time away for review" },
    hasPermission("analytics.view") && { route:"intelligence", icon:"▥", title:"Enterprise insights", detail:"Open cross-functional intelligence" },
    hasPermission("system.manage") && { route:"admin", icon:"⚙", title:"Administration", detail:"Provision accounts and system settings" }
  ].filter(Boolean).slice(0,8);

  const attention = [
    pendingApprovals.length && { route:"approvals", value:pendingApprovals.length, title:"Approvals waiting", detail:"Decisions require authorized review" },
    openCases.length && { route:"cases", value:openCases.length, title:"Open cases", detail:"Customer and operational casework" },
    openService.length && { route:"service", value:openService.length, title:"Service requests", detail:"Internal support queue" },
    pendingAccounts.length && { route:"admin", value:pendingAccounts.length, title:"Account requests", detail:"Users awaiting provisioning" },
    unreadNotifications.length && { route:"notifications", value:unreadNotifications.length, title:"Unread notifications", detail:"New Citadel activity for you" }
  ].filter(Boolean);

  target.innerHTML = `
    <div class="page">
      <section class="home-hero">
        <div class="home-hero-copy">
          <div class="eyebrow">Your workspace</div>
          <h1>Good to see you, ${esc(accountName().split(" ")[0] || accountName())}.</h1>
          <p>${esc(state.employee?.positionName || roleLabel(state.profile?.roles?.[0] || "Employee"))} · ${esc(state.employee?.departmentName || "Citadel")}</p>
        </div>
        <div class="home-identity">
          <div><span>Effective clearance</span><strong>C${effectiveClearance()}</strong></div>
          <div><span>Primary role</span><strong>${esc(roleLabel(state.profile?.roles?.[0] || "Employee"))}</strong></div>
          ${temporaryGrantActive() ? '<div class="home-temp-badge"><span>Temporary access</span><strong>Active</strong></div>' : ""}
        </div>
      </section>

      <div class="kpi-grid home-kpis">
        ${homeMetrics.map(metric => `<button class="kpi-card kpi-button" data-route-local="${esc(metric.route)}"><div class="kpi-label">${esc(metric.label)}</div><div class="kpi-value">${metric.value}</div><div class="kpi-meta">${esc(metric.meta)}</div></button>`).join("")}
      </div>

      <section class="workspace-section">
        <div class="section-heading"><div><span class="eyebrow">Start something</span><h2>Quick actions</h2></div></div>
        <div class="quick-grid">
          ${quickActions.map(action => `
            <button class="quick-action" data-route-local="${esc(action.route)}">
              <span class="quick-action-icon">${action.icon}</span>
              <span><strong>${esc(action.title)}</strong><small>${esc(action.detail)}</small></span>
              <span class="quick-action-arrow">→</span>
            </button>
          `).join("")}
        </div>
      </section>

      <div class="grid-2 home-grid">
        <section class="card">
          <div class="card-head"><div><h2>My work</h2><p>Items that need attention across Citadel</p></div></div>
          ${attention.length ? `<div class="attention-list">${attention.map(item => `
            <button class="attention-row" data-route-local="${esc(item.route)}">
              <span class="attention-value">${item.value}</span>
              <span class="grow"><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></span>
              <span class="attention-arrow">→</span>
            </button>
          `).join("")}</div>` : '<div class="empty"><strong>You are caught up</strong><p>No configured work queues currently need your attention.</p></div>'}
        </section>

        <section class="card">
          <div class="card-head"><div><h2>Recent cases</h2><p>Latest unresolved casework</p></div><button class="btn btn-sm" data-route-local="cases">View all</button></div>
          ${openCases.length ? `<div class="list">${openCases.slice(0,6).map((caseRecord) => `
            <div class="list-row"><div class="grow"><strong>${esc(caseRecord.title || "Case")}</strong><span>${esc(caseRecord.category || "General")} · ${esc(caseRecord.priority || "Normal")} priority</span></div>${statusBadge(caseRecord.status || "Open")}</div>
          `).join("")}</div>` : '<div class="empty"><strong>No open cases</strong><p>New casework will appear here.</p></div>'}
        </section>
      </div>
    </div>
  `;

  target.querySelectorAll("[data-route-local]").forEach((el) => el.addEventListener("click", () => navigate(el.dataset.routeLocal)));
}

async function customerQuery() {
  const term = state.search.trim().toLowerCase();
  const clearance = effectiveClearance();

  await ensureCustomerAccessModel();

  let snap = await getDocs(query(
    collection(db, "customers"),
    where("accessLevel", "in", customerAccessLevelsForClearance(clearance)),
    limit(200)
  ));

  if (snap.empty && state.profile?.isSystemOwner === true) {
    snap = await getDocs(query(
      collection(db,"customers"),
      where("classification","in",classificationsForClearance(clearance)),
      limit(200)
    ));
  }

  if (!term) return snap;

  const docs = snap.docs.filter((d) => {
    const data = d.data();
    return [
      data.customerId,
      data.displayName,
      data.searchName,
      data.email,
      data.phone
    ].some((value) => String(value || "").toLowerCase().includes(term));
  });

  return { docs };
}

async function renderCustomers(target) {
  const [snap, employees] = await Promise.all([
    customerQuery(),
    hasPermission("employee.view") ? safeCollection("employees",250) : Promise.resolve([])
  ]);
  const customers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  target.innerHTML = `
    <div class="page">
      ${pageHeader("Customers", state.search ? `Search results for “${state.search}”` : "Customer 360 records and account relationships.", hasPermission("customer.create") ? '<button class="btn btn-primary" data-new-customer>New customer</button>' : "")}
      <section class="card">
        <div class="card-head">
          <div><h2>Customer directory</h2><p>${customers.length} authorized result${customers.length === 1 ? "" : "s"}</p></div>
          ${state.search ? '<button class="btn btn-sm" data-clear-search>Clear search</button>' : ""}
        </div>
        ${customers.length ? `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Customer</th><th>Status</th><th>Classification</th><th>Contact</th><th>Assigned</th><th>Updated</th></tr></thead>
            <tbody>${customers.map((c) => `
              <tr data-customer="${esc(c.id)}" style="cursor:pointer">
                <td><div class="primary-cell">${esc(customerDisplayName(c))}</div><div class="secondary">${esc(c.customerId || "—")}</div></td>
                <td>${statusBadge(c.status || "Active")}</td>
                <td>${classificationBadge(c.classification || "STANDARD")}</td>
                <td><div>${esc(c.email || "—")}</div><div class="secondary">${esc(c.phone || "")}</div></td>
                <td><div class="primary-cell">${esc(employeeDisplay(employees,c.assignedEmployeeId))}</div><div class="secondary">${esc(employeeDisplayContext(employees,c.assignedEmployeeId))}</div></td>
                <td>${esc(fmtDate(c.updatedAt || c.createdAt))}</td>
              </tr>
            `).join("")}</tbody>
          </table></div>
        ` : `<div class="empty"><strong>No customers found</strong><p>Create the first customer or adjust your search.</p></div>`}
      </section>
    </div>
  `;

  target.querySelector("[data-new-customer]")?.addEventListener("click", newCustomerModal);
  target.querySelector("[data-clear-search]")?.addEventListener("click", () => { state.search = ""; renderShell(); });
  target.querySelectorAll("[data-customer]").forEach((row) => row.addEventListener("click", () => {
    const customer = customers.find((c) => c.id === row.dataset.customer);
    openCustomer(customer);
  }));
}

function newCustomerModal() {
  openModal({
    title: "Create customer",
    submitLabel: "Create customer",
    body: `
      <div class="form-grid">
        <div class="field"><label>First name</label><input class="input" name="firstName" required /></div>
        <div class="field"><label>Last name</label><input class="input" name="lastName" required /></div>
        <div class="field"><label>Email</label><input class="input" name="email" type="email" /></div>
        <div class="field"><label>Phone</label><input class="input" name="phone" /></div>
        <div class="field"><label>Status</label><select class="select" name="status"><option>Active</option><option>Prospect</option><option>Inactive</option></select></div>
        <div class="field"><label>Classification</label><select class="select" name="classification"><option>STANDARD</option><option>INTERNAL</option><option>CONFIDENTIAL</option><option>SENSITIVE</option><option>RESTRICTED</option><option>HIGHLY_RESTRICTED</option></select></div>
        <div class="field span-2"><label>Internal note</label><textarea class="textarea" name="note" placeholder="Optional initial context"></textarea></div>
      </div>
    `,
    onSubmit: async (fd) => {
      try {
        const firstName = String(fd.get("firstName") || "").trim();
        const lastName = String(fd.get("lastName") || "").trim();
        const displayName = `${firstName} ${lastName}`.trim();
        const customerId = await nextId("customers", "CUS");
        const ref = doc(collection(db, "customers"));
        const batch = writeBatch(db);
        batch.set(ref, {
          customerId,
          firstName,
          lastName,
          displayName,
          searchName: displayName.toLowerCase(),
          email: String(fd.get("email") || "").trim().toLowerCase(),
          phone: String(fd.get("phone") || "").trim(),
          status: String(fd.get("status") || "Active"),
          classification: String(fd.get("classification") || "STANDARD"),
          minimumClearance: classificationLevel(String(fd.get("classification") || "STANDARD")),
          assignedEmployeeId: state.employee?.employeeId || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: state.user.uid,
          updatedBy: state.user.uid
        });
        const note = String(fd.get("note") || "").trim();
        if (note) {
          const noteRef = doc(collection(db, "customerNotes"));
          batch.set(noteRef, {
            customerRecordId: ref.id,
            customerId,
            body: note,
            internal: true,
            createdBy: state.user.uid,
            createdByEmployeeId: state.employee?.employeeId || null,
            createdAt: serverTimestamp()
          });
        }
        await batch.commit();
        await audit("CUSTOMER_CREATED", "customer", ref.id, { customerId });
        toast("Customer created", customerId);
        state.search = "";
        await renderPage();
        return true;
      } catch (error) {
        toast("Customer not created", firebaseMessage(error));
        return false;
      }
    }
  });
}

async function openCustomer(customer) {
  let notes = [];
  let flags = [];
  let interactions = [];
  let relatedCases = [];
  try {
    const [noteSnap, flagSnap, interactionSnap, caseSnap] = await Promise.all([
      getDocs(query(collection(db, "customerNotes"), where("customerRecordId", "==", customer.id), limit(40))),
      getDocs(query(collection(db, "customerFlags"), where("customerRecordId", "==", customer.id), limit(30))),
      getDocs(query(collection(db, "customerInteractions"), where("customerRecordId", "==", customer.id), limit(40))),
      customer.customerId
        ? getDocs(query(collection(db, "cases"), where("customerId", "==", customer.customerId), limit(40)))
        : Promise.resolve({ docs: [] })
    ]);
    notes = noteSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    flags = flagSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    interactions = interactionSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    relatedCases = caseSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.warn("Customer 360 related records unavailable", error);
  }
  const openCustomerCases = relatedCases.filter(r => !["Resolved","Closed"].includes(r.status));
  const criticalFlags = flags.filter(f => f.active !== false && ["High","Critical"].includes(f.severity));
  const escalatedCases = openCustomerCases.filter(r => r.status === "Escalated" || r.priority === "Critical");
  const customerRiskScore = Math.min(100, criticalFlags.length * 25 + escalatedCases.length * 20 + Math.min(30, openCustomerCases.length * 5));
  const customerRiskLevel = customerRiskScore >= 70 ? "Critical" : customerRiskScore >= 40 ? "High" : customerRiskScore >= 20 ? "Moderate" : "Low";

  await audit("CUSTOMER_VIEWED", "customer", customer.id, { customerId: customer.customerId || null });
  openModal({
    title: customerDisplayName(customer),
    submitLabel: "Save changes",
    width: "760px",
    body: `
      ${["RESTRICTED","HIGHLY_RESTRICTED"].includes(String(customer.classification)) ? `<div class="notice warning" style="margin-bottom:16px"><div><strong>Protected customer record</strong>This record is classified ${esc(customer.classification)}. Access has been logged.</div></div>` : ""}
      <div class="security-grid" style="margin-bottom:18px">
        <div class="security-box"><span>Customer ID</span><strong>${esc(customer.customerId || "—")}</strong></div>
        <div class="security-box"><span>Status</span><strong>${esc(customer.status || "Active")}</strong></div>
        <div class="security-box"><span>Classification</span><strong>${esc(customer.classification || "STANDARD")}</strong></div>
        <div class="security-box"><span>Customer risk</span><strong>${esc(customerRiskLevel)} · ${customerRiskScore}/100</strong></div>
      </div>
      <div class="form-grid">
        <div class="field"><label>First name</label><input class="input" name="firstName" value="${esc(customer.firstName || "")}" /></div>
        <div class="field"><label>Last name</label><input class="input" name="lastName" value="${esc(customer.lastName || "")}" /></div>
        <div class="field"><label>Email</label><input class="input" type="email" name="email" value="${esc(customer.email || "")}" /></div>
        <div class="field"><label>Phone</label><input class="input" name="phone" value="${esc(customer.phone || "")}" /></div>
        <div class="field"><label>Status</label><select class="select" name="status">${["Active","Prospect","Inactive","Archived"].map((v) => `<option ${customer.status === v ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="field"><label>Classification</label><select class="select" name="classification">${["STANDARD","INTERNAL","CONFIDENTIAL","SENSITIVE","RESTRICTED","HIGHLY_RESTRICTED"].map((v) => `<option ${customer.classification === v ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      </div>
      <div class="grid-2" style="margin-top:8px">
        <div class="section-stack">
          <div class="card">
            <div class="card-head"><div><h2>Internal notes</h2><p>Authorized employee context</p></div></div>
            ${notes.length ? `<div class="list">${notes.slice(0,10).map((n) => `<div class="list-row"><div class="grow"><strong>${esc(n.body || "Note")}</strong><span>${esc(n.createdByEmployeeId || "Employee")} · ${esc(fmtDateTime(n.createdAt))}</span></div></div>`).join("")}</div>` : '<div class="empty"><strong>No notes yet</strong><p>Customer notes will appear here.</p></div>'}
          </div>
          <div class="card">
            <div class="card-head"><div><h2>Interactions</h2><p>Logged customer communications and contact</p></div></div>
            ${interactions.length ? `<div class="list">${interactions.slice(0,10).map((i) => `<div class="list-row"><div class="grow"><strong>${esc(i.summary || i.channel || "Interaction")}</strong><span>${esc(i.channel || "Contact")} · ${esc(i.createdByEmployeeId || "Employee")} · ${esc(fmtDateTime(i.createdAt))}</span></div></div>`).join("")}</div>` : '<div class="empty"><strong>No interactions logged</strong><p>Calls, emails, meetings, and other contact will appear here.</p></div>'}
          </div>
        </div>
        <div class="section-stack">
          <div class="card">
            <div class="card-head"><div><h2>Flags</h2><p>Operational and risk indicators</p></div></div>
            ${flags.length ? `<div class="list">${flags.slice(0,10).map((f) => `<div class="list-row"><div class="grow"><strong>${esc(f.name || "Customer flag")}</strong><span>${esc(f.details || "No additional detail")}</span></div>${statusBadge(f.severity || "Normal")}</div>`).join("")}</div>` : '<div class="empty"><strong>No active flags</strong><p>Authorized customer flags will appear here.</p></div>'}
          </div>
          <div class="card">
            <div class="card-head"><div><h2>Related cases</h2><p>Customer service and operational case history</p></div></div>
            ${relatedCases.length ? `<div class="list">${relatedCases.slice(0,10).map((r) => `<div class="list-row"><div class="grow"><strong>${esc(r.title || "Case")}</strong><span>${esc(r.caseId || "—")} · ${esc(r.category || "General")}</span></div>${statusBadge(r.status || "Open")}</div>`).join("")}</div>` : '<div class="empty"><strong>No related cases</strong><p>Cases linked to this customer will appear here.</p></div>'}
          </div>
        </div>
      </div>
      ${hasPermission("customer.edit") ? `
        <div class="card" style="margin-top:14px">
          <div class="card-head"><div><h2>Record activity</h2><p>Add context without leaving Customer 360</p></div></div>
          <div class="card-body">
            <div class="form-grid">
              <div class="field span-2"><label>New internal note</label><textarea class="textarea" name="newInternalNote" placeholder="Optional internal note"></textarea></div>
              <div class="field"><label>Interaction channel</label><select class="select" name="interactionChannel"><option value="">No interaction</option><option>Phone</option><option>Email</option><option>SMS</option><option>Meeting</option><option>Portal</option><option>Letter</option><option>Other</option></select></div>
              <div class="field"><label>Interaction summary</label><input class="input" name="interactionSummary" placeholder="Optional interaction summary" /></div>
              <div class="field"><label>New flag</label><input class="input" name="newFlagName" placeholder="Optional customer flag" /></div>
              <div class="field"><label>Flag severity</label><select class="select" name="newFlagSeverity"><option>Normal</option><option>Important</option><option>High</option><option>Critical</option></select></div>
              <div class="field span-2"><label>Flag details</label><input class="input" name="newFlagDetails" placeholder="Optional flag details" /></div>
            </div>
          </div>
        </div>
      ` : ""}
    `,
    onSubmit: async (fd) => {
      if (!hasPermission("customer.edit")) {
        toast("Access denied", "Your profile cannot edit customer records.");
        return false;
      }
      try {
        const firstName = String(fd.get("firstName") || "").trim();
        const lastName = String(fd.get("lastName") || "").trim();
        await updateDoc(doc(db, "customers", customer.id), {
          firstName,
          lastName,
          displayName: `${firstName} ${lastName}`.trim(),
          searchName: `${firstName} ${lastName}`.trim().toLowerCase(),
          email: String(fd.get("email") || "").trim().toLowerCase(),
          phone: String(fd.get("phone") || "").trim(),
          status: String(fd.get("status") || "Active"),
          classification: String(fd.get("classification") || "STANDARD"),
          minimumClearance: classificationLevel(String(fd.get("classification") || "STANDARD")),
          updatedAt: serverTimestamp(),
          updatedBy: state.user.uid
        });

        const newNote = String(fd.get("newInternalNote") || "").trim();
        if (newNote) {
          await addDoc(collection(db, "customerNotes"), {
            customerRecordId: customer.id,
            customerId: customer.customerId || null,
            body: newNote,
            internal: true,
            createdBy: state.user.uid,
            createdByEmployeeId: state.employee?.employeeId || null,
            createdAt: serverTimestamp()
          });
        }

        const interactionChannel = String(fd.get("interactionChannel") || "").trim();
        const interactionSummary = String(fd.get("interactionSummary") || "").trim();
        if (interactionChannel && interactionSummary) {
          await addDoc(collection(db, "customerInteractions"), {
            customerRecordId: customer.id,
            customerId: customer.customerId || null,
            channel: interactionChannel,
            summary: interactionSummary,
            createdBy: state.user.uid,
            createdByEmployeeId: state.employee?.employeeId || null,
            createdAt: serverTimestamp()
          });
        }

        const flagName = String(fd.get("newFlagName") || "").trim();
        if (flagName) {
          await addDoc(collection(db, "customerFlags"), {
            customerRecordId: customer.id,
            customerId: customer.customerId || null,
            name: flagName,
            severity: String(fd.get("newFlagSeverity") || "Normal"),
            details: String(fd.get("newFlagDetails") || "").trim(),
            active: true,
            createdBy: state.user.uid,
            createdByEmployeeId: state.employee?.employeeId || null,
            createdAt: serverTimestamp()
          });
        }

        await audit("CUSTOMER_UPDATED", "customer", customer.id, { customerId: customer.customerId || null });
        toast("Customer updated", customer.customerId || "");
        await renderPage();
        return true;
      } catch (error) {
        toast("Update failed", firebaseMessage(error));
        return false;
      }
    }
  });
}

async function renderCases(target) {
  const [cases, refs] = await Promise.all([
    safeCollection("cases",75),
    loadReferenceData()
  ]);
  target.innerHTML = `
    <div class="page">
      ${pageHeader("Cases", "Customer service, escalations, and operational casework.", hasPermission("case.create") ? '<button class="btn btn-primary" data-new-case>New case</button>' : "")}
      <section class="card">
        <div class="card-head"><div><h2>Case queue</h2><p>${cases.length} recent case${cases.length === 1 ? "" : "s"}</p></div></div>
        ${cases.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Case</th><th>Priority</th><th>Status</th><th>Customer</th><th>Owner</th><th>SLA</th><th>Created</th></tr></thead>
          <tbody>${cases.map((c) => {
            const slaBreached = c.slaDueAt && c.slaDueAt?.toDate ? c.slaDueAt.toDate().getTime() < Date.now() : (c.slaDueAt ? new Date(c.slaDueAt).getTime() < Date.now() : false);
            const closed = ["Resolved","Closed"].includes(c.status);
            return `<tr>
              <td><div class="primary-cell">${esc(c.title || "Untitled case")}</div><div class="secondary">${esc(c.caseId || "—")}</div></td>
              <td>${statusBadge(c.priority || "Normal")}</td>
              <td>${statusBadge(c.status || "Open")}</td>
              <td>${(() => { const customer=customerFromHumanId(refs.customers,c.customerId); return customer ? `<div class="primary-cell">${esc(customerDisplayName(customer))}</div><div class="secondary">${esc(c.customerId || "")}</div>` : esc(c.customerId || "Internal"); })()}</td>
              <td><div class="primary-cell">${esc(employeeDisplay(refs.employees,c.assignedEmployeeId))}</div><div class="secondary">${esc(employeeDisplayContext(refs.employees,c.assignedEmployeeId))}</div></td>
              <td>${c.slaDueAt ? statusBadge(!closed && slaBreached ? "Breached" : closed ? "Complete" : "On Track") : '<span class="badge">Not set</span>'}</td>
              <td>${esc(fmtDate(c.createdAt))}</td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>` : '<div class="empty"><strong>No cases yet</strong><p>Create a case to begin operational case management.</p></div>'}
      </section>
    </div>
  `;
  target.querySelector("[data-new-case]")?.addEventListener("click", newCaseModal);
}

async function newCaseModal() {
  const refs = await loadReferenceData();
  openModal({
    title: "Create case",
    submitLabel: "Create case",
    body: `
      <div class="form-grid">
        <div class="field span-2"><label>Case title</label><input class="input" name="title" required /></div>
        <div class="field"><label>Customer</label><select class="select" name="customerId"><option value="">No customer / internal case</option>${refs.customers.map(customer => option(customer.customerId || customer.id, `${customerDisplayName(customer)} — ${customer.customerId || ""}`)).join("")}</select></div>
        <div class="field"><label>Category</label><select class="select" name="category"><option>General</option><option>Account</option><option>Billing</option><option>Service</option><option>Complaint</option><option>Order</option><option>Technical</option><option>Security</option><option>Compliance</option><option>Other</option></select></div>
        <div class="field"><label>Priority</label><select class="select" name="priority"><option>Normal</option><option>High</option><option>Critical</option><option>Low</option></select></div>
        <div class="field"><label>Status</label><select class="select" name="status"><option>New</option><option>Open</option><option>In Progress</option><option>Pending Customer</option><option>Pending Internal</option><option>Escalated</option></select></div>
        <div class="field"><label>SLA target</label><select class="select" name="slaHours"><option value="4">4 hours</option><option value="8">8 hours</option><option value="24" selected>24 hours</option><option value="48">48 hours</option><option value="72">72 hours</option></select></div>
        <div class="field span-2"><label>Description</label><textarea class="textarea" name="description" required></textarea></div>
      </div>
    `,
    onSubmit: async (fd) => {
      try {
        const caseId = await nextId("cases", "CASE");
        const ref = doc(collection(db, "cases"));
        await setDoc(ref, {
          caseId,
          title: String(fd.get("title") || "").trim(),
          customerId: String(fd.get("customerId") || "").trim().toUpperCase() || null,
          category: String(fd.get("category") || "General").trim(),
          priority: String(fd.get("priority") || "Normal"),
          status: String(fd.get("status") || "New"),
          description: String(fd.get("description") || "").trim(),
          slaHours: Number(fd.get("slaHours") || 24),
          slaDueAt: new Date(Date.now() + Number(fd.get("slaHours") || 24) * 3600000),
          assignedEmployeeId: state.employee?.employeeId || null,
          assignedUid: state.user.uid,
          createdBy: state.user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        await audit("CASE_CREATED", "case", ref.id, { caseId });
        toast("Case created", caseId);
        await renderPage();
        return true;
      } catch (error) {
        toast("Case not created", firebaseMessage(error));
        return false;
      }
    }
  });
}

async function peopleQuery() {
  const term = state.route === "people" ? state.search.trim() : "";
  if (!term) return getDocs(query(collection(db, "employees"), orderBy("createdAt", "desc"), limit(75)));
  if (/^EMP-/i.test(term)) return getDocs(query(collection(db, "employees"), where("employeeId", "==", term.toUpperCase()), limit(20)));
  const normalized = term.toLowerCase();
  return getDocs(query(collection(db, "employees"), orderBy("searchName"), where("searchName", ">=", normalized), where("searchName", "<=", normalized + "\uf8ff"), limit(50)));
}

async function renderPeople(target) {
  const snap = await peopleQuery();
  const people = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  target.innerHTML = `
    <div class="page">
      ${pageHeader("People", "Citadel personnel directory and employment identity records.")}
      <section class="card">
        <div class="card-head"><div><h2>Employee directory</h2><p>${people.length} authorized result${people.length === 1 ? "" : "s"}</p></div></div>
        ${people.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Employee</th><th>Position</th><th>Department</th><th>Status</th><th>Clearance</th></tr></thead>
          <tbody>${people.map((p) => `<tr data-employee-record="${esc(p.id)}" style="${hasPermission("employee.manage") ? "cursor:pointer" : ""}">
            <td><div class="primary-cell">${esc(p.displayName || "Unnamed employee")}</div><div class="secondary">${esc(p.employeeId || "—")} · ${esc(p.workEmail || "")}</div></td>
            <td>${esc(p.positionName || "—")}</td>
            <td>${esc(p.departmentName || "—")}</td>
            <td>${statusBadge(p.employmentStatus || "Active")}</td>
            <td><span class="badge">C${Number(p.clearanceLevel || 0)}</span></td>
          </tr>`).join("")}</tbody>
        </table></div>` : '<div class="empty"><strong>No employees found</strong><p>Provisioned employees will appear here.</p></div>'}
      </section>
    </div>
  `;

  if (hasPermission("employee.manage")) {
    target.querySelectorAll("[data-employee-record]").forEach(row => row.addEventListener("click", () => {
      const person = people.find(p => p.id === row.dataset.employeeRecord);
      if (person) manageEmployeeRecord(person);
    }));
  }
}

async function manageEmployeeRecord(person) {
  const refs = await loadReferenceData();
  const selectedPosition = person.positionId || refs.positions.find(p => p.name === person.positionName)?.positionId || "";
  const selectedDepartment = person.departmentId || refs.departments.find(d => d.name === person.departmentName)?.departmentId || "";

  openModal({
    title: `Employee · ${person.displayName || person.employeeId || ""}`,
    submitLabel: "Save employee",
    width: "760px",
    body: `
      <div class="record-identity"><span>${esc(person.employeeId || "")}</span><strong>${esc(person.displayName || "Employee")}</strong></div>
      <div class="form-grid">
        <div class="field"><label>First name</label><input class="input" name="firstName" value="${esc(person.firstName || "")}" required /></div>
        <div class="field"><label>Last name</label><input class="input" name="lastName" value="${esc(person.lastName || "")}" required /></div>
        <div class="field"><label>Position</label><select class="select" name="positionId"><option value="">No position</option>${refs.positions.map(p=>option(p.positionId||p.id,p.name||p.positionId,String(selectedPosition)===String(p.positionId||p.id))).join("")}</select></div>
        <div class="field"><label>Department</label><select class="select" name="departmentId"><option value="">No department</option>${refs.departments.map(d=>option(d.departmentId||d.id,d.name||d.departmentId,String(selectedDepartment)===String(d.departmentId||d.id))).join("")}</select></div>
        <div class="field"><label>Employment type</label><select class="select" name="employmentType">${["Full-Time","Part-Time","Contractor","Temporary","Intern","Volunteer","Seasonal","Owner"].map(v=>option(v,v,String(person.employmentType||"")===v)).join("")}</select></div>
        <div class="field"><label>Employment status</label><select class="select" name="employmentStatus">${["active","leave","suspended","terminated","inactive"].map(v=>option(v,v[0].toUpperCase()+v.slice(1),String(person.employmentStatus||"active")===v)).join("")}</select></div>
        <div class="field"><label>Manager</label>${employeeSelect(refs,"managerEmployeeId",person.managerEmployeeId||"",{label:"No manager"})}</div>
        <div class="field"><label>Work phone</label><input class="input" name="workPhone" value="${esc(person.workPhone || "")}" /></div>
      </div>
      <div class="notice" style="margin-top:8px"><div><strong>Security separation</strong>Clearance, roles, and permissions remain managed from Security rather than the personnel form.</div></div>
    `,
    onSubmit: async fd => {
      try {
        const firstName=String(fd.get("firstName")||"").trim();
        const lastName=String(fd.get("lastName")||"").trim();
        const positionId=String(fd.get("positionId")||"");
        const departmentId=String(fd.get("departmentId")||"");
        const position=refs.positions.find(p=>String(p.positionId||p.id)===positionId);
        const department=refs.departments.find(d=>String(d.departmentId||d.id)===departmentId);

        await updateDoc(doc(db,"employees",person.id),{
          firstName,
          lastName,
          displayName:`${firstName} ${lastName}`.trim(),
          searchName:`${firstName} ${lastName}`.trim().toLowerCase(),
          positionId:positionId||null,
          positionName:position?.name||null,
          departmentId:departmentId||null,
          departmentName:department?.name||null,
          employmentType:String(fd.get("employmentType")||"Full-Time"),
          employmentStatus:String(fd.get("employmentStatus")||"active"),
          managerEmployeeId:String(fd.get("managerEmployeeId")||"")||null,
          workPhone:String(fd.get("workPhone")||"").trim(),
          updatedAt:serverTimestamp(),
          updatedBy:state.user.uid
        });
        await audit("EMPLOYEE_UPDATED","employee",person.id,{targetEmployeeId:person.employeeId||null});
        toast("Employee updated",person.displayName||person.employeeId||"");
        await renderPage();
        return true;
      } catch(error) {
        toast("Employee update failed",firebaseMessage(error));
        return false;
      }
    }
  });
}

async function renderApprovals(target) {
  const [approvals, employees] = await Promise.all([
    safeCollection("approvals",75),
    hasPermission("employee.view") ? safeCollection("employees",250) : Promise.resolve([])
  ]);
  target.innerHTML = `
    <div class="page">
      ${pageHeader("Approvals", "One queue for decisions that require authorized review.")}
      <section class="card">
        <div class="card-head"><div><h2>Approval queue</h2><p>Centralized authorization decisions</p></div></div>
        ${approvals.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Approval</th><th>Type</th><th>Status</th><th>Requester</th><th>Submitted</th></tr></thead><tbody>
          ${approvals.map((a) => `<tr><td class="primary-cell">${esc(a.title || a.approvalId || "Approval")}</td><td>${esc(a.type || "General")}</td><td>${statusBadge(a.status || "Pending")}</td><td><div class="primary-cell">${esc(employeeDisplay(employees,a.requesterEmployeeId,"Employee"))}</div><div class="secondary">${esc(employeeDisplayContext(employees,a.requesterEmployeeId))}</div></td><td>${esc(fmtDate(a.createdAt))}</td></tr>`).join("")}
        </tbody></table></div>` : '<div class="empty"><strong>No pending approvals</strong><p>Future workflows will route authorization decisions into this queue.</p></div>'}
      </section>
    </div>
  `;
}

async function renderSecurity(target) {
  if (!hasPermission("security.manage")) throw Object.assign(new Error("Security administration permission required."), { code: "permission-denied" });
  const [audits, accessProfiles, employees] = await Promise.all([
    safeCollection("auditEvents", 40),
    hasPermission("access.manage") ? safeCollection("accessProfiles", 100) : Promise.resolve([]),
    hasPermission("employee.view") ? safeCollection("employees", 250) : Promise.resolve([])
  ]);
  const employeeForProfile = (profile) => employees.find(employee =>
    employee.id === profile.id
    || employee.authUid === profile.id
    || employee.employeeId === profile.employeeId
  );

  target.innerHTML = `
    <div class="page">
      ${pageHeader("Security", "Identity, effective access, classification, clearance, and audit controls.", hasPermission("audit.export") ? '<button class="btn" data-export-audit>Export audit CSV</button>' : "")}
      <div class="security-grid" style="margin-bottom:14px">
        <div class="security-box"><span>Account class</span><strong>${esc(state.userRecord?.protectedPrincipal ? "Protected Principal" : "Standard")}</strong></div>
        <div class="security-box"><span>Clearance</span><strong>C${Number(state.profile?.clearanceLevel || 0)}</strong></div>
        <div class="security-box"><span>Scope</span><strong>${esc(state.profile?.scope || "Assigned")}</strong></div>
      </div>

      ${hasPermission("access.manage") ? `
        <section class="card" style="margin-bottom:14px">
          <div class="card-head"><div><h2>Access profiles</h2><p>Clearance, roles, explicit permissions, and account authorization</p></div></div>
          ${accessProfiles.length ? `
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Employee</th><th>Clearance</th><th>Roles</th><th>Status</th><th>Protected</th></tr></thead>
              <tbody>${accessProfiles.map((p) => {
                const employee = employeeForProfile(p);
                return `<tr data-access-profile="${esc(p.id)}" style="cursor:pointer">
                  <td><div class="primary-cell">${esc(employee?.displayName || p.employeeId || "Citadel user")}</div><div class="secondary">${esc(employee?.positionName || "No position")} · ${esc(employee?.departmentName || "No department")}</div></td>
                  <td><span class="badge">C${Number(p.clearanceLevel || 0)}</span></td>
                  <td>${esc((p.roles || []).map(roleLabel).join(", ") || "No role")}</td>
                  <td>${statusBadge(p.active === false ? "Suspended" : "Active")}</td>
                  <td>${p.protectedPrincipal ? '<span class="badge warning">Protected Principal</span>' : '<span class="badge">Standard</span>'}</td>
                </tr>`;
              }).join("")}</tbody>
            </table></div>
          ` : '<div class="empty"><strong>No access profiles found</strong><p>Provisioned Citadel accounts will appear here.</p></div>'}
        </section>
      ` : ""}

      <div class="grid-2">
        <section class="card">
          <div class="card-head"><div><h2>My effective access</h2><p>Permissions currently granted to this account</p></div></div>
          <div class="list">
            ${(state.profile?.permissions || []).map((p) => `<div class="list-row"><div class="grow"><strong>${esc(permissionFriendlyName(p))}</strong><span>${esc(p)} · ${esc((state.profile?.roles || []).map(roleLabel).join(", ") || "Explicit access")}</span></div><span class="badge success">Allowed</span></div>`).join("")}
          </div>
        </section>
        <section class="card">
          <div class="card-head"><div><h2>Recent audit events</h2><p>System-wide events visible to your authorization</p></div></div>
          ${audits.length ? `<div class="list">${audits.slice(0,16).map((a) => `<div class="list-row"><div class="grow"><strong>${esc(String(a.action || "Event").replaceAll("_"," ").toLowerCase().replace(/\b\w/g,ch=>ch.toUpperCase()))}</strong><span>${esc(employeeDisplay(employees,a.actorEmployeeId,"System"))} · ${esc(fmtDateTime(a.createdAt))}</span></div></div>`).join("")}</div>` : '<div class="empty"><strong>No audit events</strong><p>Security-relevant activity will appear here.</p></div>'}
        </section>
      </div>
    </div>
  `;

  target.querySelectorAll("[data-access-profile]").forEach((row) => row.addEventListener("click", () => {
    const profile = accessProfiles.find((p) => p.id === row.dataset.accessProfile);
    if (profile) manageAccessProfile(profile, employeeForProfile(profile));
  }));
  target.querySelector("[data-export-audit]")?.addEventListener("click", () => generation3.exportAudit());
}

function manageAccessProfile(profile, employee = null) {
  const canGrantPrivileged = state.profile?.isSystemOwner === true
    && state.profile?.protectedPrincipal === true
    && Number(state.profile?.clearanceLevel || 0) === 10;
  const targetPrivileged = profile.protectedPrincipal === true
    || profile.isSystemOwner === true
    || Number(profile.clearanceLevel || 0) === 10
    || (profile.roles || []).includes("SYSTEM_OWNER")
    || (profile.permissions || []).some(permission => PRIVILEGED_ACCESS_PERMISSIONS.has(permission));
  const readOnly = (profile.protectedPrincipal === true && profile.id !== state.user.uid)
    || (!canGrantPrivileged && targetPrivileged);
  const clearanceOptions = Array.from({length:canGrantPrivileged ? 11 : 10},(_,i)=>i);
  openModal({
    title: employee?.displayName ? `Access · ${employee.displayName}` : `Access · ${profile.employeeId || "Citadel user"}`,
    submitLabel: readOnly ? "Close" : "Save access",
    width: "980px",
    body: `
      ${profile.protectedPrincipal ? '<div class="notice warning" style="margin-bottom:16px"><div><strong>Protected Principal</strong>Citadel protects this account from ordinary administrative lockout or ownership removal.</div></div>' : ""}
      ${!canGrantPrivileged && targetPrivileged && !profile.protectedPrincipal ? '<div class="notice warning" style="margin-bottom:16px"><div><strong>Owner-level access</strong>This profile contains privileged authority. Only the System Owner can modify it.</div></div>' : ""}
      <div class="access-editor">
        <div class="access-editor-summary">
          <div class="access-editor-avatar">${esc(initials(employee?.displayName || profile.employeeId || "U"))}</div>
          <div class="grow"><strong>${esc(employee?.displayName || profile.employeeId || "Citadel user")}</strong><span>${esc(employee?.positionName || "No position")} · ${esc(employee?.departmentName || "No department")} · C${Number(profile.clearanceLevel || 0)}</span></div>
          ${profile.protectedPrincipal ? '<span class="badge warning">Protected</span>' : statusBadge(profile.active === false ? "Suspended" : "Active")}
        </div>

        <div class="editor-tabs" role="tablist">
          <button class="editor-tab active" type="button" data-editor-tab="account">Account</button>
          <button class="editor-tab" type="button" data-editor-tab="roles">Roles</button>
          <button class="editor-tab" type="button" data-editor-tab="permissions">Permissions <span class="tab-count" data-permission-tab-count>0</span></button>
        </div>

        <section class="editor-pane active" data-editor-pane="account">
          <div class="editor-pane-head"><div><h3>Account controls</h3><p>Authorization state and clearance for this Citadel identity.</p></div></div>
          <div class="form-grid">
            <div class="field"><label>Clearance level</label><select class="select" name="clearanceLevel">${clearanceOptions.map(i=>`<option value="${i}" ${Number(profile.clearanceLevel||0)===i?"selected":""}>C${i}</option>`).join("")}</select><div class="field-help">Clearance controls classified-record eligibility; it does not automatically grant module permissions.</div></div>
            <div class="field"><label>Account authorization</label><select class="select" name="active"><option value="true" ${profile.active!==false?"selected":""}>Active</option><option value="false" ${profile.active===false?"selected":""}>Suspended</option></select><div class="field-help">Suspended accounts cannot use Citadel even if permissions remain assigned.</div></div>
          </div>
          <div class="access-explainer">
            <div><span>Permanent clearance</span><strong>C${Number(profile.clearanceLevel || 0)}</strong></div>
            <div><span>Roles assigned</span><strong>${(profile.roles || []).length}</strong></div>
            <div><span>Explicit permissions</span><strong>${(profile.permissions || []).length}</strong></div>
          </div>
        </section>

        <section class="editor-pane" data-editor-pane="roles" hidden>
          <div class="editor-pane-head"><div><h3>Roles</h3><p>Use roles to describe the employee's job function. Permissions are still controlled separately.</p></div></div>
          ${rolePicker(profile.roles || [], { allowSystemOwner: canGrantPrivileged })}
        </section>

        <section class="editor-pane permission-field" data-editor-pane="permissions" hidden>
          <div class="field-heading">
            <div><h3>Explicit permissions</h3><span>Select the exact capabilities this account receives.</span></div>
            <div class="selection-count"><strong data-permission-count>0</strong><span>selected</span></div>
          </div>
          <div class="permission-toolbar">
            <div class="permission-search-wrap"><span>⌕</span><input class="input" type="search" data-permission-search placeholder="Search permissions…" /></div>
            <button class="btn btn-sm" type="button" data-expand-permissions>Expand all</button>
            <button class="btn btn-sm btn-ghost" type="button" data-collapse-permissions>Collapse all</button>
          </div>
          <div class="permission-picker" data-permission-picker>${permissionPicker(profile.permissions || [], { allowPrivileged: canGrantPrivileged })}</div>
        </section>
      </div>
    `,
    onSubmit: async (fd) => {
      if (readOnly) return true;
      try {
        const clearanceLevel = Number(fd.get("clearanceLevel") || 0);
        const active = String(fd.get("active")) === "true";
        const roles = [...new Set(fd.getAll("roles").map(String).filter(Boolean))];
        const permissions = [...new Set(fd.getAll("permissions").map(String).filter(Boolean))];

        if (profile.protectedPrincipal && profile.id === state.user.uid) {
          if (!active || clearanceLevel !== 10 || profile.isSystemOwner !== true) {
            toast("Protected owner", "The primary protected owner must remain active at C10.");
            return false;
          }
        }

        await updateDoc(doc(db, "accessProfiles", profile.id), {
          clearanceLevel,
          active,
          roles,
          permissions,
          updatedAt: serverTimestamp()
        });

        if (hasPermission("employee.manage")) {
          try {
            await updateDoc(doc(db, "employees", profile.id), {
              clearanceLevel,
              updatedAt: serverTimestamp(),
              updatedBy: state.user.uid
            });
          } catch (error) {
            console.warn("Employee clearance mirror was not updated", error);
          }
        }

        await audit("ACCESS_PROFILE_UPDATED", "accessProfile", profile.id, {
          targetEmployeeId: profile.employeeId || null,
          targetClearanceLevel: clearanceLevel
        });
        toast("Access updated", profile.employeeId || profile.id);

        if (profile.id === state.user.uid) {
          await loadAccount(state.user);
        } else {
          await renderPage();
        }
        return true;
      } catch (error) {
        toast("Access update failed", firebaseMessage(error));
        return false;
      }
    }
  });

  const modalRoot = document.getElementById("modal-root");
  const permissionSearch = modalRoot.querySelector("[data-permission-search]");
  const permissionCount = modalRoot.querySelector("[data-permission-count]");

  const refreshPermissionCounts = () => {
    const allChecked = modalRoot.querySelectorAll('input[name="permissions"]:checked');
    if (permissionCount) permissionCount.textContent = allChecked.length;
    const tabCount = modalRoot.querySelector("[data-permission-tab-count]");
    if (tabCount) tabCount.textContent = allChecked.length;
    modalRoot.querySelectorAll("[data-permission-group]").forEach(group => {
      const checked = group.querySelectorAll('input[name="permissions"]:checked').length;
      const selectedLabel = group.querySelector("[data-group-selected]");
      if (selectedLabel) selectedLabel.textContent = checked;
      group.classList.toggle("has-selection", checked > 0);
    });
  };

  permissionSearch?.addEventListener("input", () => {
    const term = permissionSearch.value.trim().toLowerCase();
    modalRoot.querySelectorAll("[data-permission-option]").forEach((el) => {
      const visible = !term || el.dataset.permissionOption.includes(term);
      el.hidden = !visible;
    });
    modalRoot.querySelectorAll("[data-permission-group]").forEach((group) => {
      const visible = [...group.querySelectorAll("[data-permission-option]")].some(el => !el.hidden);
      group.hidden = !visible;
      if (term && visible) {
        group.classList.add("is-open");
        group.querySelector("[data-toggle-permission-group]")?.setAttribute("aria-expanded","true");
        const body = group.querySelector(".permission-group-body");
        if (body) body.hidden = false;
      }
    });
  });

  const setPermissionGroupOpen = (group, open) => {
    group.classList.toggle("is-open", open);
    group.querySelector("[data-toggle-permission-group]")?.setAttribute("aria-expanded", String(open));
    const body = group.querySelector(".permission-group-body");
    if (body) body.hidden = !open;
  };

  modalRoot.querySelectorAll("[data-toggle-permission-group]").forEach(button => button.addEventListener("click", () => {
    const group = button.closest("[data-permission-group]");
    setPermissionGroupOpen(group, !group.classList.contains("is-open"));
  }));
  modalRoot.querySelector("[data-expand-permissions]")?.addEventListener("click", () => {
    modalRoot.querySelectorAll("[data-permission-group]").forEach(group => setPermissionGroupOpen(group, true));
  });
  modalRoot.querySelector("[data-collapse-permissions]")?.addEventListener("click", () => {
    modalRoot.querySelectorAll("[data-permission-group]").forEach(group => setPermissionGroupOpen(group, false));
  });
  modalRoot.querySelectorAll("[data-select-group]").forEach(button => button.addEventListener("click", () => {
    button.closest("[data-permission-group]").querySelectorAll('input[name="permissions"]').forEach(input => input.checked = true);
    refreshPermissionCounts();
  }));
  modalRoot.querySelectorAll("[data-clear-group]").forEach(button => button.addEventListener("click", () => {
    button.closest("[data-permission-group]").querySelectorAll('input[name="permissions"]').forEach(input => input.checked = false);
    refreshPermissionCounts();
  }));
  modalRoot.querySelectorAll('input[name="permissions"]').forEach(input => input.addEventListener("change", refreshPermissionCounts));
  refreshPermissionCounts();

  modalRoot.querySelectorAll("[data-editor-tab]").forEach(tab => tab.addEventListener("click", () => {
    const name = tab.dataset.editorTab;
    modalRoot.querySelectorAll("[data-editor-tab]").forEach(item => item.classList.toggle("active", item === tab));
    modalRoot.querySelectorAll("[data-editor-pane]").forEach(pane => {
      const active = pane.dataset.editorPane === name;
      pane.classList.toggle("active", active);
      pane.hidden = !active;
    });
  }));

  if (readOnly) {
    const form = document.querySelector("#modal-root form");
    form?.querySelectorAll("input,select,textarea,button[data-select-group],button[data-clear-group]").forEach((el) => el.disabled = true);
  }
}

async function renderAdmin(target) {
  if (!hasPermission("system.manage")) throw Object.assign(new Error("System administration permission required."), { code: "permission-denied" });
  const requests = await safeCollection("registrationRequests", 100, "requestedAt");
  const pending = requests.filter((r) => r.status === "pending");
  target.innerHTML = `
    <div class="page">
      ${pageHeader("Administration", "Organization configuration and Citadel account provisioning.")}
      <div class="grid-2">
        <section class="card">
          <div class="card-head"><div><h2>Account requests</h2><p>Firebase Auth identities awaiting Citadel provisioning</p></div></div>
          ${pending.length ? `<div class="list">${pending.map((r) => `
            <div class="list-row">
              <div class="grow"><strong>${esc(r.displayName || r.email || r.uid)}</strong><span>${esc(r.email || "")} · ${esc(fmtDateTime(r.requestedAt))}</span></div>
              <button class="btn btn-sm btn-primary" data-approve-user="${esc(r.uid)}">Approve</button>
            </div>
          `).join("")}</div>` : '<div class="empty"><strong>No pending accounts</strong><p>New Firebase Auth users that request Citadel access will appear here.</p></div>'}
        </section>
        <section class="card">
          <div class="card-head"><div><h2>System identity</h2><p>Connected environment</p></div></div>
          <div class="card-body">
            <div class="security-grid" style="grid-template-columns:1fr">
              <div class="security-box"><span>Product</span><strong>Citadel</strong></div>
              <div class="security-box"><span>Firebase project</span><strong>citadel-8bf1b</strong></div>
              <div class="security-box"><span>Hosting model</span><strong>GitHub Pages</strong></div>
              <div class="security-box"><span>Deployed build</span><strong title="${esc(currentBuild())}">${esc(shortBuild())}</strong></div>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
  target.querySelectorAll("[data-approve-user]").forEach((button) => button.addEventListener("click", async () => {
    const request = pending.find((r) => r.uid === button.dataset.approveUser);
    approveAccountModal(request);
  }));
}

async function approveAccountModal(request) {
  const refs = await loadReferenceData();
  openModal({
    title: "Provision Citadel account",
    submitLabel: "Approve account",
    body: `
      <div class="notice" style="margin-bottom:16px"><div><strong>${esc(request.email || request.uid)}</strong>This will create an employee record and an active C1 access profile.</div></div>
      <div class="form-grid">
        <div class="field"><label>First name</label><input class="input" name="firstName" required /></div>
        <div class="field"><label>Last name</label><input class="input" name="lastName" required /></div>
        <div class="field"><label>Position</label><select class="select" name="positionId" required><option value="">Select position</option>${refs.positions.map(p=>option(p.positionId||p.id,p.name||p.positionId)).join("")}</select></div>
        <div class="field"><label>Department</label><select class="select" name="departmentId" required><option value="">Select department</option>${refs.departments.map(d=>option(d.departmentId||d.id,d.name||d.departmentId)).join("")}</select></div>
        <div class="field"><label>Employment type</label><select class="select" name="employmentType"><option>Full-Time</option><option>Part-Time</option><option>Contractor</option><option>Temporary</option><option>Intern</option><option>Volunteer</option><option>Seasonal</option></select></div>
        <div class="field"><label>Clearance</label><select class="select" name="clearanceLevel">${Array.from({length:10},(_,i)=>`<option value="${i+1}" ${i===0?"selected":""}>C${i+1}</option>`).join("")}</select></div>
      </div>
    `,
    onSubmit: async (fd) => {
      try {
        const employeeId = await nextId("employees", "EMP");
        const firstName = String(fd.get("firstName") || "").trim();
        const lastName = String(fd.get("lastName") || "").trim();
        const displayName = `${firstName} ${lastName}`.trim();
        const clearance = Number(fd.get("clearanceLevel") || 1);
        const positionId = String(fd.get("positionId") || "");
        const departmentId = String(fd.get("departmentId") || "");
        const position = refs.positions.find(p => String(p.positionId || p.id) === positionId);
        const department = refs.departments.find(d => String(d.departmentId || d.id) === departmentId);
        const employmentType = String(fd.get("employmentType") || "Full-Time");
        const batch = writeBatch(db);
        batch.set(doc(db, "employees", request.uid), {
          employeeId,
          authUid: request.uid,
          firstName,
          lastName,
          displayName,
          searchName: displayName.toLowerCase(),
          workEmail: request.email || "",
          positionId,
          positionName: position?.name || "General Employee",
          departmentId,
          departmentName: department?.name || "Operations",
          employmentStatus: "active",
          employmentType,
          clearanceLevel: clearance,
          accountClass: "standard",
          classification: "CONFIDENTIAL",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: state.user.uid,
          updatedBy: state.user.uid
        });
        batch.set(doc(db, "users", request.uid), {
          uid: request.uid,
          employeeRecordId: request.uid,
          employeeId,
          displayName,
          email: request.email || "",
          accountStatus: "active",
          protectedPrincipal: false,
          ownerStatus: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        batch.set(doc(db, "accessProfiles", request.uid), {
          uid: request.uid,
          employeeId,
          active: true,
          clearanceLevel: clearance,
          roles: ["GENERAL_EMPLOYEE"],
          permissions: [
            "customer.view",
            "case.view",
            "case.create",
            "employee.view",
            "service.create",
            "hr.request.leave",
            "training.self",
            "procurement.request",
            "finance.expense.create",
            "communications.view",
            "document.view",
            "organization.view",
            "access.request",
            "dashboard.customize",
            "notification.view"
          ],
          isSystemOwner: false,
          protectedPrincipal: false,
          scope: "assigned",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        batch.update(doc(db, "registrationRequests", request.uid), {
          status: "approved",
          approvedBy: state.user.uid,
          approvedAt: serverTimestamp(),
          employeeId
        });
        await batch.commit();
        await audit("ACCOUNT_PROVISIONED", "employee", request.uid, { targetEmployeeId: employeeId });
        toast("Account approved", employeeId);
        await renderPage();
        return true;
      } catch (error) {
        toast("Provisioning failed", firebaseMessage(error));
        return false;
      }
    }
  });
}

const generation2 = createGeneration2({
  state,
  hasPermission,
  effectiveClearance,
  classificationsForClearance,
  customerAccessLevelsForClearance,
  nextId,
  audit,
  safeCollection,
  pageHeader,
  renderPage,
  toast,
  openModal,
  firebaseMessage
});

const generation3 = createGeneration3({
  state,
  hasPermission,
  effectiveClearance,
  classificationsForClearance,
  customerAccessLevelsForClearance,
  nextId,
  audit,
  safeCollection,
  pageHeader,
  renderPage,
  navigate,
  toast,
  openModal,
  firebaseMessage
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    state.user = null;
    state.userRecord = null;
    state.profile = null;
    state.employee = null;
    state.temporaryAccess = null;
    renderAuth();
    return;
  }

  app.innerHTML = `<div class="boot-screen"><div class="brand-mark">C</div><div><strong>Citadel</strong><span>Verifying authorization…</span></div></div>`;
  try {
    await loadAccount(user);
  } catch (error) {
    console.error(error);
    renderPendingAccess(false);
    toast("Account verification failed", firebaseMessage(error));
  }
});
