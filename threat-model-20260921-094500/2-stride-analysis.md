# STRIDE + Abuse Cases — Threat Analysis

> This analysis uses the standard **STRIDE** methodology (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege) extended with **Abuse Cases** (business logic abuse, workflow manipulation, feature misuse). The "A" column in tables below represents Abuse — a supplementary category covering threats where legitimate features are misused for unintended purposes. This is distinct from Elevation of Privilege (E), which covers authorization bypass.

## Exploitability Tiers

Threats are classified into three exploitability tiers based on the prerequisites an attacker needs:

| Tier | Label | Prerequisites | Assignment Rule |
|------|-------|---------------|----------------|
| **Tier 1** | Direct Exposure | `None` | Exploitable by unauthenticated external attacker with NO prior access. The prerequisite field MUST say `None`. |
| **Tier 2** | Conditional Risk | Single prerequisite: `Authenticated User`, `Privileged User`, `Internal Network`, or single `{Boundary} Access` | Requires exactly ONE form of access. The prerequisite field has ONE item. |
| **Tier 3** | Defense-in-Depth | `Host/OS Access`, `Admin Credentials`, `{Component} Compromise`, `Physical Access`, or MULTIPLE prerequisites joined with `+` | Requires significant prior breach, infrastructure access, or multiple combined prerequisites. |

## Summary

