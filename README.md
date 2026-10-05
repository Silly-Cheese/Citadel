# Citadel

Citadel is an independent all-in-one enterprise operations platform. The application is hosted through GitHub Pages and uses Firebase Authentication plus Cloud Firestore.

## Current build — Generation 3

Generation 3 completes Citadel's current three-generation build with the intelligence, automation, security-operations, reporting, health, and enterprise-polish layer on top of the Generation 1 foundation and Generation 2 operating modules.

## Architecture

```
GitHub Pages
    |
    +-- Citadel static application
            |
            +-- Firebase Authentication
            |
            +-- Cloud Firestore
```

There is no application server and no Firebase Hosting dependency.

Firebase Authentication establishes identity. Cloud Firestore stores Citadel data and authorization state. `firestore.rules` enforces protected reads and writes.

The Firebase web configuration is intentionally visible in the browser and is not treated as a secret.

---

# Generation 1 — Foundation

Generation 1 established:

- Firebase Email/Password authentication
- one-time System Owner bootstrap
- protected primary owner
- employee/user identity separation
- C0-C10 clearance architecture
- roles and explicit permissions
- access profiles
- account provisioning
- permission-aware navigation
- customer directory
- Customer 360
- case management
- employee directory
- approvals foundation
- Security Center
- audit events
- GitHub Pages deployment

---

# Generation 2 — Enterprise Operations

Generation 2 added:

## Customers and service

- richer Customer 360
- internal customer notes
- customer flags
- customer interactions
- related customer cases
- customer classification
- customer risk context
- case operations

## Organization and people

- departments
- positions
- locations
- HR leave requests
- HR leave decisions
- performance reviews
- disciplinary / employee-relations records
- training and certification records

## Operations

- Service Desk
- IT requests
- HR requests
- Payroll questions
- Facilities requests
- Security requests
- Access requests
- Procurement requests
- internal ticket assignment and resolution
- asset management
- vendor management
- contracts
- projects
- controlled documents
- corporate communications

## Finance and procurement

- purchase requests
- procurement review
- vendor sourcing context
- expenses
- finance review
- invoice registry

## Governance

- policies
- compliance findings
- remediation tracking
- enterprise risks
- restricted investigations
- workflow definitions

---

# Generation 3 — Intelligence, Automation, and Security

Generation 3 adds the final current layer.

## Enterprise Intelligence

**Insights** combines authorized data from across Citadel into a cross-functional command view.

It includes:

- enterprise health score
- customer population
- open customer cases
- Service Desk pressure
- pending approvals
- outstanding invoice value
- project health
- enterprise risk
- compliance findings
- security alerts
- executive-scale metrics
- operational pressure signals
- governance signals

Users with `dashboard.customize` can choose which intelligence widgets appear on their dashboard.

## Reports

Citadel now includes reusable saved reports.

Reports support:

- saved report definitions
- authorized datasets
- text filtering
- repeat execution
- report previews
- CSV export
- report ownership
- report audit events

Current datasets include:

- Customers
- Cases
- Service Tickets
- Assets
- Expenses
- Projects
- Risks
- Vendors

Reporting intentionally performs bounded authorized reads and filters records in Citadel rather than creating complex Firestore queries.

## Universal Search

The global Citadel search searches authorized:

- customers
- employees
- cases
- assets
- vendors
- projects

Search visibility still respects Firestore authorization and record clearance.

## Workflow Automation

Citadel now has a durable workflow-run engine.

Workflow definitions created in the Generation 2 **Workflows** module can be launched from **Automation**.

A workflow run creates:

- a `workflowRuns` record
- ordered `workflowTasks`
- progress state
- completion state
- audit events

Authorized operators can advance workflow tasks through Citadel.

### Important execution model

Citadel is hosted only through GitHub Pages and Firebase/Firestore.

A static GitHub Pages app cannot perform unattended server-side background work after every user closes the site.

Therefore Generation 3 automation is intentionally:

**Firestore-backed + interactive execution**

