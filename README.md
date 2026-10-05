# Citadel

Citadel is an independent all-in-one enterprise operations platform. The application is hosted through GitHub Pages and uses Firebase Authentication plus Cloud Firestore.

## Current build — Generation 2

Citadel now includes the original secure foundation plus the second-generation enterprise operations layer.

### Core foundation

- Firebase Email/Password authentication
- one-time primary System Owner initialization
- protected C10 System Owner account
- employee/user identity separation
- C0–C10 clearance
- explicit permissions and roles
- effective-access administration
- account provisioning
- permission-aware navigation
- immutable audit-event records
- responsive dark enterprise interface
- GitHub Pages deployment

### Customer operations

- customer directory
- Customer 360 profiles
- clearance-controlled customer records
- contact and account editing
- internal notes
- customer flags
- interaction history
- related case context
- case management
- classifications from STANDARD through HIGHLY_RESTRICTED

### People and HR

- employee directory
- organization structure
- departments
- positions
- locations
- leave self-service
- HR leave decisions
- performance review records
- employee-relations / disciplinary records
- training and certification tracking
- employee self-service training visibility

### Enterprise operations

- internal Service Desk
- IT / HR / Payroll / Facilities / Security / Access / Procurement request catalog
- ticket assignment and resolution
- asset inventory and assignments
- procurement requests and review lifecycle
- vendor management
- contract management
- expense submissions and finance review
- invoice register
- project register
- document registry
- internal corporate communications
- workflow definition registry

### Governance

- policy register
- compliance findings and remediation
- enterprise risk register
- restricted investigations
- Security Center
- access profile administration
- audit-event viewer
- protected principal enforcement

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

Firebase Authentication establishes identity. Citadel authorization is stored separately in Firestore and enforced by `firestore.rules`.

The Firebase web configuration is intentionally client-visible. Citadel never treats the Firebase web configuration as a secret.

## No composite indexes

Citadel Generation 2 is intentionally designed **without Firestore composite indexes**.

There is no `firestore.indexes.json` file and `firebase.json` deploys only Firestore rules.

Classified record visibility uses a numeric `minimumClearance` field and single-field queries. Search and secondary filtering are performed in memory after a bounded authorized read where necessary.

This is a deliberate architecture constraint. Do not introduce a multi-field Firestore query that requires a composite index unless the Citadel architecture is intentionally changed later.

## Firebase setup

### Authentication

In Firebase Console for project `citadel-8bf1b`:

1. Open **Authentication**.
2. Open **Sign-in method**.
3. Enable **Email/Password**.

### Firestore

Create the Cloud Firestore database and deploy the repository rules:

```bash
firebase login
firebase use citadel-8bf1b
firebase deploy --only firestore:rules
```

### Configure the first owner

Manually create this Firestore document:

**Collection:** `system`  
**Document:** `bootstrap`

```json
{
  "ownerEmail": "owner@example.com",
  "initialized": false
}
```

Use the exact same email address for the intended Firebase Authentication account.

On first authorized login Citadel offers **Initialize as System Owner**. Initialization creates the first employee/user/access records, ownership record, counters, and audit event.

The primary owner receives:

- `EMP-000001`
- C10 clearance
- `SYSTEM_OWNER`
- protected-principal status
- organization-wide authority
- no audit exemption

## Account provisioning

Creating a Firebase Auth account does not automatically grant Citadel access.

Unprovisioned users submit an access request. Authorized administrators approve the request in **Administration → Account Requests**.

New standard employees receive a limited starter profile for:

- customer viewing within clearance
- case viewing/creation
- employee directory
- Service Desk requests
- leave requests
- personal training records
- purchase requests
- expense submissions
- announcements
- authorized documents
- organization structure

Security administrators can later adjust clearance, roles, account status, and explicit permissions from the Security Center.

## Clearance architecture

Record classification maps to minimum clearance:

| Classification | Minimum |
| --- | ---: |
| STANDARD | C0 |
| INTERNAL | C1 |
| CONFIDENTIAL | C2 |
| SENSITIVE | C4 |
| RESTRICTED | C6 |
| HIGHLY_RESTRICTED | C8 |

Clearance is only one authorization dimension. A user still requires the appropriate module permission.

Example: C8 does not grant access to investigations unless that account also has `investigation.view`.

## Firestore security principles

- default deny
- authenticated identity required
- active Citadel profile required
- module permissions enforced in rules
- classified records enforce clearance
- System Owner is protected but audited
- ordinary records are archived/statused rather than hard-deleted
- audit events cannot be edited through ordinary client access
- self-service collections expose only the requesting employee's records unless broader permission is present

Do not replace the rules with development rules such as:

```
allow read, write: if true;
```

## GitHub Pages

`.github/workflows/pages.yml` deploys Citadel from `main` through GitHub Pages.

The workflow is configured to enable the Pages site when necessary.

## Human-facing IDs

Citadel keeps human IDs separate from Firestore document IDs. Current prefixes include:

- `EMP-` employees
- `CUS-` customers
- `CASE-` cases
- `TKT-` service tickets
- `AST-` assets
- `PRQ-` purchase requests
- `VND-` vendors
- `CTR-` contracts
- `EXP-` expenses
- `INV-` invoices
- `PRJ-` projects
- `DOC-` documents
- `ANN-` announcements
- `POL-` policies
- `FND-` compliance findings
- `RSK-` risks
- `IGT-` investigations
- `WFL-` workflows
- `DEP-` departments
- `POS-` positions
- `LOC-` locations

## Generation 3

Generation 3 can build on this foundation with advanced analytics, executive intelligence, deeper workflow automation, temporary/emergency access, security alerts, custom dashboards, enhanced reporting, bulk tools, and final enterprise polish.