| Component | Link | S | T | R | I | D | E | A | Total | T1 | T2 | T3 | Risk |
|-----------|------|---|---|---|---|---|---|---|-------|----|----|----|------|
| AppRoutes | [Link](#approutes) | 0 | 2 | 0 | 1 | 1 | 1 | 1 | 6 | 0 | 5 | 1 | Medium |
| AuthProvider | [Link](#authprovider) | 1 | 1 | 0 | 1 | 1 | 1 | 0 | 5 | 0 | 5 | 0 | Medium |
| CloudFunctions | [Link](#cloudfunctions) | 2 | 4 | 2 | 3 | 3 | 2 | 3 | 19 | 0 | 18 | 1 | Critical |
| Dashboard | [Link](#dashboard) | 0 | 2 | 0 | 1 | 1 | 0 | 1 | 5 | 0 | 5 | 0 | Medium |
| FirebaseAuth | [Link](#firebaseauth) | 2 | 0 | 1 | 1 | 1 | 2 | 1 | 8 | 5 | 3 | 0 | High |
| FirebaseClient | [Link](#firebaseclient) | 0 | 2 | 0 | 3 | 0 | 0 | 1 | 6 | 1 | 2 | 3 | Medium |
| FirebaseHosting | [Link](#firebasehosting) | 1 | 1 | 0 | 1 | 1 | 0 | 1 | 5 | 4 | 0 | 1 | Medium |
| FirebaseStorage | [Link](#firebasestorage) | 0 | 1 | 0 | 2 | 1 | 1 | 1 | 6 | 2 | 4 | 0 | Medium |
| Firestore | [Link](#firestore) | 0 | 1 | 1 | 1 | 2 | 2 | 1 | 8 | 0 | 7 | 1 | Medium |
| LocalStorage | [Link](#localstorage) | 0 | 1 | 0 | 1 | 1 | 0 | 1 | 4 | 0 | 0 | 4 | Medium |
| LoginUser | [Link](#loginuser) | 1 | 0 | 0 | 2 | 1 | 0 | 1 | 5 | 4 | 0 | 1 | Medium |
| MainPage | [Link](#mainpage) | 0 | 0 | 0 | 1 | 0 | 1 | 1 | 3 | 0 | 3 | 0 | Low |
| MigrateHeadOfCommercial | [Link](#migrateheadofcommercial) | 0 | 1 | 1 | 0 | 1 | 1 | 0 | 4 | 0 | 0 | 4 | Medium |
| OrderDetails | [Link](#orderdetails) | 0 | 1 | 1 | 1 | 0 | 1 | 2 | 6 | 0 | 6 | 0 | Medium |
| SummaryReport | [Link](#summaryreport) | 0 | 3 | 0 | 1 | 0 | 0 | 1 | 5 | 0 | 5 | 0 | Medium |
| **Totals** | | **7** | **20** | **6** | **20** | **14** | **12** | **16** | **95** | **16** | **63** | **16** | |

---

## AppRoutes

**Trust Boundary:** Browser
**Role:** Router, route guards, per-UID draft state, and the createOrder/deleteOrder callable wrappers.
**Data Flows:** DF12, DF13
**Pod Co-location:** N/A — not a Kubernetes deployment

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 1 threats identified for this component.* | — | — | — | — |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T01.T1 | Tampering | The `RequireAuth`, `RequireUser`, and `BlockViewer` guards run entirely in the browser; a user who edits the bundle or calls the callables directly bypasses every one of them. | Authenticated User | DF13 | Keep every guard duplicated server-side; `createOrder` already re-checks `role !== "user"` and `deleteOrder` re-checks admin. | Mitigated |
| T01.T2 | Tampering | `handleDuplicateOrder` copies `finalDecisionAuthorityRank`, `option`, and the financing totals from an existing order into a fresh draft, which is then submitted as if operator-entered. | Authenticated User | DF13 | `createOrder` strips `finalDecisionAuthorityRank` and recomputes every financing figure from the line items, so the copied values never reach storage. | Mitigated |
| T01.D1 | Denial of Service | The draft-state effects mount a 4-second `listOrders` poll per open tab with no backoff, so a user with many tabs multiplies backend read volume without limit. | Authenticated User | DF13 | Replace polling with a server-driven listener or add backoff plus pagination; enforce App Check and per-caller rate limits. | Open |
| T01.E1 | Elevation of Privilege | `RequireUser` restricts `/manage` to the Requester role in the client only; a viewer or approver can render the entry screen by bypassing the guard. | Authenticated User | DF13 | Data access is unaffected — `createOrder` rejects any caller whose server-resolved role is not `"user"`. | Mitigated |
| T01.A1 | Abuse | `handleDeleteOrder` is a plain callable wrapper with no role condition of its own; the UI decides whether to render the control. | Authenticated User | DF13 | `deleteOrder` re-resolves the caller's role server-side and rejects non-admins. | Mitigated |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T01.I1 | Information Disclosure | Draft services and metadata are serialised to `localStorage` under `services_{uid}` and `orderMetadata_{uid}` in cleartext and are never removed on sign-out. | Host/OS Access | DF12 | Clear both keys in the `logout` path and avoid persisting cost fields; prefer `sessionStorage` for draft state. | Open |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Spoofing | AppRoutes asserts no identity of its own; all identity handling is delegated to AuthProvider and the Firebase SDK. |
| Repudiation | AppRoutes performs no recordable security action; every state change it triggers is recorded, or not, by the callable it invokes. |

---

## AuthProvider

**Trust Boundary:** Browser
**Role:** Resolves the caller's role, department, and name and publishes them to every route guard and control-visibility check.
**Data Flows:** DF04, DF05, DF06
**Pod Co-location:** N/A — not a Kubernetes deployment

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 1 threats identified for this component.* | — | — | — | — |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T02.S1 | Spoofing | The role the provider publishes comes from `getMyProfile`, which returns `rank4` for any caller with no profile document whose email contains the substring `rank4`, so the client presents approver identity to a non-approver. | Authenticated User | DF04, DF05 | Remove the email-substring branch from `getMyProfile` and return only roles backed by a provisioned `users` document. | Open |
| T02.T1 | Tampering | `updateDepartment` calls `setActualDepartment(newDept)` before invoking the callable and never reverts it when the call throws, leaving the UI asserting a department the server refused. | Authenticated User | DF05 | Apply the state change only after the callable resolves, and re-read the profile on failure. | Open |
| T02.I1 | Information Disclosure | The resolved role is written to the browser console (`console.log("[Auth] Loaded role …")`) and failure paths log the raw error object, exposing profile details in shared or recorded sessions. | Authenticated User | DF05 | Strip identity and role details from production console output. | Open |
| T02.D1 | Denial of Service | Any `getMyProfile` failure falls through to a direct Firestore read that the deny-all rules reject, after which the catch block assigns `role = "user"` — silently stripping an approver of their function until reload. | Authenticated User | DF05, DF06 | Surface the failure to the user and retry rather than defaulting to a role; remove the now-dead Firestore fallback. | Open |
| T02.E1 | Elevation of Privilege | The fallback path reads `users/{uid}` and `users/{email}` directly from the browser and would accept whatever role those documents assert. | Authenticated User | DF06 | `firestore.rules` denies all client reads of `users`, so the fallback cannot succeed and cannot be used to self-assert a role. | Mitigated |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 3 threats identified for this component.* | — | — | — | — |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Repudiation | AuthProvider records no action; it only reads and caches profile attributes. |
| Abuse | The provider exposes no business workflow that can be misused independently of the callables it wraps. |

---

## CloudFunctions

**Trust Boundary:** FirebaseBackend
**Role:** The nine `onCall` endpoints in `functions/src/index.ts`; the only authorization enforcement point and the only write path into Firestore.
**Data Flows:** DF05, DF13, DF14, DF17, DF18
**Pod Co-location:** N/A — not a Kubernetes deployment

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 1 threats identified for this component.* | — | — | — | — |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T03.S1 | Spoofing | Viewer scope is decided by comparing the order's free-text `accountManager` string to the caller's profile `name`; any requester can type a viewer's name and grant them access, and two people with the same name are indistinguishable. | Authenticated User | DF13 | Key viewer scope to a stable identifier (UID or verified email) recorded at creation time rather than a typed display name. | Open |
| T03.S2 | Spoofing | `getCallerProfile` resolves the profile from `users/{uid}` and falls back to `users/{email}`; the two documents can carry different roles, and which one wins depends on provisioning order. | Authenticated User | DF17 | Resolve profiles by UID only and migrate any email-keyed documents. | Open |
| T03.T1 | Tampering | `createOrder` strips `id`, `status`, `currentApprovalRank`, `approvalHistory`, and `finalDecisionAuthorityRank` but passes `orderNumber` (when `isNew` is false), `version`, and `createdAt` through untouched into the stored document. | Authenticated User | DF13 | Reject or overwrite `version` and `createdAt` server-side, and verify that a supplied `orderNumber` belongs to an order the caller created. | Open |
| T03.T2 | Tampering | `submitForApproval` writes `approvalHistory: []`, discarding every previously recorded approval and rejection on that document. | Authenticated User | DF14 | Append a "resubmitted" marker instead of clearing, and move the audit trail to an append-only subcollection. | Open |
| T03.T3 | Tampering | Every field of each `attachments` entry — `url`, `name`, `path`, `size`, `type` — is spread into the stored order without validation and later rendered as an anchor for all readers. | Authenticated User | DF13 | Validate that each `url` resolves to the project's Storage bucket and that `path` lies under the caller's own prefix. | Open |
| T03.R1 | Repudiation | No callable writes a security event anywhere: creation, submission, withdrawal, approval, rejection, and deletion leave no record outside the mutable `approvalHistory` array on the order itself. | Authenticated User | DF17 | Write an append-only `auditLog` collection entry, keyed by UID and timestamp, from every state-changing callable. | Open |
| T03.R2 | Repudiation | `deleteOrder` calls `.delete()` on the document, removing the order and its embedded approval history with no tombstone or archived copy. | Privileged User | DF13 | Replace the hard delete with a soft-delete flag plus an audit entry, and retain approved requests for their records-retention period. | Open |
| T03.I1 | Information Disclosure | `ORDER_SENSITIVE_FIELDS` lists only `totalCost`, so `stripForViewer` leaves `totalOneTimeChargeB2S` in place — a value the same function computes as the sum of one-time `totalCost + totalSST`. | Authenticated User | DF13 | Add every derived cost field to the strip list, or build the viewer projection from an allow-list instead of a deny-list. | Open |
| T03.I2 | Information Disclosure | In `listOrders` the Rank 4 department filter is `matchesDept = !o.headOfDepartment \|\| o.headOfDepartment.toLowerCase() === department.toLowerCase()` and only runs when `department` is truthy, so an order with no department, or an approver with none, matches everything. | Authenticated User | DF13 | Mirror the fail-closed polarity already used in `approveOrder` and `canAccessOrder`. | Open |
| T03.I3 | Information Disclosure | After scoping, `listOrders` rebuilds the result as every document sharing a visible `orderNumber`, returning versions the approver was never routed — including Drafts still being edited. | Authenticated User | DF13 | Scope version history by the same rule as the current version rather than by order number. | Open |
| T03.D1 | Denial of Service | `listOrders` executes `db.collection("orders").orderBy("createdAt","desc").get()` — a full collection read — on every call, with no pagination, no caching, no rate limit, and no App Check. | Authenticated User | DF13, DF17 | Paginate, filter server-side with indexed queries, enable App Check, and add per-caller rate limiting. | Open |
| T03.D2 | Denial of Service | `createOrder` can be invoked in a loop by any Requester; each call runs a counter transaction and writes a document, inflating cost and permanently consuming FA numbers. | Authenticated User | DF13, DF17 | Rate-limit creation per caller and per time window. | Open |
| T03.D3 | Denial of Service | `approveOrder` and `rejectOrder` require a non-empty comment but apply no maximum length, so an approver can append an arbitrarily large string to `approvalHistory` on every decision. | Authenticated User | DF14, DF17 | Bound the comment to a documented maximum and reject longer input with `invalid-argument`. | Open |
| T03.E1 | Elevation of Privilege | `getCallerProfile` returns `role = data?.role \|\| "user"`, so any principal without a `users` document is treated as a Requester — a role that can create orders and consume the global counter. | Authenticated User | DF17 | Default unprovisioned principals to a no-privilege role and reject them explicitly. | Open |
| T03.E2 | Elevation of Privilege | In `approveOrder` and `rejectOrder`, `callerRankStr = role === "admin" ? currentRank : rankMap[role]`, so a single admin satisfies the rank check at every step and can drive a request from Draft to Approved alone. | Privileged User | DF14 | Require a second principal for admin overrides, and record every override distinctly in the audit trail. | Open |
| T03.A1 | Abuse | `approveOrder` and `rejectOrder` perform `orderRef.get()` then `orderRef.update()` outside a transaction, so two concurrent decisions on the same rank can both pass the check and one audit entry overwrites the other. | Authenticated User | DF14, DF17 | Wrap the read, the authorization check, and the write in `db.runTransaction`, and append history with `FieldValue.arrayUnion`. | Open |
| T03.A2 | Abuse | The creator can call `withdrawFromReview` at any point in the chain and then `submitForApproval` again, which resets the chain to Rank 4 and clears the history — allowing unlimited re-rolls until a favourable approver acts. | Authenticated User | DF14 | Preserve history across withdrawals, cap or record re-submissions, and notify prior approvers when a reviewed request re-enters the chain. | Open |
| T03.A3 | Abuse | When financing does not apply, `contractPeriod` falls back to a floored client integer with no upper bound, and that value becomes `n` in the financing-lease PMT computation. | Authenticated User | DF13 | Bound `contractPeriod` to the permitted installment periods declared in `src/types.ts`. | Open |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T03.T4 | Tampering | The `functions/` directory contains only `src/index.ts` — there is no `package.json` and no lockfile — so `firebase-admin` and `firebase-functions` resolve to whatever the build environment provides, while the code depends on Admin SDK v12+ semantics at cold start. | Admin Credentials | DF17 | Add `functions/package.json` with pinned versions and commit the lockfile; verify the floor in CI. | Open |

#### Categories Not Applicable

*All seven STRIDE-A categories produced concrete threats for this component.*

---

## Dashboard

**Trust Boundary:** Browser
**Role:** Service line-item entry screen; also the attachment upload and deletion client.
**Data Flows:** DF09, DF15
**Pod Co-location:** N/A — not a Kubernetes deployment

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 1 threats identified for this component.* | — | — | — | — |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T04.T1 | Tampering | File type is validated against `file.type` in the browser and against `request.resource.contentType` in the rules — but both read the same client-declared value, so neither verifies the bytes. Any payload can be uploaded labelled `application/pdf`. | Authenticated User | DF09, DF15 | Verify content server-side by magic-byte inspection in a post-upload function, and treat the declared content type as untrusted. | Open |
| T04.T2 | Tampering | The browser applies a single 100 MB ceiling to both file types while `storage.rules` caps PDFs at 5 MB, so a 5–100 MB PDF passes client validation and is then refused by the rules. | Authenticated User | DF09, DF15 | Make the client limits per-type and derive both sides from one shared constant. | Open |
| T04.I1 | Information Disclosure | On upload completion the handler calls `getDownloadURL` and stores the resulting tokenized URL in the draft, which is later persisted on the order and shown to every reader. | Authenticated User | DF15 | Closed by FIND-01 (2026-09-23): the `getDownloadURL` call was removed, only the object path is stored, and `getAttachmentUrl` mints a short-lived signed URL after authorizing. | Mitigated |
| T04.D1 | Denial of Service | Nothing limits how many attachments a requester uploads or their cumulative size; `storage.rules` caps a single object at 100 MB but imposes no count or total quota. | Authenticated User | DF15 | Cap attachments per draft and total bytes per user, and expire orphaned draft objects. | Open |
| T04.A1 | Abuse | `handleRemoveAttachment` deletes the Storage object but any order already persisted keeps the URL, leaving approvers with a link to a deleted file and no indication it changed. | Authenticated User | DF15 | Freeze attachments at submission time by copying them to an order-scoped, immutable prefix. | Open |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 3 threats identified for this component.* | — | — | — | — |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Spoofing | Uploads are addressed by `currentUser.uid` and the Storage rules bind the path to the authenticated UID, leaving no identity to assert. |
| Repudiation | Upload and delete actions are recorded by Firebase Storage's own operation logging, outside this component. |
| Elevation of Privilege | The component holds no privilege beyond the signed-in user's own Storage prefix. |

---

## FirebaseAuth

**Trust Boundary:** — (external service)
**Role:** Google-managed identity provider issuing the ID tokens that every callable verifies.
**Data Flows:** DF03, DF04, DF07, DF18
**Pod Co-location:** N/A — not a Kubernetes deployment

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T05.S1 | Spoofing | Nothing in the repository restricts which identities the project accepts — no blocking function, no domain allow-list, no email-verification gate — so any account that exists in the project is a valid principal to every callable. | None | DF03 | Add a `beforeCreate`/`beforeSignIn` blocking function enforcing the corporate domain and a verified email. | Open |
| T05.S2 | Spoofing | Accounts that authorise material financial commitments are protected by a password alone; no second factor is enrolled or required anywhere in the code or configuration. | None | DF03 | Require multi-factor enrolment for every rank-holding and admin account. | Open |
| T05.I1 | Information Disclosure | Identity Toolkit responses can distinguish registered from unregistered addresses, allowing enumeration of staff email addresses. | None | DF03 | Firebase's email-enumeration protection is a project-level setting applied by the platform; the application's own error handling is already generic. | Platform |
| T05.D1 | Denial of Service | Repeated sign-in attempts against a known address can lock or exhaust an account. | None | DF03 | Firebase Authentication applies its own per-IP and per-account throttling and CAPTCHA escalation. | Platform |
| T05.A1 | Abuse | Email addresses are never verified, so an account's `email` claim — the value stamped into `createdBy` and `approvedBy` and matched against `accountManager` — can be an address the holder does not control. | None | DF03, DF18 | Gate sign-in on `email_verified` in a blocking function. | Open |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T05.R1 | Repudiation | Firebase Authentication's sign-in records are not exported, retained, or surfaced anywhere in the application, so an approver disputing an attributed decision cannot be checked against session evidence. | Authenticated User | DF18 | Export Identity Platform audit logs to a retained sink and correlate them with approval events. | Open |
| T05.E1 | Elevation of Privilege | `getMyProfile` grants the `rank4` role to any authenticated caller with no profile document whose email contains `rank4`, and derives their department from substrings of the same address. | Authenticated User | DF05 | Remove the substring heuristics; resolve role and department only from provisioned `users` documents. | Open |
| T05.E2 | Elevation of Privilege | Roles are read per call from Firestore, but the ID token itself is never checked for revocation, so a deprovisioned or demoted account keeps a usable session until its token expires. | Authenticated User | DF18 | Check `revokeRefreshTokens` state via `verifyIdToken(token, true)` in the callables, and shorten the effective session for rank-holding accounts. | Open |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 3 threats identified for this component.* | — | — | — | — |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Tampering | Token issuance and signing are wholly controlled by Google's managed service; the repository contributes no code that could alter them. |

---

## FirebaseClient

**Trust Boundary:** Browser
**Role:** Firebase SDK bootstrap; builds the app from build-time-injected configuration and exports the auth, Firestore, Storage, and Functions handles.
**Data Flows:** DF07
**Pod Co-location:** N/A — not a Kubernetes deployment

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T06.A1 | Abuse | The Firebase web configuration — API key, project id, app id — is compiled into the public bundle, letting anyone address the project's endpoints directly rather than through the UI. | None | DF07 | This is the documented Firebase web model: the config is a project identifier, not a credential. Every callable independently requires a verified ID token, and `firestore.rules` denies direct access. | Mitigated |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T06.I1 | Information Disclosure | `handleFirestoreError` serialises `uid`, `email`, `emailVerified`, `isAnonymous`, `tenantId`, and every provider entry into a JSON string that it both logs to the console and throws as an Error message. | Authenticated User | DF07 | Log a correlation id instead of identity attributes, and never embed them in a thrown message that may surface in the UI. | Open |
| T06.I2 | Information Disclosure | The development server is started with `--host=0.0.0.0`, binding every interface, so the application and its source maps are reachable by anyone on the developer's network segment. | Internal Network | DF07 | Bind the dev server to `127.0.0.1` by default and require an explicit opt-in flag for LAN exposure. | Open |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T06.T1 | Tampering | The client selects its Firestore database from `FIREBASE_DATABASE_ID` and falls through to the implicit default when unset, while the functions pin `(default)` explicitly — a build-time mismatch would silently split reads and writes across databases. | Admin Credentials | DF07 | Both paths currently converge on `(default)`, `firebase.json` deploys the same ruleset to both configured databases, and the divergence risk is documented in the source. | Mitigated |
| T06.T2 | Tampering | `vite.config.ts` reads `firebase-applet-config.json` from the repository root when present and uses it to supply `apiKey`, `projectId`, `authDomain`, and `firestoreDatabaseId`, so an added or altered file silently repoints the built application at another Firebase project. | Admin Credentials | DF07 | Remove the file-based fallback, or require an explicit opt-in flag and fail the build when the resolved project id does not match an expected value. | Open |
| T06.I3 | Information Disclosure | `vite.config.ts` declares `'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)`, so the secret is inlined into the public bundle the moment any source file references that identifier. No file references it today, so nothing is currently emitted. | Admin Credentials | DF07 | Delete the `define` entry and the unused `@google/genai` dependency; route any future Gemini call through a callable that holds the key server-side. | Open |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Spoofing | The component asserts no identity; it only constructs SDK handles. |
| Repudiation | No security-relevant action is performed that could later be disputed. |
| Denial of Service | Initialisation is a local, constant-cost operation with no externally driven work. |
| Elevation of Privilege | The handles carry only the privileges of the signed-in user, enforced remotely. |

---

## FirebaseHosting

**Trust Boundary:** FirebaseBackend
**Role:** Static host serving the compiled bundle from `dist/` with a catch-all rewrite to `index.html`.
**Data Flows:** DF01, DF20
**Pod Co-location:** N/A — not a Kubernetes deployment

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T07.S1 | Spoofing | `firebase.json` declares no `headers` block, so no `Content-Security-Policy` with `frame-ancestors` and no `X-Frame-Options` is sent; the approval screen can be framed by an attacker page and an approver's click redirected onto the Approve control. | None | DF01 | Add a `headers` block setting `Content-Security-Policy` including `frame-ancestors 'none'`, plus `X-Frame-Options: DENY`. | Open |
| T07.I1 | Information Disclosure | With no `Referrer-Policy` header, a tokenized attachment URL opened from the app leaks in the `Referer` header to whatever third-party host the user navigates to next. | None | DF01 | Set `Referrer-Policy: strict-origin-when-cross-origin` (or `no-referrer`) in the hosting headers. | Open |
| T07.D1 | Denial of Service | The bundle is served to unauthenticated clients, so request volume is unbounded. | None | DF01 | Firebase Hosting fronts the content with Google's CDN, which absorbs volumetric load; there is no application-side work per request. | Platform |
| T07.A1 | Abuse | The `"source": "**"` rewrite returns `index.html` for every path, so any URL renders the application shell and the full client route surface is reachable before any authorization decision. | None | DF01 | This is the required SPA routing model; every route's data access is authorized server-side inside the callables, so reaching a route yields no data. | Mitigated |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 2 threats identified for this component.* | — | — | — | — |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T07.T1 | Tampering | No `Content-Security-Policy` constrains `script-src` and no Subresource Integrity is applied, so a script injected through a compromised deploy or a future third-party include executes with the signed-in user's full session authority. | Admin Credentials | DF20 | Ship a restrictive `script-src` policy and pin any third-party assets with integrity hashes. | Open |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Repudiation | Hosting performs no application state change; request logging is handled by the platform. |
| Elevation of Privilege | The host serves static bytes and holds no privilege that could be escalated. |

---

## FirebaseStorage

**Trust Boundary:** FirebaseBackend
**Role:** Object store holding draft attachments under `draft-attachments/{uid}/`.
**Data Flows:** DF15, DF16
**Pod Co-location:** N/A — not a Kubernetes deployment

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T08.I1 | Information Disclosure | `getDownloadURL` returns a URL carrying a long-lived access token that serves the object to any unauthenticated requester; that URL is persisted on the order document and rendered to every reader, so it outlives order-level authorization and survives the viewer redaction entirely. | None | DF16 | Closed by FIND-01 (2026-09-23): no tokens are minted any more, and the 10 previously-issued tokens were revoked, so URLs already distributed are dead rather than superseded. | Mitigated |
| T08.E1 | Elevation of Privilege | `storage.rules` grants read only to `request.auth.uid == userId`, so approvers cannot read a requester's attachments through the rules at all — the only working access path is the unauthenticated token URL, which makes possession of a link the effective authorization check. | None | DF16 | Closed by FIND-01 (2026-09-23): `getAttachmentUrl` checks order scope with the same predicate as `getOrder` (minus viewers) before issuing a five-minute signed URL, so authorization is enforced in code rather than by link possession. | Mitigated |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T08.T1 | Tampering | The `url` stored on an order is never checked against the Storage origin or against the sibling `path` field, so the displayed link need not point at the uploaded object. | Authenticated User | DF15 | Reconstruct the link server-side from the validated `path` and ignore any client-supplied `url`. | Open |
| T08.I2 | Information Disclosure | Original filenames are embedded in the object path and rendered to every reader of the request, disclosing customer, vendor, and deal names even where the object itself is unreadable. Not closed by FIND-01, and now more exposed: viewers are refused the file but still shown its name. | Authenticated User | DF16 | Store a generated object name, keep the display name in Firestore under the order's scope rules, and bring `attachments` under `stripForViewer`. Tracked as FIND-37. | Open |
| T08.D1 | Denial of Service | Per-object limits exist (5 MB PDF, 100 MB Excel) but there is no per-user object count or aggregate quota, so a single Requester can consume project storage without bound. | Authenticated User | DF15 | Enforce per-user quotas and lifecycle rules that expire orphaned draft objects. | Open |
| T08.A1 | Abuse | Attachments are uploaded before an order exists and are never re-validated at submission, so a requester can replace the object behind a persisted URL after approvers have reviewed it. | Authenticated User | DF15, DF16 | Copy attachments to an immutable, order-scoped prefix at submission time and block writes to that prefix. | Open |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 3 threats identified for this component.* | — | — | — | — |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Spoofing | Write paths are bound to `request.auth.uid` by the Storage rules, leaving no writer identity to forge. |
| Repudiation | Object create and delete operations are recorded by the platform's own operation logs. |

---

## Firestore

**Trust Boundary:** FirebaseBackend
**Role:** Document store for the `orders`, `users`, and `counters` collections; direct client access denied by rules.
**Data Flows:** DF06, DF17, DF21
**Pod Co-location:** N/A — not a Kubernetes deployment

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 1 threats identified for this component.* | — | — | — | — |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T09.T1 | Tampering | The store enforces no schema, and `db.settings({ ignoreUndefinedProperties: true })` causes malformed fields to be dropped silently rather than rejected, so any field a callable forgets to validate is written verbatim. | Authenticated User | DF17 | Validate the full order shape server-side against the declared TypeScript types before writing. | Open |
| T09.R1 | Repudiation | No Firestore audit-log export, retention policy, or point-in-time recovery configuration is present in the repository, so document-level changes cannot be reconstructed after the fact. | Authenticated User | DF17 | Enable Firestore PITR and export Data Access audit logs to a retained sink. | Open |
| T09.I1 | Information Disclosure | Order documents hold customer names, project briefs, vendor costs, and margins in plaintext, and the whole document is returned to any caller who passes the coarse scope check in `listOrders`. | Authenticated User | DF17 | Split cost-bearing fields into a separately authorized subcollection rather than relying on response-time field stripping. | Open |
| T09.D1 | Denial of Service | Every `listOrders` call reads the entire `orders` collection, so read cost and latency grow linearly with history while clients poll every four seconds. | Authenticated User | DF17 | Add indexed, paginated queries scoped by role so the read set is bounded. | Open |
| T09.D2 | Denial of Service | `approvalHistory` is an unbounded array on the order document; every decision, withdrawal and resubmission appends an entry, driving the document toward Firestore's 1 MB ceiling, past which every write to that order fails permanently. | Authenticated User | DF17 | Move the trail to an `auditLog` subcollection so growth is not bounded by a single document, and cap comment length. | Open |
| T09.E1 | Elevation of Privilege | Direct client reads and writes to `orders`, `users`, and `counters` would let any signed-in user grant themselves a role. | Authenticated User | DF06 | `firestore.rules` sets `allow read, write: if false` on all three collections plus a catch-all deny, so no client path exists. | Mitigated |
| T09.A1 | Abuse | `counters/orders` is a single monotonically increasing document that is never reconciled against the collection, so repeated creation permanently consumes FA numbers and leaves visible gaps in the business sequence. | Authenticated User | DF17 | Rate-limit creation and reconcile the counter against the collection periodically. | Open |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T09.E2 | Elevation of Privilege | The functions' service account holds unrestricted project-wide Firestore access and the Admin SDK bypasses all security rules, so any defect in any one callable can read or write every collection — there is no per-collection or per-function scoping to contain a compromise. | CloudFunctions Compromise | DF17 | Run the callables under a service account granted only the collections they use, and split high-privilege operations into separately scoped functions. | Open |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Spoofing | All access arrives through the Admin SDK under a single service identity; there is no per-caller identity at the datastore layer to forge. |

---

## LocalStorage

**Trust Boundary:** Browser
**Role:** Per-UID browser storage holding the in-progress draft under `services_{uid}` and `orderMetadata_{uid}`.
**Data Flows:** DF12
**Pod Co-location:** N/A — not a Kubernetes deployment

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 1 threats identified for this component.* | — | — | — | — |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 2 threats identified for this component.* | — | — | — | — |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T10.T1 | Tampering | Draft content is parsed back into application state with no integrity check, so anything able to write the key — a local process, an extension, or injected script — controls the next request the user submits. | Host/OS Access | DF12 | Treat restored drafts as untrusted input and re-validate on load; the server already recomputes financial fields, so extend that to the metadata. | Open |
| T10.I1 | Information Disclosure | Company names, project briefs, cost per unit, sales buffers, and margins are stored in cleartext and are not removed at sign-out, so they remain readable to the next user of the machine. | Host/OS Access | DF12 | Clear both keys in the logout path and avoid persisting cost-bearing fields at all. | Open |
| T10.D1 | Denial of Service | Accumulated per-UID drafts can exhaust the origin's storage quota; the `setItem` calls in the persistence effects are unguarded, so the resulting exception breaks the render. | Host/OS Access | DF12 | Wrap writes in try/catch, cap draft size, and evict stale per-UID keys. | Open |
| T10.A1 | Abuse | Keys are namespaced per UID but never expired, so every account that has ever signed in on a shared workstation leaves a readable draft behind. | Host/OS Access | DF12 | Remove other users' keys on sign-in and clear the current user's on sign-out. | Open |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Spoofing | The store holds no credential or identity assertion — only draft business data. |
| Repudiation | No security-relevant action is recorded here that could be disputed. |
| Elevation of Privilege | Draft contents grant no privilege; all authorization is decided server-side from the caller's token. |

---

## LoginUser

**Trust Boundary:** Browser
**Role:** Pre-authentication email/password sign-in screen.
**Data Flows:** DF02, DF03
**Pod Co-location:** N/A — not a Kubernetes deployment

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T11.S1 | Spoofing | The form collects only an email address and a password and calls `signInWithEmailAndPassword` directly; there is no second factor, no device binding, and no step-up for approver accounts. | None | DF03 | Add multi-factor enrolment and a step-up challenge before approval actions. | Open |
| T11.I1 | Information Disclosure | A sign-in failure could reveal whether an address is registered. | None | DF02 | The catch block sets a single generic message, `"Invalid email or password."`, for every failure mode. | Mitigated |
| T11.D1 | Denial of Service | The form applies no client-side throttling or CAPTCHA, so automated attempts are limited only by the provider. | None | DF03 | Firebase Authentication applies per-IP and per-account throttling with CAPTCHA escalation. | Platform |
| T11.A1 | Abuse | The form accepts any email domain and the placeholder is the only indication that corporate identities are expected, so nothing prevents sign-in with an externally registered account. | None | DF02, DF03 | Enforce the corporate domain in a blocking authentication function rather than in UI copy. | Open |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 2 threats identified for this component.* | — | — | — | — |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T11.I2 | Information Disclosure | The visibility toggle switches the password input to `type="text"`, rendering the live credential as readable DOM text — visible to shoulder surfing, screen sharing, screen recording, and any browser extension with DOM access. | Host/OS Access | DF02 | Keep the reveal but auto-revert after a short timeout, and exclude the field from screen capture where the platform supports it. | Open |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Tampering | The screen holds no state beyond the two controlled inputs it forwards to the SDK. |
| Repudiation | Sign-in attribution is recorded by Firebase Authentication, not by this component. |
| Elevation of Privilege | The screen grants no role; the role is resolved afterwards by AuthProvider from the server. |

---

## MainPage

**Trust Boundary:** Browser
**Role:** Request list, statistics, and version-history screen.
**Data Flows:** DF08
**Pod Co-location:** N/A — not a Kubernetes deployment

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 1 threats identified for this component.* | — | — | — | — |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T12.I1 | Information Disclosure | The screen renders a `Created By` column and expands the full version history for every non-Requester role, so any over-broad scope returned by `listOrders` is surfaced directly to the user. | Authenticated User | DF08 | Fix the server scope; the client should never be the control that limits what is shown. | Open |
| T12.E1 | Elevation of Privilege | The delete control is rendered on a `role === "admin"` client check. | Authenticated User | DF08 | `deleteOrder` repeats the admin check server-side from the resolved profile. | Mitigated |
| T12.A1 | Abuse | The duplicate control copies any order visible in the list — including one created by another user — into the current draft, carrying its company, project, and pricing data forward. | Authenticated User | DF08 | Restrict duplication to orders the caller created, and enforce it in `createOrder`. | Open |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 3 threats identified for this component.* | — | — | — | — |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Spoofing | The screen asserts no identity; it renders whatever the authenticated `listOrders` call returned. |
| Tampering | It is read-only over the order list and mutates no server state directly. |
| Repudiation | It performs no recordable action of its own; deletion is recorded, or not, by the callable. |
| Denial of Service | Rendering cost is bounded by the result set the server already chose to return. |

---

## MigrateHeadOfCommercial

**Trust Boundary:** OperatorWorkstation
**Role:** Operator-run Admin SDK script that rewrites authority labels across every order document.
**Data Flows:** DF19, DF21
**Pod Co-location:** N/A — not a Kubernetes deployment

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 1 threats identified for this component.* | — | — | — | — |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 2 threats identified for this component.* | — | — | — | — |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T13.T1 | Tampering | The script reads every document in `orders` and writes back a rewritten `services` array with no dry-run mode, no backup, no confirmation prompt, and no scoping to affected documents. | Admin Credentials | DF21 | Add a dry-run flag that is the default, take an export first, and query only documents matching the old values. | Open |
| T13.R1 | Repudiation | Rewritten fields carry no marker distinguishing a migration write from a user edit, and `console.log` output is the only record that the run happened. | Admin Credentials | DF21 | Stamp a migration id and timestamp on each touched document and write a run record to the audit collection. | Open |
| T13.D1 | Denial of Service | The loop performs a sequential `await doc.ref.update()` per document over the whole collection, consuming write quota and contending with live traffic as the collection grows. | Admin Credentials | DF21 | Use batched writes with a bounded concurrency and run during a maintenance window. | Open |
| T13.E1 | Elevation of Privilege | `admin.initializeApp()` picks up Application Default Credentials, which on an operator workstation typically carry project-owner scope — far beyond the two fields the script edits. | Admin Credentials | DF19, DF21 | Run the migration under a dedicated service account limited to the `orders` collection. | Open |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Spoofing | The script runs under a single credential with no identity assertion to forge. |
| Information Disclosure | It reads and writes documents in place and emits only order ids and numbers to the console. |
| Abuse | It exposes no business workflow — it is a one-shot maintenance job with a fixed value mapping. |

---

## OrderDetails

**Trust Boundary:** Browser
**Role:** Request detail, approval decision, submit, and withdraw screen.
**Data Flows:** DF11, DF14
**Pod Co-location:** N/A — not a Kubernetes deployment

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 1 threats identified for this component.* | — | — | — | — |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T14.T1 | Tampering | The module imports `doc` and `updateDoc` from the Firestore SDK, leaving a direct client write path one line away from being reintroduced alongside the callable-based flow. | Authenticated User | DF14 | `firestore.rules` denies all client writes, so the import is currently inert; remove the unused imports to keep it that way. | Mitigated |
| T14.R1 | Repudiation | The Approval Audit Log rendered here is the in-document `approvalHistory`, which `submitForApproval` clears on every resubmission — while the withdraw dialog tells the user that earlier approvals "will remain on record". | Authenticated User | DF14 | Make the server honour the promise: preserve history across withdrawal and resubmission in an append-only store. | Open |
| T14.I1 | Information Disclosure | The Financial Analysis cards and costing columns are gated on the client-side `role` value, while the server returns the underlying figures to every non-viewer role regardless of what the UI chooses to render. | Authenticated User | DF11 | Project the response per role on the server so the client never receives figures it must not show. | Open |
| T14.E1 | Elevation of Privilege | `isAuthorizedApprover` decides whether the Approve and Reject controls render, including the Rank 4 department match. | Authenticated User | DF14 | `approveOrder` and `rejectOrder` repeat the rank and department checks server-side and fail closed on a missing department. | Mitigated |
| T14.A1 | Abuse | The creator's Withdraw & Edit control pulls a request that has already collected approvals back to Draft; resubmitting restarts the chain at Rank 4 with the prior decisions discarded. | Authenticated User | DF14 | Preserve and display prior decisions across withdrawal, and notify approvers who had already signed off. | Open |
| T14.A2 | Abuse | The order to display is chosen from the `id` query-string parameter, which a user can set to any document id. | Authenticated User | DF11 | The lookup is `orders.find(o => o.id === orderId)` over the already-authorized `listOrders` result, so an out-of-scope id simply renders "Order not found". | Mitigated |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 3 threats identified for this component.* | — | — | — | — |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Spoofing | Decisions are attributed server-side from the verified token's email claim, not from anything this screen sends. |
| Denial of Service | Every action is a single user-initiated callable invocation with no unbounded client-side work. |

---

## SummaryReport

**Trust Boundary:** Browser
**Role:** Costing and pricing summary screen; assembles the order object and confirms it.
**Data Flows:** DF10
**Pod Co-location:** N/A — not a Kubernetes deployment

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 1 threats identified for this component.* | — | — | — | — |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T15.T1 | Tampering | The screen builds the full order object client-side, including `id`, `version`, `createdAt`, and every financing figure, and hands it to `createOrder`. | Authenticated User | DF10 | The server recomputes all financial fields and the authority rank, but accepts `version` and `createdAt` as sent — those two must also be server-owned. | Open |
| T15.T2 | Tampering | When no order number is set, the screen derives `newOrderNumber` by scanning the locally visible orders for the highest `FA-NNNN`, so the client proposes the business identifier. | Authenticated User | DF10 | The server overrides it only when `isNew` is true; make the counter transaction the sole source of order numbers on every path. | Open |
| T15.T3 | Tampering | The effect that loads an existing order into `metadata` rebuilds the object field by field and omits `attachments`, so opening an order for edit drops its attachments; re-confirming then persists a new version with none. | Authenticated User | DF10 | Carry `attachments` through the reload, and have `createOrder` refuse to drop attachments present on the version being superseded. | Open |
| T15.I1 | Information Disclosure | The screen renders complete costing, margin, and commission tables. | Authenticated User | DF10 | The `BlockViewer` guard keeps viewers off the route and the server's viewer projection strips the underlying cost fields, so a bypassed guard yields no cost data. | Mitigated |
| T15.A1 | Abuse | Re-confirming an existing order always writes a new document with `version + 1` rather than updating, so history grows without bound and the client-chosen version determines which document the UI treats as current. | Authenticated User | DF10 | Derive `version` server-side from the existing documents for that order number. | Open |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 3 threats identified for this component.* | — | — | — | — |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Spoofing | `createdBy` is stamped server-side from the verified token; nothing this screen sends influences attribution. |
| Repudiation | Confirmation is recorded, or not, by `createOrder`; the screen itself writes no record. |
| Denial of Service | Summary computation is bounded by the number of line items the user entered. |
| Elevation of Privilege | The screen grants no privilege; `createOrder` independently requires the Requester role. |
