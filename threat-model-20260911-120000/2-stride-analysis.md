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
| AppRoutes | [Link](#approutes) | 0 | 1 | 0 | 1 | 2 | 1 | 1 | 6 | 0 | 6 | 0 | Medium |
| AuthProvider | [Link](#authprovider) | 1 | 1 | 0 | 2 | 1 | 1 | 0 | 6 | 1 | 5 | 0 | Medium |
| LoginUser | [Link](#loginuser) | 1 | 1 | 0 | 1 | 1 | 0 | 1 | 5 | 4 | 0 | 1 | Medium |
| FirebaseClient | [Link](#firebaseclient) | 0 | 1 | 0 | 3 | 0 | 1 | 0 | 5 | 3 | 1 | 1 | Medium |
| MainPage | [Link](#mainpage) | 0 | 0 | 0 | 2 | 0 | 1 | 1 | 4 | 0 | 4 | 0 | Low |
| Dashboard | [Link](#dashboard) | 0 | 2 | 0 | 1 | 1 | 1 | 1 | 6 | 0 | 6 | 0 | Medium |
| SummaryReport | [Link](#summaryreport) | 0 | 3 | 0 | 1 | 0 | 1 | 2 | 7 | 0 | 7 | 0 | High |
| OrderDetails | [Link](#orderdetails) | 0 | 1 | 0 | 3 | 0 | 1 | 2 | 7 | 0 | 7 | 0 | Medium |
| LocalStorage | [Link](#localstorage) | 0 | 1 | 1 | 1 | 1 | 0 | 0 | 4 | 0 | 0 | 4 | Medium |
| FirebaseHosting | [Link](#firebasehosting) | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 7 | 6 | 1 | 0 | Medium |
| CloudFunctions | [Link](#cloudfunctions) | 3 | 3 | 3 | 3 | 3 | 4 | 3 | 22 | 2 | 20 | 0 | Critical |
| Firestore | [Link](#firestore) | 0 | 1 | 1 | 2 | 2 | 1 | 0 | 7 | 0 | 0 | 7 | Medium |
| FirebaseStorage | [Link](#firebasestorage) | 1 | 1 | 1 | 2 | 1 | 1 | 2 | 9 | 1 | 8 | 0 | High |
| FirebaseAuth | [Link](#firebaseauth) | 2 | 1 | 1 | 1 | 1 | 1 | 1 | 8 | 7 | 1 | 0 | Medium |
| MigrateHeadOfCommercial | [Link](#migrateheadofcommercial) | 0 | 2 | 1 | 1 | 1 | 1 | 0 | 6 | 0 | 0 | 6 | Medium |
| **Totals** | | **9** | **20** | **9** | **25** | **15** | **16** | **15** | **109** | **24** | **66** | **19** | |

---

## AppRoutes

**Trust Boundary:** Browser
**Role:** Root router and application shell; owns the `RequireAuth`, `RequireUser`, and `BlockViewer` guards, per-UID draft state, and the create/delete/list order callable invocations.
**Data Flows:** DF08, DF12, DF13
**Pod Co-location:** N/A — not a Kubernetes deployment.

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 1 threats identified.* | — | — | — | — |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T01.T | Tampering | Draft state is rehydrated from `localStorage` with no schema or range validation (`src/App.tsx:88-89`); a modified entry injects arbitrary service objects — negative costs, oversized numbers, extra fields — directly into the order-creation path. | Authenticated User | DF12 | Validate the parsed draft against the `Service`/`OrderMetadata` shape before use, and re-validate server-side in `createOrder`. | Open |
| T01.I | Information Disclosure | `handleDeleteOrder` surfaces the raw server error string in a toast (`src/App.tsx:193-196`), exposing internal failure detail to the end user. | Authenticated User | DF13 | Map `HttpsError` codes to fixed user-facing strings and log the detail only to the console. | Open |
| T01.D1 | Denial of Service | The services draft is parsed with a bare `JSON.parse` and no `try`/`catch` (`src/App.tsx:88-89`), unlike the metadata parse immediately below it which is guarded; malformed stored JSON throws inside the effect and blanks the application. | Authenticated User | DF12 | Wrap the services parse in `try`/`catch` and fall back to an empty draft, matching the metadata path. | Open |
| T01.D2 | Denial of Service | Every open tab polls `listOrders` on a fixed 4-second interval with no backoff, jitter, or pause on error or tab blur (`src/hooks/useFirestoreOrders.ts:13,45`), multiplying backend load by the number of open sessions. | Authenticated User | DF13 | Add exponential backoff on failure, pause polling when the document is hidden, and prefer a change-driven subscription over fixed polling. | Open |
| T01.E | Elevation of Privilege | `RequireUser` and `BlockViewer` decide access from the React `role` state (`src/App.tsx:35-64`); editing that state in browser devtools renders the `/manage` and `/report` screens to any signed-in user. | Authenticated User | DF13 | `createOrder` independently rejects any caller whose server-resolved role is not `user` (`functions/src/index.ts:370-374`), so the guard bypass yields UI access only, not a privileged write. | Mitigated |
| T01.A | Abuse | `handleDuplicateOrder` (`src/App.tsx:144-185`) copies every field of any order in the caller's visible set into a fresh draft, letting a requester harvest another team's pricing structure wholesale through repeated duplication. | Authenticated User | DF13 | Restrict duplication to orders the caller created, or strip cost and margin fields from the duplicated draft. | Open |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 3 threats identified.* | — | — | — | — |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Spoofing | The router asserts no identity of its own; every identity decision is delegated to AuthProvider and re-verified server-side. |
| Repudiation | No security-relevant action is recorded here; auditing is the responsibility of the CloudFunctions layer. |

---

## AuthProvider

**Trust Boundary:** Browser
**Role:** React context that resolves the signed-in user's role, department, and display name through the `getMyProfile` callable, with a direct-Firestore fallback path.
**Data Flows:** DF04, DF05, DF06
**Pod Co-location:** N/A — not a Kubernetes deployment.

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T02.I1 | Information Disclosure | The public bundle contains the complete role-resolution algorithm, including the `getDepartmentFromEmail` substring table and the `email.includes("rank4")` heuristic (`src/context/AuthContext.tsx:33-45,99-101`), handing an unauthenticated attacker a map of the privilege model and the exact address patterns that map to elevated roles. | None | DF05 | Move all role and department derivation server-side and return only the resolved values; never ship the mapping rules to the client. | Open |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T02.S | Spoofing | Role state held in `actualRole` is authoritative for every UI decision; overwriting it in React DevTools lets a signed-in user present as `admin` or any rank for the remainder of the session. | Authenticated User | DF05 | Every privileged callable re-derives the caller's role from Firestore via `getCallerProfile` and ignores anything the client asserts (`functions/src/index.ts:33-46`). | Mitigated |
| T02.T | Tampering | `updateDepartment` writes the new department into local state before the callable returns and only logs a failure (`src/context/AuthContext.tsx:131-140`), so the UI can display a department the server never accepted. | Authenticated User | DF05 | Apply the local state change only after the callable resolves, and surface a toast on failure. | Open |
| T02.I2 | Information Disclosure | The resolved role is written to the browser console on every sign-in (`src/context/AuthContext.tsx:64`), where it persists in exported console logs and third-party error-reporting captures. | Authenticated User | DF05 | Remove the role from production logging or gate it behind a development-only flag. | Open |
| T02.D | Denial of Service | `setLoading(false)` runs only after `getMyProfile` settles and, on failure, after two further Firestore round-trips (`src/context/AuthContext.tsx:55-121`); a slow or erroring callable holds every route on the "Loading…" splash for the full duration. | Authenticated User | DF05 | Apply a client-side timeout to the profile call and render with a least-privilege default while it is in flight. | Open |
| T02.E | Elevation of Privilege | The Firestore fallback branch still contains the client-side `email.includes("rank4")` promotion (`src/context/AuthContext.tsx:99-101`); it is unreachable today only because `firestore.rules` denies the read, so any future relaxation of those rules silently re-enables client-assigned rank. | Authenticated User | DF06 | Delete the fallback branch entirely now that `getMyProfile` is the supported path, rather than relying on the rules to keep it dead. | Open |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 3 threats identified.* | — | — | — | — |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Repudiation | Authentication events are recorded by Firebase Authentication rather than by this component. |
| Abuse | The provider exposes no business workflow that can be misused; it only resolves identity attributes. |

---

## LoginUser

**Trust Boundary:** Browser
**Role:** Email and password sign-in screen; the unauthenticated entry point to the application.
**Data Flows:** DF02, DF03
**Pod Co-location:** N/A — not a Kubernetes deployment.

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T03.S | Spoofing | The form applies no attempt counter, lockout, backoff, or CAPTCHA (`src/pages/LoginUser.tsx:19-34`); credential stuffing against known staff addresses is bounded only by Firebase's default quotas. | None | DF03 | Add a client-side attempt counter with progressive delay, and enable Firebase App Check plus reCAPTCHA Enterprise on the sign-in path. | Open |
| T03.I | Information Disclosure | A single generic message, "Invalid email or password.", is shown for every failure mode (`src/pages/LoginUser.tsx:29-31`), so the UI does not reveal whether an address is registered. | None | DF03 | The catch block discards the Firebase error code and renders one fixed string, closing the UI-level account-enumeration channel. | Mitigated |
| T03.D | Denial of Service | Repeated failed sign-ins against a known staff address trip Firebase's per-account throttling, locking the legitimate owner out of the approval portal. | None | DF03 | Enable email-enumeration protection and monitor Identity Toolkit quota events so targeted lockouts are detected. | Open |
| T03.A | Abuse | Nothing in the form, the routing, or any configuration file in the repository restricts sign-in to the corporate email domain, so any address provisioned in the Firebase project reaches the portal. | None | DF03 | Enforce a domain allow-list in a blocking Authentication function and reject non-corporate addresses at sign-in. | Open |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 2 threats identified.* | — | — | — | — |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T03.T | Tampering | The password is held in component state and can be rendered as plaintext by the visibility toggle (`src/pages/LoginUser.tsx:79,87-94`); a malicious browser extension or an onlooker can capture it from the DOM. | Host/OS Access | DF02 | Auto-revert the visibility toggle after a short interval and document the extension-hardening expectation for managed workstations. | Open |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Repudiation | Sign-in successes and failures are recorded by Firebase Authentication, not by this screen. |
| Elevation of Privilege | The screen grants no privilege itself; all authorization derives from the ID token that FirebaseAuth issues afterwards. |

---

## FirebaseClient

**Trust Boundary:** Browser
**Role:** Firebase SDK initialization module holding the build-injected web configuration and the shared Firestore error handler.
**Data Flows:** DF07
**Pod Co-location:** N/A — not a Kubernetes deployment.

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T04.I1 | Information Disclosure | `vite.config.ts:53` injects `GEMINI_API_KEY` into the bundle through Vite's `define`, so whatever value is present in the build environment is published verbatim to every visitor. The key is empty in the current `.env` and `@google/genai` is unused in `src/`, so nothing leaks today — but the build pipeline will publish a real key the moment one is configured. | None | DF01 | Remove the `GEMINI_API_KEY` define and the unused `@google/genai` dependency; if Gemini is adopted later, proxy the call through a Cloud Function so the key stays server-side. | Open |
| T04.I2 | Information Disclosure | `handleFirestoreError` serialises the caller's UID, email, verification state, tenant, and every linked provider identity into both a `console.error` and the message of the `Error` it throws (`src/firebase.ts:54-73`). It is imported in three modules but never invoked, so it is currently dormant code shipped in the bundle. | None | DF01 | Delete the helper and its imports, or reduce it to an opaque error code with the identity detail dropped. | Open |
| T04.I3 | Information Disclosure | The Firebase web configuration — API key, auth domain, project id, bucket, sender id, app id — is embedded in the public bundle (`src/firebase.ts:10-17`). | None | DF01 | This is the documented, intended design for Firebase web apps: the "API key" is a project identifier rather than a credential, and access is governed by Firebase Authentication plus the security rules in `firestore.rules` and `storage.rules`. No action required. | Mitigated |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T04.E | Elevation of Privilege | `getFirestore(app, process.env.FIREBASE_DATABASE_ID)` selects the database from a build-injected id and falls back to `(default)` when it is unset (`src/firebase.ts:22-24`). `.env` does not define `FIREBASE_DATABASE_ID`, while `firebase.json:3` deploys `firestore.rules` to the named database `ai-studio-remixremixservic-d5598bb1-8a51-4e0b-bbad-dc118e2c4552`, so the browser connects to a database the deny-all rules were never applied to. Console verification confirmed that `(default)` retains permissive legacy rules, so direct client reads and writes to `orders`, `users`, and `counters` succeed and bypass the entire Cloud Functions authorization layer. | Authenticated User | DF06 | **Fixed and verified.** `firebase.json` now uses a multi-database `firestore` array and the deny-all rules have been deployed to `(default)` as well as the named database; console verification confirmed the ruleset, and the application continues to resolve roles and list orders through the Cloud Functions layer. See FIND-17. | Mitigated |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T04.T | Tampering | `vite.config.ts:10-19` reads `firebase-applet-config.json` from the project root at build time when the file exists and merges it into the emitted configuration; a file dropped into the build workspace silently repoints the deployed application at an attacker-controlled Firebase project. | Host/OS Access | DF07 | Remove the implicit file-based config path or require an explicit opt-in flag, and pin build configuration to reviewed environment variables. | Open |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Spoofing | The module creates SDK handles and asserts no identity of its own. |
| Repudiation | SDK initialization performs no auditable action. |
| Denial of Service | Initialization is a one-time, bounded operation whose failure affects only the calling session. |
| Abuse | No business feature is exposed by SDK initialization. |

---

## MainPage

**Trust Boundary:** Browser
**Role:** Portal landing page listing FA requests with role-conditional action controls and aggregate status counters.
**Data Flows:** DF08
**Pod Co-location:** N/A — not a Kubernetes deployment.

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 1 threats identified.* | — | — | — | — |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T05.I1 | Information Disclosure | The "Created By" column renders the requester's email address to every non-`user` role (`src/pages/MainPage.tsx:181,287`), distributing an internal staff directory to viewers and every approver rank. | Authenticated User | DF08 | Render a display name resolved server-side instead of the raw address, or restrict the column to `admin`. | Open |
| T05.I2 | Information Disclosure | The summary tiles sum `totalRevenue` across every order in the caller's visible set (`src/pages/MainPage.tsx:143`), giving viewers and rank holders a portfolio-level revenue figure that exceeds the per-record access they need. | Authenticated User | DF08 | Compute aggregates server-side and return them only to roles entitled to portfolio totals. | Open |
| T05.E | Elevation of Privilege | The delete control is rendered on a client-side `role === "admin"` test (`src/pages/MainPage.tsx:274`), which any signed-in user can satisfy by editing React state. | Authenticated User | DF13 | `deleteOrder` re-resolves the caller's role server-side and rejects non-admins before touching Firestore (`functions/src/index.ts:414-418`), so revealing the button does not enable the deletion. | Mitigated |
| T05.A | Abuse | The list is delivered in full on every 4-second poll with no server-side pagination or result cap, so any authenticated user can script a complete export of every order in their scope from the network responses. | Authenticated User | DF13 | Paginate `listOrders` server-side, cap page size, and rate-limit repeated full-scope requests per caller. | Open |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 3 threats identified.* | — | — | — | — |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Spoofing | The page asserts no identity; it renders records already scoped by `listOrders`. |
| Tampering | The view is read-only — every mutation is delegated to a callable that re-validates state server-side. |
| Repudiation | No auditable action originates on this page. |
| Denial of Service | Rendering cost is bounded by the caller's own result set and degrades only their session. |

---

## Dashboard

**Trust Boundary:** Browser
**Role:** Data-entry screen for service line items and order metadata; performs direct browser-to-Cloud-Storage attachment uploads.
**Data Flows:** DF09, DF15
**Pod Co-location:** N/A — not a Kubernetes deployment.

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 1 threats identified.* | — | — | — | — |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T06.T1 | Tampering | The only content validation the application performs is the client-side `file.type` check (`src/pages/Dashboard.tsx:58-66`); `storage.rules` then validates `request.resource.contentType`, which the same client supplies, so arbitrary bytes can be stored under an `application/pdf` label. | Authenticated User | DF15 | Validate file content server-side — a Storage-triggered function that inspects magic bytes and quarantines mismatches — rather than trusting the declared type. | Open |
| T06.T2 | Tampering | The client enforces a single 100 MB cap for both formats (`src/pages/Dashboard.tsx:68-72`) while `storage.rules` caps PDFs at 5 MB, so a 5–100 MB PDF passes local validation and is then rejected at the rules layer with only a generic "Failed to upload" toast. | Authenticated User | DF15 | Align the client limits with the rules — 5 MB for PDF, 100 MB for Excel — and surface the specific reason on rejection. | Open |
| T06.I | Information Disclosure | `getDownloadURL()` mints a long-lived, unauthenticated download token (`src/pages/Dashboard.tsx:93`) that is then persisted into the order document and rendered as a link wherever the order is shown. | Authenticated User | DF15 | Store only the object path and mint a short-lived signed URL through a callable at view time, so access is re-authorized per request. | Open |
| T06.D | Denial of Service | An authenticated requester can upload 100 MB Excel objects repeatedly with no per-user quota, no object count limit, and no lifecycle rule reclaiming abandoned drafts (`src/pages/Dashboard.tsx:68`; `storage.rules`). | Authenticated User | DF15 | Apply a per-user object and byte quota enforced by a Storage trigger, and add a lifecycle rule expiring unreferenced draft attachments. | Open |
| T06.E | Elevation of Privilege | The `/manage` route is reachable only through the client-side `RequireUser` guard, which is bypassable from devtools. | Authenticated User | DF09 | `createOrder` independently rejects any caller whose server-resolved role is not `user` (`functions/src/index.ts:370-374`), so reaching the screen does not permit a privileged write. | Mitigated |
| T06.A | Abuse | `handleRemoveAttachment` removes the attachment from local metadata even when `deleteObject` rejects (`src/pages/Dashboard.tsx:111-119`), leaving an orphaned object that is still reachable through its tokenized URL but no longer tracked by the application. | Authenticated User | DF15 | Remove the local reference only after the delete succeeds, and reconcile orphaned objects with a scheduled sweep. | Open |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 3 threats identified.* | — | — | — | — |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Spoofing | Uploads are attributed by `request.auth.uid` inside both the object path and the storage rule, not by any client-asserted identity. |
| Repudiation | Upload and delete activity is recorded in Cloud Storage's own access logs rather than by this component. |

---

## SummaryReport

**Trust Boundary:** Browser
**Role:** Combined summary and margin computation screen; builds the order object that is persisted and gates finance-only panels by role.
**Data Flows:** DF10
**Pod Co-location:** N/A — not a Kubernetes deployment.

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 1 threats identified.* | — | — | — | — |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T07.T1 | Tampering | Every financial figure persisted with the order — `totalRevenue`, `totalCost`, per-service `tcv`, `totalSST`, and all margin percentages — is computed in the browser (`src/pages/SummaryReport.tsx:202-290,313-328`) and stored by `createOrder` without recomputation, so an approver's decision rests on numbers the requester controls. | Authenticated User | DF13 | **Fixed and verified.** `createOrder` recomputes `totalRevenue`, `totalCost`, every per-service monetary field, and the six financing metadata fields (`option`, `totalUpfrontPayment`, `totalOneTimeChargeB2S`, `totalFinancingRequest`, `contractPeriod`, `financingLease`) from the raw line items. Confirmed across two test passes against the deployed function. See FIND-56. | Resolved |
| T07.T2 | Tampering | `finalDecisionAuthorityRank` is derived client-side from the service authority levels (`src/pages/SummaryReport.tsx:119-149`) and stored verbatim; `approveOrder` later reads it to decide where the chain terminates (`functions/src/index.ts:158,199-210`), so a tampered value collapses a four-stage approval into a single Rank 4 sign-off. | Authenticated User | DF13 | **Fixed and verified against the deployed callable.** `createOrder` recomputes each line item's Level of Authority from its raw pricing inputs and derives the order-level rank from the results, discarding the client's value; a payload forging `Rank 4` throughout was confirmed to store `Rank 1`, with per-service ranks diverging correctly. See FIND-16. | Mitigated |
| T07.T3 | Tampering | `createdAt` is taken from `Date.now()` in the browser and `version` from the client's own increment (`src/pages/SummaryReport.tsx:315-321`); `listOrders` sorts on `createdAt` (`functions/src/index.ts:88`), so a forged timestamp reorders or hides a request in every approver's queue. | Authenticated User | DF13 | Stamp `createdAt` with `FieldValue.serverTimestamp()` and compute `version` server-side from the existing documents for that order number. | Open |
| T07.I | Information Disclosure | The commission, EBITDA, and net-margin panel is hidden behind a client-side `role === "admin" \|\| role === "rank1"` test (`src/pages/SummaryReport.tsx:1078`), but the cost fields backing those figures are present in the `listOrders` payload for every non-`viewer` role, so a Rank 2, 3, or 4 approver can read them straight from the network response. | Authenticated User | DF13 | Extend the server-side field stripping in `stripForViewer` into a per-role projection so commission-grade fields are never sent to roles that may not see them. | Open |
| T07.E | Elevation of Privilege | The `/report` route is wrapped in the client-side `BlockViewer` guard, which a signed-in viewer can bypass from devtools (`src/App.tsx:224`). | Authenticated User | DF10 | `stripForViewer` independently removes `totalCost`, `costPerUnit`, `totalSST`, and `salesBuffer` from every viewer response server-side (`functions/src/index.ts:48-59,125-127`), so bypassing the guard reveals no cost data. | Mitigated |
| T07.A1 | Abuse | `handleConfirm` writes a new document with a fresh `crypto.randomUUID()` on every confirmation (`src/pages/SummaryReport.tsx:313-315`), and no server-side cap limits how many versions may share an order number, so repeated edits inflate the collection that `listOrders` scans on every poll. | Authenticated User | DF13 | Cap versions per order number server-side and reject further writes beyond a reasonable limit. | Open |
| T07.A2 | Abuse | When an existing order is edited the client supplies `orderNumber` and calls `createOrder` with `isNew: false`, which skips counter allocation and stores whatever number was sent (`functions/src/index.ts:365,379-391`), letting a requester graft a new document onto another order's version history. | Authenticated User | DF13 | Derive `orderNumber` server-side from the order being edited and verify the caller created that order, rather than accepting it from the request. | Open |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 3 threats identified.* | — | — | — | — |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Spoofing | The component asserts no identity; `createdBy` is stamped from the verified token inside `createOrder`. |
| Repudiation | Order creation produces no audit entry from this component; that gap is recorded against CloudFunctions. |
| Denial of Service | The margin computations are bounded by the caller's own draft and degrade only their session. |

---

## OrderDetails

**Trust Boundary:** Browser
**Role:** Request detail view; invokes the submit, withdraw, approve, and reject callables and renders the approval audit log.
**Data Flows:** DF11, DF14, DF16
**Pod Co-location:** N/A — not a Kubernetes deployment.

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 1 threats identified.* | — | — | — | — |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T08.I1 | Information Disclosure | Attachment links render the stored tokenized Storage URL directly into `href` (`src/pages/OrderDetails.tsx:452-456`), so anyone the link is forwarded to — inside or outside the company — retrieves the file with no session. | Authenticated User | DF16 | Replace the persisted download URL with a callable that re-authorizes the caller and returns a short-lived signed URL. | Open |
| T08.I2 | Information Disclosure | The sales-commission card is gated by a client-side `role === "admin" \|\| role === "rank1"` test (`src/pages/OrderDetails.tsx:560`) while the cost fields it derives from are delivered to every non-`viewer` role in the same payload. | Authenticated User | DF13 | Apply the same per-role server-side projection recommended for SummaryReport so commission inputs never reach ineligible roles. | Open |
| T08.I3 | Information Disclosure | The approval audit log renders each approver's email address and free-text comment to everyone who can see the order (`src/pages/OrderDetails.tsx:786-817`), so an internal negotiating position recorded in a comment is visible to the requester. | Authenticated User | DF14 | Show a resolved display name instead of the address, and consider restricting comment visibility to the approval chain. | Open |
| T08.A1 | Abuse | `handleWithdrawFromReview` (`src/pages/OrderDetails.tsx:125-141`) lets the creator pull an order out of review after partial approvals, and `withdrawFromReview` applies no limit, so a requester can repeatedly withdraw immediately before an unfavourable decision and resubmit until a different approver is on duty. | Authenticated User | DF11, DF14 | Record every withdrawal in `approvalHistory`, cap the number of withdrawal cycles, and require a reason. | Open |
| T08.A2 | Abuse | Approval and rejection require a comment on both sides (`src/pages/OrderDetails.tsx:72-75,98-101`; `functions/src/index.ts:143-145,232-234`) but neither bounds its length, so an approver can append megabyte-scale comments to the `approvalHistory` array inside the order document. | Authenticated User | DF14 | Enforce a maximum comment length server-side and reject oversized payloads before the update. | Open |
| T08.T | Tampering | The component sends only `orderId` and `comment` to the workflow callables; it cannot dictate the resulting status or rank. | Authenticated User | DF14 | `approveOrder` and `rejectOrder` re-read the order from Firestore and compute the transition entirely server-side from that fresh state (`functions/src/index.ts:147-216`). | Mitigated |
| T08.E | Elevation of Privilege | The approve and reject controls are rendered from client-side role state, which a signed-in user can edit. | Authenticated User | DF14 | Every workflow callable re-resolves the caller's role, verifies rank against `currentApprovalRank`, checks the Rank 4 department, and enforces creator ownership for submit and withdraw (`functions/src/index.ts:133-356`). | Mitigated |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 3 threats identified.* | — | — | — | — |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Spoofing | The approver identity written into `approvalHistory` comes from the verified ID token, never from the request body. |
| Repudiation | Approve and reject are audited server-side; the gaps covering other actions are recorded against CloudFunctions. |
| Denial of Service | The view operates on a single order already delivered to the client and degrades only that session. |

---

## LocalStorage

**Trust Boundary:** Browser
**Role:** Browser HTML5 local storage holding per-UID in-progress draft services and order metadata, including cost and margin fields.
**Data Flows:** DF12
**Pod Co-location:** N/A — not a Kubernetes deployment.

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 1 threats identified.* | — | — | — | — |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 2 threats identified.* | — | — | — | — |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T09.I | Information Disclosure | Draft services and metadata — vendor cost per unit, sales buffer, customer name, project brief — are written to `localStorage` in plaintext (`src/App.tsx:111-121`) and are never cleared on sign-out, because `logout` calls only `signOut` (`src/context/AuthContext.tsx:127-129`). On a shared or re-imaged workstation the next occupant reads the previous user's commercial data from devtools. | Host/OS Access | DF12 | Clear the `services_*` and `orderMetadata_*` keys on sign-out, and move in-progress drafts to a server-side draft document instead of browser storage. | Open |
| T09.T | Tampering | Nothing validates the shape or ranges of a stored draft when it is read back (`src/App.tsx:88-89`), so a modified entry injects arbitrary service objects straight into the order-creation path. | Host/OS Access | DF12 | Validate the parsed draft against the declared types before use and re-validate every field server-side in `createOrder`. | Open |
| T09.R | Repudiation | Drafts carry no author, timestamp, or integrity marker, so once a modified draft is submitted there is no way to distinguish it from one the application itself produced. | Host/OS Access | DF12 | Persist drafts server-side with a server timestamp and owner so that submitted content has a verifiable provenance. | Open |
| T09.D | Denial of Service | `setItem` is called unguarded on every services and metadata change (`src/App.tsx:111-121`); a draft that exceeds the origin's storage quota throws `QuotaExceededError` inside the effect and breaks the screen with no recovery path. | Host/OS Access | DF12 | Wrap both writes in `try`/`catch`, surface a clear message when the quota is hit, and cap the number of line items per draft. | Open |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Spoofing | Storage keys are namespaced by UID but assert no identity; the browser origin is the only access control. |
| Elevation of Privilege | Local storage grants no application privilege — role resolution happens server-side on every privileged call. |
| Abuse | The store holds only the caller's own in-progress draft and exposes no shared workflow that could be misused. |

---

## FirebaseHosting

**Trust Boundary:** FirebaseBackend
**Role:** Firebase Hosting site serving the compiled SPA bundle and rewriting all paths to `/index.html`.
**Data Flows:** DF01, DF20
**Pod Co-location:** N/A — not a Kubernetes deployment.

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T10.T | Tampering | `firebase.json` defines no `headers` block, so responses carry no `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, or `Referrer-Policy`; the approval portal can be framed for clickjacking and any injected script executes without restriction. | None | DF01 | Add a `headers` block to `firebase.json` setting a strict CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and HSTS. | Open |
| T10.I | Information Disclosure | The catch-all rewrite serves the complete bundle to unauthenticated clients (`firebase.json:16-21`), exposing route structure, role names, callable function names, and the field-stripping logic to anyone who fetches the site. | None | DF01 | Accept the bundle's public nature but remove privilege logic and identifying heuristics from it, keeping authorization decisions server-side. | Open |
| T10.R | Repudiation | Deployments are performed manually with the Firebase CLI and there is no pipeline, approval gate, or record tying a deployed bundle to a source commit — the repository contains no CI/CD configuration at all. | None | DF20 | Introduce a CI/CD pipeline that builds from a tagged commit, records the deployment, and restricts who may release. | Open |
| T10.S | Spoofing | The site is served from a Firebase-managed domain over a Google-issued certificate with HTTPS enforced. | None | DF01 | Certificate issuance, renewal, and TLS termination are managed by Firebase Hosting and cannot be weakened from this repository. | Platform |
| T10.D | Denial of Service | A volumetric request flood against the static site would exhaust origin capacity. | None | DF01 | Firebase Hosting serves the bundle from Google's global CDN, which absorbs volumetric floods for static assets. | Platform |
| T10.E | Elevation of Privilege | A misconfigured rewrite could expose server-side paths or a directory listing. | None | DF01 | The single `"source": "**"` rewrite returns `index.html` for every unmatched path (`firebase.json:16-21`), so no server-side route is reachable and no listing is produced. | Mitigated |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T10.A | Abuse | The `dev` script binds Vite to `--host=0.0.0.0` (`package.json:7`), publishing the development build — and the Firebase configuration injected into it — to every host on the developer's network. | Internal Network | DF01 | Bind the dev server to `127.0.0.1` by default and require an explicit flag to expose it on the network. | Open |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 3 threats identified.* | — | — | — | — |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| — | All seven STRIDE-A categories produced at least one threat for this component. |

---

## CloudFunctions

**Trust Boundary:** FirebaseBackend
**Role:** Ten Firebase `onCall` HTTPS callable functions holding all server-side authentication, authorization, and approval-workflow enforcement.
**Data Flows:** DF05, DF13, DF14, DF17, DF18
**Pod Co-location:** N/A — not a Kubernetes deployment.

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T11.S1 | Spoofing | Every callable is a public HTTPS endpoint and Firebase App Check is configured nowhere in the repository, so there is no attestation that a request originated from the official web application; any HTTP client holding a valid ID token can drive the workflow directly. | None | DF13 | Enable Firebase App Check with an attestation provider and enforce it on every callable. | Open |
| T11.D1 | Denial of Service | A callable invocation is billed and its container spun up before the `request.auth` check inside the handler runs, and no rate limit, per-caller quota, or App Check gate sits in front of it, so an unauthenticated flood drives Cloud Functions cost and cold-start pressure directly. | None | DF13 | Enable App Check to reject unattested calls at the edge, set per-function max instances, and add per-caller rate limiting. | Open |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T11.E1 | Elevation of Privilege | `updateMyDepartment` performs no role check whatsoever, and when the caller has neither a `users/{uid}` nor a `users/{email}` document it writes `{ role: "rank4", department: <caller-supplied> }` into `users/{uid}` (`functions/src/index.ts:465-490`). `getCallerProfile` reads that role on every subsequent call, so any authenticated account without a profile promotes itself to a Rank 4 approver and chooses the department whose orders it will approve. | Authenticated User | DF05 | **Fixed and verified.** The handler now resolves the caller's existing profile, rejects anyone whose role is not already `rank4` and anyone with no profile at all, validates `department` against an allowlist, and uses `update()` so profile creation is structurally impossible. Confirmed against the deployed callable — see FIND-15. | Mitigated |
| T11.T1 | Tampering | `createOrder` spreads the client's order object straight into the new document (`functions/src/index.ts:364-398`). Only `id` is dropped and only `orderNumber` and `createdBy` are stamped, leaving `status`, `currentApprovalRank`, `approvalHistory`, `finalDecisionAuthorityRank`, `totalCost`, and `totalRevenue` under the requester's control — an order can be created already marked `"Approved"` with a fabricated approval history. | Authenticated User | DF13 | **Fixed and verified against the deployed callable.** `createOrder` strips `status`, `currentApprovalRank`, `approvalHistory`, and `finalDecisionAuthorityRank` from the request and sets them server-side; a forged payload was confirmed to store as `Draft` with an empty history. Stored `totalCost`/`totalRevenue` remain client-supplied — see FIND-16 residuals. | Mitigated |
| T11.I1 | Information Disclosure | `getOrder` applies no authorization beyond authentication (`functions/src/index.ts:62-77`): it returns any order by document id to any signed-in caller, stripping fields only when the role is `viewer`. An authenticated requester can enumerate document ids and read other departments' cost bases, margins, and customer terms. | Authenticated User | DF13 | **Fixed in source.** `getOrder` now calls a `canAccessOrder` scope predicate mirroring `listOrders`, returning `not-found` for out-of-scope documents; viewers still receive the stripped projection. See FIND-18. | Mitigated |
| T11.E2 | Elevation of Privilege | `approveOrder` lets an admin adopt whichever rank is currently pending — `const callerRankStr = role === "admin" ? currentRank : (rankMap[role] \|\| "")` (`functions/src/index.ts:169`) — and the same pattern appears in `rejectOrder` (`functions/src/index.ts:254`), so a single admin account can walk an order through all four approval stages alone, defeating separation of duties. | Privileged User | DF14 | Require a distinct approver identity per rank, record admin overrides explicitly, and block the same principal from approving consecutive stages. | Open |
| T11.E3 | Elevation of Privilege | The Rank 4 department check runs only when the order carries a `headOfDepartment` value — `if (role === "rank4" && department && order.headOfDepartment)` (`functions/src/index.ts:174-178`) — and that field arrives unvalidated from the client, so an order created without it is approvable by any Rank 4 holder regardless of department. | Authenticated User | DF14 | **Fixed and verified.** `approveOrder`/`rejectOrder` now fail closed when either the caller's department or the order's `headOfDepartment` is absent, `createOrder` requires a canonical value, and the client approve controls match. A pre-deployment audit found no stranded data; a real Rank 4 approval succeeded afterwards. See FIND-21. | Mitigated |
| T11.S2 | Spoofing | `getCallerProfile` resolves a profile by `users/{uid}` and then falls back to `users/{email}` (`functions/src/index.ts:33-46`). The email-keyed document is a weaker identity binding than the UID-keyed one, because it is addressable by anyone who controls that address at sign-up rather than by the account that Firebase actually authenticated. | Authenticated User | DF05 | Key profiles solely on UID and migrate any email-keyed documents, removing the fallback. | Open |
| T11.S3 | Spoofing | `getMyProfile` assigns `role: "rank4"` when no profile document exists and the email contains the substring "rank4" (`functions/src/index.ts:453-455`), while `getCallerProfile` — used by every enforcing path — defaults the same caller to `"user"`. The two resolvers disagree, so the UI presents approver controls that every server-side check then denies. | Authenticated User | DF05 | Delete the substring heuristic and have both resolvers share one implementation that reads the profile document only. | Open |
| T11.T2 | Tampering | No schema, type, range, or size validation is applied to `order`, `comment`, `submissionNote`, or `department` on any callable, and `db.settings({ ignoreUndefinedProperties: true })` (`functions/src/index.ts:7`) silently discards malformed fields instead of failing, so invalid data is persisted rather than rejected. | Authenticated User | DF13 | Validate every request payload against an explicit schema — the repository already depends on Zod — and reject anything that does not conform. | Open |
| T11.T3 | Tampering | `approveOrder` and `rejectOrder` read the order, decide, and write without a transaction (`functions/src/index.ts:148-216,236-283`); two concurrent approvals at the same rank both observe the same `currentApprovalRank` and both append, advancing the order two stages or losing an audit entry. | Authenticated User | DF14 | Perform the read, authorization check, and write inside `db.runTransaction`, and reject the write if `currentApprovalRank` changed. | Open |
| T11.I2 | Information Disclosure | The `viewer` scope in `listOrders` is a case-insensitive string match of `accountManager` against the profile `name` (`functions/src/index.ts:117-120`), so two people sharing a display name see each other's orders. | Authenticated User | DF13 | Scope viewer access by a stable account identifier stored on the order rather than by a display-name string. | Open |
| T11.R1 | Repudiation | `createOrder`, `deleteOrder`, `submitForApproval`, `withdrawFromReview`, and `updateMyDepartment` write no audit record at all (`functions/src/index.ts:288-356,359-423,465-491`); only approve and reject append to `approvalHistory`, so most state changes to a financial-approval record are untraceable. | Authenticated User | DF17 | Write an append-only audit entry for every state-changing callable, capturing the actor, action, timestamp, and before/after values. | Open |
| T11.R2 | Repudiation | `deleteOrder` performs a hard delete (`functions/src/index.ts:420`) with no tombstone or archive, so an admin removing an approved order leaves no evidence that it ever existed. | Authenticated User | DF17 | Replace the hard delete with a soft-delete flag plus an audit entry, and restrict permanent removal to a separate retention process. | Open |
| T11.D2 | Denial of Service | `listOrders` reads the entire `orders` collection on every invocation (`functions/src/index.ts:88`) and filters in memory, while the SPA polls it every four seconds per open tab (`src/hooks/useFirestoreOrders.ts:13`); read volume and cost scale as orders × sessions × 15 per minute. | Authenticated User | DF13 | Push the role filter into the Firestore query, paginate results, and replace fixed polling with a change-driven subscription. | Open |
| T11.D3 | Denial of Service | `createOrder` increments a single `counters/orders` document inside a transaction (`functions/src/index.ts:383-390`); sustained concurrent creation contends on that one document against Firestore's per-document write throughput ceiling. | Authenticated User | DF17 | Use a sharded counter or a distributed id scheme so order-number allocation does not serialise on one document. | Open |
| T11.A1 | Abuse | `submitForApproval` resets `approvalHistory` to `[]` (`functions/src/index.ts:319`) with no role check beyond creator ownership, so a creator who withdraws and resubmits erases the record of earlier rank decisions on that document. | Authenticated User | DF14 | Preserve prior history across resubmission by appending a "resubmitted" marker instead of clearing the array. | Open |
| T11.A2 | Abuse | `withdrawFromReview` (`functions/src/index.ts:326-356`) may be called at any point while an order is pending, with no limit on repetitions and no record of the withdrawal, letting a creator stall a decision indefinitely or shop for a more favourable approver. | Authenticated User | DF14 | Record each withdrawal in the audit trail, cap the number of cycles, and require a stated reason. | Open |
| T11.A3 | Abuse | `createOrder` honours `isNew: false`, which skips counter allocation and stores the client's `orderNumber` verbatim (`functions/src/index.ts:365,379-391`) without verifying the caller owns that order number, so a requester can attach a fabricated document to another team's order history. | Authenticated User | DF13 | Resolve `orderNumber` server-side from the order being amended and confirm the caller created it. | Open |
| T11.I3 | Information Disclosure | Cost-basis fields would otherwise reach the `viewer` role, which represents account managers who must not see internal costs. | Authenticated User | DF13 | `stripForViewer` removes `totalCost` from the order and `costPerUnit`, `totalCost`, `totalSST`, and `salesBuffer` from every service before the response is returned, and it is applied in both `getOrder` and `listOrders` (`functions/src/index.ts:9-10,48-59,76,125-127`). | Mitigated |
| T11.E4 | Elevation of Privilege | A client could attempt to drive a workflow transition by submitting its own view of the order state. | Authenticated User | DF14 | Every workflow callable re-reads the order fresh from Firestore and re-resolves the caller's role server-side rather than trusting request state, with the intent documented in the code (`functions/src/index.ts:147-154,240-242`). | Mitigated |
| T11.R3 | Repudiation | Approval decisions could otherwise be denied by the approver. | Authenticated User | DF14 | Approve and reject append an entry to `approvalHistory` carrying the caller's verified token email and a server-side timestamp, not values supplied by the client (`functions/src/index.ts:186-194,269-277`). | Mitigated |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 3 threats identified.* | — | — | — | — |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| — | All seven STRIDE-A categories produced at least one threat for this component. |

---

## Firestore

**Trust Boundary:** FirebaseBackend
**Role:** Cloud Firestore database holding the `orders`, `users`, and `counters` collections; direct client access is denied by security rules.
**Data Flows:** DF06, DF17, DF21
**Pod Co-location:** N/A — not a Kubernetes deployment.

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 1 threats identified.* | — | — | — | — |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 2 threats identified.* | — | — | — | — |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T12.T | Tampering | Both `CloudFunctions` and `MigrateHeadOfCommercial` reach the database through the Admin SDK, which bypasses security rules entirely, so any defect or credential compromise in either caller carries unrestricted write access to every collection. | Admin Credentials | DF17, DF21 | Run each function with a least-privilege service account scoped to the collections it needs, rather than the default full-access Admin SDK identity. | Open |
| T12.I1 | Information Disclosure | Cost, margin, commission, and customer data are stored with no field-level encryption, so any principal reaching the data plane reads them in the clear. | Admin Credentials | DF17 | Apply application-layer encryption or Cloud KMS-backed field encryption to the most sensitive cost and margin fields. | Open |
| T12.R | Repudiation | Cloud Audit Logs for Firestore data access are neither enabled nor referenced anywhere in the repository, so reads and writes performed with Admin SDK credentials leave no trace the application can surface. | Admin Credentials | DF17, DF21 | Enable Data Access audit logs for Firestore and route them to a retained, access-controlled sink. | Open |
| T12.D1 | Denial of Service | The repository contains no backup, point-in-time-recovery, or retention configuration, so an erroneous bulk write or an admin `deleteOrder` is unrecoverable. | Admin Credentials | DF17, DF21 | Enable Firestore point-in-time recovery and scheduled exports, and document the restore procedure. | Open |
| T12.D2 | Denial of Service | `approvalHistory` grows without bound as an array inside the order document (`functions/src/index.ts:194,277`) against Firestore's 1 MiB per-document ceiling; a sufficiently long comment thread renders the order permanently unwritable. | Admin Credentials | DF17 | Move audit entries into a subcollection instead of an in-document array, and bound comment length. | Open |
| T12.E | Elevation of Privilege | A permissive rule set would expose every order, profile, and counter to any authenticated client. | Admin Credentials | DF06 | `firestore.rules` denies every client read and write on `orders`, `users`, `counters`, and the `{document=**}` catch-all, forcing all access through the Cloud Functions layer. | Mitigated |
| T12.I2 | Information Disclosure | Data at rest could be read from the underlying storage medium. | Admin Credentials | DF17 | Cloud Firestore encrypts all data at rest with Google-managed keys by default; this is not configurable from the repository. | Platform |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Spoofing | Under the current deny-all rules Firestore accepts no client identity assertion; every request arrives through the Admin SDK. |
| Abuse | The datastore exposes no business workflow of its own — workflow misuse is recorded against CloudFunctions. |

---

## FirebaseStorage

**Trust Boundary:** FirebaseBackend
**Role:** Cloud Storage bucket holding draft PDF and Excel attachments under `draft-attachments/{uid}/`.
**Data Flows:** DF15, DF16
**Pod Co-location:** N/A — not a Kubernetes deployment.

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T13.I1 | Information Disclosure | `getDownloadURL()` mints a token-bearing URL that serves the object to anyone who presents it, with no session required and no expiry (`src/pages/Dashboard.tsx:93`). Those URLs are persisted into order documents and rendered as links (`src/pages/OrderDetails.tsx:452-456`), so a forwarded link, a browser history export, or a referrer leak hands a vendor quotation to an unauthenticated third party. | None | DF16 | Stop persisting download URLs; store the object path and mint a short-lived signed URL through an authorizing callable at view time. | Open |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T13.I2 | Information Disclosure | `storage.rules` grants `allow read: if request.auth != null` across `draft-attachments/{userId}/{fileName}`, so every authenticated user can read every other user's draft attachments rather than only their own — the write rule is scoped by UID but the read rule is not. | Authenticated User | DF15 | **Fixed in source.** `storage.rules` now scopes the read rule to `request.auth.uid == userId`, matching write and delete. Closes only the SDK path — tokenized `getDownloadURL()` links bypass rules entirely and stay valid until FIND-03 revokes them. See FIND-19. | Mitigated |
| T13.T | Tampering | The write rule validates `request.resource.contentType`, which the uploading client supplies, and never inspects the stored bytes, so arbitrary content can be persisted under a PDF or Excel label and later served from a Google-owned domain. | Authenticated User | DF15 | Verify magic bytes in a Storage-triggered function and quarantine or delete objects whose content does not match the declared type. | Open |
| T13.D | Denial of Service | The Excel branch permits objects up to 100 MiB with no per-user quota, no object-count limit, and no lifecycle rule (`storage.rules`); abandoned draft attachments are never reclaimed. | Authenticated User | DF15 | Enforce per-user quotas in a Storage trigger and add a lifecycle rule expiring unreferenced draft objects. | Open |
| T13.A1 | Abuse | Objects remain under `draft-attachments/` after the order is submitted and approved, so a path named for transient drafts accumulates an indefinite archive of vendor quotations and cost breakdowns with no retention policy. | Authenticated User | DF15 | Move attachments to an order-scoped prefix on submission and apply an explicit retention schedule. | Open |
| T13.A2 | Abuse | No malware or content scanning is applied to uploads, and the unauthenticated tokenized URLs make the bucket a convenient distribution point on a `firebasestorage.googleapis.com` domain that recipients are likely to trust. | Authenticated User | DF15 | Scan uploads with a Storage-triggered malware check before any download URL is issued. | Open |
| T13.R | Repudiation | The application records nothing about who uploaded, replaced, or removed an attachment; only Cloud Storage's own access logs would hold that, and they are not configured anywhere in the repository. | Authenticated User | DF15 | Record attachment lifecycle events in the application audit trail and enable Storage data-access logging. | Open |
| T13.E | Elevation of Privilege | A user could attempt to write into or delete from another user's attachment prefix. | Authenticated User | DF15 | `storage.rules` binds both write and delete to `request.auth.uid == userId`, so the UID segment of the path cannot be forged by the uploading client. | Mitigated |
| T13.S | Spoofing | Uploads could otherwise be attributed to another user. | Authenticated User | DF15 | The object path embeds `request.auth.uid` and the rule binds writes to it (`src/pages/Dashboard.tsx:77`; `storage.rules`), so an upload cannot be planted under another user's identity. | Mitigated |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 3 threats identified.* | — | — | — | — |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| — | All seven STRIDE-A categories produced at least one threat for this component. |

---

## FirebaseAuth

**Trust Boundary:** External — Google-managed identity provider
**Role:** Firebase Authentication (Identity Toolkit) issuing and verifying ID tokens for email and password sign-in.
**Data Flows:** DF03, DF04, DF07, DF18
**Pod Co-location:** N/A — not a Kubernetes deployment.

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T14.S1 | Spoofing | The project uses email and password sign-in with no second factor configured anywhere in the repository, so a single stolen or phished password is sufficient to reach a CFO-level approver account and sign off financial commitments. | None | DF03 | Enable multi-factor authentication on the Firebase project and require it for every account holding an approver rank. | Open |
| T14.S2 | Spoofing | No password complexity, rotation, or breach-check policy is expressed in the repository or in any Firebase configuration it contains, so accounts may carry weak or previously breached passwords. | None | DF03 | Enable Identity Platform password policy enforcement and breached-credential detection on the project. | Open |
| T14.I | Information Disclosure | Unless email-enumeration protection is enabled on the project, the Identity Toolkit REST endpoint distinguishes an unknown address from a wrong password, letting an unauthenticated attacker confirm which staff addresses hold accounts — the generic message in the UI does not affect the API response. | None | DF03 | Enable email-enumeration protection in the Firebase Authentication settings. | Open |
| T14.A | Abuse | Nothing in the repository restricts which email domains may hold accounts in the project, so an externally controlled address provisioned in the project reaches the approval portal. | None | DF03 | Add a blocking `beforeUserCreated` Authentication function enforcing a corporate domain allow-list. | Open |
| T14.D | Denial of Service | Automated sign-in attempts could otherwise exhaust the identity endpoint. | None | DF03 | Firebase Authentication applies its own per-IP and per-account throttling to sign-in attempts, managed by Google and not configurable from this repository. | Platform |
| T14.T | Tampering | A forged ID token would grant arbitrary identity to the callable layer. | None | DF18 | ID tokens are signed by Google and cryptographically verified by the Firebase Functions runtime before `request.auth` is populated. | Platform |
| T14.R | Repudiation | A user could deny having signed in. | None | DF03 | Sign-in successes and failures are recorded in Firebase Authentication's own logs, outside this codebase's control. | Platform |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T14.E | Elevation of Privilege | ID tokens remain valid for up to an hour, and the application never calls `revokeRefreshTokens` or forces a refresh when a role changes, so a user who is demoted or disabled retains their previous privileges until the token expires naturally. | Authenticated User | DF04, DF18 | Revoke refresh tokens whenever a profile role changes or an account is disabled, and have the callables reject tokens issued before the revocation time. | Open |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 3 threats identified.* | — | — | — | — |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| — | All seven STRIDE-A categories produced at least one threat for this component. |

---

## MigrateHeadOfCommercial

**Trust Boundary:** OperatorWorkstation
**Role:** Standalone Node.js maintenance script that rewrites `authorityLevel` and `finalDecisionMaker` across every order using the Admin SDK.
**Data Flows:** DF19, DF21
**Pod Co-location:** N/A — not a Kubernetes deployment.

### STRIDE-A Analysis

#### Tier 1 — Direct Exposure (No Prerequisites)

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 1 threats identified.* | — | — | — | — |

#### Tier 2 — Conditional Risk

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| — | — | *No Tier 2 threats identified.* | — | — | — | — |

#### Tier 3 — Defense-in-Depth

| ID | Category | Threat | Prerequisites | Affected Flow | Mitigation | Status |
|----|----------|--------|---------------|---------------|------------|--------|
| T15.E | Elevation of Privilege | `admin.initializeApp()` with ambient Application Default Credentials (`migrate-head-of-commercial.js:2-4`) gives the script unrestricted, rules-bypassing write access to every Firestore collection, and the script sits in the repository root where anyone who clones it on a machine holding those credentials can run it against production. | Host/OS Access | DF19, DF21 | Move the script out of the application repository into a controlled operations location, and run it under a least-privilege service account scoped to the fields it edits. | Open |
| T15.T1 | Tampering | The script assigns `const updates = { services }` unconditionally (`migrate-head-of-commercial.js:27`), rewriting the entire services array on every changed document rather than patching only the `authorityLevel` values it targets, so a defect in the mapping replaces the whole array. | Host/OS Access | DF21 | Patch only the specific nested fields being migrated, or verify the rewritten array against the original before writing. | Open |
| T15.T2 | Tampering | There is no dry-run mode, confirmation prompt, backup step, or idempotency guard anywhere in the script, and it targets `authorityLevel` and `finalDecisionMaker` — the fields that determine who may approve a request. | Host/OS Access | DF21 | Add a dry-run flag that reports the planned changes, require explicit confirmation, and snapshot the collection before writing. | Open |
| T15.I | Information Disclosure | The script reads every order document, including cost, margin, and customer fields, into the operator's local Node.js process on a workstation outside the application's trust boundary. | Host/OS Access | DF21 | Run migrations from a controlled environment rather than an operator workstation, and select only the fields the migration needs. | Open |
| T15.D | Denial of Service | `db.collection("orders").get()` loads every order into memory and the loop then updates documents one at a time with an `await` per write (`migrate-head-of-commercial.js:10-38`), so the script scales linearly with collection size and contends with live approval traffic. | Host/OS Access | DF21 | Page through the collection with a cursor and apply changes in batched writes. | Open |
| T15.R | Repudiation | The script logs only to stdout (`migrate-head-of-commercial.js:36,39`) and writes no record into Firestore, so a bulk change to approval-authority fields leaves no durable attribution of who ran it, when, or against what. | Host/OS Access | DF21 | Write a migration record into an audit collection capturing the operator, timestamp, and affected document ids. | Open |

#### Categories Not Applicable

| Category | Justification |
|----------|---------------|
| Spoofing | The script asserts no user identity; it acts as the service account backing the ambient credentials. |
| Abuse | The script exposes no interface another party could misuse — it is a single-purpose, one-shot job. |
