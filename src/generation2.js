import {
  db,
  doc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  where,
  serverTimestamp
} from "./firebase.js";
import { esc, fmtDate, fmtDateTime, statusBadge, classificationBadge } from "./utils.js";

export const GENERATION2_PERMISSIONS = [
  "hr.view",
  "hr.manage",
  "hr.request.leave",
  "training.view",
  "training.self",
  "training.manage",
  "asset.view",
  "asset.manage",
  "service.view",
  "service.create",
  "service.manage",
  "procurement.view",
  "procurement.request",
  "procurement.manage",
  "vendor.view",
  "vendor.manage",
  "contract.view",
  "contract.manage",
  "finance.view",
  "finance.expense.create",
  "finance.manage",
  "compliance.view",
  "compliance.manage",
  "risk.view",
  "risk.manage",
  "investigation.view",
  "investigation.manage",
  "project.view",
  "project.manage",
  "document.view",
  "document.manage",
  "communications.view",
  "communications.manage",
  "workflow.view",
  "workflow.manage",
  "organization.view"
];

export const GENERATION2_NAV = [
  { section: "People", id: "hr", label: "HR Operations", icon: "◫", anyPermission: ["hr.view", "hr.request.leave"] },
  { section: "People", id: "training", label: "Training", icon: "△", anyPermission: ["training.view", "training.self"] },
  { section: "Organization", id: "organization", label: "Structure", icon: "⌘", permission: "organization.view" },

  { section: "Operations", id: "service", label: "Service Desk", icon: "◇", anyPermission: ["service.view", "service.create"] },
  { section: "Operations", id: "assets", label: "Assets", icon: "▣", permission: "asset.view" },
  { section: "Operations", id: "procurement", label: "Procurement", icon: "↗", anyPermission: ["procurement.view", "procurement.request"] },
  { section: "Operations", id: "vendors", label: "Vendors", icon: "⬡", permission: "vendor.view" },
  { section: "Operations", id: "contracts", label: "Contracts", icon: "▤", permission: "contract.view" },
  { section: "Operations", id: "finance", label: "Finance", icon: "$", anyPermission: ["finance.view", "finance.expense.create"] },

  { section: "Enterprise", id: "projects", label: "Projects", icon: "◈", permission: "project.view" },
  { section: "Enterprise", id: "documents", label: "Documents", icon: "▧", permission: "document.view" },
  { section: "Enterprise", id: "communications", label: "Communications", icon: "◒", permission: "communications.view" },

  { section: "Governance", id: "compliance", label: "Compliance", icon: "✓", permission: "compliance.view" },
  { section: "Governance", id: "risks", label: "Risk Register", icon: "!", permission: "risk.view" },
  { section: "Governance", id: "investigations", label: "Investigations", icon: "◐", permission: "investigation.view" },
  { section: "Governance", id: "workflows", label: "Workflows", icon: "⇄", permission: "workflow.view" }
];

const MODULES = {
  assets: {
    title: "Assets",
    subtitle: "Corporate equipment, ownership, assignments, condition, and lifecycle.",
    collection: "assets",
    prefix: "AST",
    counter: "assets",
    view: "asset.view",
    manage: "asset.manage",
    createLabel: "Register asset",
    singular: "asset",
    columns: [
      ["Asset", r => cell(r.name || r.assetType || "Asset", r.assetId)],
      ["Category", r => esc(r.assetType || "General")],
      ["Status", r => statusBadge(r.status || "Available")],
      ["Assigned", (r,refs) => esc(employeeLabel(refs,r.assignedEmployeeId))],
      ["Serial / Tag", r => esc(r.serialNumber || r.assetTag || "—")],
      ["Updated", r => esc(fmtDate(r.updatedAt || r.createdAt))]
    ],
    fields: [
      { name: "name", label: "Asset name", required: true },
      { name: "assetType", label: "Category", type: "select", options: ["Laptop","Phone","Tablet","Vehicle","Badge","Key","Equipment","Other"] },
      { name: "serialNumber", label: "Serial number" },
      { name: "assetTag", label: "Asset tag" },
      { name: "status", label: "Status", type: "select", options: ["Available","Assigned","In Service","Repair","Lost","Retired"] },
      { name: "assignedEmployeeId", label: "Assigned employee", type: "employee" },
      { name: "location", label: "Location", type: "location" },
      { name: "notes", label: "Notes", type: "textarea", span: 2 }
    ]
  },
  vendors: {
    title: "Vendors",
    subtitle: "Third-party organizations, contacts, status, and corporate relationships.",
    collection: "vendors",
    prefix: "VND",
    counter: "vendors",
    view: "vendor.view",
    manage: "vendor.manage",
    createLabel: "Add vendor",
    singular: "vendor",
    columns: [
      ["Vendor", r => cell(r.name || "Vendor", r.vendorId)],
      ["Status", r => statusBadge(r.status || "Active")],
      ["Category", r => esc(r.category || "General")],
      ["Primary contact", r => esc(r.contactName || "—")],
      ["Email", r => esc(r.email || "—")],
      ["Risk", r => statusBadge(r.riskLevel || "Low")]
    ],
    fields: [
      { name: "name", label: "Vendor name", required: true },
      { name: "category", label: "Category", type: "select", options: ["Technology","Facilities","Professional Services","Office Supplies","Fleet","Marketing","Financial","Legal","Training","Other"] },
      { name: "status", label: "Status", type: "select", options: ["Active","Prospective","Restricted","Inactive"] },
      { name: "riskLevel", label: "Risk level", type: "select", options: ["Low","Moderate","High","Critical"] },
      { name: "contactName", label: "Primary contact" },
      { name: "email", label: "Email", type: "email" },
      { name: "phone", label: "Phone" },
      { name: "website", label: "Website" },
      { name: "notes", label: "Internal notes", type: "textarea", span: 2 }
    ]
  },
  contracts: {
    title: "Contracts",
    subtitle: "Contract registry, responsible owners, renewal dates, value, and status.",
    collection: "contracts",
    classified: true,
    prefix: "CTR",
    counter: "contracts",
    view: "contract.view",
    manage: "contract.manage",
    createLabel: "New contract",
    singular: "contract",
    columns: [
      ["Contract", r => cell(r.title || "Contract", r.contractId)],
      ["Vendor", (r,refs) => esc(vendorLabel(refs,r.vendorId,r.vendorName || "—"))],
      ["Status", r => statusBadge(r.status || "Draft")],
      ["Value", r => money(r.value)],
      ["Owner", (r,refs) => esc(employeeLabel(refs,r.ownerEmployeeId,"—"))],
      ["Renewal", r => esc(r.renewalDate || "—")]
    ],
    fields: [
      { name: "title", label: "Contract title", required: true, span: 2 },
      { name: "vendorId", label: "Vendor", type: "vendor" },
      { name: "status", label: "Status", type: "select", options: ["Draft","Review","Active","Expiring","Expired","Terminated"] },
      { name: "value", label: "Contract value", type: "number" },
      { name: "startDate", label: "Start date", type: "date" },
      { name: "renewalDate", label: "Renewal / end date", type: "date" },
      { name: "ownerEmployeeId", label: "Responsible employee", type: "employee" },
      { name: "classification", label: "Classification", type: "select", options: ["INTERNAL","CONFIDENTIAL","SENSITIVE","RESTRICTED"] },
      { name: "notes", label: "Contract notes", type: "textarea", span: 2 }
    ]
  },
  projects: {
    title: "Projects",
    subtitle: "Strategic and operational initiatives, ownership, health, budgets, and milestones.",
    collection: "projects",
    prefix: "PRJ",
    counter: "projects",
    view: "project.view",
    manage: "project.manage",
    createLabel: "New project",
    singular: "project",
    columns: [
      ["Project", r => cell(r.name || "Project", r.projectId)],
      ["Status", r => statusBadge(r.status || "Planning")],
      ["Health", r => statusBadge(r.health || "On Track")],
      ["Owner", r => esc(r.ownerEmployeeId || "—")],
      ["Budget", r => money(r.budget)],
      ["Target", r => esc(r.targetDate || "—")]
    ],
    fields: [
      { name: "name", label: "Project name", required: true, span: 2 },
      { name: "status", label: "Status", type: "select", options: ["Planning","Active","On Hold","Complete","Cancelled"] },
      { name: "health", label: "Health", type: "select", options: ["On Track","At Risk","Off Track"] },
      { name: "ownerEmployeeId", label: "Owner", type: "employee" },
      { name: "department", label: "Department", type: "departmentName" },
      { name: "budget", label: "Budget", type: "number" },
      { name: "targetDate", label: "Target date", type: "date" },
      { name: "summary", label: "Executive summary", type: "textarea", span: 2 }
    ]
  },
  documents: {
    title: "Documents",
    subtitle: "Controlled corporate document registry with classification and record ownership.",
    collection: "documents",
    classified: true,
    prefix: "DOC",
    counter: "documents",
    view: "document.view",
    manage: "document.manage",
    createLabel: "Register document",
    singular: "document",
    columns: [
      ["Document", r => cell(r.title || "Document", r.documentId)],
      ["Type", r => esc(r.documentType || "General")],
      ["Classification", r => classificationBadge(r.classification || "INTERNAL")],
      ["Owner", r => esc(r.ownerEmployeeId || "—")],
      ["Status", r => statusBadge(r.status || "Active")],
      ["Updated", r => esc(fmtDate(r.updatedAt || r.createdAt))]
    ],
    fields: [
      { name: "title", label: "Document title", required: true, span: 2 },
      { name: "documentType", label: "Document type", type: "select", options: ["Policy","Procedure","Contract","Form","Report","Memo","Guide","Legal","Financial","Technical","Other"] },
      { name: "status", label: "Status", type: "select", options: ["Draft","Active","Superseded","Archived","Legal Hold"] },
      { name: "classification", label: "Classification", type: "select", options: ["INTERNAL","CONFIDENTIAL","SENSITIVE","RESTRICTED","HIGHLY_RESTRICTED"] },
      { name: "ownerEmployeeId", label: "Owner", type: "employee" },
      { name: "externalUrl", label: "External document URL", span: 2 },
      { name: "description", label: "Description", type: "textarea", span: 2 }
    ]
  },
  communications: {
    title: "Communications",
    subtitle: "Organization announcements, operational notices, and targeted internal messages.",
    collection: "announcements",
    prefix: "ANN",
    counter: "announcements",
    view: "communications.view",
    manage: "communications.manage",
    createLabel: "New announcement",
    singular: "announcement",
    columns: [
      ["Announcement", r => cell(r.title || "Announcement", r.announcementId)],
      ["Audience", r => esc(r.audience || "All Employees")],
      ["Priority", r => statusBadge(r.priority || "Normal")],
      ["Status", r => statusBadge(r.status || "Published")],
      ["Author", (r,refs) => esc(employeeLabel(refs,r.authorEmployeeId,"—"))],
      ["Created", r => esc(fmtDate(r.createdAt))]
    ],
    fields: [
      { name: "title", label: "Announcement title", required: true, span: 2 },
      { name: "audience", label: "Audience", type: "select", options: ["All Employees","Managers","Executives","Department","Location"] },
      { name: "audienceValue", label: "Department / location (if applicable)" },
      { name: "priority", label: "Priority", type: "select", options: ["Normal","Important","Urgent","Critical"] },
      { name: "status", label: "Status", type: "select", options: ["Draft","Published","Expired"] },
      { name: "body", label: "Message", type: "textarea", span: 2, required: true }
    ]
  },
  risks: {
    title: "Risks",
    subtitle: "Enterprise risk register, ownership, exposure, mitigation, and review status.",
    collection: "risks",
    prefix: "RSK",
    counter: "risks",
    view: "risk.view",
    manage: "risk.manage",
    createLabel: "New risk",
    singular: "risk",
    columns: [
      ["Risk", r => cell(r.title || "Risk", r.riskId)],
      ["Category", r => esc(r.category || "Enterprise")],
      ["Likelihood", r => statusBadge(r.likelihood || "Possible")],
      ["Impact", r => statusBadge(r.impact || "Moderate")],
      ["Status", r => statusBadge(r.status || "Open")],
      ["Owner", (r,refs) => esc(employeeLabel(refs,r.ownerEmployeeId))]
    ],
    fields: [
      { name: "title", label: "Risk title", required: true, span: 2 },
      { name: "category", label: "Category", type: "select", options: ["Strategic","Operational","Financial","Compliance","Security","Technology","Vendor","Reputation","Other"] },
      { name: "status", label: "Status", type: "select", options: ["Open","Monitoring","Mitigating","Accepted","Transferred","Closed"] },
      { name: "likelihood", label: "Likelihood", type: "select", options: ["Rare","Unlikely","Possible","Likely","Almost Certain"] },
      { name: "impact", label: "Impact", type: "select", options: ["Low","Moderate","High","Severe","Critical"] },
      { name: "ownerEmployeeId", label: "Risk owner", type: "employee" },
      { name: "reviewDate", label: "Next review date", type: "date" },
      { name: "description", label: "Risk description", type: "textarea", span: 2 },
      { name: "mitigation", label: "Mitigation / controls", type: "textarea", span: 2 }
    ]
  },
  investigations: {
    title: "Investigations",
    subtitle: "Restricted internal investigations, case ownership, evidence context, and controlled outcomes.",
    collection: "investigations",
    classified: true,
    prefix: "IGT",
    counter: "investigations",
    view: "investigation.view",
    manage: "investigation.manage",
    createLabel: "Open investigation",
    singular: "investigation",
    columns: [
      ["Investigation", r => cell(r.title || "Investigation", r.investigationId)],
      ["Type", r => esc(r.investigationType || "Internal")],
      ["Status", r => statusBadge(r.status || "Open")],
      ["Classification", r => classificationBadge(r.classification || "RESTRICTED")],
      ["Lead", (r,refs) => esc(employeeLabel(refs,r.leadEmployeeId))],
      ["Opened", r => esc(fmtDate(r.createdAt))]
    ],
    fields: [
      { name: "title", label: "Investigation title", required: true, span: 2 },
      { name: "investigationType", label: "Type", type: "select", options: ["Employee Conduct","Customer Fraud","Security Incident","Financial Irregularity","Compliance","Policy Violation","Other"] },
      { name: "status", label: "Status", type: "select", options: ["Open","Triage","Active Investigation","Pending Review","Substantiated","Unsubstantiated","Closed"] },
      { name: "classification", label: "Classification", type: "select", options: ["SENSITIVE","RESTRICTED","HIGHLY_RESTRICTED"] },
      { name: "leadEmployeeId", label: "Lead investigator", type: "employee" },
      { name: "subjectReference", label: "Investigation subject", type: "subject", span: 2 },
      { name: "allegationSummary", label: "Allegation / issue summary", type: "textarea", span: 2 },
      { name: "outcome", label: "Outcome / disposition", type: "textarea", span: 2 }
    ]
  },
  workflows: {
    title: "Workflows",
    subtitle: "Cross-module process definitions for approvals, assignments, and operational handoffs.",
    collection: "workflows",
    prefix: "WFL",
    counter: "workflows",
    view: "workflow.view",
    manage: "workflow.manage",
    createLabel: "New workflow",
    singular: "workflow",
    columns: [
      ["Workflow", r => cell(r.name || "Workflow", r.workflowId)],
      ["Trigger", r => esc(r.trigger || "Manual")],
      ["Status", r => statusBadge(r.status || "Draft")],
      ["Owner", r => esc(r.ownerEmployeeId || "—")],
      ["Version", r => esc(r.version || "1")],
      ["Updated", r => esc(fmtDate(r.updatedAt || r.createdAt))]
    ],
    fields: [
      { name: "name", label: "Workflow name", required: true, span: 2 },
      { name: "trigger", label: "Trigger", type: "select", options: ["Manual","Record Created","Status Changed","Approval Completed","Date Reached"] },
      { name: "status", label: "Status", type: "select", options: ["Draft","Active","Paused","Retired"] },
      { name: "ownerEmployeeId", label: "Owner", type: "employee" },
      { name: "version", label: "Version", type: "number", defaultValue: "1" },
      { name: "description", label: "Purpose", type: "textarea", span: 2 },
      { name: "stepsSummary", label: "Steps summary", type: "textarea", span: 2 }
    ]
  }
};

