import {
  db,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch
} from "./firebase.js";
import {
  esc,
  fmtDate,
  fmtDateTime,
  statusBadge,
  classificationBadge,
  customerDisplayName
} from "./utils.js";

export const GENERATION3_PERMISSIONS = [
  "analytics.view",
  "analytics.executive",
  "dashboard.customize",
  "report.view",
  "report.manage",
  "workflow.run",
  "workflow.run.manage",
  "security.alerts.view",
  "security.alerts.manage",
  "access.request",
  "access.temporary.manage",
  "system.health.view",
  "bulk.manage",
  "audit.export",
  "notification.view"
];

export const GENERATION3_NAV = [
  { section: "Intelligence", id: "intelligence", label: "Insights", icon: "▥", permission: "analytics.view" },
  { section: "Intelligence", id: "reports", label: "Reports", icon: "▦", permission: "report.view" },
  { section: "Intelligence", id: "health", label: "System Health", icon: "◌", permission: "system.health.view" },

  { section: "Automation", id: "automation", label: "Automation", icon: "↻", permission: "workflow.run" },
  { section: "Automation", id: "bulk", label: "Bulk Center", icon: "▨", permission: "bulk.manage" },

  { section: "Security", id: "securityOps", label: "Security Ops", icon: "◉", anyPermission: ["security.alerts.view", "access.request", "access.temporary.manage"] }
];

const PROTECTED_TEMP_PERMISSIONS = new Set([
  "system.manage",
  "access.manage",
  "access.temporary.manage",
  "security.manage",
  "employee.manage",
  "organization.manage",
  "admin.organization.manage"
]);

const DEFAULT_WIDGETS = [
  "customers",
  "openCases",
  "service",
  "approvals",
  "finance",
  "projects",
  "risk",
  "compliance",
  "security"
];

const REPORT_DATASETS = {
  customers: {
    label: "Customers",
    permission: "customer.view",
    humanId: "customerId",
    searchable: ["customerId","displayName","email","phone","status","classification","assignedEmployeeId"]
  },
  cases: {
    label: "Cases",
    permission: "case.view",
    humanId: "caseId",
    searchable: ["caseId","title","status","priority","customerId","category","assignedEmployeeId"]
  },
  serviceTickets: {
    label: "Service Tickets",
    permission: "service.view",
    humanId: "ticketId",
    searchable: ["ticketId","title","catalog","priority","status","requesterEmployeeId","assignedEmployeeId"]
  },
  assets: {
    label: "Assets",
    permission: "asset.view",
    humanId: "assetId",
    searchable: ["assetId","name","assetType","status","assetTag","serialNumber","assignedEmployeeId"]
  },
  expenses: {
    label: "Expenses",
    permission: "finance.view",
    humanId: "expenseId",
    searchable: ["expenseId","description","category","status","requesterEmployeeId","costCenter"]
  },
  projects: {
    label: "Projects",
    permission: "project.view",
    humanId: "projectId",
    searchable: ["projectId","name","status","health","ownerEmployeeId","department"]
  },
  risks: {
    label: "Risks",
    permission: "risk.view",
    humanId: "riskId",
    searchable: ["riskId","title","category","status","likelihood","impact","ownerEmployeeId"]
  },
  vendors: {
    label: "Vendors",
    permission: "vendor.view",
    humanId: "vendorId",
    searchable: ["vendorId","name","category","status","riskLevel","contactName","email"]
  }
};

const BULK_DATASETS = {
  cases: { label:"Cases", permission:"case.assign", humanId:"caseId", statuses:["New","Open","In Progress","Pending Customer","Pending Internal","Escalated","Resolved","Closed"] },
  serviceTickets: { label:"Service Tickets", permission:"service.manage", humanId:"ticketId", statuses:["New","Assigned","In Progress","Pending Requester","Pending Internal","Resolved","Closed","Cancelled"] },
  assets: { label:"Assets", permission:"asset.manage", humanId:"assetId", statuses:["Available","Assigned","In Service","Repair","Lost","Retired"] },
  purchaseRequests: { label:"Purchase Requests", permission:"procurement.manage", humanId:"purchaseRequestId", statuses:["Submitted","Pending Approval","Approved","Denied","Sourcing","Ordered","Received","Closed","Cancelled"] },
  expenses: { label:"Expenses", permission:"finance.manage", humanId:"expenseId", statuses:["Submitted","Under Review","Approved","Denied","Scheduled","Paid","Cancelled"] },
  projects: { label:"Projects", permission:"project.manage", humanId:"projectId", statuses:["Planning","Active","On Hold","Complete","Cancelled"] },
  risks: { label:"Risks", permission:"risk.manage", humanId:"riskId", statuses:["Open","Monitoring","Mitigating","Accepted","Transferred","Closed"] }
};