The workflow state is durable, but an authorized Citadel user must open the system and launch/advance work.

No hidden server or Firebase Cloud Function is assumed.

## SLA Management

Generation 3 adds SLA tracking.

### Cases

New cases can receive:

- 4-hour SLA
- 8-hour SLA
- 24-hour SLA
- 48-hour SLA
- 72-hour SLA

Cases show:

- On Track
- Breached
- Complete
- Not Set

### Service Desk

New Service Desk requests automatically receive SLA targets based on priority:

- Critical: 4 hours
- High: 8 hours
- Normal: 24 hours
- Low: 72 hours

System Health identifies breached Service Desk and case SLAs.

## Customer Risk Intelligence

Customer 360 now calculates a live customer-risk signal using visible:

- active High/Critical customer flags
- escalated cases
- critical cases
- number of unresolved cases

The score is presented as:

- Low
- Moderate
- High
- Critical

This is operational Citadel scoring, not an external credit or identity score.

## Security Operations

Generation 3 adds a dedicated **Security Operations** area.

It includes:

- security-alert register
- security-alert severity
- investigation/monitoring/resolution status
- temporary-access requests
- temporary-access approval
- temporary-access denial
- active temporary grants
- grant revocation
- effective temporary clearance

## Temporary Access

Citadel supports time-limited temporary authority.

A temporary grant can include:

- specific permissions
- temporary clearance
- business/emergency reason
- case/reference number
- grantor
- expiration
- source request
- audit history

The grant is stored under:

```
temporaryAccess/{firebaseUid}
```

Firestore Rules evaluate temporary permission and clearance during every protected request.

Expired or revoked grants stop affecting authorization.

### Temporary access limitations

Temporary access is deliberately restricted.

It cannot grant:

- `system.manage`
- `access.manage`
- `access.temporary.manage`
- `security.manage`
- `employee.manage`
- `organization.manage`
- `admin.organization.manage`

Temporary clearance is limited to **C9**.

**C10 remains a permanent System Owner state.**

This prevents a temporary grant from becoming a permanent privilege-escalation path.

## Security Alerts

Authorized security staff can:

- create alerts
- assign severity
- categorize alerts
- relate alerts to Citadel IDs
- move alerts through Open / Investigating / Monitoring / Resolved / Closed
- record response/resolution information

## Security Center

The main Security Center now supports:

- effective clearance display
- permanent access profiles
- roles
- explicit permissions
- account status
- protected-principal state
- audit events
- CSV audit export

If temporary clearance is active, the Security Center shows the effective value.

## System Health

Generation 3 includes a live **System Health** and **Needs Attention** engine.

It can detect visible issues such as:

- breached case SLAs
- stale open cases
- breached Service Desk SLAs
- critical Service Desk tickets
- unassigned Service Desk tickets
- contracts nearing renewal
- overdue contract dates
- critical enterprise risks
- overdue compliance remediation
- at-risk projects
- lost assets

System Health runs when the page is opened. It does not require background hosting.

## Bulk Center

Authorized managers can perform controlled bulk status changes.

Supported datasets include:

- Cases
- Service Tickets
- Assets
- Purchase Requests
- Expenses
- Projects
- Risks

Records are matched using human-facing Citadel IDs.

Bulk Center does **not** bypass Firestore Rules. Every document in the batch must independently pass the underlying module authorization.

## Notifications

The top notification control now opens a real Notification Center.

Users can:

- view their notifications
- distinguish unread records
- mark notifications read
- mark all loaded notifications read

---

# Clearance Architecture

Citadel classifications map to minimum clearance:

| Classification | Minimum clearance |
| --- | ---: |
| STANDARD | C0 |
| INTERNAL | C1 |
| CONFIDENTIAL | C2 |
| SENSITIVE | C4 |
| RESTRICTED | C6 |
| HIGHLY_RESTRICTED | C8 |

Clearance never replaces module permission.

For example, a C8 user still requires `investigation.view` to access a restricted investigation.