function cell(primary, secondary = "") {
  return `<div class="primary-cell">${esc(primary)}</div>${secondary ? `<div class="secondary">${esc(secondary)}</div>` : ""}`;
}

function employeeLabel(refs, employeeId, fallback = "Unassigned") {
  if (!employeeId) return fallback;
  const employee = (refs?.employees || []).find(item => String(item.employeeId || item.id) === String(employeeId));
  return employee?.displayName || fallback;
}

function employeeContext(refs, employeeId) {
  if (!employeeId) return "";
  const employee = (refs?.employees || []).find(item => String(item.employeeId || item.id) === String(employeeId));
  return employee ? [employee.positionName, employee.departmentName].filter(Boolean).join(" · ") : "";
}

function vendorLabel(refs, vendorId, fallback = "—") {
  if (!vendorId) return fallback;
  const vendor = (refs?.vendors || []).find(item => String(item.vendorId || item.id) === String(vendorId));
  return vendor?.name || fallback;
}

function money(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
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

function asDate(value) {
  if (!value) return null;
  try {
    return value?.toDate ? value.toDate() : new Date(value);
  } catch {
    return null;
  }
}

function asMillis(value) {
  const date = asDate(value);
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function fieldHtml(field, value = "", refs = {}) {
  const required = field.required ? "required" : "";
  const span = field.span === 2 ? " span-2" : "";
  const safe = value ?? field.defaultValue ?? "";

  const relationOptions = {
    employee: (refs.employees || []).map(e => [e.employeeId || e.id, `${e.displayName || "Employee"} — ${e.positionName || "No position"}`]),
    vendor: (refs.vendors || []).map(v => [v.vendorId || v.id, `${v.name || "Vendor"}${v.category ? " — " + v.category : ""}`]),
    departmentName: (refs.departments || []).map(d => [d.name || d.departmentId || d.id, d.name || d.departmentId || "Department"]),
    department: (refs.departments || []).map(d => [d.departmentId || d.id, d.name || d.departmentId || "Department"]),
    position: (refs.positions || []).map(p => [p.positionId || p.id, p.name || p.positionId || "Position"]),
    location: (refs.locations || []).map(l => [l.locationId || l.id, l.name || l.locationId || "Location"]),
    subject: [
      ...(refs.employees || []).map(e => [e.employeeId || e.id, `Employee · ${e.displayName || e.employeeId}`]),
      ...(refs.customers || []).map(customer => [customer.customerId || customer.id, `Customer · ${customer.displayName || customer.customerId}`]),
      ...(refs.vendors || []).map(v => [v.vendorId || v.id, `Vendor · ${v.name || v.vendorId}`])
    ]
  };

  if (relationOptions[field.type]) {
    return `<div class="field${span}"><label>${esc(field.label)}</label><select class="select" name="${esc(field.name)}" ${required}>
      <option value="">Select ${esc(field.label.toLowerCase())}</option>
      ${relationOptions[field.type].map(([v,l]) => `<option value="${esc(v)}" ${String(safe) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}
    </select></div>`;
  }

  if (field.type === "select") {
    return `<div class="field${span}"><label>${esc(field.label)}</label><select class="select" name="${esc(field.name)}" ${required}>
      ${field.options.map(o => `<option value="${esc(o)}" ${String(safe) === String(o) ? "selected" : ""}>${esc(o)}</option>`).join("")}
    </select></div>`;
  }
  if (field.type === "textarea") {
    return `<div class="field${span}"><label>${esc(field.label)}</label><textarea class="textarea" name="${esc(field.name)}" ${required}>${esc(safe)}</textarea></div>`;
  }
  return `<div class="field${span}"><label>${esc(field.label)}</label><input class="input" name="${esc(field.name)}" type="${esc(field.type || "text")}" value="${esc(safe)}" ${required} /></div>`;
}

function collectFields(fd, fields) {
  const out = {};
  for (const field of fields) {
    let value = String(fd.get(field.name) ?? "").trim();
    if (field.type === "number") value = value === "" ? 0 : Number(value);
    out[field.name] = value;
  }
  return out;
}

export function createGeneration2(ctx) {
  const {
    state,
    hasPermission,
    effectiveClearance,
    nextId,
    audit,
    safeCollection,
    pageHeader,
    renderPage,
    toast,
    openModal,
    firebaseMessage
  } = ctx;

  async function loadReferences() {
    const refs={employees:[],departments:[],positions:[],locations:[],vendors:[],customers:[]};
    const tasks=[
      safeCollection("departments",200).then(v=>refs.departments=v),
      safeCollection("positions",250).then(v=>refs.positions=v),
      safeCollection("locations",200).then(v=>refs.locations=v)
    ];
    if(hasPermission("employee.view")||hasPermission("employee.manage")||state.profile?.isSystemOwner===true){
      tasks.push(safeCollection("employees",300).then(v=>refs.employees=v));
    }
    if(hasPermission("vendor.view")||hasPermission("vendor.manage")||hasPermission("procurement.view")||state.profile?.isSystemOwner===true){
      tasks.push(safeCollection("vendors",250).then(v=>refs.vendors=v));
    }
    if(hasPermission("customer.view")){
      tasks.push((async()=>{
        try{
          const snap=state.profile?.isSystemOwner===true
            ? await getDocs(query(collection(db,"customers"),orderBy("createdAt","desc"),limit(250)))
            : await getDocs(query(collection(db,"customers"),where("minimumClearance","<=",effectiveClearance()),limit(250)));
          refs.customers=snap.docs.map(d=>({id:d.id,...d.data()}));
        }catch{}
      })());
    }
    await Promise.all(tasks);
    return refs;
  }

  async function recordsForAccess(config, ownerField = null, selfPermission = null) {
    if (hasPermission(config.view)) {
      if (config.classified && state.profile?.isSystemOwner !== true) {
        const snap = await getDocs(query(
          collection(db, config.collection),
          where("minimumClearance", "<=", effectiveClearance()),
          limit(150)
        ));
        return snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a,b) => asMillis(b.createdAt) - asMillis(a.createdAt));
      }
      return safeCollection(config.collection, 150);
    }

    if (ownerField && (!selfPermission || hasPermission(selfPermission))) {
      const snap = await getDocs(query(collection(db, config.collection), where(ownerField, "==", state.user.uid), limit(150)));
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a,b) => asMillis(b.createdAt) - asMillis(a.createdAt));
    }

    return [];
  }

  async function renderRegistry(target, key) {
    const config = MODULES[key];
    const [records, refs] = await Promise.all([recordsForAccess(config), loadReferences()]);
    const canManage = hasPermission(config.manage);

    target.innerHTML = `
      <div class="page">
        ${pageHeader(config.title, config.subtitle, canManage ? `<button class="btn btn-primary" data-create> ${esc(config.createLabel)} </button>` : "")}
        <section class="card">
          <div class="card-head registry-head">
            <div><h2>${esc(config.title)} registry</h2><p><span data-registry-count>${records.length}</span> of ${records.length} record${records.length === 1 ? "" : "s"} visible</p></div>
            ${records.length ? `<div class="registry-tools">
              <div class="registry-search"><span>⌕</span><input class="input" type="search" data-registry-search placeholder="Search ${esc(config.title.toLowerCase())}…" /></div>
              <select class="select registry-filter" data-registry-status>
                <option value="">All statuses</option>
                ${[...new Set(records.map(record=>record.status).filter(Boolean))].sort().map(status=>`<option value="${esc(String(status).toLowerCase())}">${esc(status)}</option>`).join("")}
              </select>
            </div>` : ""}
          </div>
          ${records.length ? `
            <div class="table-wrap"><table class="table">
              <thead><tr>${config.columns.map(c => `<th>${esc(c[0])}</th>`).join("")}</tr></thead>
              <tbody>${records.map(record => `<tr data-registry-row data-record="${esc(record.id)}" data-status="${esc(String(record.status||"").toLowerCase())}" style="cursor:pointer">${config.columns.map(c => `<td>${c[1](record, refs)}</td>`).join("")}</tr>`).join("")}</tbody>
            </table></div>
            <div class="empty compact" data-registry-empty hidden><strong>No matching records</strong><p>Adjust the search or status filter.</p></div>
          ` : `<div class="empty"><strong>No ${esc(config.title.toLowerCase())} yet</strong><p>${canManage ? "Create the first record to begin." : "No records are currently visible to your account."}</p></div>`}
        </section>
      </div>
    `;

    target.querySelector("[data-create]")?.addEventListener("click", () => editRegistryRecord(config));

    const registrySearch = target.querySelector("[data-registry-search]");
    const registryStatus = target.querySelector("[data-registry-status]");
    const registryCount = target.querySelector("[data-registry-count]");
    const registryEmpty = target.querySelector("[data-registry-empty]");
    const applyRegistryFilters = () => {
      const term = String(registrySearch?.value || "").trim().toLowerCase();
      const status = String(registryStatus?.value || "").toLowerCase();
      let visible = 0;
      target.querySelectorAll("[data-registry-row]").forEach(row => {
        const matchesTerm = !term || row.textContent.toLowerCase().includes(term);
        const matchesStatus = !status || row.dataset.status === status;
        const show = matchesTerm && matchesStatus;
        row.hidden = !show;
        if (show) visible++;
      });
      if (registryCount) registryCount.textContent = visible;
      if (registryEmpty) registryEmpty.hidden = visible !== 0;
    };
    registrySearch?.addEventListener("input", applyRegistryFilters);
    registryStatus?.addEventListener("change", applyRegistryFilters);

    target.querySelectorAll("[data-record]").forEach(row => {
      row.addEventListener("click", () => {
        const record = records.find(r => r.id === row.dataset.record);
        editRegistryRecord(config, record, !canManage);
      });
    });
  }

  async function editRegistryRecord(config, record = null, readOnly = false) {
    const editing = Boolean(record);
    const refs = await loadReferences();
    openModal({
      title: `${readOnly ? "View" : editing ? "Edit" : "Create"} ${config.singular}`,
      submitLabel: readOnly ? "Close" : editing ? "Save changes" : config.createLabel,
      width: "780px",
      body: `
        ${editing ? `<div class="record-identity"><span>${esc(record[config.counter.slice(0,-1) + "Id"] || record[config.singular + "Id"] || "")}</span><strong>${esc(record.title || record.name || config.title)}</strong></div>` : ""}
        <div class="form-grid">${config.fields.map(f => fieldHtml(f, record?.[f.name], refs)).join("")}</div>
        ${readOnly ? '<div class="notice"><div><strong>Read-only access</strong>Your current authorization allows viewing this record but not modifying it.</div></div>' : ""}
      `,
      onSubmit: async (fd) => {
        if (readOnly) return true;
        try {
          const data = collectFields(fd, config.fields);
          if (config.classified && data.classification) {
            data.minimumClearance = classificationLevel(data.classification);
          }

          if (editing) {
            await updateDoc(doc(db, config.collection, record.id), {
              ...data,
              updatedAt: serverTimestamp(),
              updatedBy: state.user.uid
            });
            await audit(`${config.singular.toUpperCase()}_UPDATED`, config.singular, record.id);
            toast(`${config.title.slice(0,-1)} updated`, "Changes have been saved.");
          } else {
            const humanId = await nextId(config.counter, config.prefix);
            const humanField = config.singular === "announcement"
              ? "announcementId"
              : config.singular + "Id";
            const ref = doc(collection(db, config.collection));
            if (config.collection === "announcements") {
              data.authorEmployeeId = state.employee?.employeeId || null;
            }
            await setDoc(ref, {
              ...data,
              [humanField]: humanId,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              createdBy: state.user.uid,
              updatedBy: state.user.uid
            });
            await audit(`${config.singular.toUpperCase()}_CREATED`, config.singular, ref.id, { humanId });
            toast(`${config.title.slice(0,-1)} created`, humanId);
          }
          await renderPage();
          return true;
        } catch (error) {
          toast("Operation failed", firebaseMessage(error));
          return false;
        }
      }
    });

    if (readOnly) {
      const form = document.querySelector("#modal-root form");
      form?.querySelectorAll("input,select,textarea").forEach(el => el.disabled = true);
      const submit = form?.querySelector('button[type="submit"]');
      if (submit) submit.textContent = "Close";
    }
  }


  async function renderOrganization(target) {
    const [departments, positions, locations, refs] = await Promise.all([
      safeCollection("departments", 100),
      safeCollection("positions", 120),
      safeCollection("locations", 100),
      loadReferences()
    ]);
    const canManage = hasPermission("organization.manage");

    target.innerHTML = `
      <div class="page">
        ${pageHeader("Organization", "Departments, positions, locations, and the structure behind Citadel access and reporting.", canManage ? '<button class="btn btn-primary" data-org-add="department">New department</button><button class="btn" data-org-add="position">New position</button><button class="btn" data-org-add="location">New location</button>' : "")}
        <div class="kpi-grid">
          <div class="kpi-card"><div class="kpi-label">Departments</div><div class="kpi-value">${departments.length}</div><div class="kpi-meta">Operational and corporate units</div></div>
          <div class="kpi-card"><div class="kpi-label">Positions</div><div class="kpi-value">${positions.length}</div><div class="kpi-meta">Position-based access foundation</div></div>
          <div class="kpi-card"><div class="kpi-label">Locations</div><div class="kpi-value">${locations.length}</div><div class="kpi-meta">Physical or operating sites</div></div>
          <div class="kpi-card"><div class="kpi-label">Structure status</div><div class="kpi-value kpi-small">Connected</div><div class="kpi-meta">Shared across enterprise modules</div></div>
        </div>
        <div class="section-stack">
          <section class="card">
            <div class="card-head"><div><h2>Departments</h2><p>Organizational units and leadership assignments</p></div></div>
            ${departments.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Department</th><th>Code</th><th>Leader</th><th>Status</th></tr></thead><tbody>
              ${departments.map(r=>`<tr><td>${cell(r.name||"Department",r.departmentId)}</td><td>${esc(r.code||"—")}</td><td>${esc(employeeLabel(refs,r.leaderEmployeeId,"Unassigned"))}</td><td>${statusBadge(r.status||"Active")}</td></tr>`).join("")}
            </tbody></table></div>` : '<div class="empty"><strong>No departments configured</strong><p>Departments can be created by Organization administrators.</p></div>'}
          </section>
          <div class="grid-2">
            <section class="card">
              <div class="card-head"><div><h2>Positions</h2><p>Job positions used by personnel and access control</p></div></div>
              ${positions.length ? `<div class="list">${positions.slice(0,18).map(r=>`<div class="list-row"><div class="grow"><strong>${esc(r.name||"Position")}</strong><span>${esc(r.positionId||"—")} · ${esc(r.department||"No department")}</span></div>${statusBadge(r.status||"Active")}</div>`).join("")}</div>` : '<div class="empty"><strong>No positions configured</strong><p>Position definitions will appear here.</p></div>'}
            </section>
            <section class="card">
              <div class="card-head"><div><h2>Locations</h2><p>Operating sites and corporate facilities</p></div></div>
              ${locations.length ? `<div class="list">${locations.slice(0,18).map(r=>`<div class="list-row"><div class="grow"><strong>${esc(r.name||"Location")}</strong><span>${esc(r.locationId||"—")} · ${esc(r.city||"")} ${esc(r.state||"")}</span></div>${statusBadge(r.status||"Active")}</div>`).join("")}</div>` : '<div class="empty"><strong>No locations configured</strong><p>Corporate locations will appear here.</p></div>'}
            </section>
          </div>
        </div>
      </div>
    `;

    target.querySelectorAll("[data-org-add]").forEach(btn => btn.addEventListener("click", () => organizationModal(btn.dataset.orgAdd)));
  }

  async function organizationModal(type) {
    const refs = await loadReferences();
    const configs = {
      department: {
        title: "New department", collection: "departments", counter: "departments", prefix: "DEP", idField: "departmentId",
        body: `<div class="form-grid">
          <div class="field"><label>Department name</label><input class="input" name="name" required /></div>
          <div class="field"><label>Department code</label><input class="input" name="code" /></div>
          ${fieldHtml({name:"leaderEmployeeId",label:"Department leader",type:"employee"}, "", refs)}
          <div class="field"><label>Status</label><select class="select" name="status"><option>Active</option><option>Planned</option><option>Inactive</option></select></div>
          <div class="field span-2"><label>Description</label><textarea class="textarea" name="description"></textarea></div>
        </div>`
      },
      position: {
        title: "New position", collection: "positions", counter: "positions", prefix: "POS", idField: "positionId",
        body: `<div class="form-grid">
          <div class="field"><label>Position name</label><input class="input" name="name" required /></div>
          ${fieldHtml({name:"department",label:"Department",type:"departmentName"}, "", refs)}
          ${fieldHtml({name:"reportsToPositionId",label:"Reports to position",type:"position"}, "", refs)}
          <div class="field"><label>Default clearance</label><select class="select" name="defaultClearance">${Array.from({length:11},(_,i)=>`<option value="${i}">C${i}</option>`).join("")}</select></div>
          <div class="field"><label>Status</label><select class="select" name="status"><option>Active</option><option>Planned</option><option>Inactive</option></select></div>
          <div class="field span-2"><label>Description</label><textarea class="textarea" name="description"></textarea></div>
        </div>`
      },
      location: {
        title: "New location", collection: "locations", counter: "locations", prefix: "LOC", idField: "locationId",
        body: `<div class="form-grid">
          <div class="field"><label>Location name</label><input class="input" name="name" required /></div>
          <div class="field"><label>Location type</label><select class="select" name="locationType"><option>Headquarters</option><option>Office</option><option>Store</option><option>Warehouse</option><option>Service Center</option><option>Remote</option><option>Other</option></select></div>
          <div class="field"><label>City</label><input class="input" name="city" /></div>
          <div class="field"><label>State / region</label><input class="input" name="state" /></div>
          <div class="field"><label>Status</label><select class="select" name="status"><option>Active</option><option>Planned</option><option>Closed</option></select></div>
          <div class="field span-2"><label>Address / notes</label><textarea class="textarea" name="address"></textarea></div>
        </div>`
      }
    };
    const cfg=configs[type];
    openModal({
      title:cfg.title,
      submitLabel:"Create",
      body:cfg.body,
      onSubmit:async fd=>{
        try{
          const humanId=await nextId(cfg.counter,cfg.prefix);
          const ref=doc(collection(db,cfg.collection));
          const data={};
          for(const [key,value] of fd.entries()) data[key]=String(value).trim();
          if(data.defaultClearance !== undefined) data.defaultClearance=Number(data.defaultClearance||0);
          await setDoc(ref,{
            ...data,
            [cfg.idField]:humanId,
            createdAt:serverTimestamp(),
            updatedAt:serverTimestamp(),
            createdBy:state.user.uid
          });
          await audit(`${type.toUpperCase()}_CREATED`,type,ref.id,{humanId});
          toast(`${cfg.title.replace("New ","")} created`,humanId);
          await renderPage();
          return true;
        }catch(error){toast("Creation failed",firebaseMessage(error));return false;}
      }
    });
  }

  async function renderHR(target) {
    const canHR = hasPermission("hr.view");
    const refs = await loadReferences();
    const leaveSnap = canHR
      ? await safeCollection("leaveRequests", 100)
      : await getDocs(query(collection(db, "leaveRequests"), where("requesterUid", "==", state.user.uid), limit(100)))
          .then(s => s.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b)=>asMillis(b.createdAt)-asMillis(a.createdAt)));
    const reviews = canHR ? await safeCollection("performanceReviews", 60) : [];
    const discipline = canHR ? await safeCollection("disciplinaryActions", 60) : [];

    target.innerHTML = `
      <div class="page">
        ${pageHeader("HR Operations", "Leave, performance, employee relations, and personnel operations.", '<button class="btn btn-primary" data-leave>Request leave</button>' + (hasPermission("hr.manage") ? '<button class="btn" data-review>New performance review</button><button class="btn" data-discipline>Record action</button>' : ""))}
        <div class="kpi-grid">
          <div class="kpi-card"><div class="kpi-label">Leave requests</div><div class="kpi-value">${leaveSnap.length ?? 0}</div><div class="kpi-meta">${canHR ? "Organization-visible queue" : "Your requests"}</div></div>
          <div class="kpi-card"><div class="kpi-label">Performance reviews</div><div class="kpi-value">${reviews.length}</div><div class="kpi-meta">Recent review records</div></div>
          <div class="kpi-card"><div class="kpi-label">Employee relations</div><div class="kpi-value">${discipline.length}</div><div class="kpi-meta">Controlled personnel actions</div></div>
          <div class="kpi-card"><div class="kpi-label">Your department</div><div class="kpi-value kpi-small">${esc(state.employee?.departmentName || "—")}</div><div class="kpi-meta">${esc(state.employee?.positionName || "Employee")}</div></div>
        </div>
        <div class="grid-2">
          <section class="card">
            <div class="card-head"><div><h2>Leave queue</h2><p>Time-off requests and decisions</p></div></div>
            ${leaveSnap.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Status</th><th>Submitted</th></tr></thead><tbody>
              ${leaveSnap.map(r=>`<tr data-leave-record="${esc(r.id)}" style="${hasPermission("hr.manage") ? "cursor:pointer" : ""}"><td><div class="primary-cell">${esc(employeeLabel(refs,r.requesterEmployeeId,"Employee"))}</div><div class="secondary">${esc(employeeContext(refs,r.requesterEmployeeId))}</div></td><td class="primary-cell">${esc(r.leaveType || "Leave")}</td><td>${esc(r.startDate || "—")} → ${esc(r.endDate || "—")}</td><td>${statusBadge(r.status || "Pending")}</td><td>${esc(fmtDate(r.createdAt))}</td></tr>`).join("")}
            </tbody></table></div>` : '<div class="empty"><strong>No leave requests</strong><p>Leave requests will appear here.</p></div>'}
          </section>
          <section class="card">
            <div class="card-head"><div><h2>Personnel controls</h2><p>Core personnel operations</p></div></div>
            <div class="list">
              <div class="list-row"><div class="grow"><strong>Performance management</strong><span>Formal reviews with rating, period, reviewer, and narrative.</span></div>${canHR ? '<span class="badge success">Available</span>' : '<span class="badge">Restricted</span>'}</div>
              <div class="list-row"><div class="grow"><strong>Employee relations</strong><span>Controlled disciplinary and corrective-action records.</span></div>${canHR ? '<span class="badge success">Available</span>' : '<span class="badge">Restricted</span>'}</div>
              <div class="list-row"><div class="grow"><strong>Leave self-service</strong><span>Employees can submit requests without broad HR data access.</span></div><span class="badge success">Available</span></div>
            </div>
          </section>
        </div>
      </div>
    `;

    target.querySelector("[data-leave]")?.addEventListener("click", leaveModal);
    target.querySelector("[data-review]")?.addEventListener("click", reviewModal);
    target.querySelector("[data-discipline]")?.addEventListener("click", disciplineModal);
    if (hasPermission("hr.manage")) {
      target.querySelectorAll("[data-leave-record]").forEach(row => row.addEventListener("click", () => {
        const record = leaveSnap.find(r => r.id === row.dataset.leaveRecord);
        if (record) manageLeaveModal(record, refs);
      }));
    }
  }

  function manageLeaveModal(record, refs = {employees:[]}) {
    openModal({
      title: `Review leave · ${employeeLabel(refs,record.requesterEmployeeId,"Employee")}`,
      submitLabel: "Save decision",
      body: `
        <div class="notice" style="margin-bottom:16px"><div><strong>${esc(employeeLabel(refs,record.requesterEmployeeId,"Employee"))}</strong>${esc(record.leaveType || "Leave")} · ${esc(record.startDate || "—")} → ${esc(record.endDate || "—")}</div></div>
        <div class="form-grid">
          <div class="field"><label>Status</label><select class="select" name="status">${["Pending","Approved","Denied","Cancelled"].map(v=>`<option ${record.status===v?"selected":""}>${v}</option>`).join("")}</select></div>
          <div class="field"><label>Decision note</label><input class="input" name="decisionNote" value="${esc(record.decisionNote || "")}" /></div>
        </div>
      `,
      onSubmit: async fd => {
        try {
          await updateDoc(doc(db,"leaveRequests",record.id),{
            status:String(fd.get("status")||"Pending"),
            decisionNote:String(fd.get("decisionNote")||"").trim(),
            decidedByUid:state.user.uid,
            decidedByEmployeeId:state.employee?.employeeId||null,
            decidedAt:serverTimestamp(),
            updatedAt:serverTimestamp()
          });
          await audit("LEAVE_REQUEST_DECIDED","leaveRequest",record.id,{leaveId:record.leaveId||null});
          toast("Leave request updated",record.leaveId||"");
          await renderPage();
          return true;
        } catch(error) { toast("Decision failed",firebaseMessage(error)); return false; }
      }
    });
  }

  function leaveModal() {
    openModal({
      title: "Request leave",
      submitLabel: "Submit request",
      body: `
        <div class="form-grid">
          <div class="field"><label>Leave type</label><select class="select" name="leaveType"><option>Vacation</option><option>Sick</option><option>Personal</option><option>Bereavement</option><option>Medical</option><option>Other</option></select></div>
          <div class="field"><label>Start date</label><input class="input" name="startDate" type="date" required /></div>
          <div class="field"><label>End date</label><input class="input" name="endDate" type="date" required /></div>
          <div class="field span-2"><label>Reason / notes</label><textarea class="textarea" name="reason"></textarea></div>
        </div>
      `,
      onSubmit: async fd => {
        try {
          const leaveId = await nextId("leaveRequests", "LVE");
          const ref = doc(collection(db, "leaveRequests"));
          await setDoc(ref, {
            leaveId,
            requesterUid: state.user.uid,
            requesterEmployeeId: state.employee?.employeeId || null,
            leaveType: String(fd.get("leaveType") || "Other"),
            startDate: String(fd.get("startDate") || ""),
            endDate: String(fd.get("endDate") || ""),
            reason: String(fd.get("reason") || "").trim(),
            status: "Pending",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
          await audit("LEAVE_REQUESTED","leaveRequest",ref.id,{leaveId});
          toast("Leave submitted", leaveId);
          await renderPage();
          return true;
        } catch (error) {
          toast("Request failed", firebaseMessage(error));
          return false;
        }
      }
    });
  }

  async function reviewModal() {
    const refs = await loadReferences();
    openModal({
      title: "New performance review",
      submitLabel: "Create review",
      body: `
        <div class="form-grid">
          ${fieldHtml({name:"employeeId",label:"Employee",type:"employee",required:true}, "", refs)}
          <div class="field"><label>Review period</label><input class="input" name="reviewPeriod" placeholder="2026 Annual" required /></div>
          <div class="field"><label>Overall rating</label><select class="select" name="rating"><option>Exceptional</option><option>Exceeds Expectations</option><option selected>Meets Expectations</option><option>Needs Improvement</option><option>Unsatisfactory</option></select></div>
          <div class="field"><label>Status</label><select class="select" name="status"><option>Draft</option><option>Manager Review</option><option>Delivered</option><option>Final</option></select></div>
          <div class="field span-2"><label>Summary</label><textarea class="textarea" name="summary" required></textarea></div>
          <div class="field span-2"><label>Goals / next steps</label><textarea class="textarea" name="goals"></textarea></div>
        </div>
      `,
      onSubmit: async fd => createSimple("performanceReviews","performanceReviews","PRF","PERFORMANCE_REVIEW_CREATED",{
        employeeId:String(fd.get("employeeId")||"").trim().toUpperCase(),
        reviewPeriod:String(fd.get("reviewPeriod")||"").trim(),
        rating:String(fd.get("rating")||"Meets Expectations"),
        status:String(fd.get("status")||"Draft"),
        summary:String(fd.get("summary")||"").trim(),
        goals:String(fd.get("goals")||"").trim(),
        reviewerUid:state.user.uid,
        reviewerEmployeeId:state.employee?.employeeId||null
      })
    });
  }

  async function disciplineModal() {
    const refs = await loadReferences();
    openModal({
      title: "Record employee relations action",
      submitLabel: "Record action",
      body: `
        <div class="form-grid">
          ${fieldHtml({name:"employeeId",label:"Employee",type:"employee",required:true}, "", refs)}
          <div class="field"><label>Action type</label><select class="select" name="actionType"><option>Coaching</option><option>Verbal Warning</option><option>Written Warning</option><option>Final Warning</option><option>Suspension</option><option>Investigation Referral</option></select></div>
          <div class="field"><label>Status</label><select class="select" name="status"><option>Open</option><option>Final</option><option>Appealed</option><option>Closed</option></select></div>
          <div class="field"><label>Effective date</label><input class="input" name="effectiveDate" type="date" /></div>
          <div class="field span-2"><label>Reason</label><textarea class="textarea" name="reason" required></textarea></div>
          <div class="field span-2"><label>Expectations / corrective plan</label><textarea class="textarea" name="correctivePlan"></textarea></div>
        </div>
      `,
      onSubmit: async fd => createSimple("disciplinaryActions","disciplinaryActions","DSA","DISCIPLINARY_ACTION_CREATED",{
        employeeId:String(fd.get("employeeId")||"").trim().toUpperCase(),
        actionType:String(fd.get("actionType")||"Written Warning"),
        status:String(fd.get("status")||"Open"),
        effectiveDate:String(fd.get("effectiveDate")||""),
        reason:String(fd.get("reason")||"").trim(),
        correctivePlan:String(fd.get("correctivePlan")||"").trim(),
        createdByEmployeeId:state.employee?.employeeId||null
      })
    });
  }

  async function createSimple(collectionName, counter, prefix, auditAction, data) {
    try {
      const humanId = await nextId(counter,prefix);
      const ref = doc(collection(db,collectionName));
      await setDoc(ref,{
        ...data,
        recordId: humanId,
        createdAt:serverTimestamp(),
        updatedAt:serverTimestamp(),
        createdBy:state.user.uid
      });
      await audit(auditAction,collectionName,ref.id,{humanId});
      toast("Record created",humanId);
      await renderPage();
      return true;
    } catch(error) {
      toast("Operation failed",firebaseMessage(error));
      return false;
    }
  }

  async function renderTraining(target) {
    const canAll = hasPermission("training.view");
    const refs = await loadReferences();
    const records = canAll
      ? await safeCollection("trainingRecords",100)
      : await getDocs(query(collection(db,"trainingRecords"),where("employeeId","==",state.employee?.employeeId || "__none__"),limit(100))).then(s=>s.docs.map(d=>({id:d.id,...d.data()})));
    target.innerHTML = `
      <div class="page">
        ${pageHeader("Training", "Required learning, certifications, completions, and renewal tracking.", hasPermission("training.manage") ? '<button class="btn btn-primary" data-training>Add training record</button>' : "")}
        <section class="card">
          <div class="card-head"><div><h2>Training records</h2><p>${records.length} visible record${records.length===1?"":"s"}</p></div></div>
          ${records.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Course / Certification</th><th>Employee</th><th>Status</th><th>Completed</th><th>Expires</th></tr></thead><tbody>
          ${records.map(r=>`<tr><td>${cell(r.title||"Training",r.recordId)}</td><td><div class="primary-cell">${esc(employeeLabel(refs,r.employeeId,"Employee"))}</div><div class="secondary">${esc(employeeContext(refs,r.employeeId))}</div></td><td>${statusBadge(r.status||"Assigned")}</td><td>${esc(r.completedDate||"—")}</td><td>${esc(r.expirationDate||"—")}</td></tr>`).join("")}
          </tbody></table></div>` : '<div class="empty"><strong>No training records</strong><p>Assigned and completed training will appear here.</p></div>'}
        </section>
      </div>
    `;
    target.querySelector("[data-training]")?.addEventListener("click",async()=>{
      const refs = await loadReferences();
      openModal({
        title:"Add training record",
        submitLabel:"Add record",
        body:`<div class="form-grid">
          ${fieldHtml({name:"employeeId",label:"Employee",type:"employee",required:true}, "", refs)}
          <div class="field"><label>Course / certification</label><input class="input" name="title" required /></div>
          <div class="field"><label>Status</label><select class="select" name="status"><option>Assigned</option><option>In Progress</option><option>Completed</option><option>Expired</option><option>Waived</option></select></div>
          <div class="field"><label>Completed date</label><input class="input" name="completedDate" type="date" /></div>
          <div class="field"><label>Expiration date</label><input class="input" name="expirationDate" type="date" /></div>
          <div class="field"><label>Score / result</label><input class="input" name="result" /></div>
        </div>`,
        onSubmit:fd=>createSimple("trainingRecords","trainingRecords","TRN","TRAINING_RECORD_CREATED",{
          employeeId:String(fd.get("employeeId")||"").trim().toUpperCase(),
          title:String(fd.get("title")||"").trim(),
          status:String(fd.get("status")||"Assigned"),
          completedDate:String(fd.get("completedDate")||""),
          expirationDate:String(fd.get("expirationDate")||""),
          result:String(fd.get("result")||"")
        })
      });
    });
  }

  async function renderService(target) {
    const canViewAll = hasPermission("service.view");
    const refs = await loadReferences();
    const records = canViewAll
      ? await safeCollection("serviceTickets",120)
      : await getDocs(query(collection(db,"serviceTickets"),where("requesterUid","==",state.user.uid),limit(120)))
          .then(s=>s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>asMillis(b.createdAt)-asMillis(a.createdAt)));

    target.innerHTML = `
      <div class="page">
        ${pageHeader("Service Desk", "Internal IT, HR, Facilities, Security, Access, and corporate service requests.", hasPermission("service.create") ? '<button class="btn btn-primary" data-ticket>New request</button>' : "")}
        <section class="card">
          <div class="card-head"><div><h2>${canViewAll ? "Service queue" : "My requests"}</h2><p>${records.length} ticket${records.length===1?"":"s"}</p></div></div>
          ${records.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Request</th><th>Catalog</th><th>Priority</th><th>Status</th><th>SLA</th><th>Requester</th><th>Updated</th></tr></thead><tbody>
            ${records.map(r=>{
              const due=asDate(r.slaDueAt);
              const breached=due&&due.getTime()<Date.now()&&!["Resolved","Closed","Cancelled"].includes(r.status);
              return `<tr data-service-record="${esc(r.id)}" style="${hasPermission("service.manage") ? "cursor:pointer" : ""}"><td>${cell(r.title||"Request",r.ticketId)}</td><td>${esc(r.catalog||"General")}</td><td>${statusBadge(r.priority||"Normal")}</td><td>${statusBadge(r.status||"New")}</td><td>${r.slaDueAt?statusBadge(breached?"Breached":"On Track"):'<span class="badge">Not set</span>'}</td><td><div class="primary-cell">${esc(employeeLabel(refs,r.requesterEmployeeId,"Employee"))}</div><div class="secondary">${esc(employeeContext(refs,r.requesterEmployeeId))}</div></td><td>${esc(fmtDate(r.updatedAt||r.createdAt))}</td></tr>`;
            }).join("")}
          </tbody></table></div>` : '<div class="empty"><strong>No service requests</strong><p>Use New Request for IT, HR, Facilities, Security, Access, Procurement, or other internal support.</p></div>'}
        </section>
      </div>
    `;
    target.querySelector("[data-ticket]")?.addEventListener("click",ticketModal);
    if (hasPermission("service.manage")) {
      target.querySelectorAll("[data-service-record]").forEach(row => row.addEventListener("click", () => {
        const record=records.find(r=>r.id===row.dataset.serviceRecord);
        if(record) manageServiceTicket(record);
      }));
    }
  }

  async function manageServiceTicket(record) {
    const refs = await loadReferences();
    openModal({
      title:`Manage ticket · ${record.ticketId || ""}`,
      submitLabel:"Save ticket",
      body:`
        <div class="notice" style="margin-bottom:16px"><div><strong>${esc(record.title||"Service request")}</strong>${esc(record.description||"")}</div></div>
        <div class="form-grid">
          <div class="field"><label>Status</label><select class="select" name="status">${["New","Assigned","In Progress","Pending Requester","Pending Internal","Resolved","Closed","Cancelled"].map(v=>`<option ${record.status===v?"selected":""}>${v}</option>`).join("")}</select></div>
          ${fieldHtml({name:"assignedEmployeeId",label:"Assigned employee",type:"employee"}, record.assignedEmployeeId||"", refs)}
          <div class="field"><label>Priority</label><select class="select" name="priority">${["Low","Normal","High","Critical"].map(v=>`<option ${record.priority===v?"selected":""}>${v}</option>`).join("")}</select></div>
          <div class="field span-2"><label>Resolution / internal update</label><textarea class="textarea" name="resolution">${esc(record.resolution||"")}</textarea></div>
        </div>
      `,
      onSubmit:async fd=>{
        try{
          await updateDoc(doc(db,"serviceTickets",record.id),{
            status:String(fd.get("status")||"New"),
            assignedEmployeeId:String(fd.get("assignedEmployeeId")||"").trim().toUpperCase()||null,
            priority:String(fd.get("priority")||"Normal"),
            resolution:String(fd.get("resolution")||"").trim(),
            updatedAt:serverTimestamp(),
            updatedBy:state.user.uid
          });
          await audit("SERVICE_TICKET_UPDATED","serviceTicket",record.id,{ticketId:record.ticketId||null});
          toast("Ticket updated",record.ticketId||"");
          await renderPage();
          return true;
        }catch(error){toast("Ticket update failed",firebaseMessage(error));return false;}
      }
    });
  }

  function ticketModal() {
    openModal({
      title:"New service request",
      submitLabel:"Submit request",
      body:`<div class="form-grid">
        <div class="field span-2"><label>Request title</label><input class="input" name="title" required /></div>
        <div class="field"><label>Service catalog</label><select class="select" name="catalog"><option>IT Support</option><option>HR Request</option><option>Payroll Question</option><option>Facilities</option><option>Security</option><option>Access Request</option><option>Procurement</option><option>Legal</option><option>Other</option></select></div>
        <div class="field"><label>Priority</label><select class="select" name="priority"><option>Low</option><option selected>Normal</option><option>High</option><option>Critical</option></select></div>
        <div class="field span-2"><label>Description</label><textarea class="textarea" name="description" required></textarea></div>
      </div>`,
      onSubmit:async fd=>{
        try{
          const ticketId=await nextId("serviceTickets","TKT");
          const ref=doc(collection(db,"serviceTickets"));
          const priority=String(fd.get("priority")||"Normal");
          const slaHours=priority==="Critical"?4:priority==="High"?8:priority==="Low"?72:24;
          await setDoc(ref,{
            ticketId,
            title:String(fd.get("title")||"").trim(),
            catalog:String(fd.get("catalog")||"Other"),
            priority,
            description:String(fd.get("description")||"").trim(),
            status:"New",
            slaHours,
            slaDueAt:new Date(Date.now()+slaHours*3600000),
            requesterUid:state.user.uid,
            requesterEmployeeId:state.employee?.employeeId||null,
            assignedEmployeeId:null,
            createdAt:serverTimestamp(),
            updatedAt:serverTimestamp()
          });
          await audit("SERVICE_TICKET_CREATED","serviceTicket",ref.id,{ticketId});
          toast("Request submitted",ticketId);
          await renderPage();
          return true;
        }catch(error){toast("Request failed",firebaseMessage(error));return false;}
      }
    });
  }

  async function renderProcurement(target) {
    const canViewAll=hasPermission("procurement.view");
    const refs=await loadReferences();
    const requests=canViewAll
      ? await safeCollection("purchaseRequests",120)
      : await getDocs(query(collection(db,"purchaseRequests"),where("requesterUid","==",state.user.uid),limit(120))).then(s=>s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>asMillis(b.createdAt)-asMillis(a.createdAt)));
    target.innerHTML=`
      <div class="page">
        ${pageHeader("Procurement","Purchase requests, vendor sourcing, approvals, and acquisition tracking.",hasPermission("procurement.request")?'<button class="btn btn-primary" data-purchase>Purchase request</button>':"")}
        <div class="kpi-grid">
          <div class="kpi-card"><div class="kpi-label">Visible requests</div><div class="kpi-value">${requests.length}</div><div class="kpi-meta">Current request register</div></div>
          <div class="kpi-card"><div class="kpi-label">Pending</div><div class="kpi-value">${requests.filter(r=>["Submitted","Pending Approval","Sourcing"].includes(r.status)).length}</div><div class="kpi-meta">Still in procurement flow</div></div>
          <div class="kpi-card"><div class="kpi-label">Approved</div><div class="kpi-value">${requests.filter(r=>r.status==="Approved").length}</div><div class="kpi-meta">Authorized purchases</div></div>
          <div class="kpi-card"><div class="kpi-label">Requested value</div><div class="kpi-value kpi-small">${money(requests.reduce((s,r)=>s+Number(r.estimatedCost||0),0))}</div><div class="kpi-meta">Visible request total</div></div>
        </div>
        <section class="card"><div class="card-head"><div><h2>${canViewAll?"Purchase request queue":"My purchase requests"}</h2><p>Purchase, sourcing, and fulfillment lifecycle</p></div></div>
        ${requests.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Request</th><th>Department</th><th>Cost</th><th>Vendor</th><th>Status</th><th>Requester</th></tr></thead><tbody>
          ${requests.map(r=>`<tr data-purchase-record="${esc(r.id)}" style="${hasPermission("procurement.manage") ? "cursor:pointer" : ""}"><td>${cell(r.title||"Purchase",r.purchaseRequestId)}</td><td>${esc(r.department||"—")}</td><td>${money(r.estimatedCost)}</td><td>${esc(r.preferredVendor||"Open sourcing")}</td><td>${statusBadge(r.status||"Submitted")}</td><td><div class="primary-cell">${esc(employeeLabel(refs,r.requesterEmployeeId,"Employee"))}</div><div class="secondary">${esc(employeeContext(refs,r.requesterEmployeeId))}</div></td></tr>`).join("")}
        </tbody></table></div>`:'<div class="empty"><strong>No purchase requests</strong><p>Submit a purchase request to begin the procurement workflow.</p></div>'}</section>
      </div>`;
    target.querySelector("[data-purchase]")?.addEventListener("click",purchaseModal);
    if (hasPermission("procurement.manage")) {
      target.querySelectorAll("[data-purchase-record]").forEach(row=>row.addEventListener("click",()=>{
        const record=requests.find(r=>r.id===row.dataset.purchaseRecord);
        if(record) managePurchaseRequest(record);
      }));
    }
  }

  async function managePurchaseRequest(record){
    const refs = await loadReferences();
    openModal({
      title:`Manage purchase request · ${record.purchaseRequestId||""}`,
      submitLabel:"Save request",
      body:`
        <div class="notice" style="margin-bottom:16px"><div><strong>${esc(record.title||"Purchase request")}</strong>${money(record.estimatedCost)} · ${esc(record.department||"No department")}</div></div>
        <div class="form-grid">
          <div class="field"><label>Status</label><select class="select" name="status">${["Submitted","Pending Approval","Approved","Denied","Sourcing","Ordered","Received","Closed","Cancelled"].map(v=>`<option ${record.status===v?"selected":""}>${v}</option>`).join("")}</select></div>
          <div class="field"><label>Selected vendor</label><select class="select" name="selectedVendor"><option value="">Select vendor</option>${refs.vendors.map(v=>`<option value="${esc(v.name||v.vendorId||v.id)}" ${String(record.selectedVendor||record.preferredVendor||"")===String(v.name||v.vendorId||v.id)?"selected":""}>${esc(v.name||"Vendor")}</option>`).join("")}</select></div>
          <div class="field"><label>PO / reference</label><input class="input" name="purchaseOrderRef" value="${esc(record.purchaseOrderRef||"")}" /></div>
          <div class="field span-2"><label>Procurement notes</label><textarea class="textarea" name="procurementNotes">${esc(record.procurementNotes||"")}</textarea></div>
        </div>
      `,
      onSubmit:async fd=>{
        try{
          await updateDoc(doc(db,"purchaseRequests",record.id),{
            status:String(fd.get("status")||"Submitted"),
            selectedVendor:String(fd.get("selectedVendor")||"").trim(),
            purchaseOrderRef:String(fd.get("purchaseOrderRef")||"").trim(),
            procurementNotes:String(fd.get("procurementNotes")||"").trim(),
            reviewedByUid:state.user.uid,
            reviewedByEmployeeId:state.employee?.employeeId||null,
            updatedAt:serverTimestamp()
          });
          await audit("PURCHASE_REQUEST_UPDATED","purchaseRequest",record.id,{purchaseRequestId:record.purchaseRequestId||null});
          toast("Purchase request updated",record.purchaseRequestId||"");
          await renderPage();
          return true;
        }catch(error){toast("Update failed",firebaseMessage(error));return false;}
      }
    });
  }

  async function purchaseModal(){
    const refs = await loadReferences();
    openModal({
      title:"Purchase request",
      submitLabel:"Submit request",
      body:`<div class="form-grid">
        <div class="field span-2"><label>Purchase title</label><input class="input" name="title" required /></div>
        ${fieldHtml({name:"department",label:"Department",type:"departmentName"}, state.employee?.departmentName||"", refs)}
        <div class="field"><label>Estimated cost</label><input class="input" type="number" min="0" step=".01" name="estimatedCost" required /></div>
        <div class="field"><label>Preferred vendor</label><select class="select" name="preferredVendor"><option value="">No preference</option>${refs.vendors.map(v=>`<option value="${esc(v.name||v.vendorId||v.id)}">${esc(v.name||"Vendor")}</option>`).join("")}</select></div>
        <div class="field"><label>Needed by</label><input class="input" name="neededBy" type="date" /></div>
        <div class="field span-2"><label>Business justification</label><textarea class="textarea" name="justification" required></textarea></div>
      </div>`,
      onSubmit:async fd=>{
        try{
          const purchaseRequestId=await nextId("purchaseRequests","PRQ");
          const ref=doc(collection(db,"purchaseRequests"));
          await setDoc(ref,{
            purchaseRequestId,
            title:String(fd.get("title")||"").trim(),
            department:String(fd.get("department")||"").trim(),
            estimatedCost:Number(fd.get("estimatedCost")||0),
            preferredVendor:String(fd.get("preferredVendor")||"").trim(),
            neededBy:String(fd.get("neededBy")||""),
            justification:String(fd.get("justification")||"").trim(),
            status:"Submitted",
            requesterUid:state.user.uid,
            requesterEmployeeId:state.employee?.employeeId||null,
            createdAt:serverTimestamp(),
            updatedAt:serverTimestamp()
          });
          await audit("PURCHASE_REQUEST_CREATED","purchaseRequest",ref.id,{purchaseRequestId});
          toast("Purchase request submitted",purchaseRequestId);
          await renderPage();
          return true;
        }catch(error){toast("Request failed",firebaseMessage(error));return false;}
      }
    });
  }

  async function renderFinance(target){
    const canViewAll=hasPermission("finance.view");
    const refs=await loadReferences();
    const expenses=canViewAll
      ? await safeCollection("expenses",100)
      : await getDocs(query(collection(db,"expenses"),where("requesterUid","==",state.user.uid),limit(100))).then(s=>s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>asMillis(b.createdAt)-asMillis(a.createdAt)));
    const invoices=canViewAll?await safeCollection("invoices",100):[];
    target.innerHTML=`
      <div class="page">
        ${pageHeader("Finance","Expense operations, invoice register, payment status, and financial oversight.",hasPermission("finance.expense.create")?'<button class="btn btn-primary" data-expense>New expense</button>':"")}
        <div class="kpi-grid">
          <div class="kpi-card"><div class="kpi-label">Expenses</div><div class="kpi-value">${expenses.length}</div><div class="kpi-meta">${canViewAll?"Visible organization records":"Your submissions"}</div></div>
          <div class="kpi-card"><div class="kpi-label">Expense total</div><div class="kpi-value kpi-small">${money(expenses.reduce((s,r)=>s+Number(r.amount||0),0))}</div><div class="kpi-meta">Visible gross amount</div></div>
          <div class="kpi-card"><div class="kpi-label">Invoices</div><div class="kpi-value">${invoices.length}</div><div class="kpi-meta">Accounts payable / receivable registry</div></div>
          <div class="kpi-card"><div class="kpi-label">Open invoice value</div><div class="kpi-value kpi-small">${money(invoices.filter(r=>!["Paid","Void"].includes(r.status)).reduce((s,r)=>s+Number(r.amount||0),0))}</div><div class="kpi-meta">Visible outstanding amount</div></div>
        </div>
        <div class="grid-2">
          <section class="card"><div class="card-head"><div><h2>Expenses</h2><p>Reimbursements and company spending</p></div></div>
          ${expenses.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Expense</th><th>Amount</th><th>Category</th><th>Status</th><th>Submitted</th></tr></thead><tbody>${expenses.map(r=>`<tr data-expense-record="${esc(r.id)}" style="${hasPermission("finance.manage") ? "cursor:pointer" : ""}"><td>${cell(r.description||"Expense",r.expenseId)}</td><td>${money(r.amount)}</td><td>${esc(r.category||"General")}</td><td>${statusBadge(r.status||"Submitted")}</td><td>${esc(fmtDate(r.createdAt))}</td></tr>`).join("")}</tbody></table></div>`:'<div class="empty"><strong>No expenses</strong><p>Expense submissions will appear here.</p></div>'}</section>
          <section class="card"><div class="card-head"><div><h2>Invoices</h2><p>Finance-controlled invoice register</p></div>${hasPermission("finance.manage")?'<button class="btn btn-sm" data-invoice>New invoice</button>':""}</div>
          ${invoices.length?`<div class="list">${invoices.slice(0,12).map(r=>`<div class="list-row"><div class="grow"><strong>${esc(r.invoiceId||r.description||"Invoice")}</strong><span>${esc(r.counterparty||"—")} · ${money(r.amount)}</span></div>${statusBadge(r.status||"Open")}</div>`).join("")}</div>`:'<div class="empty"><strong>No invoices</strong><p>Finance can create invoice records here.</p></div>'}</section>
        </div>
      </div>`;
    target.querySelector("[data-expense]")?.addEventListener("click",expenseModal);
    target.querySelector("[data-invoice]")?.addEventListener("click",invoiceModal);
    if (hasPermission("finance.manage")) {
      target.querySelectorAll("[data-expense-record]").forEach(row=>row.addEventListener("click",()=>{
        const record=expenses.find(r=>r.id===row.dataset.expenseRecord);
        if(record) manageExpense(record, refs);
      }));
    }
  }

  function manageExpense(record, refs={employees:[]}){
    openModal({
      title:`Review expense · ${record.expenseId||""}`,
      submitLabel:"Save decision",
      body:`
        <div class="notice" style="margin-bottom:16px"><div><strong>${esc(record.description||"Expense")}</strong>${money(record.amount)} · ${esc(employeeLabel(refs,record.requesterEmployeeId,"Employee"))}</div></div>
        <div class="form-grid">
          <div class="field"><label>Status</label><select class="select" name="status">${["Submitted","Under Review","Approved","Denied","Scheduled","Paid","Cancelled"].map(v=>`<option ${record.status===v?"selected":""}>${v}</option>`).join("")}</select></div>
          <div class="field"><label>Finance note</label><input class="input" name="financeNote" value="${esc(record.financeNote||"")}" /></div>
        </div>
      `,
      onSubmit:async fd=>{
        try{
          await updateDoc(doc(db,"expenses",record.id),{
            status:String(fd.get("status")||"Submitted"),
            financeNote:String(fd.get("financeNote")||"").trim(),
            reviewedByUid:state.user.uid,
            reviewedByEmployeeId:state.employee?.employeeId||null,
            reviewedAt:serverTimestamp(),
            updatedAt:serverTimestamp()
          });
          await audit("EXPENSE_REVIEWED","expense",record.id,{expenseId:record.expenseId||null});
          toast("Expense updated",record.expenseId||"");
          await renderPage();
          return true;
        }catch(error){toast("Expense update failed",firebaseMessage(error));return false;}
      }
    });
  }

  function expenseModal(){
    openModal({
      title:"Submit expense",
      submitLabel:"Submit expense",
      body:`<div class="form-grid">
        <div class="field span-2"><label>Description</label><input class="input" name="description" required /></div>
        <div class="field"><label>Amount</label><input class="input" type="number" min="0" step=".01" name="amount" required /></div>
        <div class="field"><label>Category</label><select class="select" name="category"><option>Travel</option><option>Meals</option><option>Equipment</option><option>Software</option><option>Supplies</option><option>Professional Services</option><option>Other</option></select></div>
        <div class="field"><label>Expense date</label><input class="input" type="date" name="expenseDate" /></div>
        <div class="field"><label>Cost center</label><input class="input" name="costCenter" /></div>
        <div class="field span-2"><label>Business purpose</label><textarea class="textarea" name="businessPurpose" required></textarea></div>
      </div>`,
      onSubmit:async fd=>{
        try{
          const expenseId=await nextId("expenses","EXP");
          const ref=doc(collection(db,"expenses"));
          await setDoc(ref,{
            expenseId,
            description:String(fd.get("description")||"").trim(),
            amount:Number(fd.get("amount")||0),
            category:String(fd.get("category")||"Other"),
            expenseDate:String(fd.get("expenseDate")||""),
            costCenter:String(fd.get("costCenter")||"").trim(),
            businessPurpose:String(fd.get("businessPurpose")||"").trim(),
            status:"Submitted",
            requesterUid:state.user.uid,
            requesterEmployeeId:state.employee?.employeeId||null,
            createdAt:serverTimestamp(),
            updatedAt:serverTimestamp()
          });
          await audit("EXPENSE_SUBMITTED","expense",ref.id,{expenseId});
          toast("Expense submitted",expenseId);
          await renderPage();
          return true;
        }catch(error){toast("Expense failed",firebaseMessage(error));return false;}
      }
    });
  }

  function invoiceModal(){
    openModal({
      title:"Create invoice record",
      submitLabel:"Create invoice",
      body:`<div class="form-grid">
        <div class="field"><label>Counterparty</label><input class="input" name="counterparty" required /></div>
        <div class="field"><label>Direction</label><select class="select" name="direction"><option>Payable</option><option>Receivable</option></select></div>
        <div class="field"><label>Amount</label><input class="input" type="number" min="0" step=".01" name="amount" required /></div>
        <div class="field"><label>Status</label><select class="select" name="status"><option>Open</option><option>Pending Approval</option><option>Scheduled</option><option>Paid</option><option>Void</option></select></div>
        <div class="field"><label>Due date</label><input class="input" type="date" name="dueDate" /></div>
        <div class="field"><label>Reference</label><input class="input" name="reference" /></div>
        <div class="field span-2"><label>Description</label><textarea class="textarea" name="description"></textarea></div>
      </div>`,
      onSubmit:async fd=>{
        try{
          const invoiceId=await nextId("invoices","INV");
          const ref=doc(collection(db,"invoices"));
          await setDoc(ref,{
            invoiceId,
            counterparty:String(fd.get("counterparty")||"").trim(),
            direction:String(fd.get("direction")||"Payable"),
            amount:Number(fd.get("amount")||0),
            status:String(fd.get("status")||"Open"),
            dueDate:String(fd.get("dueDate")||""),
            reference:String(fd.get("reference")||"").trim(),
            description:String(fd.get("description")||"").trim(),
            createdAt:serverTimestamp(),
            updatedAt:serverTimestamp(),
            createdBy:state.user.uid
          });
          await audit("INVOICE_CREATED","invoice",ref.id,{invoiceId});
          toast("Invoice created",invoiceId);
          await renderPage();
          return true;
        }catch(error){toast("Invoice failed",firebaseMessage(error));return false;}
      }
    });
  }

  async function renderCompliance(target){
    const [policies,findings,refs]=await Promise.all([
      safeCollection("policies",100),
      safeCollection("complianceFindings",100),
      loadReferences()
    ]);
    target.innerHTML=`
      <div class="page">
        ${pageHeader("Compliance","Policies, acknowledgements, findings, remediation, and governance tracking.",hasPermission("compliance.manage")?'<button class="btn btn-primary" data-policy>New policy</button><button class="btn" data-finding>New finding</button>':"")}
        <div class="kpi-grid">
          <div class="kpi-card"><div class="kpi-label">Policies</div><div class="kpi-value">${policies.length}</div><div class="kpi-meta">Controlled policy register</div></div>
          <div class="kpi-card"><div class="kpi-label">Open findings</div><div class="kpi-value">${findings.filter(f=>!["Closed","Remediated"].includes(f.status)).length}</div><div class="kpi-meta">Requires remediation</div></div>
          <div class="kpi-card"><div class="kpi-label">Critical findings</div><div class="kpi-value">${findings.filter(f=>f.severity==="Critical"&&!["Closed","Remediated"].includes(f.status)).length}</div><div class="kpi-meta">Executive attention</div></div>
          <div class="kpi-card"><div class="kpi-label">Governance</div><div class="kpi-value kpi-small">Active</div><div class="kpi-meta">Audit-ready records</div></div>
        </div>
        <div class="grid-2">
          <section class="card"><div class="card-head"><div><h2>Policies</h2><p>Corporate policy register</p></div></div>
            ${policies.length?`<div class="list">${policies.slice(0,15).map(p=>`<div class="list-row"><div class="grow"><strong>${esc(p.title||"Policy")}</strong><span>Owner: ${esc(employeeLabel(refs,p.ownerEmployeeId,"Unassigned"))}</span></div>${statusBadge(p.status||"Active")}</div>`).join("")}</div>`:'<div class="empty"><strong>No policies</strong><p>Create the first controlled policy record.</p></div>'}
          </section>
          <section class="card"><div class="card-head"><div><h2>Compliance findings</h2><p>Issues, owners, and remediation status</p></div></div>
            ${findings.length?`<div class="list">${findings.slice(0,15).map(f=>`<div class="list-row"><div class="grow"><strong>${esc(f.title||"Finding")}</strong><span>Owner: ${esc(employeeLabel(refs,f.ownerEmployeeId,"Unassigned"))}</span></div>${statusBadge(f.severity||"Moderate")}</div>`).join("")}</div>`:'<div class="empty"><strong>No findings</strong><p>Compliance findings and remediation items will appear here.</p></div>'}
          </section>
        </div>
      </div>`;
    target.querySelector("[data-policy]")?.addEventListener("click",policyModal);
    target.querySelector("[data-finding]")?.addEventListener("click",findingModal);
  }

  async function policyModal(){
    const refs = await loadReferences();
    openModal({
      title:"New policy",
      submitLabel:"Create policy",
      body:`<div class="form-grid">
        <div class="field span-2"><label>Policy title</label><input class="input" name="title" required /></div>
        <div class="field"><label>Category</label><input class="input" name="category" /></div>
        <div class="field"><label>Status</label><select class="select" name="status"><option>Draft</option><option>Active</option><option>Under Review</option><option>Retired</option></select></div>
        ${fieldHtml({name:"ownerEmployeeId",label:"Policy owner",type:"employee"}, "", refs)}
        <div class="field"><label>Review date</label><input class="input" type="date" name="reviewDate" /></div>
        <div class="field span-2"><label>Policy summary</label><textarea class="textarea" name="summary" required></textarea></div>
      </div>`,
      onSubmit:async fd=>{
        try{
          const policyId=await nextId("policies","POL");
          const ref=doc(collection(db,"policies"));
          await setDoc(ref,{
            policyId,
            title:String(fd.get("title")||"").trim(),
            category:String(fd.get("category")||"").trim(),
            status:String(fd.get("status")||"Draft"),
            ownerEmployeeId:String(fd.get("ownerEmployeeId")||"").trim().toUpperCase(),
            reviewDate:String(fd.get("reviewDate")||""),
            summary:String(fd.get("summary")||"").trim(),
            version:1,
            createdAt:serverTimestamp(),
            updatedAt:serverTimestamp(),
            createdBy:state.user.uid
          });
          await audit("POLICY_CREATED","policy",ref.id,{policyId});
          toast("Policy created",policyId);
          await renderPage();
          return true;
        }catch(error){toast("Policy failed",firebaseMessage(error));return false;}
      }
    });
  }

  async function findingModal(){
    const refs = await loadReferences();
    openModal({
      title:"New compliance finding",
      submitLabel:"Create finding",
      body:`<div class="form-grid">
        <div class="field span-2"><label>Finding title</label><input class="input" name="title" required /></div>
        <div class="field"><label>Severity</label><select class="select" name="severity"><option>Low</option><option>Moderate</option><option>High</option><option>Critical</option></select></div>
        <div class="field"><label>Status</label><select class="select" name="status"><option>Open</option><option>Remediation</option><option>Verification</option><option>Remediated</option><option>Closed</option></select></div>
        ${fieldHtml({name:"ownerEmployeeId",label:"Finding owner",type:"employee"}, "", refs)}
        <div class="field"><label>Due date</label><input class="input" type="date" name="dueDate" /></div>
        <div class="field span-2"><label>Finding details</label><textarea class="textarea" name="details" required></textarea></div>
        <div class="field span-2"><label>Remediation plan</label><textarea class="textarea" name="remediationPlan"></textarea></div>
      </div>`,
      onSubmit:fd=>createSimple("complianceFindings","complianceFindings","FND","COMPLIANCE_FINDING_CREATED",{
        title:String(fd.get("title")||"").trim(),
        severity:String(fd.get("severity")||"Moderate"),
        status:String(fd.get("status")||"Open"),
        ownerEmployeeId:String(fd.get("ownerEmployeeId")||"").trim().toUpperCase(),
        dueDate:String(fd.get("dueDate")||""),
        details:String(fd.get("details")||"").trim(),
        remediationPlan:String(fd.get("remediationPlan")||"").trim()
      })
    });
  }

  const renderers = {
    hr: renderHR,
    training: renderTraining,
    organization: renderOrganization,
    service: renderService,
    assets: target => renderRegistry(target,"assets"),
    procurement: renderProcurement,
    vendors: target => renderRegistry(target,"vendors"),
    contracts: target => renderRegistry(target,"contracts"),
    finance: renderFinance,
    projects: target => renderRegistry(target,"projects"),
    documents: target => renderRegistry(target,"documents"),
    communications: target => renderRegistry(target,"communications"),
    compliance: renderCompliance,
    risks: target => renderRegistry(target,"risks"),
    investigations: target => renderRegistry(target,"investigations"),
    workflows: target => renderRegistry(target,"workflows")
  };

  return { renderers };
}
