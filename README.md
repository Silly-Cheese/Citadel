# Citadel

Citadel is an independent enterprise operations platform built as a static GitHub-hosted application with Firebase Authentication and Cloud Firestore.

## Part 1

This repository currently includes the first Citadel foundation:

- Firebase Email/Password authentication
- one-time primary System Owner bootstrap
- protected C10 owner profile
- employee identity and access profiles
- pending account registration and administrator approval
- permission-aware navigation
- customer directory and customer record editing
- customer classifications
- customer internal notes
- basic case management
- employee directory
- approvals foundation
- Security / Effective Access view
- immutable audit-event rules
- Firestore security rules
- GitHub Pages deployment workflow
- responsive dark enterprise interface

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

Firebase Authentication establishes identity. Citadel authorization is stored separately in Firestore and enforced with `firestore.rules`.

The Firebase web configuration is intentionally client-visible. Security must depend on Authentication and Firestore Security Rules, not on hiding the Firebase configuration.

## Initial Firebase setup

### 1. Authentication

In Firebase Console for project `citadel-8bf1b`:

1. Open **Authentication**.
2. Select **Sign-in method**.
3. Enable **Email/Password**.

### 2. Firestore

Create the Cloud Firestore database for `citadel-8bf1b`.

Deploy the repository rules and index configuration with the Firebase CLI:

```bash
firebase login
firebase use citadel-8bf1b
firebase deploy --only firestore:rules,firestore:indexes
```

### 3. Configure the first owner

The client is intentionally not allowed to create its own bootstrap authorization document.

In the Firestore Console, manually create:

**Collection:** `system`  
**Document ID:** `bootstrap`

Fields:

| Field | Type | Value |
| --- | --- | --- |
| `ownerEmail` | string | the exact email address of the intended primary owner |
| `initialized` | boolean | `false` |

Example:

```json
{
  "ownerEmail": "owner@example.com",
  "initialized": false
}
```

Use the same email address for the Firebase Auth account.

### 4. Initialize Citadel

1. Open Citadel.
2. Create or sign in to the Firebase Auth account matching `system/bootstrap.ownerEmail`.
3. Citadel will recognize that identity as the authorized bootstrap account.
4. Enter the owner's first and last name.
5. Select **Initialize as System Owner**.

The initialization transaction creates:

- `employees/{firebaseUid}`
- `users/{firebaseUid}`
- `accessProfiles/{firebaseUid}`
- `system/ownership`
- `counters/employees`
- initial audit event

It also changes `system/bootstrap.initialized` to `true`.

The owner receives human-facing employee ID `EMP-000001`, C10 clearance, the `SYSTEM_OWNER` role, protected-principal status, and the Part 1 owner permission set.

## New employee accounts

A new user can create a Firebase Auth account, but that does **not** grant access to Citadel.

An unprovisioned authenticated user receives an **Access pending** screen and creates a `registrationRequests/{uid}` record.

The System Owner can open:

**Administration → Account Requests**

and approve the user. Approval creates the Citadel employee record, user link, and access profile.

Part 1 provisions approved employees as C1 General Employees with a limited starter permission set. Later generations will replace this with full position-, role-, department-, and policy-based provisioning.

## Firestore security

The rules currently enforce:

- authenticated access
- active Citadel access profiles
- permission checks
- clearance checks for customer classifications
- System Owner bootstrap constraints
- protected owner identity constraints
- employee/account provisioning permissions
- customer create/read/update permissions
- case permissions
- approval permissions
- append-only audit events
- no ordinary hard deletion of protected corporate data
- default deny for every collection not explicitly listed

Do not replace these rules with development rules such as:

```
allow read, write: if true;
```

That would invalidate Citadel's security model.

## GitHub Pages

The repository includes:

```
.github/workflows/pages.yml
```

Every push to `main` triggers the GitHub Pages deployment workflow.

If Pages has not been enabled for the repository yet, open:

**Repository Settings → Pages**

and select **GitHub Actions** as the source.

## Human-facing IDs

Citadel uses human-facing IDs separately from Firestore document IDs.

Current prefixes:

- Employees: `EMP-`
- Customers: `CUS-`
- Cases: `CASE-`

Firestore document IDs remain implementation identifiers.

## Current navigation

- Home / Command
- Customers
- Cases
- People
- Approvals
- Security
- Administration

Navigation is authorization-aware.

## Next build

Part 1 establishes the security, identity, customer, case, people, audit, and administration foundation. Later Citadel generations can expand this into HR, assets, finance, procurement, service management, vendors, contracts, compliance, risk, investigations, workflows, documents, analytics, and executive operations without replacing the underlying identity model.