Temporary clearance can raise effective clearance up to C9 while a valid grant exists.

---

# No Composite Indexes

Citadel is intentionally designed without Firestore composite indexes.

There is **no**:

```
firestore.indexes.json
```

The Firebase configuration deploys only:

```json
{
  "firestore": {
    "rules": "firestore.rules"
  }
}
```

Citadel avoids composite indexes by using:

- single-field equality queries
- single-field clearance queries
- single-field ordering
- bounded authorized reads
- application-side filtering and sorting

Do not introduce multi-field query patterns that require Firestore composite indexes unless this architecture is intentionally changed in a future generation.

---

# Firebase Setup

## Authentication

For Firebase project:

```
citadel-8bf1b
```

enable:

**Authentication → Sign-in Method → Email/Password**

## Firestore

Create Cloud Firestore and deploy:

```bash
firebase login
firebase use citadel-8bf1b
firebase deploy --only firestore:rules
```

No index deployment is required.

---

# First System Owner

Before the first Citadel initialization, manually create:

**Collection**

```
system
```

**Document**

```
bootstrap
```

Fields:

```json
{
  "ownerEmail": "owner@example.com",
  "initialized": false
}
```

Sign into Firebase Authentication using that exact email.

Citadel will offer:

**Initialize as System Owner**

Initialization creates the protected owner identity and:

- `EMP-000001`
- C10 clearance
- `SYSTEM_OWNER`
- protected-principal status
- organization-wide authority
- System Ownership record
- initial audit event

The owner has no audit exemption.

---

# New Employee Accounts

Creating a Firebase Authentication account does not grant Citadel access.

Unprovisioned accounts enter the Citadel account-request flow.

An authorized administrator can approve the account in:

**Administration → Account Requests**

A standard starter account receives limited permissions for common employee self-service and corporate access.

Security administrators can then assign the person's permanent:

- clearance
- roles
- explicit permissions
- account status

---

# Human-Facing IDs

Citadel maintains human-facing IDs separately from Firestore document IDs.

Examples include:

- `EMP-` Employees
- `CUS-` Customers
- `CASE-` Cases
- `TKT-` Service Tickets
- `AST-` Assets
- `PRQ-` Purchase Requests
- `VND-` Vendors
- `CTR-` Contracts
- `EXP-` Expenses
- `INV-` Invoices
- `PRJ-` Projects
- `DOC-` Documents
- `ANN-` Announcements
- `POL-` Policies
- `FND-` Compliance Findings
- `RSK-` Risks
- `IGT-` Investigations
- `WFL-` Workflow Definitions
- `RUN-` Workflow Runs
- `RPT-` Saved Reports
- `ACR-` Temporary Access Requests
- `SEC-` Security Alerts
- `DEP-` Departments
- `POS-` Positions
- `LOC-` Locations

---

# Security Principles

Citadel follows these rules:

- default deny
- Firebase Auth identity required
- active Citadel access profile required
- permissions enforced in Firestore Rules
- clearance enforced in Firestore Rules
- temporary grants expire
- C10 cannot be granted temporarily
- protected principals cannot be casually disabled
- critical admin authority cannot be temporarily granted
- audit events are append-only through ordinary client access
- hard deletion is avoided for core corporate records
- self-service records expose only authorized user data unless broader permission exists
- frontend-hidden buttons are never treated as security

Never replace `firestore.rules` with:

```
allow read, write: if true;
```

Doing so would invalidate Citadel's security architecture.

---

# GitHub Pages

Citadel deploys through:

```
.github/workflows/pages.yml
```

Every push to `main` triggers GitHub Pages deployment.

The workflow can initialize GitHub Pages if it has not already been enabled.

---

# Current Build Status

Generation 1: **Foundation**

Generation 2: **Enterprise Operations**

Generation 3: **Intelligence, Automation, Security, Analytics, and Final Enterprise Layer**

The current three-generation Citadel architecture is complete and remains extensible for future specialized modules.
