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
} from "./firebase.js";
import {
  esc,
  initials,
  fmtDate,
  fmtDateTime,
  statusBadge,
  classificationBadge,
  customerDisplayName
} from "./utils.js";
import { toast, openModal } from "./ui.js";
import { createGeneration2, GENERATION2_NAV, GENERATION2_PERMISSIONS } from "./generation2.js";

const app = document.getElementById("app");

const state = {
  user: null,
  userRecord: null,
  profile: null,
  employee: null,
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
  ...GENERATION2_PERMISSIONS
];

const NAV = [
  { section: "Workspace", id: "home", label: "Home", icon: "⌂" },
  { section: "Workspace", id: "customers", label: "Customers", icon: "◉", permission: "customer.view" },
  { section: "Workspace", id: "cases", label: "Cases", icon: "◇", permission: "case.view" },
  { section: "Organization", id: "people", label: "People", icon: "◎", permission: "employee.view" },
  { section: "Organization", id: "approvals", label: "Approvals", icon: "✓", permission: "approval.view" },
  ...GENERATION2_NAV,
  { section: "Control", id: "security", label: "Security", icon: "◆", permission: "security.manage" },
  { section: "Control", id: "admin", label: "Administration", icon: "⚙", permission: "system.manage" }
];

function hasPermission(permission) {
  if (!state.profile) return false;
  if (state.profile.isSystemOwner === true) return true;
  return Array.isArray(state.profile.permissions) && state.profile.permissions.includes(permission);
}

function accountName() {
  return state.employee?.displayName || state.userRecord?.displayName || state.user?.displayName || state.user?.email || "Citadel User";
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
  const userSnap = await getDoc(doc(db, "users", user.uid)).catch(() => null);
  const profileSnap = await getDoc(doc(db, "accessProfiles", user.uid)).catch(() => null);

  state.userRecord = userSnap?.exists() ? userSnap.data() : null;
  state.profile = profileSnap?.exists() ? profileSnap.data() : null;
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
  let lastSection = "";
  return NAV.filter((item) => {
    if (item.anyPermission) return item.anyPermission.some((permission) => hasPermission(permission));
    return !item.permission || hasPermission(item.permission);
  }).map((item) => {
    const label = item.section !== lastSection ? `<div class="nav-label">${esc(item.section)}</div>` : "";
    lastSection = item.section;
    return `${label}<button class="nav-item ${state.route === item.id ? "active" : ""}" data-route="${item.id}">
      <span class="nav-icon">${item.icon}</span><span>${esc(item.label)}</span>
    </button>`;
  }).join("");
}