function money(value) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function asDate(value) {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asMillis(value) {
  return asDate(value)?.getTime() || 0;
}

function isPast(value) {
  const date = asDate(value);
  return date ? date.getTime() < Date.now() : false;
}

function daysUntil(value) {
  const date = asDate(value);
  if (!date) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text;
}

function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const content = [
    keys.map(csvEscape).join(","),
    ...rows.map(row => keys.map(key => csvEscape(
      row[key]?.toDate ? row[key].toDate().toISOString() :
      Array.isArray(row[key]) ? row[key].join(" | ") :
      typeof row[key] === "object" && row[key] !== null ? JSON.stringify(row[key]) :
      row[key]
    )).join(","))
  ].join("\n");
  const blob = new Blob([content], { type:"text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function metricCard(label, value, meta = "") {
  return `<div class="kpi-card"><div class="kpi-label">${esc(label)}</div><div class="kpi-value ${String(value).length > 8 ? "kpi-small" : ""}">${esc(value)}</div><div class="kpi-meta">${esc(meta)}</div></div>`;
}

function findingRow(title, detail, tone = "info") {
  return `<div class="list-row"><div class="grow"><strong>${esc(title)}</strong><span>${esc(detail)}</span></div><span class="badge ${tone}">${tone === "danger" ? "Action" : tone === "warning" ? "Review" : "Info"}</span></div>`;
}

export function createGeneration3(ctx) {
  const {
    state,
    hasPermission,
    effectiveClearance,
    nextId,
    audit,
    safeCollection,
    pageHeader,
    renderPage,
    navigate,
    toast,
    openModal,
    firebaseMessage
  } = ctx;

  async function authorizedCustomers(count = 250) {
    if (!hasPermission("customer.view")) return [];
    try {
      const snap = state.profile?.isSystemOwner === true
        ? await getDocs(query(collection(db,"customers"),orderBy("createdAt","desc"),limit(count)))
        : await getDocs(query(
            collection(db,"customers"),
            where("minimumClearance","<=",effectiveClearance()),
            limit(count)
          ));
      return snap.docs
        .map(d=>({id:d.id,...d.data()}))
        .sort((a,b)=>asMillis(b.createdAt)-asMillis(a.createdAt));
    } catch(error) {
      if(error?.code==="permission-denied") return [];
      throw error;
    }
  }

  async function loadDashboardPreferences() {
    try {
      const snap=await getDoc(doc(db,"dashboardPreferences",state.user.uid));
      return snap.exists() ? snap.data() : { widgets:DEFAULT_WIDGETS };
    } catch {
      return { widgets:DEFAULT_WIDGETS };
    }
  }

  async function analyticsSnapshot() {
    const tasks = [];
    const add = (key, permitted, promise) => tasks.push(
      permitted ? promise.then(value=>[key,value]) : Promise.resolve([key,[]])
    );

    add("customers",hasPermission("customer.view"),authorizedCustomers(300));
    add("cases",hasPermission("case.view"),safeCollection("cases",300));
    add("service",hasPermission("service.view"),safeCollection("serviceTickets",300));
    add("approvals",hasPermission("approval.view"),safeCollection("approvals",250));
    add("expenses",hasPermission("finance.view"),safeCollection("expenses",300));
    add("invoices",hasPermission("finance.view"),safeCollection("invoices",300));
    add("projects",hasPermission("project.view"),safeCollection("projects",250));
    add("risks",hasPermission("risk.view"),safeCollection("risks",250));
    add("findings",hasPermission("compliance.view"),safeCollection("complianceFindings",250));
    add("alerts",hasPermission("security.alerts.view"),safeCollection("securityAlerts",250));
    add("employees",hasPermission("employee.view"),safeCollection("employees",300));
    add("contracts",hasPermission("contract.view"),classifiedCollection("contracts",250));
    add("assets",hasPermission("asset.view"),safeCollection("assets",300));
    const pairs=await Promise.all(tasks);
    return Object.fromEntries(pairs);
  }

  async function classifiedCollection(name,count=200) {
    if(state.profile?.isSystemOwner===true) return safeCollection(name,count);
    try {
      const snap=await getDocs(query(
        collection(db,name),
        where("minimumClearance","<=",effectiveClearance()),
        limit(count)
      ));
      return snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>asMillis(b.createdAt)-asMillis(a.createdAt));
    } catch(error) {
      if(error?.code==="permission-denied") return [];
      throw error;
    }
  }

  async function renderIntelligence(target) {
    const [data,prefs]=await Promise.all([analyticsSnapshot(),loadDashboardPreferences()]);
    const widgets=Array.isArray(prefs.widgets)&&prefs.widgets.length ? prefs.widgets : DEFAULT_WIDGETS;
    const openCases=data.cases.filter(r=>!["Resolved","Closed"].includes(r.status));
    const openService=data.service.filter(r=>!["Resolved","Closed","Cancelled"].includes(r.status));
    const pendingApprovals=data.approvals.filter(r=>["Submitted","Pending"].includes(r.status));
    const activeProjects=data.projects.filter(r=>r.status==="Active");
    const atRiskProjects=data.projects.filter(r=>["At Risk","Off Track"].includes(r.health));
    const openRisk=data.risks.filter(r=>r.status!=="Closed");
    const criticalRisk=data.risks.filter(r=>["Severe","Critical"].includes(r.impact)&&r.status!=="Closed");
    const openFindings=data.findings.filter(r=>!["Closed","Remediated"].includes(r.status));
    const openAlerts=data.alerts.filter(r=>!["Resolved","Closed"].includes(r.status));
    const outstandingInvoices=data.invoices.filter(r=>!["Paid","Void"].includes(r.status));
    const expenseTotal=data.expenses.reduce((sum,r)=>sum+Number(r.amount||0),0);
    const invoiceOutstanding=outstandingInvoices.reduce((sum,r)=>sum+Number(r.amount||0),0);

    const cards={
      customers:metricCard("Customers",data.customers.length,"Authorized customer population"),
      openCases:metricCard("Open Cases",openCases.length,"Customer and operational casework"),
      service:metricCard("Service Queue",openService.length,"Open internal service requests"),
      approvals:metricCard("Pending Approvals",pendingApprovals.length,"Awaiting authorized decisions"),
      finance:metricCard("Open Invoice Value",money(invoiceOutstanding),"Expense volume "+money(expenseTotal)),
      projects:metricCard("Projects At Risk",atRiskProjects.length,`${activeProjects.length} active projects`),
      risk:metricCard("Critical Risks",criticalRisk.length,`${openRisk.length} open risks`),
      compliance:metricCard("Open Findings",openFindings.length,"Compliance remediation queue"),
      security:metricCard("Security Alerts",openAlerts.length,"Unresolved security events")
    };

    const healthScore=Math.max(0,100-Math.min(45,
      criticalRisk.length*8+
      atRiskProjects.length*5+
      openAlerts.filter(a=>a.severity==="Critical").length*8+
      openFindings.filter(f=>f.severity==="Critical").length*6
    ));

    target.innerHTML=`
      <div class="page">
        ${pageHeader("Enterprise Intelligence","Cross-functional operational intelligence calculated from the records your account is authorized to see.",hasPermission("dashboard.customize")?'<button class="btn" data-customize>Customize dashboard</button>':"")}
        <div class="command-banner">
          <div>
            <div class="eyebrow">Enterprise health</div>
            <strong class="command-score">${healthScore}</strong>
            <span>/100</span>
          </div>
          <div class="command-banner-copy">
            <strong>${healthScore>=90?"Operations are stable":healthScore>=75?"Operations need attention":"Executive attention recommended"}</strong>
            <span>Calculated from critical risk, project health, compliance findings, and security alerts visible to you.</span>
          </div>
        </div>
        <div class="kpi-grid">${widgets.filter(w=>cards[w]).map(w=>cards[w]).join("")}</div>

        <div class="grid-2">
          <section class="card">
            <div class="card-head"><div><h2>Operational pressure</h2><p>Queues that may require management attention</p></div></div>
            <div class="list">
              ${findingRow("Open customer cases",`${openCases.length} records remain unresolved`,openCases.length>15?"warning":"info")}
              ${findingRow("Internal service queue",`${openService.length} requests remain open`,openService.filter(r=>r.priority==="Critical").length?"danger":"info")}
              ${findingRow("Pending approvals",`${pendingApprovals.length} decisions are waiting`,pendingApprovals.length>20?"warning":"info")}
              ${findingRow("At-risk projects",`${atRiskProjects.length} projects are At Risk or Off Track`,atRiskProjects.length?"warning":"info")}
            </div>
          </section>
          <section class="card">
            <div class="card-head"><div><h2>Governance signal</h2><p>Risk, compliance, and security posture</p></div></div>
            <div class="list">
              ${findingRow("Critical enterprise risks",`${criticalRisk.length} high-impact risks require attention`,criticalRisk.length?"danger":"info")}
              ${findingRow("Compliance remediation",`${openFindings.length} findings remain open`,openFindings.filter(f=>f.severity==="Critical").length?"danger":"info")}
              ${findingRow("Security alerts",`${openAlerts.length} security alerts remain unresolved`,openAlerts.filter(a=>a.severity==="Critical").length?"danger":"info")}
              ${findingRow("Outstanding invoices",`${money(invoiceOutstanding)} remains open`,invoiceOutstanding>0?"warning":"info")}
            </div>
          </section>
        </div>

        ${hasPermission("analytics.executive") ? `
          <section class="card" style="margin-top:14px">
            <div class="card-head"><div><h2>Executive population</h2><p>High-level enterprise scale</p></div></div>
            <div class="executive-strip">
              <div><span>Employees</span><strong>${data.employees.length}</strong></div>
              <div><span>Customers</span><strong>${data.customers.length}</strong></div>
              <div><span>Assets</span><strong>${data.assets.length}</strong></div>
              <div><span>Contracts</span><strong>${data.contracts.length}</strong></div>
              <div><span>Projects</span><strong>${data.projects.length}</strong></div>
            </div>
          </section>
        ` : ""}
      </div>
    `;
    target.querySelector("[data-customize]")?.addEventListener("click",()=>customizeDashboard(prefs));
  }

  function customizeDashboard(prefs) {
    const current=new Set(Array.isArray(prefs.widgets)?prefs.widgets:DEFAULT_WIDGETS);
    const options=[
      ["customers","Customers"],
      ["openCases","Open Cases"],
      ["service","Service Queue"],
      ["approvals","Pending Approvals"],
      ["finance","Finance"],
      ["projects","Projects"],
      ["risk","Risk"],
      ["compliance","Compliance"],
      ["security","Security"]
    ];
    openModal({
      title:"Customize intelligence dashboard",
      submitLabel:"Save dashboard",
      body:`<div class="checkbox-grid">${options.map(([id,label])=>`
        <label class="check-card"><input type="checkbox" name="widgets" value="${id}" ${current.has(id)?"checked":""}/><span><strong>${esc(label)}</strong><small>Show this metric on Enterprise Intelligence.</small></span></label>
      `).join("")}</div>`,
      onSubmit:async(fd)=>{
        try{
          const widgets=fd.getAll("widgets").map(String);
          await setDoc(doc(db,"dashboardPreferences",state.user.uid),{
            userId:state.user.uid,
            widgets:widgets.length?widgets:DEFAULT_WIDGETS,
            updatedAt:serverTimestamp()
          },{merge:true});
          toast("Dashboard saved","Your intelligence layout has been updated.");
          await renderPage();
          return true;
        }catch(error){toast("Dashboard not saved",firebaseMessage(error));return false;}
      }
    });
  }

  async function reportDataset(name) {
    const config=REPORT_DATASETS[name];
    if(!config||!hasPermission(config.permission)) return [];
    if(name==="customers") return authorizedCustomers(500);
    return safeCollection(name,500);
  }

  async function renderReports(target) {
    const reports=await safeCollection("savedReports",100);
    const available=Object.entries(REPORT_DATASETS).filter(([,cfg])=>hasPermission(cfg.permission));

    target.innerHTML=`
      <div class="page">
        ${pageHeader("Reports","Reusable reports run against authorized Firestore records without composite indexes.",hasPermission("report.manage")?'<button class="btn btn-primary" data-new-report>New report</button>':"")}
        <div class="notice" style="margin-bottom:14px"><div><strong>Index-free reporting</strong>Reports use a bounded authorized read and filter/sort the result in Citadel. They never create multi-field Firestore queries.</div></div>
        <section class="card">
          <div class="card-head"><div><h2>Saved reports</h2><p>${reports.length} report definition${reports.length===1?"":"s"}</p></div></div>
          ${reports.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Report</th><th>Dataset</th><th>Filter</th><th>Owner</th><th>Updated</th></tr></thead><tbody>
            ${reports.map(r=>`<tr data-report="${esc(r.id)}" style="cursor:pointer"><td><div class="primary-cell">${esc(r.name||"Report")}</div><div class="secondary">${esc(r.reportId||"—")}</div></td><td>${esc(REPORT_DATASETS[r.dataset]?.label||r.dataset||"—")}</td><td>${esc(r.filterText||"No filter")}</td><td>${esc(r.ownerEmployeeId||"—")}</td><td>${esc(fmtDate(r.updatedAt||r.createdAt))}</td></tr>`).join("")}
          </tbody></table></div>`:'<div class="empty"><strong>No saved reports</strong><p>Create a report definition for repeatable operational analysis and CSV export.</p></div>'}
        </section>
      </div>
    `;

    target.querySelector("[data-new-report]")?.addEventListener("click",()=>reportModal(null,available));
    target.querySelectorAll("[data-report]").forEach(row=>row.addEventListener("click",()=>{
      const report=reports.find(r=>r.id===row.dataset.report);
      if(report) openReport(report);
    }));
  }

  function reportModal(report,available) {
    const options=available.length?available:Object.entries(REPORT_DATASETS);
    openModal({
      title:report?"Edit report":"New report",
      submitLabel:report?"Save report":"Create report",
      body:`<div class="form-grid">
        <div class="field span-2"><label>Report name</label><input class="input" name="name" value="${esc(report?.name||"")}" required /></div>
        <div class="field"><label>Dataset</label><select class="select" name="dataset">${options.map(([key,cfg])=>`<option value="${key}" ${report?.dataset===key?"selected":""}>${esc(cfg.label)}</option>`).join("")}</select></div>
        <div class="field"><label>Text filter</label><input class="input" name="filterText" value="${esc(report?.filterText||"")}" placeholder="Optional contains filter" /></div>
        <div class="field span-2"><label>Description</label><textarea class="textarea" name="description">${esc(report?.description||"")}</textarea></div>
      </div>`,
      onSubmit:async fd=>{
        try{
          const data={
            name:String(fd.get("name")||"").trim(),
            dataset:String(fd.get("dataset")||"cases"),
            filterText:String(fd.get("filterText")||"").trim(),
            description:String(fd.get("description")||"").trim(),
            ownerUid:state.user.uid,
            ownerEmployeeId:state.employee?.employeeId||null,
            updatedAt:serverTimestamp()
          };
          if(report){
            await updateDoc(doc(db,"savedReports",report.id),data);
            await audit("REPORT_UPDATED","savedReport",report.id,{reportId:report.reportId||null});
            toast("Report updated",report.reportId||data.name);
          }else{
            const reportId=await nextId("savedReports","RPT");
            const ref=doc(collection(db,"savedReports"));
            await setDoc(ref,{...data,reportId,createdAt:serverTimestamp(),createdBy:state.user.uid});
            await audit("REPORT_CREATED","savedReport",ref.id,{reportId});
            toast("Report created",reportId);
          }
          await renderPage();
          return true;
        }catch(error){toast("Report not saved",firebaseMessage(error));return false;}
      }
    });
  }

  async function openReport(report) {
    const config=REPORT_DATASETS[report.dataset];
    if(!config||!hasPermission(config.permission)){
      toast("Access denied","You no longer have access to this report dataset.");
      return;
    }
    const records=await reportDataset(report.dataset);
    const term=String(report.filterText||"").trim().toLowerCase();
    const filtered=term?records.filter(r=>config.searchable.some(field=>String(r[field]||"").toLowerCase().includes(term))):records;
    openModal({
      title:report.name||"Report",
      submitLabel:"Close",
      width:"980px",
      body:`
        <div class="report-toolbar">
          <div><strong>${filtered.length}</strong><span> matching records</span></div>
          <button class="btn btn-sm" type="button" data-export-report>Export CSV</button>
          ${hasPermission("report.manage")?'<button class="btn btn-sm" type="button" data-edit-report>Edit definition</button>':""}
        </div>
        <div class="table-wrap"><table class="table"><thead><tr>${config.searchable.slice(0,6).map(f=>`<th>${esc(f)}</th>`).join("")}</tr></thead><tbody>
          ${filtered.slice(0,150).map(r=>`<tr>${config.searchable.slice(0,6).map(f=>`<td>${esc(Array.isArray(r[f])?r[f].join(", "):r[f]??"—")}</td>`).join("")}</tr>`).join("")}
        </tbody></table></div>
        ${filtered.length>150?'<div class="notice" style="margin-top:12px"><div><strong>Preview limited</strong>CSV export contains the complete authorized result set.</div></div>':""}
      `,
      onSubmit:async()=>true
    });
    document.querySelector("[data-export-report]")?.addEventListener("click",()=>{
      downloadCsv(`${(report.name||"citadel-report").replace(/[^a-z0-9]+/gi,"-").toLowerCase()}.csv`,filtered);
      audit("REPORT_EXPORTED","savedReport",report.id,{reportId:report.reportId||null}).catch(()=>{});
    });
    document.querySelector("[data-edit-report]")?.addEventListener("click",()=>{
      document.getElementById("modal-root").innerHTML="";
      const available=Object.entries(REPORT_DATASETS).filter(([,cfg])=>hasPermission(cfg.permission));
      reportModal(report,available);
    });
  }

  async function renderAutomation(target) {
    const [workflows,runs]=await Promise.all([
      safeCollection("workflows",100),
      safeCollection("workflowRuns",150)
    ]);
    const active=workflows.filter(w=>w.status==="Active");
    const openRuns=runs.filter(r=>!["Completed","Cancelled"].includes(r.status));

    target.innerHTML=`
      <div class="page">
        ${pageHeader("Automation","Launch and advance Firestore-backed workflow runs without requiring a separate application server.")}
        <div class="notice warning" style="margin-bottom:14px"><div><strong>Execution model</strong>GitHub Pages cannot run unattended background jobs. Citadel stores durable workflow state in Firestore; authorized users launch and advance runs when they work in the system.</div></div>
        <div class="kpi-grid">
          ${metricCard("Active Workflows",active.length,"Available definitions")}
          ${metricCard("Open Runs",openRuns.length,"In progress")}
          ${metricCard("Completed Runs",runs.filter(r=>r.status==="Completed").length,"Recent run history")}
          ${metricCard("Automation Mode","Interactive","Firestore durable state")}
        </div>
        <div class="grid-2">
          <section class="card">
            <div class="card-head"><div><h2>Workflow catalog</h2><p>Active definitions that can be launched</p></div></div>
            ${active.length?`<div class="list">${active.map(w=>`<div class="list-row"><div class="grow"><strong>${esc(w.name||"Workflow")}</strong><span>${esc(w.workflowId||"—")} · Trigger ${esc(w.trigger||"Manual")}</span></div><button class="btn btn-sm btn-primary" data-launch-workflow="${esc(w.id)}">Launch</button></div>`).join("")}</div>`:'<div class="empty"><strong>No active workflows</strong><p>Activate a workflow definition in the Workflows module first.</p></div>'}
          </section>
          <section class="card">
            <div class="card-head"><div><h2>Active runs</h2><p>Durable workflow execution state</p></div></div>
            ${openRuns.length?`<div class="list">${openRuns.slice(0,20).map(r=>`<div class="list-row"><div class="grow"><strong>${esc(r.workflowName||"Workflow run")}</strong><span>${esc(r.runId||"—")} · ${esc(r.status||"Running")}</span></div><button class="btn btn-sm" data-open-run="${esc(r.id)}">Open</button></div>`).join("")}</div>`:'<div class="empty"><strong>No active runs</strong><p>Launch a workflow to create the first run.</p></div>'}
          </section>
        </div>
      </div>
    `;

    target.querySelectorAll("[data-launch-workflow]").forEach(btn=>btn.addEventListener("click",()=>{
      const workflow=active.find(w=>w.id===btn.dataset.launchWorkflow);
      if(workflow) launchWorkflow(workflow);
    }));
    target.querySelectorAll("[data-open-run]").forEach(btn=>btn.addEventListener("click",()=>{
      const run=openRuns.find(r=>r.id===btn.dataset.openRun);
      if(run) openWorkflowRun(run);
    }));
  }

  async function launchWorkflow(workflow) {
    try{
      const runId=await nextId("workflowRuns","RUN");
      const runRef=doc(collection(db,"workflowRuns"));
      const rawSteps=String(workflow.stepsSummary||"").split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
      const steps=rawSteps.length?rawSteps:["Review workflow objective","Complete required action","Close workflow"];
      const batch=writeBatch(db);
      batch.set(runRef,{
        runId,
        workflowId:workflow.workflowId||workflow.id,
        workflowRecordId:workflow.id,
        workflowName:workflow.name||"Workflow",
        status:"Running",
        totalSteps:steps.length,
        completedSteps:0,
        startedByUid:state.user.uid,
        startedByEmployeeId:state.employee?.employeeId||null,
        startedAt:serverTimestamp(),
        createdAt:serverTimestamp(),
        updatedAt:serverTimestamp()
      });
      steps.forEach((title,index)=>{
        const taskRef=doc(collection(db,"workflowTasks"));
        batch.set(taskRef,{
          runRecordId:runRef.id,
          runId,
          sequence:index+1,
          title,
          status:index===0?"Ready":"Queued",
          assignedEmployeeId:null,
          createdAt:serverTimestamp(),
          updatedAt:serverTimestamp()
        });
      });
      await batch.commit();
      await audit("WORKFLOW_RUN_STARTED","workflowRun",runRef.id,{runId,workflowId:workflow.workflowId||null});
      toast("Workflow launched",runId);
      await renderPage();
    }catch(error){toast("Workflow not launched",firebaseMessage(error));}
  }

  async function openWorkflowRun(run) {
    let tasks=[];
    try{
      const snap=await getDocs(query(collection(db,"workflowTasks"),where("runRecordId","==",run.id),limit(100)));
      tasks=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>Number(a.sequence||0)-Number(b.sequence||0));
    }catch(error){toast("Tasks unavailable",firebaseMessage(error));return;}

    openModal({
      title:`${run.workflowName||"Workflow"} · ${run.runId||""}`,
      submitLabel:"Close",
      width:"820px",
      body:`
        <div class="progress-shell"><div class="progress-meta"><strong>${run.completedSteps||0} / ${run.totalSteps||tasks.length}</strong><span>steps complete</span></div><div class="progress-track"><div class="progress-fill" style="width:${Math.round(((run.completedSteps||0)/Math.max(1,run.totalSteps||tasks.length))*100)}%"></div></div></div>
        <div class="list">${tasks.map(t=>`<div class="list-row"><div class="grow"><strong>${esc(t.sequence+". "+t.title)}</strong><span>${esc(t.assignedEmployeeId||"Unassigned")} · ${esc(t.status||"Queued")}</span></div>${t.status!=="Completed"&&hasPermission("workflow.run.manage")?`<button class="btn btn-sm btn-primary" type="button" data-complete-task="${esc(t.id)}">Complete</button>`:statusBadge(t.status||"Queued")}</div>`).join("")}</div>
      `,
      onSubmit:async()=>true
    });

    document.querySelectorAll("[data-complete-task]").forEach(btn=>btn.addEventListener("click",async()=>{
      const task=tasks.find(t=>t.id===btn.dataset.completeTask);
      if(!task) return;
      try{
        await updateDoc(doc(db,"workflowTasks",task.id),{
          status:"Completed",
          completedByUid:state.user.uid,
          completedByEmployeeId:state.employee?.employeeId||null,
          completedAt:serverTimestamp(),
          updatedAt:serverTimestamp()
        });
        const nextCompleted=tasks.filter(t=>t.status==="Completed").length+1;
        const complete=nextCompleted>=tasks.length;
        await updateDoc(doc(db,"workflowRuns",run.id),{
          completedSteps:nextCompleted,
          status:complete?"Completed":"Running",
          ...(complete?{completedAt:serverTimestamp(),completedByEmployeeId:state.employee?.employeeId||null}:{}),
          updatedAt:serverTimestamp()
        });
        if(!complete){
          const next=tasks.find(t=>t.status!=="Completed"&&t.id!==task.id);
          if(next) await updateDoc(doc(db,"workflowTasks",next.id),{status:"Ready",updatedAt:serverTimestamp()});
        }
        await audit("WORKFLOW_TASK_COMPLETED","workflowTask",task.id,{runId:run.runId||null});
        document.getElementById("modal-root").innerHTML="";
        toast(complete?"Workflow completed":"Task completed",run.runId||"");
        await renderPage();
      }catch(error){toast("Task not completed",firebaseMessage(error));}
    }));
  }

  async function renderSecurityOps(target) {
    const canAlerts=hasPermission("security.alerts.view");
    const canManageAccess=hasPermission("access.temporary.manage");
    const [alerts,requests,grants]=await Promise.all([
      canAlerts?safeCollection("securityAlerts",150):Promise.resolve([]),
      canManageAccess?safeCollection("accessRequests",150):loadOwnAccessRequests(),
      canManageAccess?safeCollection("temporaryAccess",150):loadOwnTemporaryGrant()
    ]);
    const openAlerts=alerts.filter(a=>!["Resolved","Closed"].includes(a.status));
    const pendingRequests=requests.filter(r=>r.status==="Pending");

    target.innerHTML=`
      <div class="page">
        ${pageHeader("Security Operations","Security alerts, temporary authorization, and access escalation.",hasPermission("access.request")?'<button class="btn btn-primary" data-access-request>Request temporary access</button>':"")}
        <div class="kpi-grid">
          ${metricCard("Open Alerts",openAlerts.length,"Security events awaiting resolution")}
          ${metricCard("Pending Access",pendingRequests.length,canManageAccess?"Organization queue":"Your requests")}
          ${metricCard("Temporary Grants",grants.filter(g=>g.active!==false&&!isPast(g.expiresAt)).length,"Currently active")}
          ${metricCard("Effective Clearance","C"+effectiveClearance(),"Includes active temporary grant")}
        </div>
        <div class="grid-2">
          <section class="card">
            <div class="card-head"><div><h2>Access requests</h2><p>Time-limited permission and clearance requests</p></div></div>
            ${requests.length?`<div class="list">${requests.slice(0,25).map(r=>`<div class="list-row"><div class="grow"><strong>${esc(r.requesterEmployeeId||"Employee")}</strong><span>${esc((r.requestedPermissions||[]).join(", ")||"No permissions")} · C${Number(r.requestedClearance||0)} · ${esc(r.status||"Pending")}</span></div>${canManageAccess&&r.status==="Pending"?`<button class="btn btn-sm btn-primary" data-review-access="${esc(r.id)}">Review</button>`:statusBadge(r.status||"Pending")}</div>`).join("")}</div>`:'<div class="empty"><strong>No access requests</strong><p>Temporary authorization requests will appear here.</p></div>'}
          </section>
          <section class="card">
            <div class="card-head"><div><h2>Security alerts</h2><p>Operational security register</p></div>${hasPermission("security.alerts.manage")?'<button class="btn btn-sm" data-new-alert>New alert</button>':""}</div>
            ${alerts.length?`<div class="list">${alerts.slice(0,25).map(a=>`<div class="list-row" data-security-alert="${esc(a.id)}" style="${hasPermission("security.alerts.manage")?"cursor:pointer":""}"><div class="grow"><strong>${esc(a.title||"Security alert")}</strong><span>${esc(a.alertId||"—")} · ${esc(a.details||"")}</span></div>${statusBadge(a.severity||"Moderate")}</div>`).join("")}</div>`:'<div class="empty"><strong>No security alerts</strong><p>Security alerts and operational concerns will appear here.</p></div>'}
          </section>
        </div>
        ${canManageAccess?`
          <section class="card" style="margin-top:14px">
            <div class="card-head"><div><h2>Temporary grants</h2><p>Active and recently issued time-limited authorization</p></div></div>
            ${grants.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Employee</th><th>Permissions</th><th>Clearance</th><th>Expires</th><th>Status</th></tr></thead><tbody>
              ${grants.map(g=>`<tr data-grant="${esc(g.id)}" style="cursor:pointer"><td class="primary-cell">${esc(g.employeeId||g.userId||g.id)}</td><td>${esc((g.permissions||[]).join(", ")||"—")}</td><td>C${Number(g.clearanceLevel||0)}</td><td>${esc(fmtDateTime(g.expiresAt))}</td><td>${statusBadge(g.active!==false&&!isPast(g.expiresAt)?"Active":"Expired / Revoked")}</td></tr>`).join("")}
            </tbody></table></div>`:'<div class="empty"><strong>No temporary grants</strong><p>Approved access grants will appear here.</p></div>'}
          </section>
        `:""}
      </div>
    `;

    target.querySelector("[data-access-request]")?.addEventListener("click",accessRequestModal);
    target.querySelector("[data-new-alert]")?.addEventListener("click",securityAlertModal);
    if(hasPermission("security.alerts.manage")){
      target.querySelectorAll("[data-security-alert]").forEach(row=>row.addEventListener("click",()=>{
        const alert=alerts.find(a=>a.id===row.dataset.securityAlert);
        if(alert) manageSecurityAlert(alert);
      }));
    }
    target.querySelectorAll("[data-review-access]").forEach(btn=>btn.addEventListener("click",()=>{
      const request=requests.find(r=>r.id===btn.dataset.reviewAccess);
      if(request) reviewAccessRequest(request);
    }));
    target.querySelectorAll("[data-grant]").forEach(row=>row.addEventListener("click",()=>{
      const grant=grants.find(g=>g.id===row.dataset.grant);
      if(grant) manageGrant(grant);
    }));
  }

  async function loadOwnAccessRequests() {
    try{
      const snap=await getDocs(query(collection(db,"accessRequests"),where("requesterUid","==",state.user.uid),limit(50)));
      return snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>asMillis(b.createdAt)-asMillis(a.createdAt));
    }catch{return [];}
  }

  async function loadOwnTemporaryGrant() {
    try{
      const snap=await getDoc(doc(db,"temporaryAccess",state.user.uid));
      return snap.exists()?[{id:snap.id,...snap.data()}]:[];
    }catch{return [];}
  }

  function accessRequestModal() {
    openModal({
      title:"Request temporary access",
      submitLabel:"Submit request",
      body:`
        <div class="notice warning" style="margin-bottom:16px"><div><strong>Temporary authority</strong>Requested permissions do not bypass clearance or auditing unless an authorized C8+ security administrator explicitly grants temporary clearance.</div></div>
        <div class="form-grid">
          <div class="field span-2"><label>Requested permissions</label><textarea class="textarea" name="permissions" placeholder="One permission per line" required></textarea></div>
          <div class="field"><label>Requested clearance</label><select class="select" name="clearance">${Array.from({length:10},(_,i)=>`<option value="${i}" ${i===Math.min(9,effectiveClearance())?"selected":""}>C${i}</option>`).join("")}</select></div>
          <div class="field"><label>Requested duration</label><select class="select" name="hours"><option value="1">1 hour</option><option value="4">4 hours</option><option value="8">8 hours</option><option value="24">24 hours</option></select></div>
          <div class="field span-2"><label>Business / emergency reason</label><textarea class="textarea" name="reason" required></textarea></div>
          <div class="field span-2"><label>Reference / case number</label><input class="input" name="reference" /></div>
        </div>
      `,
      onSubmit:async fd=>{
        try{
          const requestId=await nextId("accessRequests","ACR");
          const ref=doc(collection(db,"accessRequests"));
          const permissions=[...new Set(String(fd.get("permissions")||"").split(/\r?\n/).map(v=>v.trim()).filter(Boolean))];
          await setDoc(ref,{
            requestId,
            requesterUid:state.user.uid,
            requesterEmployeeId:state.employee?.employeeId||null,
            requestedPermissions:permissions,
            requestedClearance:Number(fd.get("clearance")||effectiveClearance()),
            requestedHours:Number(fd.get("hours")||1),
            reason:String(fd.get("reason")||"").trim(),
            reference:String(fd.get("reference")||"").trim(),
            status:"Pending",
            createdAt:serverTimestamp(),
            updatedAt:serverTimestamp()
          });
          await audit("TEMP_ACCESS_REQUESTED","accessRequest",ref.id,{requestId});
          toast("Access request submitted",requestId);
          await renderPage();
          return true;
        }catch(error){toast("Request failed",firebaseMessage(error));return false;}
      }
    });
  }

  function reviewAccessRequest(request) {
    const requestedHours=Math.max(1,Math.min(24,Number(request.requestedHours||1)));
    openModal({
      title:`Review access · ${request.requestId||""}`,
      submitLabel:"Save decision",
      body:`
        <div class="notice warning" style="margin-bottom:16px"><div><strong>C8+ authorization required</strong>Temporary grants are enforced by Firestore Rules and automatically stop applying after expiration.</div></div>
        <div class="security-grid" style="margin-bottom:16px">
          <div class="security-box"><span>Employee</span><strong>${esc(request.requesterEmployeeId||"—")}</strong></div>
          <div class="security-box"><span>Requested clearance</span><strong>C${Number(request.requestedClearance||0)}</strong></div>
          <div class="security-box"><span>Duration</span><strong>${requestedHours}h</strong></div>
        </div>
        <div class="field"><label>Permissions</label><textarea class="textarea" name="permissions">${esc((request.requestedPermissions||[]).join("\n"))}</textarea></div>
        <div class="field"><label>Decision</label><select class="select" name="decision"><option>Approved</option><option>Denied</option></select></div>
        <div class="field"><label>Approved clearance</label><select class="select" name="clearance">${Array.from({length:10},(_,i)=>`<option value="${i}" ${i===Math.min(9,Number(request.requestedClearance||0))?"selected":""}>C${i}</option>`).join("")}</select></div>
        <div class="field span-2"><label>Decision note</label><textarea class="textarea" name="approvalNote"></textarea></div>
      `,
      onSubmit:async fd=>{
        try{
          const decision=String(fd.get("decision")||"Approved");
          if(decision==="Denied"){
            await updateDoc(doc(db,"accessRequests",request.id),{
              status:"Denied",
              approvalNote:String(fd.get("approvalNote")||"").trim(),
              decidedByUid:state.user.uid,
              decidedByEmployeeId:state.employee?.employeeId||null,
              decidedAt:serverTimestamp(),
              updatedAt:serverTimestamp()
            });
            await audit("TEMP_ACCESS_DENIED","accessRequest",request.id,{requestId:request.requestId||null,targetEmployeeId:request.requesterEmployeeId||null});
            toast("Access request denied",request.requestId||"");
            await renderPage();
            return true;
          }

          const permissions=[...new Set(String(fd.get("permissions")||"").split(/\r?\n/).map(v=>v.trim()).filter(Boolean))];
          const protectedRequested=permissions.filter(p=>PROTECTED_TEMP_PERMISSIONS.has(p));
          if(protectedRequested.length){
            toast("Permanent authority required","These permissions cannot be granted temporarily: "+protectedRequested.join(", "));
            return false;
          }
          const clearance=Math.min(9,Number(fd.get("clearance")||0));
          const expiresAt=new Date(Date.now()+requestedHours*3600000);
          await setDoc(doc(db,"temporaryAccess",request.requesterUid),{
            userId:request.requesterUid,
            employeeId:request.requesterEmployeeId||null,
            permissions,
            clearanceLevel:clearance,
            active:true,
            sourceRequestId:request.requestId||request.id,
            reason:request.reason||"",
            reference:request.reference||"",
            grantedByUid:state.user.uid,
            grantedByEmployeeId:state.employee?.employeeId||null,
            grantedAt:serverTimestamp(),
            createdAt:serverTimestamp(),
            expiresAt,
            updatedAt:serverTimestamp()
          });
          await updateDoc(doc(db,"accessRequests",request.id),{
            status:"Approved",
            approvedPermissions:permissions,
            approvedClearance:clearance,
            approvedHours:requestedHours,
            approvalNote:String(fd.get("approvalNote")||"").trim(),
            decidedByUid:state.user.uid,
            decidedByEmployeeId:state.employee?.employeeId||null,
            decidedAt:serverTimestamp(),
            updatedAt:serverTimestamp()
          });
          await audit("TEMP_ACCESS_GRANTED","accessRequest",request.id,{requestId:request.requestId||null,targetEmployeeId:request.requesterEmployeeId||null});
          toast("Temporary access granted",`Expires in ${requestedHours} hour${requestedHours===1?"":"s"}.`);
          await renderPage();
          return true;
        }catch(error){toast("Grant failed",firebaseMessage(error));return false;}
      }
    });
  }

  function manageGrant(grant) {
    openModal({
      title:`Temporary grant · ${grant.employeeId||grant.userId||""}`,
      submitLabel:"Revoke grant",
      body:`
        <div class="security-grid">
          <div class="security-box"><span>Clearance</span><strong>C${Number(grant.clearanceLevel||0)}</strong></div>
          <div class="security-box"><span>Expires</span><strong>${esc(fmtDateTime(grant.expiresAt))}</strong></div>
          <div class="security-box"><span>Status</span><strong>${grant.active!==false&&!isPast(grant.expiresAt)?"Active":"Expired / Revoked"}</strong></div>
        </div>
        <div class="notice" style="margin-top:16px"><div><strong>Permissions</strong>${esc((grant.permissions||[]).join(", ")||"None")}</div></div>
      `,
      onSubmit:async()=>{
        try{
          await updateDoc(doc(db,"temporaryAccess",grant.id),{active:false,revokedByUid:state.user.uid,revokedAt:serverTimestamp(),updatedAt:serverTimestamp()});
          await audit("TEMP_ACCESS_REVOKED","temporaryAccess",grant.id,{targetEmployeeId:grant.employeeId||null});
          toast("Temporary access revoked",grant.employeeId||grant.id);
          await renderPage();
          return true;
        }catch(error){toast("Revocation failed",firebaseMessage(error));return false;}
      }
    });
  }

  function manageSecurityAlert(alert) {
    openModal({
      title:`${alert.alertId||"Security alert"} · ${alert.title||""}`,
      submitLabel:"Save alert",
      body:`
        <div class="form-grid">
          <div class="field"><label>Severity</label><select class="select" name="severity">${["Low","Moderate","High","Critical"].map(v=>`<option ${alert.severity===v?"selected":""}>${v}</option>`).join("")}</select></div>
          <div class="field"><label>Status</label><select class="select" name="status">${["Open","Investigating","Monitoring","Resolved","Closed"].map(v=>`<option ${alert.status===v?"selected":""}>${v}</option>`).join("")}</select></div>
          <div class="field span-2"><label>Details</label><textarea class="textarea" name="details">${esc(alert.details||"")}</textarea></div>
          <div class="field span-2"><label>Resolution / response</label><textarea class="textarea" name="resolution">${esc(alert.resolution||"")}</textarea></div>
        </div>
      `,
      onSubmit:async fd=>{
        try{
          await updateDoc(doc(db,"securityAlerts",alert.id),{
            severity:String(fd.get("severity")||"Moderate"),
            status:String(fd.get("status")||"Open"),
            details:String(fd.get("details")||"").trim(),
            resolution:String(fd.get("resolution")||"").trim(),
            updatedByUid:state.user.uid,
            updatedByEmployeeId:state.employee?.employeeId||null,
            updatedAt:serverTimestamp()
          });
          await audit("SECURITY_ALERT_UPDATED","securityAlert",alert.id,{alertId:alert.alertId||null});
          toast("Security alert updated",alert.alertId||"");
          await renderPage();
          return true;
        }catch(error){toast("Alert update failed",firebaseMessage(error));return false;}
      }
    });
  }

  function securityAlertModal() {
    openModal({
      title:"Create security alert",
      submitLabel:"Create alert",
      body:`<div class="form-grid">
        <div class="field span-2"><label>Alert title</label><input class="input" name="title" required /></div>
        <div class="field"><label>Severity</label><select class="select" name="severity"><option>Low</option><option>Moderate</option><option>High</option><option>Critical</option></select></div>
        <div class="field"><label>Category</label><select class="select" name="category"><option>Access</option><option>Authentication</option><option>Data</option><option>Policy</option><option>Investigation</option><option>System</option><option>Other</option></select></div>
        <div class="field"><label>Related entity ID</label><input class="input" name="relatedId" /></div>
        <div class="field"><label>Status</label><select class="select" name="status"><option>Open</option><option>Investigating</option><option>Monitoring</option><option>Resolved</option></select></div>
        <div class="field span-2"><label>Details</label><textarea class="textarea" name="details" required></textarea></div>
      </div>`,
      onSubmit:async fd=>{
        try{
          const alertId=await nextId("securityAlerts","SEC");
          const ref=doc(collection(db,"securityAlerts"));
          await setDoc(ref,{
            alertId,
            title:String(fd.get("title")||"").trim(),
            severity:String(fd.get("severity")||"Moderate"),
            category:String(fd.get("category")||"Other"),
            relatedId:String(fd.get("relatedId")||"").trim(),
            status:String(fd.get("status")||"Open"),
            details:String(fd.get("details")||"").trim(),
            createdByUid:state.user.uid,
            createdByEmployeeId:state.employee?.employeeId||null,
            createdAt:serverTimestamp(),
            updatedAt:serverTimestamp()
          });
          await audit("SECURITY_ALERT_CREATED","securityAlert",ref.id,{alertId});
          toast("Security alert created",alertId);
          await renderPage();
          return true;
        }catch(error){toast("Alert not created",firebaseMessage(error));return false;}
      }
    });
  }

  async function renderHealth(target) {
    const data=await analyticsSnapshot();
    const now=Date.now();
    const findings=[];

    const breachedCases=data.cases.filter(r=>r.slaDueAt&&isPast(r.slaDueAt)&&!["Resolved","Closed"].includes(r.status));
    if(breachedCases.length) findings.push({title:"Case SLA breaches",detail:`${breachedCases.length} open cases are beyond their SLA target.`,tone:"danger"});

    const staleCases=data.cases.filter(r=>!["Resolved","Closed"].includes(r.status)&&now-asMillis(r.updatedAt||r.createdAt)>7*86400000);
    if(staleCases.length) findings.push({title:"Stale open cases",detail:`${staleCases.length} cases have not changed in more than 7 days.`,tone:"warning"});

    const breachedService=data.service.filter(r=>r.slaDueAt&&isPast(r.slaDueAt)&&!["Resolved","Closed","Cancelled"].includes(r.status));
    if(breachedService.length) findings.push({title:"Service SLA breaches",detail:`${breachedService.length} service tickets are beyond their SLA target.`,tone:"danger"});

    const criticalTickets=data.service.filter(r=>r.priority==="Critical"&&!["Resolved","Closed"].includes(r.status));
    if(criticalTickets.length) findings.push({title:"Critical service tickets",detail:`${criticalTickets.length} critical service tickets remain open.`,tone:"danger"});

    const unassignedService=data.service.filter(r=>!r.assignedEmployeeId&&!["Resolved","Closed","Cancelled"].includes(r.status));
    if(unassignedService.length) findings.push({title:"Unassigned service work",detail:`${unassignedService.length} service tickets have no assignee.`,tone:"warning"});

    const expiringContracts=data.contracts.filter(r=>{
      const d=daysUntil(r.renewalDate); return d!==null&&d>=0&&d<=30&&r.status!=="Terminated";
    });
    if(expiringContracts.length) findings.push({title:"Contracts nearing renewal",detail:`${expiringContracts.length} contracts renew or expire within 30 days.`,tone:"warning"});

    const overdueContracts=data.contracts.filter(r=>daysUntil(r.renewalDate)!==null&&daysUntil(r.renewalDate)<0&&!["Expired","Terminated"].includes(r.status));
    if(overdueContracts.length) findings.push({title:"Contract dates overdue",detail:`${overdueContracts.length} contract records are beyond renewal/end date without closure.`,tone:"danger"});

    const criticalRisks=data.risks.filter(r=>["Severe","Critical"].includes(r.impact)&&r.status!=="Closed");
    if(criticalRisks.length) findings.push({title:"High-impact enterprise risk",detail:`${criticalRisks.length} severe or critical risks remain open.`,tone:"danger"});

    const overdueFindings=data.findings.filter(r=>r.dueDate&&isPast(r.dueDate)&&!["Closed","Remediated"].includes(r.status));
    if(overdueFindings.length) findings.push({title:"Overdue compliance remediation",detail:`${overdueFindings.length} findings are beyond their remediation due date.`,tone:"danger"});

    const atRiskProjects=data.projects.filter(r=>["At Risk","Off Track"].includes(r.health)&&r.status==="Active");
    if(atRiskProjects.length) findings.push({title:"Project delivery risk",detail:`${atRiskProjects.length} active projects are At Risk or Off Track.`,tone:"warning"});

    const lostAssets=data.assets.filter(r=>r.status==="Lost");
    if(lostAssets.length) findings.push({title:"Lost assets",detail:`${lostAssets.length} assets are currently marked lost.`,tone:"danger"});

    if(!findings.length) findings.push({title:"No critical integrity findings",detail:"Current authorized operational scan did not identify a configured exception.",tone:"info"});

    const score=Math.max(0,100-findings.reduce((sum,f)=>sum+(f.tone==="danger"?10:f.tone==="warning"?5:0),0));

    target.innerHTML=`
      <div class="page">
        ${pageHeader("System Health","Live operational and data-quality checks calculated from authorized Citadel records.")}
        <div class="command-banner">
          <div><div class="eyebrow">Health score</div><strong class="command-score">${score}</strong><span>/100</span></div>
          <div class="command-banner-copy"><strong>${score>=90?"Healthy":score>=75?"Attention recommended":"Intervention recommended"}</strong><span>This scan runs when the page is opened; no background server is required.</span></div>
        </div>
        <div class="grid-2">
          <section class="card">
            <div class="card-head"><div><h2>Needs Attention</h2><p>Operational exceptions and data-quality signals</p></div></div>
            <div class="list">${findings.map(f=>findingRow(f.title,f.detail,f.tone)).join("")}</div>
          </section>
          <section class="card">
            <div class="card-head"><div><h2>Architecture status</h2><p>Citadel runtime constraints and controls</p></div></div>
            <div class="list">
              ${findingRow("Authentication","Firebase Authentication connected","info")}
              ${findingRow("Authorization","Firestore Rules + Citadel access profiles","info")}
              ${findingRow("Hosting","GitHub Pages static deployment","info")}
              ${findingRow("Composite indexes","Not used by Citadel","info")}
              ${findingRow("Background jobs","Not configured; automation is interactive","info")}
            </div>
          </section>
        </div>
      </div>
    `;
  }

  async function renderBulk(target) {
    const available=Object.entries(BULK_DATASETS).filter(([,cfg])=>hasPermission(cfg.permission));
    target.innerHTML=`
      <div class="page">
        ${pageHeader("Bulk Center","Perform controlled high-volume status updates while preserving each module's Firestore security rules.")}
        <div class="notice warning" style="margin-bottom:14px"><div><strong>Security remains authoritative</strong>Bulk Center does not bypass module permissions. Every write in the batch must independently pass Firestore Rules.</div></div>
        ${available.length?`
          <section class="card">
            <div class="card-head"><div><h2>Bulk status update</h2><p>Match by Citadel human-facing IDs</p></div></div>
            <div class="card-body">
              <form id="bulk-form">
                <div class="form-grid">
                  <div class="field"><label>Dataset</label><select class="select" name="dataset">${available.map(([key,cfg])=>`<option value="${key}">${esc(cfg.label)}</option>`).join("")}</select></div>
                  <div class="field"><label>New status</label><select class="select" name="status" data-bulk-status></select></div>
                  <div class="field span-2"><label>Record IDs</label><textarea class="textarea" name="ids" style="min-height:180px" placeholder="One ID per line, e.g. CASE-000001" required></textarea></div>
                  <div class="field span-2"><label>Bulk action reason</label><input class="input" name="reason" required /></div>
                </div>
                <button class="btn btn-primary" type="submit">Apply bulk update</button>
              </form>
            </div>
          </section>
        `:'<div class="empty"><strong>No bulk permissions</strong><p>Your account does not have a module permission that is eligible for Bulk Center.</p></div>'}
      </div>
    `;
    const form=target.querySelector("#bulk-form");
    if(!form) return;
    const dataset=form.querySelector('[name="dataset"]');
    const status=form.querySelector('[name="status"]');
    const populate=()=>{
      const cfg=BULK_DATASETS[dataset.value];
      status.innerHTML=cfg.statuses.map(v=>`<option>${esc(v)}</option>`).join("");
    };
    dataset.addEventListener("change",populate);
    populate();
    form.addEventListener("submit",async event=>{
      event.preventDefault();
      const fd=new FormData(form);
      const key=String(fd.get("dataset"));
      const cfg=BULK_DATASETS[key];
      const ids=[...new Set(String(fd.get("ids")||"").split(/\r?\n|,/).map(v=>v.trim().toUpperCase()).filter(Boolean))];
      if(!ids.length) return toast("No IDs","Enter at least one Citadel record ID.");
      const button=form.querySelector('button[type="submit"]');
      button.disabled=true;
      try{
        const records=await safeCollection(key,500);
        const matched=records.filter(r=>ids.includes(String(r[cfg.humanId]||"").toUpperCase()));
        if(!matched.length){toast("No records matched","No authorized records matched those IDs.");return;}
        const batch=writeBatch(db);
        matched.forEach(record=>batch.update(doc(db,key,record.id),{
          status:String(fd.get("status")||""),
          bulkUpdateReason:String(fd.get("reason")||"").trim(),
          bulkUpdatedByUid:state.user.uid,
          bulkUpdatedByEmployeeId:state.employee?.employeeId||null,
          updatedAt:serverTimestamp()
        }));
        await batch.commit();
        await audit("BULK_STATUS_UPDATED","bulk",key,{recordCount:matched.length,targetStatus:String(fd.get("status")||"")});
        toast("Bulk update complete",`${matched.length} record${matched.length===1?"":"s"} updated.`);
        form.reset();populate();
      }catch(error){toast("Bulk update failed",firebaseMessage(error));}
      finally{button.disabled=false;}
    });
  }

  async function renderNotifications(target) {
    let notifications=[];
    try{
      const snap=await getDocs(query(collection(db,"notifications"),where("recipientUid","==",state.user.uid),limit(100)));
      notifications=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>asMillis(b.createdAt)-asMillis(a.createdAt));
    }catch(error){
      if(error?.code!=="permission-denied") throw error;
    }
    const unread=notifications.filter(n=>n.read!==true);
    target.innerHTML=`
      <div class="page">
        ${pageHeader("Notifications","Your Citadel alerts, assignments, approvals, and system messages.",unread.length?'<button class="btn" data-mark-all>Mark all read</button>':"")}
        <section class="card">
          <div class="card-head"><div><h2>Notification center</h2><p>${unread.length} unread · ${notifications.length} loaded</p></div></div>
          ${notifications.length?`<div class="list">${notifications.map(n=>`<div class="list-row ${n.read===true?"":"unread-row"}" data-notification="${esc(n.id)}" style="cursor:pointer"><div class="grow"><strong>${esc(n.title||"Notification")}</strong><span>${esc(n.message||"")} · ${esc(fmtDateTime(n.createdAt))}</span></div>${statusBadge(n.priority||"Normal")}</div>`).join("")}</div>`:'<div class="empty"><strong>No notifications</strong><p>Your Citadel notifications will appear here.</p></div>'}
        </section>
      </div>
    `;
    target.querySelectorAll("[data-notification]").forEach(row=>row.addEventListener("click",async()=>{
      try{
        await updateDoc(doc(db,"notifications",row.dataset.notification),{read:true,readAt:serverTimestamp()});
        row.classList.remove("unread-row");
      }catch(error){toast("Could not update notification",firebaseMessage(error));}
    }));
    target.querySelector("[data-mark-all]")?.addEventListener("click",async()=>{
      try{
        const batch=writeBatch(db);
        unread.forEach(n=>batch.update(doc(db,"notifications",n.id),{read:true,readAt:serverTimestamp()}));
        await batch.commit();
        toast("Notifications updated","All loaded notifications marked read.");
        await renderPage();
      }catch(error){toast("Update failed",firebaseMessage(error));}
    });
  }

  async function exportAudit() {
    if(!hasPermission("audit.export")) return toast("Access denied","Audit export permission is required.");
    const rows=await safeCollection("auditEvents",500);
    if(!rows.length) return toast("Nothing to export","No audit events are visible.");
    downloadCsv(`citadel-audit-${new Date().toISOString().slice(0,10)}.csv`,rows);
    await audit("AUDIT_EXPORTED","audit","export",{recordCount:rows.length});
    toast("Audit exported",`${rows.length} events exported to CSV.`);
  }

  const renderers={
    intelligence:renderIntelligence,
    reports:renderReports,
    automation:renderAutomation,
    securityOps:renderSecurityOps,
    health:renderHealth,
    bulk:renderBulk,
    notifications:renderNotifications
  };

  return { renderers, exportAudit };
}