function renderShell() {
  if (!NAV.some((n) => n.id === state.route)) state.route = "home";
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
            <input class="input" id="global-search" placeholder="Search customers, employees, IDs…" value="${esc(state.search)}" />
          </div>
          <div class="top-actions">
            <button class="icon-btn hide-mobile" title="Approvals" data-route="approvals">✓</button>
            <button class="icon-btn" title="Notifications">●</button>
          </div>
        </header>
        <div id="page-content"></div>
      </main>
    </div>
  `;

  app.querySelectorAll("[data-route]").forEach((el) => el.addEventListener("click", () => navigate(el.dataset.route)));
  app.querySelector("[data-signout]").addEventListener("click", () => signOut(auth));
  app.querySelector("[data-menu]")?.addEventListener("click", () => app.querySelector("#shell").classList.add("menu-open"));
  app.querySelector("[data-close-menu]")?.addEventListener("click", () => app.querySelector("#shell").classList.remove("menu-open"));
  app.querySelector("#global-search").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    state.search = event.currentTarget.value.trim();
    navigate("customers");
  });

  renderPage();
}

function navigate(route) {
  state.route = route;
  app.querySelector("#shell")?.classList.remove("menu-open");
  renderShell();
}

async function renderPage() {
  const target = document.getElementById("page-content");
  target.innerHTML = `<div class="page"><div class="empty"><strong>Loading ${esc(state.route)}…</strong><p>Retrieving authorized Citadel data.</p></div></div>`;
  try {
    const renderers = {
      home: renderHome,
      customers: renderCustomers,
      cases: renderCases,
      people: renderPeople,
      approvals: renderApprovals,
      security: renderSecurity,
      admin: renderAdmin,
      ...generation2.renderers
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
  return `<div class="page-head">
    <div><div class="eyebrow">Citadel</div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>
    <div class="page-actions">${actions}</div>
  </div>`;
}

async function renderHome(target) {
  const [customers, cases, approvals, requests] = await Promise.all([
    hasPermission("customer.view") ? safeCollection("customers", 100) : [],
    hasPermission("case.view") ? safeCollection("cases", 100) : [],
    hasPermission("approval.view") ? safeCollection("approvals", 100) : [],
    hasPermission("system.manage") ? safeCollection("registrationRequests", 100, "requestedAt") : []
  ]);
  const openCases = cases.filter((c) => !["closed","resolved"].includes(String(c.status).toLowerCase()));
  const pendingApprovals = approvals.filter((a) => String(a.status).toLowerCase() === "pending");
  const pendingAccounts = requests.filter((r) => r.status === "pending");

  target.innerHTML = `
    <div class="page">
      ${pageHeader("Command", `Welcome back, ${accountName()}. Your authorized operational overview is below.`)}
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">Customers</div><div class="kpi-value">${customers.length}</div><div class="kpi-meta">Visible in current workspace</div></div>
        <div class="kpi-card"><div class="kpi-label">Open cases</div><div class="kpi-value">${openCases.length}</div><div class="kpi-meta">Requires operational attention</div></div>
        <div class="kpi-card"><div class="kpi-label">Pending approvals</div><div class="kpi-value">${pendingApprovals.length}</div><div class="kpi-meta">Awaiting authorized decision</div></div>
        <div class="kpi-card"><div class="kpi-label">Account requests</div><div class="kpi-value">${pendingAccounts.length}</div><div class="kpi-meta">Pending provisioning</div></div>
      </div>
      <div class="grid-2">
        <section class="card">
          <div class="card-head"><div><h2>Recent cases</h2><p>Latest customer and operational case activity</p></div><button class="btn btn-sm" data-route-local="cases">View all</button></div>
          ${openCases.length ? `<div class="list">${openCases.slice(0,6).map((c) => `
            <div class="list-row"><div class="grow"><strong>${esc(c.title || c.caseId || "Case")}</strong><span>${esc(c.caseId || "—")} · ${esc(c.category || "General")}</span></div>${statusBadge(c.status || "Open")}</div>
          `).join("")}</div>` : `<div class="empty"><strong>No open cases</strong><p>New cases will appear here as they are created.</p></div>`}
        </section>
        <section class="card">
          <div class="card-head"><div><h2>Account security</h2><p>Your current Citadel authorization context</p></div></div>
          <div class="card-body">
            <div class="security-grid" style="grid-template-columns:1fr">
              <div class="security-box"><span>Employee ID</span><strong>${esc(state.employee?.employeeId || "—")}</strong></div>
              <div class="security-box"><span>Clearance</span><strong>C${Number(state.profile?.clearanceLevel || 0)}</strong></div>
              <div class="security-box"><span>Primary role</span><strong>${esc(state.profile?.roles?.[0] || "—")}</strong></div>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
  target.querySelectorAll("[data-route-local]").forEach((el) => el.addEventListener("click", () => navigate(el.dataset.routeLocal)));
}

async function customerQuery() {
  const term = state.search.trim();
  if (!term) return getDocs(query(collection(db, "customers"), orderBy("createdAt", "desc"), limit(50)));
  if (/^CUS-/i.test(term)) return getDocs(query(collection(db, "customers"), where("customerId", "==", term.toUpperCase()), limit(20)));
  if (term.includes("@")) return getDocs(query(collection(db, "customers"), where("email", "==", term.toLowerCase()), limit(20)));
  const normalized = term.toLowerCase();
  return getDocs(query(collection(db, "customers"), orderBy("searchName"), where("searchName", ">=", normalized), where("searchName", "<=", normalized + "\uf8ff"), limit(50)));
}

async function renderCustomers(target) {
  const snap = await customerQuery();
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
                <td>${esc(c.assignedEmployeeId || "Unassigned")}</td>
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
  try {
    const noteSnap = await getDocs(query(collection(db, "customerNotes"), where("customerRecordId", "==", customer.id), limit(20)));
    notes = noteSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {}
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
      </div>
      <div class="form-grid">
        <div class="field"><label>First name</label><input class="input" name="firstName" value="${esc(customer.firstName || "")}" /></div>
        <div class="field"><label>Last name</label><input class="input" name="lastName" value="${esc(customer.lastName || "")}" /></div>
        <div class="field"><label>Email</label><input class="input" type="email" name="email" value="${esc(customer.email || "")}" /></div>
        <div class="field"><label>Phone</label><input class="input" name="phone" value="${esc(customer.phone || "")}" /></div>
        <div class="field"><label>Status</label><select class="select" name="status">${["Active","Prospect","Inactive","Archived"].map((v) => `<option ${customer.status === v ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="field"><label>Classification</label><select class="select" name="classification">${["STANDARD","INTERNAL","CONFIDENTIAL","SENSITIVE","RESTRICTED","HIGHLY_RESTRICTED"].map((v) => `<option ${customer.classification === v ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      </div>
      <div class="card" style="margin-top:8px">
        <div class="card-head"><div><h2>Internal notes</h2><p>Authorized employee context</p></div></div>
        ${notes.length ? `<div class="list">${notes.map((n) => `<div class="list-row"><div class="grow"><strong>${esc(n.body || "Note")}</strong><span>${esc(n.createdByEmployeeId || "Employee")} · ${esc(fmtDateTime(n.createdAt))}</span></div></div>`).join("")}</div>` : '<div class="empty"><strong>No notes yet</strong><p>Customer notes will appear here.</p></div>'}
      </div>
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
          updatedAt: serverTimestamp(),
          updatedBy: state.user.uid
        });
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
  const cases = await safeCollection("cases", 75);
  target.innerHTML = `
    <div class="page">
      ${pageHeader("Cases", "Customer service, escalations, and operational casework.", hasPermission("case.create") ? '<button class="btn btn-primary" data-new-case>New case</button>' : "")}
      <section class="card">
        <div class="card-head"><div><h2>Case queue</h2><p>${cases.length} recent case${cases.length === 1 ? "" : "s"}</p></div></div>
        ${cases.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Case</th><th>Priority</th><th>Status</th><th>Customer</th><th>Owner</th><th>Created</th></tr></thead>
          <tbody>${cases.map((c) => `<tr>
            <td><div class="primary-cell">${esc(c.title || "Untitled case")}</div><div class="secondary">${esc(c.caseId || "—")}</div></td>
            <td>${statusBadge(c.priority || "Normal")}</td>
            <td>${statusBadge(c.status || "Open")}</td>
            <td>${esc(c.customerId || "—")}</td>
            <td>${esc(c.assignedEmployeeId || "Unassigned")}</td>
            <td>${esc(fmtDate(c.createdAt))}</td>
          </tr>`).join("")}</tbody>
        </table></div>` : '<div class="empty"><strong>No cases yet</strong><p>Create a case to begin operational case management.</p></div>'}
      </section>
    </div>
  `;
  target.querySelector("[data-new-case]")?.addEventListener("click", newCaseModal);
}

function newCaseModal() {
  openModal({
    title: "Create case",
    submitLabel: "Create case",
    body: `
      <div class="form-grid">
        <div class="field span-2"><label>Case title</label><input class="input" name="title" required /></div>
        <div class="field"><label>Customer ID</label><input class="input" name="customerId" placeholder="CUS-000001" /></div>
        <div class="field"><label>Category</label><input class="input" name="category" placeholder="Billing, Service, General…" /></div>
        <div class="field"><label>Priority</label><select class="select" name="priority"><option>Normal</option><option>High</option><option>Critical</option><option>Low</option></select></div>
        <div class="field"><label>Status</label><select class="select" name="status"><option>New</option><option>Open</option><option>In Progress</option><option>Pending Customer</option><option>Pending Internal</option><option>Escalated</option></select></div>
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
          <tbody>${people.map((p) => `<tr>
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
}

async function renderApprovals(target) {
  const approvals = await safeCollection("approvals", 75);
  target.innerHTML = `
    <div class="page">
      ${pageHeader("Approvals", "One queue for decisions that require authorized review.")}
      <section class="card">
        <div class="card-head"><div><h2>Approval queue</h2><p>Part 1 approval foundation</p></div></div>
        ${approvals.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Approval</th><th>Type</th><th>Status</th><th>Requester</th><th>Submitted</th></tr></thead><tbody>
          ${approvals.map((a) => `<tr><td class="primary-cell">${esc(a.approvalId || a.title || "Approval")}</td><td>${esc(a.type || "General")}</td><td>${statusBadge(a.status || "Pending")}</td><td>${esc(a.requesterEmployeeId || "—")}</td><td>${esc(fmtDate(a.createdAt))}</td></tr>`).join("")}
        </tbody></table></div>` : '<div class="empty"><strong>No pending approvals</strong><p>Future workflows will route authorization decisions into this queue.</p></div>'}
      </section>
    </div>
  `;
}

async function renderSecurity(target) {
  if (!hasPermission("security.manage")) throw Object.assign(new Error("Security administration permission required."), { code: "permission-denied" });
  const audits = await safeCollection("auditEvents", 30);
  target.innerHTML = `
    <div class="page">
      ${pageHeader("Security", "Identity, effective access, classification, and audit controls.")}
      <div class="security-grid" style="margin-bottom:14px">
        <div class="security-box"><span>Account class</span><strong>${esc(state.userRecord?.protectedPrincipal ? "Protected Principal" : "Standard")}</strong></div>
        <div class="security-box"><span>Clearance</span><strong>C${Number(state.profile?.clearanceLevel || 0)}</strong></div>
        <div class="security-box"><span>Scope</span><strong>${esc(state.profile?.scope || "Assigned")}</strong></div>
      </div>
      <div class="grid-2">
        <section class="card">
          <div class="card-head"><div><h2>Effective access</h2><p>Permissions currently granted to this account</p></div></div>
          <div class="list">
            ${(state.profile?.permissions || []).map((p) => `<div class="list-row"><div class="grow"><strong>${esc(p)}</strong><span>Granted by ${esc(state.profile?.roles?.join(", ") || "access profile")}</span></div><span class="badge success">Allowed</span></div>`).join("")}
          </div>
        </section>
        <section class="card">
          <div class="card-head"><div><h2>Recent audit events</h2><p>System-wide events visible to your authorization</p></div></div>
          ${audits.length ? `<div class="list">${audits.slice(0,12).map((a) => `<div class="list-row"><div class="grow"><strong>${esc(a.action || "EVENT")}</strong><span>${esc(a.actorEmployeeId || a.actorUid || "System")} · ${esc(fmtDateTime(a.createdAt))}</span></div></div>`).join("")}</div>` : '<div class="empty"><strong>No audit events</strong><p>Security-relevant activity will appear here.</p></div>'}
        </section>
      </div>
    </div>
  `;
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

function approveAccountModal(request) {
  openModal({
    title: "Provision Citadel account",
    submitLabel: "Approve account",
    body: `
      <div class="notice" style="margin-bottom:16px"><div><strong>${esc(request.email || request.uid)}</strong>This will create an employee record and an active C1 access profile.</div></div>
      <div class="form-grid">
        <div class="field"><label>First name</label><input class="input" name="firstName" required /></div>
        <div class="field"><label>Last name</label><input class="input" name="lastName" required /></div>
        <div class="field"><label>Position</label><input class="input" name="positionName" value="General Employee" required /></div>
        <div class="field"><label>Department</label><input class="input" name="departmentName" value="Operations" required /></div>
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
        const batch = writeBatch(db);
        batch.set(doc(db, "employees", request.uid), {
          employeeId,
          authUid: request.uid,
          firstName,
          lastName,
          displayName,
          searchName: displayName.toLowerCase(),
          workEmail: request.email || "",
          positionName: String(fd.get("positionName") || "General Employee").trim(),
          departmentName: String(fd.get("departmentName") || "Operations").trim(),
          employmentStatus: "active",
          employmentType: "employee",
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
            "document.view"
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
  nextId,
  audit,
  safeCollection,
  pageHeader,
  renderPage,
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
