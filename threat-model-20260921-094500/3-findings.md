# Security Findings

> **Numbering note:** FIND-26 through FIND-35 were folded in from the baseline report `threat-model-20260911-120000` after this report was written, following the reconciliation recorded in `THREAT-MODEL-RECONCILIATION.md`. FIND-36 and FIND-37 were added later still — FIND-36 discovered while remediating FIND-01, and FIND-37 split out of FIND-01 when it closed so that the residual its fix did not address stayed tracked. Neither has a baseline counterpart. They are placed in correct sorted position — by tier, then severity, then CVSS descending — so finding IDs are **not** strictly ascending in document order from FIND-14 onward. Renumbering FIND-01..FIND-25 was rejected as the more harmful option: those IDs are already referenced in the reconciliation document, in the carried-forward verification evidence, and in active remediation planning. This follows the same precedent set by FIND-56 in the baseline report.

---

## Tier 1 — Direct Exposure (No Prerequisites)

### FIND-01: Attachment download URLs are unauthenticated bearer capabilities

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Critical |
| CVSS 4.0 | 8.7 (CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:N/VA:N) |
| CWE | [CWE-522](https://cwe.mitre.org/data/definitions/522.html): Insufficiently Protected Credentials |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | None |
| Exploitability Tier | Tier 1 — Direct Exposure |
| Remediation Effort | Medium |
| Mitigation Type | Redesign |
| Component | FirebaseStorage |
| Related Threats | [T04.I1](2-stride-analysis.md#dashboard), [T08.I1](2-stride-analysis.md#firebasestorage), [T08.I2](2-stride-analysis.md#firebasestorage), [T08.E1](2-stride-analysis.md#firebasestorage) |

#### Description

Attachments are uploaded to Firebase Storage and immediately converted to a permanent download URL with `getDownloadURL`. That URL embeds an access token which serves the object to any requester, with no Firebase ID token and no evaluation of `storage.rules`. The URL is then persisted verbatim on the order document and rendered as an anchor for every reader of the request.

The consequence is that authorization for the most sensitive artefacts in the system — vendor quotes and costing spreadsheets — is reduced to possession of a link. The link survives role changes, survives the order leaving the holder's scope, and is unaffected by the viewer redaction that strips cost fields from the JSON response. It compounds a second defect: because `storage.rules` grants read only to the uploading UID, approvers have no rules-based path to the file at all, so the tokenized URL is not a convenience but the only working access mechanism.

**Status: Resolved and verified — remediated, deployed, and confirmed against the live project on 2026-09-23.** Attachment access is now brokered by the `getAttachmentUrl` callable, which authorizes before issuing a five-minute V4 signed URL; no client code calls `getDownloadURL`; `createOrder` strips the `url` field; and every previously-issued download token has been revoked, so the leaked links are dead rather than merely superseded. Severity is retained at Critical to record the seriousness of the exposure while it was open; the finding is closed, not downgraded. See Verification for the evidence.

**Scope of this closure, stated precisely.** What is closed is the *authorization* problem: unauthenticated retrieval, and the reduction of access control to link possession. One component of this finding is **not** closed and has been split out into [FIND-37](#find-37-attachment-filenames-are-disclosed-to-every-reader-of-an-order) so this finding could close cleanly — filenames remain embedded in the storage path and rendered to every reader, including the viewers now refused the file itself. That is deliberately a separate finding because the remediation is different in kind: this one was closed by brokering access, whereas that requires changing how objects are named and how display names are stored. The same split pattern was used in the baseline report when FIND-16 closed and FIND-56 carried its residual.

#### Evidence

**Prerequisite basis:** FirebaseStorage is listed in the Component Exposure Table as `Reachability = External`, `Auth Required = No (download tokens bypass rules)`, `Min Prerequisite = None`, `Derived Tier = T1`. A `getDownloadURL` token URL is served by `firebasestorage.googleapis.com` to unauthenticated clients by design.

- `src/pages/Dashboard.tsx:92-103` — on upload completion, `const url = await getDownloadURL(uploadTask.snapshot.ref);` and the value is stored on the attachment record.
- `src/types.ts:138-146` — the `Attachment` interface persists both `url` (the tokenized URL) and `path` (the object path).
- `functions/src/index.ts` — `createOrder` spreads `...orderData` into the stored document; `attachments` is not in the stripped-field destructuring, so the URL is written to Firestore as supplied.
- `src/pages/OrderDetails.tsx:449-466` — every attachment is rendered as `<a href={attachment.url} target="_blank">` for all roles, including `viewer`.
- `storage.rules:12` — `allow read: if request.auth != null && request.auth.uid == userId;` restricts path-based reads to the owner only, which is why no approver can reach the object except through the token URL.

#### Remediation

Stop persisting `getDownloadURL` output. Store only the object `path` on the order document. Add a callable — for example `getAttachmentUrl({orderId, attachmentId})` — that re-reads the order, applies the same `canAccessOrder` check already implemented for `getOrder`, and returns a signed URL with a short expiry generated through the Admin SDK. Revoke the existing download tokens on all stored objects so previously distributed links stop working. Extend `storage.rules` only if a direct client read path is still required, and keep write access owner-scoped as it is today.

#### Verification

**Verified against the deployed system. Evidence recorded below (2026-09-23).**

Deployment prerequisites, both of which were hard blockers and are now satisfied:

| Prerequisite | Resolution |
|---|---|
| Functions service account able to sign | `roles/iam.serviceAccountTokenCreator` granted on `898927828479-compute@developer.gserviceaccount.com`, self-granted — this is what allows `getSignedUrl` to fall back to the IAM `signBlob` API |
| Signing bucket matches the upload bucket | Confirmed as `celcomdigi-portal.firebasestorage.app` — note this is the newer `.firebasestorage.app` form, not `.appspot.com` |

Functional and revocation results:

| Check | Result |
|-------|--------|
| Functions and client deployed | Both deployed |
| Approver retrieves an attachment through the authorizing path | Succeeded — an approver opened an attachment via the signed-URL flow |
| Previously-issued download tokens revoked | `revoke-attachment-tokens.js` ran clean: 10 objects, all under `draft-attachments/`, tokens removed |

The revocation result is the one that matters most, and it is why this finding closes rather than merely improving. Brokering new access would have left every URL already distributed — in browser history, forwarded mail, and anywhere an order was exported — valid and unauthenticated in perpetuity. Stripping `firebaseStorageDownloadTokens` from all 10 objects is what makes the prior leak historical. That the object count was small and wholly within the expected prefix also confirms no attachments existed outside the modelled path.

**Not directly confirmed, and worth doing opportunistically:** that a previously-captured download URL now returns a failure when opened with no session (the revocation is evidenced by the script's own output rather than by replaying a captured link); that a caller with no scope on the order receives `not-found`; and that a `viewer` now receives `permission-denied` rather than a URL. None of these affect the closure — the first is the script's documented effect and the latter two are enforced by code paths that were reviewed — but each would convert inspection into an exercised test.

**Regression watch.** Any reintroduction of a `getDownloadURL` call anywhere in the client silently re-mints a permanent token on the object and reopens this finding without any error surfacing. A grep for `getDownloadURL` returning only comment matches is the cheapest guard; worth adding to CI.

**Prior verification history — carried forward from `threat-model-20260911-120000` (2026-09-11).** See `THREAT-MODEL-RECONCILIATION.md` Part B for the full lineage.

This finding is the continuation of old **FIND-03** ("Attachment download URLs are unauthenticated and never expire", Important / CVSS 7.1), which was **never remediated**. No verification was performed against it because no fix was applied.

Old **FIND-19** ("Draft attachments are readable by every authenticated user", Important / CVSS 7.1) *was* remediated and is **still closed** — do not loosen `storage.rules` to resolve this finding. Its recorded evidence:

- Remediation applied: `storage.rules` changed to `allow read: if request.auth != null && request.auth.uid == userId;`, matching the write and delete scoping.
- Verification status: *"Resolved. Rule change applied; the refusal path was not directly exercised."* The only SDK read in the application is `getDownloadURL()` in `src/pages/Dashboard.tsx:93`, called by the uploader against their own object, where the UID comparison passes. Normal use after deployment showed no regression.
- Explicitly **not** confirmed: no attempt was made as user A to read an object under user B's prefix through the Storage SDK and observe the refusal.

The old report anticipated this finding directly, and its warning is the reason the severity here is Critical rather than Important: *"This fix achieves considerably less than it appears to, and should not be read as closing attachment confidentiality. […] Firebase download tokens bypass security rules entirely. Every such URL already issued remains valid and unauthenticated regardless of this change. […] The two findings should be treated as a pair, with FIND-03 as the one that carries the actual confidentiality benefit."*

Consequence to preserve when fixing: because the FIND-19 fix removed the SDK read path for non-owners, the tokenized URL is now the *only* mechanism by which an approver reaches an attachment. Token revocation must therefore ship together with the authorizing callable, or the approval workflow breaks.

### FIND-02: No identity-provider restriction on account provisioning or sign-in

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 8.7 (CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:H/VA:N) |
| CWE | [CWE-1390](https://cwe.mitre.org/data/definitions/1390.html): Weak Authentication |
| OWASP | A07:2025 – Authentication Failures |
| Exploitation Prerequisites | None |
| Exploitability Tier | Tier 1 — Direct Exposure |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | FirebaseAuth |
| Related Threats | [T05.S1](2-stride-analysis.md#firebaseauth), [T05.A1](2-stride-analysis.md#firebaseauth), [T11.A1](2-stride-analysis.md#loginuser) |

#### Description

The repository contains no blocking authentication function, no corporate-domain allow-list, and no check on `email_verified` anywhere in the client or in the callables. Any identity that exists in the Firebase project is therefore a fully valid principal, and the `email` claim it carries is accepted by the backend without verification that the holder controls that address.

This matters more than usual here because the email claim is load-bearing: `createOrder` stamps it into `createdBy`, `approveOrder` writes it into the audit entry as `approvedBy`, `withdrawFromReview` and `submitForApproval` gate on it, and `getCallerProfile` uses it as a secondary profile key. Combined with FIND-11, an unprovisioned account resolves to the write-capable Requester role, so an account that should have no standing in the system can create FA requests and consume the global order-number sequence.

#### Evidence

**Prerequisite basis:** FirebaseAuth is listed in the Component Exposure Table as `Reachability = External`, `Auth Required = No`, `Min Prerequisite = None`, `Derived Tier = T1` — the Identity Toolkit sign-in and account-creation endpoints are publicly reachable by design.

- `src/pages/LoginUser.tsx:27` — `await signInWithEmailAndPassword(auth, email, password);` with no domain check before or after.
- `src/pages/LoginUser.tsx:69` — the corporate domain appears only as a placeholder string, `you@celcomdigi.com`.
- No `beforeCreate` or `beforeSignIn` blocking function exists; `functions/src/index.ts` exports only the nine `onCall` handlers.
- `functions/src/index.ts` — no callable reads `token.email_verified`; `getCallerProfile` consumes `token.email` directly.
- `functions/src/index.ts` — `getDepartmentFromEmail` assigns a department by substring match on the email address, so an attacker-chosen address also selects a department.

#### Remediation

Add a `beforeSignIn` blocking function that rejects any identity whose email domain is outside the approved corporate list and any identity where `email_verified` is false. Disable self-service sign-up for the Email/Password provider in the Identity Platform console so accounts are created only by provisioning. Stop deriving department from email substrings — resolve it solely from the provisioned `users` document.

#### Verification

Attempt to sign in with an account on a non-corporate domain and confirm the blocking function rejects it. Attempt to create an account through the Identity Toolkit REST API using the public web API key and confirm it is refused. Confirm `getDepartmentFromEmail` is no longer referenced from the enforcement path in `functions/src/index.ts`.

### FIND-03: No multi-factor authentication on financial-approval accounts

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 8.2 (CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:H/VI:H/VA:N) |
| CWE | [CWE-308](https://cwe.mitre.org/data/definitions/308.html): Use of Single-factor Authentication |
| OWASP | A07:2025 – Authentication Failures |
| Exploitation Prerequisites | None |
| Exploitability Tier | Tier 1 — Direct Exposure |
| Remediation Effort | Medium |
| Mitigation Type | Standard Mitigation |
| Component | FirebaseAuth |
| Related Threats | [T05.S2](2-stride-analysis.md#firebaseauth), [T11.S1](2-stride-analysis.md#loginuser) |

#### Description

Every account in the system — including the Rank 1 CFO and the super-admin — authenticates with an email address and a password alone. There is no second factor, no device binding, and no step-up challenge before an approval decision is recorded.

The accounts protected this way authorise material financial commitments: a single compromised Rank 4 password moves a request into the chain, and a compromised admin password is sufficient on its own to drive a request from Draft to Approved (see FIND-14). Because the audit entry records only the email address, a phished credential produces a decision that is indistinguishable from a legitimate one.

#### Evidence

**Prerequisite basis:** FirebaseAuth is `Reachability = External`, `Auth Required = No`, `Min Prerequisite = None`, `Derived Tier = T1` in the Component Exposure Table; credential-based attacks against the sign-in endpoint need no prior access.

- `src/pages/LoginUser.tsx:11-34` — the form collects only `email` and `password` and calls `signInWithEmailAndPassword`; no MFA resolver or `multiFactor()` enrolment path exists anywhere in `src/`.
- `functions/src/index.ts` — `approveOrder` and `rejectOrder` check role and rank but perform no re-authentication or step-up before writing an approval.
- `functions/src/index.ts` — the audit entry records `approvedBy: email || "Unknown Approver"` with no authentication-strength claim.

#### Remediation

Enrol every rank-holding and admin account in Firebase multi-factor authentication and enforce it through the Identity Platform MFA policy. Add the MFA resolver flow to `LoginUser`. For approval actions specifically, require a recent authentication event — read `auth_time` from the decoded token in `approveOrder` and `rejectOrder` and reject decisions made on a stale session.

#### Verification

Confirm that signing in as a rank-holding account prompts for a second factor. Confirm that `approveOrder` rejects a call whose token `auth_time` is older than the configured window. Confirm the audit entry records that a second factor was present.

### FIND-04: Firebase Hosting serves the application without security response headers

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 5.1 (CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:A/VC:L/VI:L/VA:N) |
| CWE | [CWE-693](https://cwe.mitre.org/data/definitions/693.html): Protection Mechanism Failure |
| OWASP | A02:2025 – Security Misconfiguration |
| Exploitation Prerequisites | None |
| Exploitability Tier | Tier 1 — Direct Exposure |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | FirebaseHosting |
| Related Threats | [T07.S1](2-stride-analysis.md#firebasehosting), [T07.T1](2-stride-analysis.md#firebasehosting), [T07.I1](2-stride-analysis.md#firebasehosting) |

#### Description

The `hosting` block in `firebase.json` declares `public`, `ignore`, and `rewrites` but no `headers` array. The application is therefore served with only Firebase Hosting's defaults: no `Content-Security-Policy`, no `X-Frame-Options`, no `Referrer-Policy`, and no `Permissions-Policy`.

The absence of `frame-ancestors` and `X-Frame-Options` means the approval screen can be framed by an attacker-controlled page and an approver's click steered onto the Approve control — a click that commits a financial decision and writes an audit entry attributing it to them. The absence of `Referrer-Policy` means a tokenized attachment URL (FIND-01) leaks through the `Referer` header to the next third-party host the user visits. The absence of a `script-src` policy removes the last containment layer against any script that reaches the page.

#### Evidence

**Prerequisite basis:** FirebaseHosting is listed in the Component Exposure Table as `Reachability = External`, `Auth Required = No`, `Min Prerequisite = None`, `Derived Tier = T1` — the bundle is served to unauthenticated clients over the public internet.

- `firebase.json:15-28` — the `hosting` object contains `public`, `ignore`, and `rewrites` keys only; there is no `headers` key.
- `firebase.json:22-27` — `"source": "**"` rewrites every path to `/index.html`, so the framing surface is the entire route space including `/order-details`.
- `src/pages/OrderDetails.tsx:1792-1799` — the Approve control is a single button whose click immediately invokes `approveOrder`, with no confirmation dialog to interrupt a framed click.

#### Remediation

Add a `headers` block to the `hosting` configuration applying, at minimum: `Content-Security-Policy` with `default-src 'self'`, an explicit `script-src`, `connect-src` covering the Firebase endpoints, and `frame-ancestors 'none'`; `X-Frame-Options: DENY`; `Referrer-Policy: strict-origin-when-cross-origin`; `X-Content-Type-Options: nosniff`; and a restrictive `Permissions-Policy`. Add a confirmation step to the Approve and Reject controls so a single framed click cannot commit a decision.

#### Verification

Fetch the deployed `index.html` and confirm each header is present with the expected value. Attempt to load the deployed origin inside an `iframe` from a different origin and confirm the browser blocks it. Confirm the application still functions with the CSP applied — in particular that the Firebase SDK's `connect-src` targets are allowed.

---

## Tier 2 — Conditional Risk (Authenticated / Single Prerequisite)

### FIND-05: Rank 4 department scoping fails open in listOrders

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 7.1 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:N/VA:N) |
| CWE | [CWE-863](https://cwe.mitre.org/data/definitions/863.html): Incorrect Authorization |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Custom Mitigation |
| Component | CloudFunctions |
| Related Threats | [T03.I2](2-stride-analysis.md#cloudfunctions) |

#### Description

`listOrders` and `canAccessOrder` implement the same Rank 4 department rule with opposite polarity. `canAccessOrder` — used by `getOrder` — fails closed: it requires both the approver's department and the order's `headOfDepartment` to be present and equal. `listOrders` fails open: the department comparison runs only when the approver has a department, and within it an order with no `headOfDepartment` matches unconditionally.

The result is that the read path leaks exactly what the mutation path was hardened to prevent. A Rank 4 approver with no department assigned sees every order pending at Rank 4 across all three departments, and any order missing `headOfDepartment` is visible to every Rank 4 approver. Those orders carry full costing, margin, vendor, and customer data for departments the approver has no standing in.

#### Evidence

**Prerequisite basis:** CloudFunctions is listed in the Component Exposure Table as `Reachability = External`, `Auth Required = Yes (Firebase ID token checked in every callable)`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. `listOrders` begins with `if (!request.auth) throw new HttpsError("unauthenticated", …)`.

- `functions/src/index.ts`, `listOrders`: `let matchesDept = true; if (role === "rank4" && department) { matchesDept = !o.headOfDepartment || o.headOfDepartment.toLowerCase() === department.toLowerCase(); }` — both the `&& department` guard and the `!o.headOfDepartment` disjunct widen the result set.
- `functions/src/index.ts`, `canAccessOrder`: `deptOk = !!department && !!order?.headOfDepartment && order.headOfDepartment.toLowerCase() === department.toLowerCase();` — the correct, fail-closed form.
- `functions/src/index.ts`, `approveOrder`: raises `permission-denied` when the caller has no department and `failed-precondition` when the order has none, confirming fail-closed is the intended rule.

#### Remediation

Replace the `listOrders` rank-scoping block with a call to the existing `canAccessOrder` helper so the read and mutation paths share one implementation. Delete the duplicated inline logic rather than patching both copies.

#### Verification

Create an order with `headOfDepartment` unset directly in Firestore, sign in as a Rank 4 approver from a different department, and confirm `listOrders` no longer returns it. Remove the `department` field from a Rank 4 user document and confirm the same call returns no rank-scoped orders. Confirm `getOrder` and `listOrders` return identical scope decisions for the same order set.

**Prior verification history — carried forward from `threat-model-20260911-120000` FIND-21 (2026-09-11). This gap was a documented deliberate exclusion, not a regression.** See `THREAT-MODEL-RECONCILIATION.md` Part A.1.

Old FIND-21 ("Rank 4 department check is skipped when the order omits headOfDepartment", Important / CVSS 6.8) was **Resolved and verified** across four code paths — `approveOrder`, `rejectOrder`, `canAccessOrder`, and the client gate in `OrderDetails.tsx` — plus a mandatory `headOfDepartment` validation added to `createOrder`. It explicitly declined to change the fifth:

> *"**Deliberately not changed:** the `matchesDept` expression in `listOrders` remains permissive. Enforcing at the action while leaving visibility open means an order that somehow lacks the field stays discoverable in a Rank 4's queue rather than silently vanishing. Visibility is not the security boundary here; authorization is."*

That rationale understates the exposure — `listOrders` returns complete order documents, so out-of-department visibility discloses customer names, vendor costs, margins, and approval history — which is why this is raised as a finding here. But the operational concern behind it is legitimate and the remediation above does not address it: scoping visibility alone can strand an order with a missing or non-canonical `headOfDepartment` in no queue at all, with nobody notified. Pair the scope fix with an admin-visible exception queue.

Pre-deployment audit evidence recorded against the live data (temporary read-only harness), which establishes that the blast radius of tightening visibility is currently nil:

| Audit | Result |
|-------|--------|
| Orders pending at Rank 4 with `headOfDepartment` missing or empty | 0 |
| Orders pending at Rank 4 with `headOfDepartment` present but non-canonical | 0 |
| `users` documents with `role: "rank4"` and no `department` | 0 |

The second row was added beyond the original query because the approval check compares the order's value against the approver's *resolved* department, so a legacy value such as `"Head of Sales"` would be equally un-approvable while passing a naive "is it missing" test.

Post-deployment through the UI: a real Rank 4 approval completed normally (no regression in the legitimate flow), and creating an order without selecting a Head of Department was blocked client-side with the expected toast. Explicitly **not** confirmed: approving an order from an unrelated department to observe `permission-denied`, and the two new `failed-precondition` paths — the audit showed no data in a state that would trigger them.

### FIND-06: Viewer redaction leaks aggregate cost through totalOneTimeChargeB2S

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 7.1 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:N/VA:N) |
| CWE | [CWE-200](https://cwe.mitre.org/data/definitions/200.html): Exposure of Sensitive Information to an Unauthorized Actor |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Custom Mitigation |
| Component | CloudFunctions |
| Related Threats | [T03.I1](2-stride-analysis.md#cloudfunctions), [T09.I1](2-stride-analysis.md#firestore), [T14.I1](2-stride-analysis.md#orderdetails) |

#### Description

`stripForViewer` removes cost fields using two deny-lists. `SERVICE_SENSITIVE_FIELDS` correctly removes `costPerUnit`, `totalCost`, `totalSST`, and `salesBuffer` from each service, but `ORDER_SENSITIVE_FIELDS` contains only `totalCost`. The order-level financing metadata survives untouched.

That metadata is derived from the very figures being redacted. `createOrder` computes `totalOneTimeChargeB2S` as the rounded sum of `totalCost + totalSST` across all one-time line items, then stores it on the order as a string. A viewer therefore receives the aggregate one-time vendor cost of the deal — the number the redaction exists to withhold — alongside `totalFinancingRequest` and `financingLease`, which are functions of the same quantity. `totalRevenue` is also returned, so the viewer can subtract the two and derive the margin directly.

#### Evidence

**Prerequisite basis:** CloudFunctions is `Reachability = External`, `Auth Required = Yes`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. The leak is reachable by any signed-in principal whose profile role is `viewer`.

- `functions/src/index.ts`: `const ORDER_SENSITIVE_FIELDS = ["totalCost"];` — the complete order-level deny-list.
- `functions/src/index.ts`, `createOrder`: `if (s.category === "one-time") oneTimeCostWithSST += loa.totalCost + loa.totalSST;` followed by `const totalOneTimeChargeB2S = Math.round(option === "Yes" ? oneTimeCostWithSST : 0);` — the field is the redacted sum.
- `functions/src/index.ts`, `createOrder` persistence block — `totalOneTimeChargeB2S`, `totalFinancingRequest`, `totalUpfrontPayment`, `financingLease`, and `totalRevenue` are all written to the document and none appear in `ORDER_SENSITIVE_FIELDS`.
- `src/utils/orderDiff.ts:55` — `totalOneTimeChargeB2S: "Total One-time Charge B2S"` is a labelled field in the change-history diff, which `src/pages/OrderDetails.tsx:920` renders for every role including `viewer`.

#### Remediation

Rebuild the viewer projection as an allow-list: enumerate the fields a viewer may see and construct the response from those, discarding everything else. This fails safe when new derived fields are added. At minimum, extend `ORDER_SENSITIVE_FIELDS` to include `totalOneTimeChargeB2S`, `totalFinancingRequest`, `totalUpfrontPayment`, `financingLease`, and `option`, and gate the `ChangeHistory` panel on role.

#### Verification

Sign in as a `viewer` and inspect the raw `listOrders` response for an order with one-time line items; confirm no field discloses vendor cost. Confirm the rendered change-history panel shows no cost-bearing labels for that role. Add a new derived cost field server-side and confirm it is absent from the viewer response without any further change to the strip list.

**Prior verification history — carried forward from `threat-model-20260911-120000` (2026-09-11). This finding contradicts a previously recorded "existing control".** See `THREAT-MODEL-RECONCILIATION.md` Part F.3.

Old **FIND-44** ("Existing control — cost fields are stripped from viewer responses server-side") recorded this mechanism as a working control, and old **FIND-22** ("Cost and commission data is delivered to roles gated only in the browser") covered the separate client-side-gating half now tracked as threat T14.I1.

The FIND-44 assessment was accurate when written. It was invalidated by the fix for old **FIND-56** ("Client-supplied financial totals are persisted without server-side recomputation", Critical / CVSS 8.5, *Resolved and verified*), whose second remediation pass **added** `totalOneTimeChargeB2S` as a server-computed field derived from `Σ (totalCost + totalSST) where category === "one-time"`, alongside `totalUpfrontPayment`, `totalFinancingRequest`, `financingLease`, `option`, and `contractPeriod`. `ORDER_SENSITIVE_FIELDS` was never extended to match.

FIND-56's Pass 2 verification confirmed the new field is genuinely server-computed — `totalOneTimeChargeB2S` was forged with a sentinel and observed as `"0"` / `"108000"` per the recomputed value, with no forged sentinel surviving anywhere in the stored document. That evidence is what makes the leak here certain rather than theoretical: the field provably equals the redacted cost sum.

Regression lesson worth encoding: a verified fix silently degraded a separate verified control. Any check adopted here should assert that *every* server-computed cost field appears in the viewer strip list, rather than enumerating fields by hand.

### FIND-07: createOrder trusts client-supplied orderNumber, version and createdAt

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 7.1 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:H/VA:N) |
| CWE | [CWE-639](https://cwe.mitre.org/data/definitions/639.html): Authorization Bypass Through User-Controlled Key |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Custom Mitigation |
| Component | CloudFunctions |
| Related Threats | [T03.T1](2-stride-analysis.md#cloudfunctions), [T09.T1](2-stride-analysis.md#firestore), [T15.T1](2-stride-analysis.md#summaryreport), [T15.T2](2-stride-analysis.md#summaryreport), [T15.A1](2-stride-analysis.md#summaryreport) |

#### Description

`createOrder` is careful about workflow state — it destructures away `id`, `status`, `currentApprovalRank`, `approvalHistory`, and `finalDecisionAuthorityRank`, and it recomputes every financial figure from the raw line items. Three fields escape that treatment: `orderNumber` (whenever `isNew` is false), `version`, and `createdAt` all flow through the `...orderData` spread into the stored document unchanged.

Those three fields are exactly what the application uses to decide which document represents an order. `MainPage` groups by `orderNumber`, sorts each group by `version` descending, and presents `group[0]` as current. `listOrders` orders by `createdAt`. A Requester can therefore call `createOrder` with `isNew: false`, another user's `orderNumber`, a `version` higher than any real one, and a future `createdAt`, and the resulting document becomes the apparent current version of someone else's FA request — displayed to approvers under that request's number, with the attacker's own line items and company data. The new document is created as a Draft with the attacker as `createdBy`, so the attacker also controls its subsequent submission.

#### Evidence

**Prerequisite basis:** CloudFunctions is `Reachability = External`, `Auth Required = Yes`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. `createOrder` additionally requires the server-resolved role to be `"user"`, which every unprovisioned account satisfies by default (FIND-11).

- `functions/src/index.ts`, `createOrder`: the destructuring removes `id`, `status`, `currentApprovalRank`, `approvalHistory`, and `finalDecisionAuthorityRank` — `version` and `createdAt` are not listed.
- `functions/src/index.ts`, `createOrder`: `let orderNumber = orderData.orderNumber;` followed by `if (isNew) { … }` — the counter transaction runs only on the `isNew` path, so a supplied number is used verbatim otherwise.
- `functions/src/index.ts`, `createOrder`: `const isNew = request.data?.isNew !== false;` — the caller controls the branch directly.
- `src/pages/SummaryReport.tsx:330-338` — the client constructs `version: existingOrder ? (existingOrder.version || 1) + 1 : 1` and `createdAt: Date.now()`.
- `src/pages/SummaryReport.tsx:315-328` — when no order number is held, the client derives `newOrderNumber` by scanning the locally visible list for the highest `FA-(\d+)`.
- `src/pages/MainPage.tsx:41-52` — `groups[key].sort((a, b) => (b.version || 1) - (a.version || 1))` then `.map(group => group[0])` selects the current version purely from the client-supplied `version`.

#### Remediation

Make all three fields server-owned. Set `createdAt` from the server clock. Derive `version` by querying existing documents for that order number and incrementing the maximum. When `isNew` is false, require the caller to pass the document id of the version being superseded, load it, and confirm the caller is its `createdBy` before reusing its `orderNumber` — reject any `orderNumber` not reached that way.

#### Verification

Call `createOrder` with `isNew: false` and an `orderNumber` belonging to another user; confirm it is rejected. Call it with `version: 9999` and confirm the stored document carries the next sequential version instead. Call it with a `createdAt` far in the future and confirm the stored value is the server time.

**Prior verification history — carried forward from `threat-model-20260911-120000` FIND-56 and FIND-29 (2026-09-11). This is the explicitly recorded residual of a verified fix.**

Old **FIND-56** ("Client-supplied financial totals are persisted without server-side recomputation", Critical / CVSS 8.5) was **Resolved and verified** in two passes against the deployed function, and old **FIND-29** ("Client controls order number and version on edit") covered the order-number half.

FIND-56's Pass 1 — every monetary field forged with the sentinel `999999` across three Hardware line items (two Upfront at 5% and 30% buffer, one Installment over 12 months to exercise the PMT branch), submitted via `createOrder` and read back through `getOrder`:

| Check | Expected | Observed |
|-------|----------|----------|
| `order.totalRevenue` recomputed | ≈ 3562.52 | 3562.52 |
| `order.totalCost` recomputed | exactly 3000 | 3000 |
| Per-service monetary fields recomputed | no field retains 999999 | all recomputed |
| Sentinel anywhere in the stored document | none | none found |
| Authority ranks still diverge per item | regression guard on FIND-16 | ranks diverged correctly |

Pass 2 covered the six financing-metadata fields across two orders constructed so `option` could be tested in both directions; all four forged financial strings were overridden, and a forged `contractPeriod` of `"999"` was correctly replaced by the line-item-derived `"36"`.

**The residual this finding now tracks was stated explicitly at the time:** *"`createdAt` and `version` were not tested and remain client-supplied, as recorded in Remediation."* And in Remediation: *"Also unchanged: `createdAt` and `version` are still taken from the client. Stamp `createdAt` with `FieldValue.serverTimestamp()` and derive `version` server-side from the existing documents for that order number. And there is still no general payload schema validation — the enum and numeric checks added here are targeted rather than comprehensive. Validating the whole payload against a Zod schema, the dependency already being present at `package.json:41`, would close `T11.T2`."*

What is new here relative to FIND-29 and FIND-56: the version-grafting attack path — that `isNew: false` plus another user's `orderNumber` plus a high `version` makes the forged document the apparent *current* version of someone else's request, because `MainPage` selects the current version by sorting on the client-supplied `version`. Neither old finding identified that chain.

### FIND-08: submitForApproval erases the approval audit trail

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 7.1 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:H/VA:N) |
| CWE | [CWE-778](https://cwe.mitre.org/data/definitions/778.html): Insufficient Logging |
| OWASP | A09:2025 – Security Logging & Alerting Failures |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Redesign |
| Component | CloudFunctions |
| Related Threats | [T03.T2](2-stride-analysis.md#cloudfunctions), [T03.A2](2-stride-analysis.md#cloudfunctions), [T14.R1](2-stride-analysis.md#orderdetails), [T14.A1](2-stride-analysis.md#orderdetails) |

#### Description

`submitForApproval` writes `approvalHistory: []` as part of moving an order into the chain. Paired with `withdrawFromReview`, which the creator may invoke at any point while a request is under review, this gives the creator an unconditional way to erase recorded approval and rejection decisions: withdraw, then resubmit.

The audit trail is the only record of who decided what — there is no separate log (FIND-17) — so its destruction is total. The behaviour also directly contradicts what the application tells the user: the withdraw dialog states that "Any approvals already given at earlier ranks will remain on record," and `withdrawFromReview` does preserve them, but the next `submitForApproval` clears them. Beyond record-keeping, this enables an approval re-roll: a requester whose request was rejected at Rank 3 can withdraw and resubmit repeatedly, restarting at Rank 4 each time with no trace of the earlier rejection.

#### Evidence

**Prerequisite basis:** CloudFunctions is `Reachability = External`, `Auth Required = Yes`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. `submitForApproval` and `withdrawFromReview` both require only that the caller be the order's `createdBy`.

- `functions/src/index.ts`, `submitForApproval`: the update object sets `approvalHistory: []` alongside the status and rank changes.
- `functions/src/index.ts`, `withdrawFromReview`: the update sets `status: "Draft"` and `currentApprovalRank: ""` and deliberately leaves `approvalHistory` intact — establishing that retention is the intended behaviour.
- `functions/src/index.ts`, `withdrawFromReview`: the only authorization is `(order.createdBy || "").toLowerCase() !== (email || "").toLowerCase()`, so no approver consent is required.
- `src/pages/OrderDetails.tsx:1842-1843` — the dialog text: "Any approvals already given at earlier ranks will remain on record."
- `src/pages/OrderDetails.tsx:782-820` — the Approval Audit Log panel renders `orderToView.approvalHistory` and nothing else, so cleared history leaves no visible trace.

#### Remediation

Stop clearing history. Move the audit trail to an append-only `orders/{id}/auditLog` subcollection written by every state-changing callable and never deleted, and render the submission as a new event rather than a reset. Record each withdrawal and resubmission explicitly, and notify approvers who had already signed off when a request they approved re-enters the chain.

#### Verification

Approve a request at Rank 4, withdraw it as the creator, resubmit it, and confirm the Rank 4 approval is still visible in the audit log with a subsequent withdrawal and resubmission event. Confirm no callable performs a write that removes existing audit entries.

### FIND-09: Viewer authorization is keyed to a free-text account-manager name

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 7.1 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:N/VA:N) |
| CWE | [CWE-287](https://cwe.mitre.org/data/definitions/287.html): Improper Authentication |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Redesign |
| Component | CloudFunctions |
| Related Threats | [T03.S1](2-stride-analysis.md#cloudfunctions) |

#### Description

Whether a `viewer` may see an order is decided by comparing the order's `accountManager` field to the viewer's profile `name`, case-insensitively after trimming. `accountManager` is a free-text field typed by the Requester when building the request; nothing constrains it to a real user, and nothing links it to an identity.

This makes an authorization decision out of a display string that the party being authorized against does not control. A Requester can type any viewer's name and grant that viewer access to a request they should not see. Two people with the same name are indistinguishable to the check. Conversely, a typo or a name-format difference silently denies a legitimate account manager access to their own deals, which tends to be resolved by loosening data rather than fixing the check.

#### Evidence

**Prerequisite basis:** CloudFunctions is `Reachability = External`, `Auth Required = Yes`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. The grant is exercised by any signed-in principal whose profile role is `viewer`.

- `functions/src/index.ts`, `listOrders`: `visible = all.filter((o) => (o.accountManager || "").trim().toLowerCase() === (name || "").trim().toLowerCase());`
- `functions/src/index.ts`, `canAccessOrder`: the same comparison for the `viewer` branch.
- `src/types.ts:154` — `accountManager: string;` is an ordinary metadata string on `OrderMetadata`.
- `src/App.tsx:156` — `accountManager: order.accountManager || ""` is copied verbatim when duplicating an order, so the grant propagates silently.
- `functions/src/index.ts`, `createOrder` — `accountManager` is not validated against any user record; it is written through the `...orderData` spread.

#### Remediation

Record the account manager as a stable identifier — the UID or verified email of a provisioned user — selected from a picker rather than typed. Authorize viewers against that identifier and keep the display name as presentation only. Validate at creation time that the referenced user exists and holds the `viewer` role.

#### Verification

Set an order's `accountManager` display string to a viewer's name without setting the identifier and confirm that viewer receives nothing from `listOrders`. Assign the identifier and confirm access is granted. Create two viewer accounts with identical names and confirm each sees only the orders assigned to their own identifier.

### FIND-10: Unbounded Firestore read amplification from the four-second poll

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 7.1 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:N/VA:H) |
| CWE | [CWE-770](https://cwe.mitre.org/data/definitions/770.html): Allocation of Resources Without Limits or Throttling |
| OWASP | A10:2025 – Mishandling of Exceptional Conditions |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Redesign |
| Component | CloudFunctions |
| Related Threats | [T01.D1](2-stride-analysis.md#approutes), [T03.D1](2-stride-analysis.md#cloudfunctions), [T09.D1](2-stride-analysis.md#firestore) |

#### Description

`listOrders` reads the entire `orders` collection on every invocation and filters in application memory. `useFirestoreOrders` calls it every four seconds for every signed-in client, with no conditional request, no caching, and no backoff.

Cost and latency therefore scale as the product of active clients and total order history: fifteen calls per minute per open tab, each reading every document ever created. Nothing bounds this. There is no pagination, no per-caller rate limit, and no App Check attestation, so the endpoint can equally be driven directly from a script holding a valid ID token — and obtaining one requires only an account, which FIND-02 shows is unrestricted. The practical impact is Firestore read-quota and billing exhaustion, and latency degradation that affects every user including approvers.

#### Evidence

**Prerequisite basis:** CloudFunctions is `Reachability = External`, `Auth Required = Yes`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. `listOrders` rejects unauthenticated callers but applies no further limit.

- `functions/src/index.ts`, `listOrders`: `const snap = await db.collection("orders").orderBy("createdAt", "desc").get();` — an unfiltered full-collection read with no `limit()`.
- `functions/src/index.ts`, `listOrders`: `const all = snap.docs.map(…)` followed by in-memory `filter` calls — scoping happens after every document has been read and billed.
- `src/hooks/useFirestoreOrders.ts:13` — `const POLL_INTERVAL_MS = 4000;`
- `src/hooks/useFirestoreOrders.ts:44-45` — `fetchOrders(); const intervalId = setInterval(fetchOrders, POLL_INTERVAL_MS);` with no visibility check and no backoff on failure.
- No App Check initialisation exists in `src/firebase.ts`, and no `enforceAppCheck` option is set on any `onCall` handler in `functions/src/index.ts`.

#### Remediation

Replace the in-memory filter with indexed Firestore queries scoped to the caller's role, and paginate with a bounded `limit()`. Raise the poll interval substantially, pause polling when the document is hidden, and back off on failure — or restore a real-time listener now that the server owns scoping. Enable Firebase App Check and set `enforceAppCheck: true` on the callables. Add per-caller rate limiting, and configure a Firestore read-quota budget alert.

#### Verification

Confirm `listOrders` issues a bounded query — check the returned document count against a collection seeded with more orders than the page size. Measure Firestore reads per minute for one idle client before and after. Confirm a call without a valid App Check token is rejected. Confirm a scripted caller exceeding the rate limit receives `resource-exhausted`.

### FIND-11: Unprovisioned principals default to the write-capable Requester role

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 7.1 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:H/VA:N) |
| CWE | [CWE-862](https://cwe.mitre.org/data/definitions/862.html): Missing Authorization |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Custom Mitigation |
| Component | CloudFunctions |
| Related Threats | [T03.D2](2-stride-analysis.md#cloudfunctions), [T03.E1](2-stride-analysis.md#cloudfunctions), [T09.A1](2-stride-analysis.md#firestore) |

#### Description

`getCallerProfile` resolves the caller's role as `data?.role || "user"`. When no `users` document exists under either the UID or the email, the caller is treated as a Requester — the role that `createOrder` requires. Provisioning is therefore not a precondition for write access; it is only a precondition for approval authority.

Any principal the project will authenticate can consequently create FA requests. Each creation runs the `counters/orders` transaction, permanently consuming an FA number from a sequence the business treats as meaningful, and writes a document into the collection that `listOrders` reads in full on every poll (FIND-10). Combined with FIND-02, which shows nothing restricts which identities the project accepts, the practical exposure is that account creation is the only step between an outsider and write access.

#### Evidence

**Prerequisite basis:** CloudFunctions is `Reachability = External`, `Auth Required = Yes`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. The default grant is reached after the `request.auth` check passes, so a valid ID token is the only requirement.

- `functions/src/index.ts`, `getCallerProfile`: `const role = data?.role || "user";` — reached when neither `users/{uid}` nor `users/{email}` exists.
- `functions/src/index.ts`, `createOrder`: `if (role !== "user") { throw new HttpsError("permission-denied", "Only requesters can create FA requests."); }` — the default role satisfies this check exactly.
- `functions/src/index.ts`, `createOrder`: the counter transaction `tx.set(counterRef, { current: next }, { merge: true })` is unconditional on the `isNew` path and is never reconciled against the collection.
- `functions/src/index.ts`, `listOrders`: the final `else` branch scopes unprovisioned callers to `o.createdBy === email`, so they also read back everything they create.

#### Remediation

Default unprovisioned principals to a role with no capabilities — for example `"none"` — and have every callable reject it with an explicit message directing the user to request access. Keep provisioning as the sole path to any role, including Requester. Pair this with the blocking function from FIND-02 so unrecognised identities never obtain a token in the first place.

#### Verification

Create an authenticated account with no `users` document and confirm `createOrder` returns `permission-denied`. Confirm `listOrders` returns an empty set for that account. Confirm the FA counter does not advance across the attempt.

### FIND-12: Approval mutations are non-transactional read-modify-write

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 6.9 (CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:N/VC:N/VI:H/VA:N) |
| CWE | [CWE-367](https://cwe.mitre.org/data/definitions/367.html): Time-of-check Time-of-use (TOCTOU) Race Condition |
| OWASP | A10:2025 – Mishandling of Exceptional Conditions |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | CloudFunctions |
| Related Threats | [T03.A1](2-stride-analysis.md#cloudfunctions) |

#### Description

`approveOrder` and `rejectOrder` each read the order with `orderRef.get()`, evaluate the status, rank, and department checks against that snapshot, build a new `approvalHistory` array in memory, and write it back with `orderRef.update()`. Nothing binds the read to the write.

Two decisions submitted close together against the same pending rank both observe the same `currentApprovalRank`, both pass authorization, and both write — the second overwriting the first, including its audit entry. The same window lets an approval and a rejection resolve to whichever write lands last, and lets a `withdrawFromReview` interleave so that a decision is recorded against an order that has already returned to Draft. `createOrder` demonstrates the correct pattern for this codebase by wrapping the counter increment in `db.runTransaction`.

#### Evidence

**Prerequisite basis:** CloudFunctions is `Reachability = External`, `Auth Required = Yes`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. Triggering the race requires a rank-holding or admin caller, which is a single authenticated identity.

- `functions/src/index.ts`, `approveOrder`: `const snap = await orderRef.get();` … `await orderRef.update({ status: nextStatus, currentApprovalRank: nextRank, approvalHistory: updatedHistory });` — no transaction spans the two.
- `functions/src/index.ts`, `approveOrder`: `const updatedHistory = [...(order.approvalHistory || []), newHistoryEntry];` — a whole-array replacement built from the stale snapshot.
- `functions/src/index.ts`, `rejectOrder`: the identical pattern.
- `functions/src/index.ts`, `createOrder`: `orderNumber = await db.runTransaction(async (tx) => { … })` — the transactional pattern already available and used elsewhere in the same file.

#### Remediation

Wrap the read, the authorization checks, and the write of `approveOrder` and `rejectOrder` in `db.runTransaction` so a concurrent modification aborts and retries. Append audit entries with `FieldValue.arrayUnion` rather than replacing the array, or write them to the append-only subcollection proposed in FIND-08. Apply the same treatment to `submitForApproval` and `withdrawFromReview`, which share the pattern.

#### Verification

Issue two concurrent `approveOrder` calls for the same order and rank and confirm exactly one succeeds while the other fails with a precondition error. Issue a concurrent `approveOrder` and `withdrawFromReview` and confirm the resulting state is internally consistent. Confirm the audit array never loses an entry under concurrency.

### FIND-13: deleteOrder permanently destroys approved financial records

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 5.9 (CVSS:4.0/AV:N/AC:L/AT:N/PR:H/UI:N/VC:N/VI:N/VA:H) |
| CWE | [CWE-212](https://cwe.mitre.org/data/definitions/212.html): Improper Removal of Sensitive Information Before Storage or Transfer |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Privileged User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Redesign |
| Component | CloudFunctions |
| Related Threats | [T03.R2](2-stride-analysis.md#cloudfunctions) |

#### Description

`deleteOrder` performs a hard delete on the order document after checking only that the caller's role is `admin`. There is no status check, so a fully approved request can be removed; there is no soft-delete flag, no archive copy, and no tombstone.

Because the approval history lives inside the deleted document and no separate audit log exists (FIND-17), deleting an order destroys the complete record that it was ever raised, what it committed the business to, and who approved it. A single admin credential — protected by a password alone (FIND-03) — is sufficient, and the action leaves nothing behind to detect it by. The UI presents the control alongside a generic confirmation dialog with no indication that an approved record is being destroyed.

#### Evidence

**Prerequisite basis:** CloudFunctions is `Reachability = External`, `Auth Required = Yes`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. This finding's own prerequisite is `Privileged User` because `deleteOrder` requires `role === "admin"` — a stricter gate than the component floor, and consistent with `PR:H` in the vector.

- `functions/src/index.ts`, `deleteOrder`: `if (role !== "admin") { throw … } await db.collection("orders").doc(orderId).delete();` — the entire body after argument validation.
- `functions/src/index.ts`, `deleteOrder`: no check on `order.status`, so `"Approved"` is deletable; the document is not even read before deletion.
- `functions/src/index.ts` — no write to any audit collection precedes or follows the delete.
- `src/pages/MainPage.tsx:274-283` — the admin-only trash control; `src/pages/MainPage.tsx:353-366` — the confirmation dialog, which states only "This action cannot be undone."

#### Remediation

Replace the hard delete with a soft delete: set `deletedAt`, `deletedBy`, and a `deleted` flag, exclude flagged documents from `listOrders`, and retain the document for the applicable records-retention period. Refuse deletion of orders in `Approved` status outright, or require an explicit override that is separately recorded. Write an audit entry before the state change. Configure Firestore point-in-time recovery as a backstop.

#### Verification

Attempt to delete an approved request as admin and confirm it is refused. Delete a draft and confirm the document still exists with `deleted: true` and is absent from `listOrders`. Confirm an audit entry names the acting admin and the target order number.

### FIND-14: Super-admin can approve every rank with no separation of duties

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 5.9 (CVSS:4.0/AV:N/AC:L/AT:N/PR:H/UI:N/VC:N/VI:H/VA:N) |
| CWE | [CWE-269](https://cwe.mitre.org/data/definitions/269.html): Improper Privilege Management |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Privileged User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Redesign |
| Component | CloudFunctions |
| Related Threats | [T03.E2](2-stride-analysis.md#cloudfunctions) |

#### Description

In both `approveOrder` and `rejectOrder`, the caller's effective rank is computed as `role === "admin" ? currentRank : rankMap[role]`. The admin role does not hold a rank; it adopts whatever rank the order is currently waiting on. The rank check that follows therefore always passes for an admin, and the Rank 4 department check is skipped because it is guarded on `role === "rank4"`.

The entire four-step governance chain — Head of Department, Head of Commercial, CEBO, CFO — can consequently be satisfied by one person holding one credential, clicking Approve four times. The UI is explicit about this, labelling it "Admin Override Mode". An override capability is a legitimate design choice, but here it has no second-party requirement, no distinct record in the audit entry (the entry names the substituted role, not the override), and no alerting. With MFA absent (FIND-03), a single phished admin password is enough to approve an arbitrary financial commitment end to end.

#### Evidence

**Prerequisite basis:** CloudFunctions is `Reachability = External`, `Auth Required = Yes`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. This finding requires the `admin` role, so its prerequisite is `Privileged User`, matching `PR:H`.

- `functions/src/index.ts`, `approveOrder`: `const callerRankStr = role === "admin" ? currentRank : (rankMap[role] || "");` immediately followed by `if (callerRankStr !== currentRank) { throw … }` — an identity comparison that cannot fail for an admin.
- `functions/src/index.ts`, `approveOrder`: the department block opens `if (role === "rank4") {`, so an admin acting in place of Rank 4 bypasses it.
- `functions/src/index.ts`, `rejectOrder`: the identical construction.
- `functions/src/index.ts`, `approveOrder`: `const newHistoryEntry = { rank: currentRank, role: roleName, … }` — `roleName` is the substituted role; nothing in the entry records that an override occurred.
- `src/pages/OrderDetails.tsx:1763-1765` — "🛡️ Admin Override Mode: You have full privilege to decide on behalf of {pendingRoleName}".

#### Remediation

Record overrides distinctly: add an `override: true` marker and the acting admin's identity to the audit entry so the substitution is visible in the log and the UI. Require a documented justification for each override. Prevent a single admin from satisfying more than one rank on the same order — track which ranks an identity has already signed and refuse repeats. Alert on override use.

#### Verification

Approve one rank as admin and confirm the audit entry is flagged as an override naming the acting account. Attempt to approve the next rank on the same order with the same admin identity and confirm it is refused. Confirm the override raises an alert.

### FIND-27: approvalHistory grows unbounded toward the Firestore document limit

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 6.9 (CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:N/VC:N/VI:N/VA:H) |
| CWE | [CWE-770](https://cwe.mitre.org/data/definitions/770.html): Allocation of Resources Without Limits or Throttling |
| OWASP | A10:2025 – Mishandling of Exceptional Conditions |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Redesign |
| Component | CloudFunctions |
| Related Threats | [T09.D2](2-stride-analysis.md#firestore), [T03.D3](2-stride-analysis.md#cloudfunctions) |

#### Description

`approvalHistory` is a plain array stored inline on the order document, appended to by `approveOrder` and `rejectOrder` with no cap on entry count or total size. Firestore enforces a hard 1 MB limit per document, and a write that would exceed it is rejected outright. Once an order's history approaches that ceiling, every subsequent write to that document fails — the order becomes permanently unapprovable, unrejectable, and unwithdrawable, with no administrative path to recover it short of direct database surgery.

**The interaction with FIND-08 and FIND-26 is the important part of this finding, and it is counter-intuitive.** Today, entry *count* is effectively capped at four per chain, because `submitForApproval` clears `approvalHistory` on every resubmission — the defect described in FIND-08 incidentally bounds this one. The dominant growth vector is therefore entry *size*, supplied by the unbounded comment in FIND-26: a single approver writing a several-hundred-kilobyte comment can push the document close enough to the ceiling that the next rank's approval fails.

That relationship inverts once FIND-08 is fixed. The recommended remediation there is to preserve history across withdrawal and resubmission, which removes the accidental cap and makes entry count grow without bound across unlimited withdraw/resubmit cycles. **Fixing FIND-08 without bounding this finding at the same time converts an audit-integrity fix into a denial-of-service vector.** The two must land together.

#### Evidence

**Prerequisite basis:** CloudFunctions is listed in the Component Exposure Table as `Reachability = External`, `Auth Required = Yes (Firebase ID token checked in every callable)`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. Appending to the array requires holding the pending rank or the admin role.

- `functions/src/index.ts`, `approveOrder`: `const updatedHistory = [...(order.approvalHistory || []), newHistoryEntry];` followed by `orderRef.update({ … approvalHistory: updatedHistory })` — a whole-array rewrite with no length or size check.
- `functions/src/index.ts`, `rejectOrder`: the identical pattern.
- `functions/src/index.ts`, `submitForApproval`: writes `approvalHistory: []`, which is what currently caps entry count at one chain's worth — see FIND-08.
- `functions/src/index.ts`, `withdrawFromReview`: deliberately leaves `approvalHistory` intact, so a withdraw-then-resubmit cycle preserves then clears it.
- `src/types.ts:185-192` — `ApprovalHistoryEntry` declares `comment?: string` with no length constraint, and `src/types.ts:206` stores the array inline on `Order`.

#### Remediation

Move the audit trail out of the order document into the append-only `orders/{id}/auditLog` subcollection proposed in FIND-17, which removes the single-document ceiling entirely and is the same change FIND-08 needs. If the inline array is retained for display convenience, cap it explicitly: bound the comment length (FIND-26), cap entry count, and reject the write with a clear `failed-precondition` rather than letting Firestore fail it. Sequence this with FIND-08 so the entry-count cap is never removed while the array is still inline.

#### Verification

Append synthetic history entries to a test order until the document approaches 1 MB and confirm the callable returns an actionable error rather than an opaque Firestore write failure. After the subcollection migration, confirm an order with hundreds of audit entries still approves normally. Confirm that a fixed FIND-08 (history preserved across resubmission) does not reintroduce unbounded growth.

---

### FIND-36: Editing an order silently discards its attachments

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 6.9 (CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:N/VC:N/VI:H/VA:N) |
| CWE | [CWE-665](https://cwe.mitre.org/data/definitions/665.html): Improper Initialization |
| OWASP | A08:2025 – Software/Data Integrity Failures |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Custom Mitigation |
| Component | SummaryReport |
| Related Threats | [T15.T3](2-stride-analysis.md#summaryreport) |

#### Description

When `SummaryReport` is opened against an existing order, the effect that populates the draft rebuilds `metadata` field by field from `existingOrder` — and the object literal it constructs omits `attachments`. Because `setMetadata` replaces the whole object rather than merging into it, the attachments are not merely unread, they are removed from state. Re-confirming then submits an order whose `attachments` array is empty, and `createOrder` persists that as the new current version.

The effect is silent loss of the supporting evidence for a commercial decision. A requester who attached a vendor quotation to v1, then edits and re-confirms, produces a v2 that approvers see with no attachments at all — and because `MainPage` presents the highest version as current, v2 is what the approval chain routes. Nothing warns the requester, nothing warns the approver, and the attachment section simply renders "-".

There is an abuse case as well as a defect. The withdraw-and-resubmit path (FIND-08) lets a creator pull a request out of review after approvers have seen it; combined with this behaviour, an edit-and-resubmit cycle strips the attachments from the record while the approval chain restarts. A requester whose supporting documents contradict their stated figures has a route to remove them that leaves no trace, since the attachment array is overwritten rather than versioned and there is no audit log (FIND-17).

**This finding is deliberately not fixed as part of the FIND-01 remediation**, which changed only how attachment URLs are resolved. It is logged separately so it is not absorbed into that work and lost. Note that FIND-01's fix does not mask it: attachments that are dropped are dropped regardless of how the surviving ones are served.

#### Evidence

**Prerequisite basis:** SummaryReport is listed in the Component Exposure Table as `Reachability = External`, `Auth Required = Yes (RequireAuth + BlockViewer guards)`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. Reaching the edit path requires being the order's creator.

- `src/pages/SummaryReport.tsx:53-95` — the `useEffect` keyed on `existingOrder` calls `setMetadata({ … })` with an object literal enumerating 30 fields from `servicesProducts` through `currency`. `attachments` is absent from that list.
- `src/types.ts:153` — `attachments?: Attachment[]` is declared on `OrderMetadata`, so the field is legitimately part of the object being replaced.
- `src/pages/SummaryReport.tsx:808` — the render reads `metadata.attachments`, which is therefore `undefined` for any loaded order, and falls through to the `-` placeholder.
- `functions/src/index.ts`, `createOrder` — persists `attachments` from the submitted payload (now sanitised of `url` per FIND-01); an empty array from the client is written as an empty array.
- Contrast `src/App.tsx:144-185` — `handleDuplicateOrder` sets `attachments: []` **explicitly and deliberately**, with a comment explaining that attachments are tied to the original request. That is intended behaviour for duplication and shows the omission in the edit path is an oversight rather than the same decision applied twice.

#### Remediation

Add `attachments: existingOrder.attachments || []` to the `setMetadata` literal so the edit path carries them through. Defend the same invariant server-side as well: have `createOrder` compare against the version being superseded (once FIND-07 supplies the superseded document id) and reject — or at minimum record — a submission that drops attachments present on the prior version, so a client bug or a deliberate strip cannot silently erase evidence. Surface attachment changes in the version diff, which `src/utils/orderDiff.ts` does not currently track.

#### Verification

Create an order with two attachments, submit it, then open it for edit and re-confirm without changing anything. Confirm the new version still carries both attachments and that both open correctly through `getAttachmentUrl`. Confirm the change-history panel shows no spurious attachment change. Separately, submit a crafted `createOrder` payload with an empty `attachments` array against an order whose prior version had attachments, and confirm the server refuses or records it.

---

### FIND-15: listOrders version expansion widens approver visibility

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 5.1 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:L/VI:N/VA:N) |
| CWE | [CWE-863](https://cwe.mitre.org/data/definitions/863.html): Incorrect Authorization |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Custom Mitigation |
| Component | CloudFunctions |
| Related Threats | [T03.I3](2-stride-analysis.md#cloudfunctions), [T12.I1](2-stride-analysis.md#mainpage), [T12.A1](2-stride-analysis.md#mainpage) |

#### Description

After scoping orders for a rank-holding caller, `listOrders` collects the `orderNumber` values of the matched documents into a set and then re-filters the full collection for every document sharing one of those numbers. The scope decision is made per document but applied per order number.

An approver who is legitimately routed one version of a request therefore also receives every other version of it — including Drafts the requester is still editing and has not submitted, and versions that were routed to a different department before the `headOfDepartment` value changed. Combined with FIND-05, an approver with no department can pull the full version history of requests across all three departments. `MainPage` surfaces this directly through the expandable history rows and the duplicate control, which copies any visible version into the caller's own draft.

#### Evidence

**Prerequisite basis:** CloudFunctions is `Reachability = External`, `Auth Required = Yes`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. Reached by any signed-in caller whose resolved role is `rank1` through `rank4`.

- `functions/src/index.ts`, `listOrders`: `const visibleNums = new Set(visible.map((o) => o.orderNumber)); visible = all.filter((o) => visibleNums.has(o.orderNumber));` — the second pass discards the per-document decision.
- `functions/src/index.ts`, `canAccessOrder`: contains no equivalent expansion, so `getOrder` and `listOrders` disagree about the same document.
- `src/pages/MainPage.tsx:291-341` — expanded rows render every returned version with company, revenue, cost, and status.
- `src/pages/MainPage.tsx:262-273` — the duplicate control copies any listed order into the caller's draft via `onDuplicateOrder`.

#### Remediation

Apply the same per-document scope rule to history that is applied to the current version — reuse `canAccessOrder` for every document rather than expanding by order number. If approvers genuinely need prior versions for context, return a redacted history projection that excludes unsubmitted Drafts, and make that an explicit, separately authorized response field.

#### Verification

Create an order, submit it, approve it as Rank 4, then create a new Draft version as the requester. Confirm the Rank 4 approver's `listOrders` response no longer contains the unsubmitted Draft. Confirm `getOrder` and `listOrders` agree on every document id.

**Prior verification history — carried forward from `threat-model-20260911-120000` FIND-18 (2026-09-11). This is the explicitly recorded residual of a verified fix.**

Old **FIND-18** ("`getOrder` returns any order to any authenticated caller", Important / CVSS 7.7) was **Resolved** by adding the `canAccessOrder` scope predicate, which is the control this finding builds on. Its verification status: *"Resolved. No regression observed; the authorization path itself was not directly exercised."* `getOrder` has no caller anywhere in the client, so tightening it carried no breakage risk and normal application use cannot exercise it either way. A Rank 4 approval and an order creation were performed through the UI after deployment and behaved normally, confirming no regression in the flows sharing `getCallerProfile` and the department logic. Explicitly **not** confirmed: no call was made to `getOrder` with an out-of-scope document id to observe `not-found`.

**The asymmetry this finding tracks was identified and deferred at the time, with a precise trigger condition:**

> *"`listOrders` still carries its own copy of the scope logic rather than calling the shared helper, so the two can drift; unifying them was judged too large a change to fold into a security fix. And `listOrders` expands a rank holder's results to every version sharing an order number, whereas `canAccessOrder` evaluates only the document in hand — so a rank holder who acted on v1 sees v3 in their list but would be refused it by `getOrder`. That asymmetry is currently harmless because nothing calls `getOrder`, but it must be resolved before the endpoint is wired to any UI."*

Two updates to that assessment. First, the drift it warned about has materialised — see FIND-05, where the two copies now disagree on the Rank 4 department rule in opposite directions. Second, "currently harmless because nothing calls `getOrder`" is true of the *inconsistency* but not of the expansion itself: `listOrders` is called every four seconds by every client, so the over-broad result set is served continuously regardless of whether `getOrder` has a caller. That is why this is raised as a finding rather than carried as a deferred cleanup.

### FIND-16: Role resolution diverges between getMyProfile and getCallerProfile

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 5.1 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:L/VI:L/VA:N) |
| CWE | [CWE-807](https://cwe.mitre.org/data/definitions/807.html): Reliance on Untrusted Inputs in a Security Decision |
| OWASP | A07:2025 – Authentication Failures |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Custom Mitigation |
| Component | CloudFunctions |
| Related Threats | [T02.S1](2-stride-analysis.md#authprovider), [T02.D1](2-stride-analysis.md#authprovider), [T03.S2](2-stride-analysis.md#cloudfunctions), [T05.E1](2-stride-analysis.md#firebaseauth) |

#### Description

The system resolves roles twice, with different rules. `getCallerProfile` — the enforcement path — reads the profile document and defaults to `"user"`. `getMyProfile` — the path the client trusts for every UI decision — adds two substring heuristics: a caller with no profile document whose email contains `rank4` is returned the `rank4` role, and departments are derived from substrings such as `region`, `glc`, `named`, and `corp`.

The immediate effect is a presentation inconsistency rather than a privilege escalation: an account with `rank4` in its address renders the approval controls, then receives `permission-denied` on click because the enforcement path resolves it as `"user"`. That mismatch is still a real problem — it makes authorization state unpredictable, trains users to ignore denials, and leaves a second, looser role-resolution implementation that a future caller could adopt as authoritative. The profile lookup order compounds it: both functions try `users/{uid}` then `users/{email}`, so two documents describing the same person can carry different roles and which one wins depends on provisioning order.

#### Evidence

**Prerequisite basis:** CloudFunctions is `Reachability = External`, `Auth Required = Yes`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. Both functions run after the `request.auth` check.

- `functions/src/index.ts`, `getMyProfile`: `} else if (email && email.toLowerCase().includes("rank4")) { role = "rank4"; department = getDepartmentFromEmail(email); }`
- `functions/src/index.ts`, `getCallerProfile`: `const role = data?.role || "user";` — no substring branch, so the two disagree for the same caller.
- `functions/src/index.ts`, `getDepartmentFromEmail`: `if (e.includes("region")) …` / `if (e.includes("public") || e.includes("glc") || e.includes("named")) …` / `if (e.includes("corporate") || e.includes("strategic") || e.includes("corp")) …`
- `functions/src/index.ts`, `getCallerProfile`: `if (!department && email) department = getDepartmentFromEmail(email);` — the enforcement path also falls back to the substring heuristic for department, which `approveOrder` then compares against `order.headOfDepartment`.
- `src/context/AuthContext.tsx:61-67` — the client adopts the `getMyProfile` result as its role for every guard and control-visibility check.

#### Remediation

Delete the email-substring branches from both functions. Have `getMyProfile` call `getCallerProfile` so exactly one implementation resolves roles and departments, and return only values backed by a provisioned `users` document. Resolve profiles by UID alone and migrate email-keyed documents to UID keys.

#### Verification

Sign in with an account whose email contains `rank4` and no `users` document; confirm the client receives no approver role and renders no approval controls. Confirm `getMyProfile` and `getCallerProfile` return identical role and department values for a set of test accounts, including accounts with both UID- and email-keyed documents.

**Prior verification history — carried forward from `threat-model-20260911-120000` FIND-23 and FIND-15 (2026-09-11).**

Old **FIND-23** ("Identity resolution has divergent paths and an email-keyed profile lookup") was **never remediated**; this finding supersedes it and adds the `rank4` email-substring branch in `getMyProfile` as a concrete instance.

The dual-key lookup was also explicitly left in place by the fix for old **FIND-15** ("`updateMyDepartment` self-provisions the rank4 role with no authorization check", Critical / CVSS 8.7), which was **Resolved and verified against the deployed function**. That fix deliberately *used* the uid-then-email order rather than removing it, so that enforcement and the write would agree on which document represents the caller: *"The caller's existing profile is resolved `users/{uid}` then `users/{email}` — matching the order `getCallerProfile` uses — and the call is rejected unless that profile's `role` is already `"rank4"`. The resolved reference is retained so the write lands on the same document the role was read from, rather than creating a second document under a different key."*

Its recorded exclusion: *"Not addressed by this change: the read-then-write race between resolving the profile and calling `update()` remains, as does the email-keyed profile fallback tracked in FIND-23."*

FIND-15's runtime evidence, retained because it establishes that the privilege-escalation half is genuinely closed and must not be reopened by this finding's remediation:

| Case | Input | Expected | Observed |
|------|-------|----------|----------|
| Core exploit | Called from a test account holding **no** `users` profile document | `permission-denied`, no document created | `permission-denied` — `"Only a Rank 4 approver can change their department."` No `users` document was created. |
| Unrecognised department string | arbitrary string | `invalid-argument` | `invalid-argument` |
| Non-string department | number, object, array | `invalid-argument` | `invalid-argument` in all three cases |

Also recorded at the time, and still outstanding: *"the `users` collection should be audited now for documents whose `role` is `rank4` but which no administrator created, since the vulnerable handler was reachable for an unknown period."* If that audit has not been run, it should be — it is a prerequisite for trusting any role data this finding's fix will rely on.

**Consequence for remediation sequencing:** migrating to UID-only profile resolution must update `updateMyDepartment` in the same change, since its correctness currently depends on matching `getCallerProfile`'s lookup order.

### FIND-17: No server-side security audit log

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 5.1 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:L/VA:N) |
| CWE | [CWE-778](https://cwe.mitre.org/data/definitions/778.html): Insufficient Logging |
| OWASP | A09:2025 – Security Logging & Alerting Failures |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Standard Mitigation |
| Component | CloudFunctions |
| Related Threats | [T03.R1](2-stride-analysis.md#cloudfunctions), [T05.R1](2-stride-analysis.md#firebaseauth), [T09.R1](2-stride-analysis.md#firestore) |

#### Description

None of the nine callables writes a security event. Creation, submission, withdrawal, approval, rejection, department change, and deletion all mutate state and return, leaving no record beyond the `approvalHistory` array embedded in the order document — which `submitForApproval` clears (FIND-08) and `deleteOrder` destroys (FIND-13).

The system therefore cannot answer basic questions after the fact: who deleted an approved request, how many times a request was withdrawn and resubmitted, whether an admin override occurred, or whether a permission-denied burst indicates probing. Nothing detects the abuse paths described in FIND-07, FIND-11, and FIND-14, because none of them leaves a trace. No Firestore audit-log export, retention policy, or alerting configuration is present in the repository either.

#### Evidence

**Prerequisite basis:** CloudFunctions is `Reachability = External`, `Auth Required = Yes`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. The gap is exercised by any authenticated action.

- `functions/src/index.ts` — no `logger` import, no `console` call, and no write to any collection other than `orders`, `users`, and `counters` in any of the nine handlers.
- `functions/src/index.ts`, `deleteOrder` — deletes without any preceding record of what was removed.
- `functions/src/index.ts`, `approveOrder` / `rejectOrder` — the only record produced is an entry appended to the mutable `approvalHistory` array on the order itself.
- `functions/src/index.ts` — the `permission-denied` throws in `createOrder`, `deleteOrder`, `updateMyDepartment`, `approveOrder`, and `rejectOrder` are not recorded anywhere, so repeated authorization failures are invisible.
- `firebase.json` — no logging, retention, or alerting configuration.

#### Remediation

Write an append-only entry to an `auditLog` collection from every state-changing callable, capturing UID, email, action, target order id and number, outcome, and server timestamp, with `firestore.rules` denying all client access. Record authorization failures as well as successes. Export Firestore and Identity Platform audit logs to a retained sink and alert on deletions, admin overrides, and permission-denied bursts. Enable Firestore point-in-time recovery.

#### Verification

Perform one of each action and confirm a corresponding audit entry exists with the acting identity and server timestamp. Trigger a `permission-denied` and confirm it is recorded. Confirm an alert fires on an admin override and on a deletion.

### FIND-18: Attachment metadata is unvalidated and rendered as a live link

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 5.1 (CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:A/VC:L/VI:L/VA:N) |
| CWE | [CWE-601](https://cwe.mitre.org/data/definitions/601.html): URL Redirection to Untrusted Site ('Open Redirect') |
| OWASP | A05:2025 – Injection |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Custom Mitigation |
| Component | CloudFunctions |
| Related Threats | [T03.T3](2-stride-analysis.md#cloudfunctions), [T04.A1](2-stride-analysis.md#dashboard), [T08.T1](2-stride-analysis.md#firebasestorage), [T08.A1](2-stride-analysis.md#firebasestorage) |

#### Description

`createOrder` validates line items thoroughly — rejecting unrecognised categories, decisions, and service types, and recomputing every financial figure — but passes the `attachments` array through the `...orderData` spread without inspecting a single field. The `url`, `name`, `path`, `size`, and `type` values are stored exactly as the caller sent them.

`OrderDetails` then renders each entry as an anchor whose `href` is that `url`, with an icon chosen from `type` and a label taken from `name`. A Requester can therefore present an approver with a link that appears to be the supporting quote for the deal but points at an attacker-controlled host — a credible phishing vector, since the approver has been asked to review the document before committing funds. The same gap lets a requester point the label at one file and the URL at another, and leaves stale URLs in place after `handleRemoveAttachment` deletes the underlying object.

#### Evidence

**Prerequisite basis:** CloudFunctions is `Reachability = External`, `Auth Required = Yes`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. Writing the metadata requires the Requester role on `createOrder`.

- `functions/src/index.ts`, `createOrder` — the destructuring removes workflow fields only; `attachments` is not validated, and the persistence call spreads `...orderData` directly.
- `functions/src/index.ts`, `createOrder` — the per-service validation loop checks `SERVICE_CATEGORIES`, `SERVICE_DECISIONS`, and service type, establishing that input validation is expected here; attachments receive none of it.
- `src/pages/OrderDetails.tsx:452-465` — `<a key={attachment.id} href={attachment.url} target="_blank" rel="noopener noreferrer">` with `{attachment.name}` as the visible label and the icon selected by `attachment.type`.
- `src/types.ts:138-146` — the `Attachment` interface carries both `url` and `path`, so the server has the information needed to reconstruct the link and does not use it.
- `src/pages/Dashboard.tsx:111-119` — `handleRemoveAttachment` deletes the object but does not revisit orders that already hold the URL.

#### Remediation

Validate each attachment in `createOrder`: require `path` to start with `draft-attachments/{callerUid}/`, require `type` to be `pdf` or `excel`, bound `name` and `size`, and discard the client's `url` entirely — reconstruct the link server-side from the validated `path` (which FIND-01 replaces with a signed-URL callable). Reject the whole request on a malformed entry, matching how line items are handled.

#### Verification

Call `createOrder` with an attachment whose `url` points at an external host and confirm the request is rejected. Call it with a `path` under another user's UID prefix and confirm rejection. Confirm rendered attachment links resolve only to the project's Storage origin.

### FIND-19: No per-user attachment quota

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 5.1 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:N/VA:L) |
| CWE | [CWE-770](https://cwe.mitre.org/data/definitions/770.html): Allocation of Resources Without Limits or Throttling |
| OWASP | A10:2025 – Mishandling of Exceptional Conditions |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | FirebaseStorage |
| Related Threats | [T04.D1](2-stride-analysis.md#dashboard), [T08.D1](2-stride-analysis.md#firebasestorage) |

#### Description

`storage.rules` bounds a single object — 5 MB for PDFs, 100 MB for Excel files — but places no limit on how many objects a user may create or on their cumulative size. Nothing expires attachments belonging to drafts that are never submitted.

A single Requester can therefore write an unbounded number of 100 MB objects into the bucket, driving storage cost and, at sufficient volume, affecting the project's quota. Because attachments are uploaded before an order exists and are never linked back to one, abandoned drafts leave orphaned objects that no cleanup path removes. The per-object ceiling is also generous relative to the stated purpose: 100 MB for a costing spreadsheet.

#### Evidence

**Prerequisite basis:** FirebaseStorage is listed in the Component Exposure Table as `Reachability = External`. Writing requires a matching authenticated UID under the Storage rules, so this finding's prerequisite is `Authenticated User`.

- `storage.rules:13-26` — the `allow write` condition tests `request.resource.contentType` and `request.resource.size` only; there is no count or aggregate condition available to it.
- `storage.rules:22-25` — `request.resource.size < 100 * 1024 * 1024` for the two Excel content types.
- `src/pages/Dashboard.tsx:54-109` — `handleFileUpload` iterates the whole `FileList` and starts a resumable upload per file with no count check.
- `src/pages/Dashboard.tsx:77` — objects are written to `draft-attachments/{uid}/{attachmentId}-{name}` before any order exists, so nothing associates them with a request that could drive cleanup.
- No lifecycle rule or cleanup function exists in the repository.

#### Remediation

Lower the per-object ceiling to what the workflow actually needs. Track attachment count and total bytes per user in Firestore and enforce a quota in an upload-authorizing callable, or move uploads behind a callable that issues a signed upload URL only when the quota allows. Add a Storage lifecycle rule expiring objects under `draft-attachments/` that are older than a set age and not referenced by any order.

#### Verification

Attempt to upload more than the configured number of attachments to one draft and confirm the upload is refused. Confirm an object under `draft-attachments/` older than the lifecycle age is removed. Confirm the per-object size limit matches the new policy.

### FIND-26: Approval and rejection comments have no length limit

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 5.1 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:N/VA:L) |
| CWE | [CWE-400](https://cwe.mitre.org/data/definitions/400.html): Uncontrolled Resource Consumption |
| OWASP | A10:2025 – Mishandling of Exceptional Conditions |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | CloudFunctions |
| Related Threats | [T03.D3](2-stride-analysis.md#cloudfunctions) |

#### Description

`approveOrder` and `rejectOrder` both require a comment and validate it carefully in one direction only: the value must be a non-empty string after trimming. Nothing bounds it from above. An approver can submit a comment of arbitrary size, which is trimmed and written straight into the `approvalHistory` entry on the order document.

On its own this is a modest input-validation gap. It matters because it is the dominant growth vector for FIND-27 — the inline `approvalHistory` array sits under Firestore's 1 MB per-document ceiling, and a single large comment consumes a meaningful fraction of it. A several-hundred-kilobyte comment written at Rank 4 can leave insufficient headroom for the Rank 3 append, at which point the order cannot progress. The client offers no protection either: the comment `Textarea` in `OrderDetails` carries no `maxLength`.

#### Evidence

**Prerequisite basis:** CloudFunctions is `Reachability = External`, `Auth Required = Yes`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. Writing a comment requires holding the currently pending rank or the admin role.

- `functions/src/index.ts`, `approveOrder`: `if (!comment || typeof comment !== "string" || !comment.trim()) { throw new HttpsError("invalid-argument", "A comment is required."); }` — a lower bound only, with no `.length` check anywhere in the handler.
- `functions/src/index.ts`, `approveOrder`: the value reaches storage via `comment: comment.trim()` inside `newHistoryEntry`.
- `functions/src/index.ts`, `rejectOrder`: the identical validation and the identical write.
- `src/pages/OrderDetails.tsx:1773-1780` — the `Textarea` bound to `approvalComment` sets `rows={3}` and no `maxLength`.
- `src/types.ts:191` — `comment?: string` is declared with no constraint.

#### Remediation

Add an explicit maximum length to both callables — a few thousand characters is ample for a decision rationale — and reject longer input with `invalid-argument`, matching the style of the existing category and decision checks in `createOrder`. Mirror the limit as a `maxLength` on the `Textarea` with a visible character counter so the constraint is discoverable before submission rather than after. Derive both from one shared constant.

#### Verification

Call `approveOrder` with a comment exceeding the limit and confirm `invalid-argument`. Confirm a normal-length comment is unaffected. Confirm the UI blocks over-length input before the call is made and shows the remaining character count.

---

### FIND-28: Stale privileges persist for the lifetime of the ID token

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 5.1 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:L/VI:L/VA:N) |
| CWE | [CWE-613](https://cwe.mitre.org/data/definitions/613.html): Insufficient Session Expiration |
| OWASP | A07:2025 – Authentication Failures |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Standard Mitigation |
| Component | FirebaseAuth |
| Related Threats | [T05.E2](2-stride-analysis.md#firebaseauth) |

#### Description

Firebase ID tokens are valid for approximately one hour. The `onCall` runtime verifies a token's signature and expiry but does not check whether it has been revoked, and no callable in this codebase performs that check itself. Disabling an account in Firebase Authentication or revoking its refresh tokens therefore does not end an in-flight session — the holder continues to transact until the current token expires naturally.

One part of this is already handled well and is worth crediting, because it bounds the impact. Role and department are re-read from Firestore on every call through `getCallerProfile`, so *changing* someone's role takes effect immediately; there are no roles baked into custom claims to go stale. What does not take effect immediately is *revoking the principal itself*. The exposure is therefore a window of up to an hour in which a deprovisioned employee — someone dismissed, or an account being contained during an incident — can still act with whatever role their `users` document last carried. For a Rank 4 holder that is a window in which departmental approvals can still be issued, and FIND-17's absence of audit logging means the activity leaves no record beyond the approval entries themselves.

#### Evidence

**Prerequisite basis:** FirebaseAuth is listed in the Component Exposure Table as `Reachability = External`, `Min Prerequisite = None`, `Derived Tier = T1`. This finding requires possession of an already-issued valid token, so its prerequisite is `Authenticated User`, above the component floor.

- `functions/src/index.ts` — every callable gates on `if (!request.auth)` and then calls `getCallerProfile`; no handler calls `verifyIdToken(token, true)` or otherwise consults revocation state.
- `functions/src/index.ts`, `getCallerProfile`: reads `users/{uid}` then `users/{email}` per invocation — this is the mitigating behaviour that makes role changes immediate.
- `functions/src/index.ts`, `approveOrder` / `rejectOrder`: the audit entry records `approvedBy: email` with no session or token-age attribute, so an action taken on a stale session is indistinguishable from a current one.
- `src/context/AuthContext.tsx:54-125` — the client refreshes state on `onAuthStateChanged` only; there is no periodic re-validation that would surface a revoked session.

#### Remediation

Verify revocation in the callables that change state: decode the raw token with `verifyIdToken(idToken, true)` and reject on `auth/id-token-revoked`. Make deprovisioning call `revokeRefreshTokens(uid)` as well as disabling the account, and document that as the required containment step. Shorten the practical window further for rank-holding accounts by pairing this with the recent-authentication check proposed in FIND-03. Record the token's `auth_time` on each audit entry so a decision's session age is auditable after the fact.

#### Verification

Sign in as a Rank 4 account, revoke its refresh tokens server-side, then attempt an approval with the still-unexpired token and confirm it is refused. Confirm a normal approval on a fresh session is unaffected. Confirm a role change in the `users` document still takes effect on the next call without requiring re-authentication.

---

### FIND-29: Development server binds to all network interfaces

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 5.1 (CVSS:4.0/AV:A/AC:L/AT:N/PR:N/UI:N/VC:L/VI:L/VA:N) |
| CWE | [CWE-1327](https://cwe.mitre.org/data/definitions/1327.html): Binding to an Unrestricted IP Address |
| OWASP | A02:2025 – Security Misconfiguration |
| Exploitation Prerequisites | Internal Network |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | FirebaseClient |
| Related Threats | [T06.I2](2-stride-analysis.md#firebaseclient) |

#### Description

The `dev` script starts Vite with `--host=0.0.0.0`, binding the development server to every network interface rather than the loopback address. Anyone on the same network segment as a developer's machine — an office LAN, a shared co-working network, a conference or hotel Wi-Fi — can reach the running application on port 3000 without any credential.

What that exposes is the development build, which is materially more revealing than the production bundle: unminified source, source maps, and the full client-side authorization logic including the role heuristics and route guards. It also exposes whatever Firebase configuration the developer's `.env` supplies, which may point at the production project. Vite's dev server is explicitly not hardened for untrusted networks, so this also broadens the reachable surface for any dev-server vulnerability.

**Modelling note:** the development server is not represented as its own component in this report's data flow diagram, which models the deployed system. It is recorded against FirebaseClient because `vite.config.ts` and the `dev` script are that component's build and runtime configuration surface — the same surface that carries FIND-33 and FIND-35. A future full re-run should consider modelling a distinct build/dev component.

#### Evidence

**Prerequisite basis:** reaching the dev server requires a position on the developer's network segment, which is the canonical `Internal Network` prerequisite (Tier 2). The `AV:A` vector matches. This is above the FirebaseClient component floor of `None`.

- `package.json:7` — `"dev": "vite --port=3000 --host=0.0.0.0"`. The `--host` flag with `0.0.0.0` overrides Vite's default loopback-only binding.
- `vite.config.ts:68-72` — the `server` block configures only `hmr`; it sets no `host`, so the CLI flag governs.
- `vite.config.ts:32-48` — when `FIREBASE_PROJECT_ID` is absent from the OS environment the build reads `.env`, so a developer's local build can carry production Firebase configuration into the exposed bundle.

#### Remediation

Drop `--host=0.0.0.0` from the `dev` script so Vite binds loopback by default, and add a separate opt-in script for the occasions where LAN access is genuinely needed — device testing, for instance. If LAN exposure must remain the default, restrict it at the host firewall and never point a LAN-exposed dev build at the production Firebase project.

#### Verification

Run `npm run dev` and confirm the server is reachable on `127.0.0.1:3000` and refused from another host on the same subnet. Confirm the opt-in script still works where LAN access is required.

---

### FIND-34: Upload content type is client-declared and never verified

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 5.1 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:A/VC:L/VI:L/VA:N) |
| CWE | [CWE-434](https://cwe.mitre.org/data/definitions/434.html): Unrestricted Upload of File with Dangerous Type |
| OWASP | A05:2025 – Injection |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Custom Mitigation |
| Component | FirebaseStorage |
| Related Threats | [T04.T1](2-stride-analysis.md#dashboard) |

#### Description

Attachment type is checked in two places, and both read the same untrusted value. The browser tests `file.type`, and `storage.rules` tests `request.resource.contentType` — but `request.resource.contentType` is the content type the *uploading client declares* in its request, not a property derived from the bytes. A rule comparing a client-supplied header against an expected string is an assertion check, not content verification.

Any payload can therefore be stored under `draft-attachments/` labelled `application/pdf`. Because Cloud Storage serves objects with the content type recorded at upload, the file is then delivered to approvers with that declared type, under a filename the requester also controls (FIND-18), through a URL that requires no authentication (FIND-01). The combination is what gives this weight: an approver following what appears to be the vendor quotation for a deal they are about to sign off receives attacker-chosen bytes served with an attacker-chosen type.

This finding restates a correct conclusion from the baseline report that the present report initially got wrong — see Verification.

#### Evidence

**Prerequisite basis:** FirebaseStorage is listed in the Component Exposure Table as `Reachability = External`, `Min Prerequisite = None`, `Derived Tier = T1`. Writing an object requires an authenticated UID matching the path under the Storage rules, so this finding's prerequisite is `Authenticated User`.

- `storage.rules:17-25` — the write condition tests `request.resource.contentType == 'application/pdf'` and the two spreadsheet types. `request.resource.contentType` is populated from the client's upload request metadata.
- `src/pages/Dashboard.tsx:58-61` — `const isPdf = file.type === "application/pdf"` and the equivalent for Excel. `File.type` is derived by the browser from the file extension and is trivially overridden by a direct SDK call.
- Nothing anywhere inspects file content: there is no magic-byte check, no server-side scan, and no post-upload validation function in the repository.
- `src/pages/OrderDetails.tsx:459-463` — the rendered icon is chosen from the stored `attachment.type`, reinforcing the declared type in the UI.

#### Remediation

Treat the declared content type as untrusted metadata. Add a Storage-triggered function that reads the first bytes of each new object, verifies the magic number against the declared type, and quarantines or deletes on mismatch — recording the event to the audit log from FIND-17. Keep the existing rules check as a cheap first filter rather than the control. Consider virus scanning on the same trigger, since these files are opened by approvers. Sequence with FIND-01 so that serving moves behind an authorizing callable at the same time.

#### Verification

Upload a non-PDF payload with the content type set to `application/pdf` through a direct SDK call and confirm the post-upload function quarantines it and that it does not appear as a usable attachment. Confirm a genuine PDF and a genuine `.xlsx` both pass unaffected.

**Correction history — this report's own status was wrong.** Threat T04.T1 was originally recorded in `2-stride-analysis.md` with status `Mitigated`, on the reasoning that *"`storage.rules` independently enforces content type and per-type size limits on the write."* That overstated the control: the rules validate a client-declared string, not the content. The baseline report's **FIND-24** ("Upload content type is client-declared and never verified") had this right, and it was incorrectly folded in as mitigated during the re-scan. T04.T1 is now recorded as `Open` and carries this finding. Recorded here rather than silently amended so the misjudgement stays visible.

---

### FIND-37: Attachment filenames are disclosed to every reader of an order

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 5.1 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:L/VI:N/VA:N) |
| CWE | [CWE-200](https://cwe.mitre.org/data/definitions/200.html): Exposure of Sensitive Information to an Unauthorized Actor |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Redesign |
| Component | FirebaseStorage |
| Related Threats | [T08.I2](2-stride-analysis.md#firebasestorage) |

#### Description

The uploader's original filename is used verbatim in two places: it is concatenated into the Cloud Storage object path, and it is stored as `attachment.name` and rendered as the visible label for every reader of the order. Filenames in this workflow are rarely neutral — they are the requester's own naming of a commercial document, so they routinely carry the customer, the vendor, the deal, and sometimes the commercial posture: `ACME-Q4-renewal-final-pricing.xlsx` discloses the counterparty and the stage of negotiation before anyone opens anything.

This was split out of FIND-01 when that finding closed. FIND-01 removed unauthenticated retrieval and made access conditional on authorization; it did not change what is written into the path or shown in the list. The split matters because **the FIND-01 fix narrows who can open the file without narrowing who can read its name**, and in one case widens the gap: a `viewer` is now refused the download but still sees the label, so the filename is the only part of the attachment they receive — and it is the part no authorization check governs.

The path-level disclosure is the more durable half. Because the name is baked into the object path at upload, it persists in Storage listings, in any bucket-level tooling, and in the `path` field stored on the order, independently of what the UI chooses to render.

#### Evidence

**Prerequisite basis:** FirebaseStorage is listed in the Component Exposure Table as `Reachability = External`, `Min Prerequisite = None`, `Derived Tier = T1`. Reading the filename requires an authenticated session scoped to the order, so this finding's prerequisite is `Authenticated User`, above the component floor.

- `src/pages/Dashboard.tsx:78` — ``const storagePath = `draft-attachments/${currentUser.uid}/${attachmentId}-${file.name}`;`` — the original filename is concatenated into the object path at upload time.
- `src/types.ts` — `name: string` is persisted on the `Attachment` record and travels with the order document into Firestore.
- `src/pages/OrderDetails.tsx:472` — `{attachment.name}` is rendered as the button label, inside the Request Information block, which carries **no role gate** — so viewers see it.
- `functions/src/index.ts`, `stripForViewer` — removes cost fields from the order and its services; `attachments` is not touched, so filenames survive the viewer projection intact.
- `functions/src/index.ts`, `getAttachmentUrl` — refuses viewers the signed URL, which is correct for the file but leaves the label they were already shown.

#### Remediation

Decouple the stored object name from the display name. Write objects under an opaque, generated name — the `attachmentId` alone is sufficient and is already a UUID — and keep the human-readable filename only in Firestore on the attachment record, where the order's own scope rules govern it. Set the original name as the `Content-Disposition` filename on the signed URL so downloads still arrive correctly titled. Then bring `attachments` under the viewer projection: either strip filenames in `stripForViewer` or gate the attachment block on role in `OrderDetails`, so a role refused the file is not shown its name.

Existing objects keep their current paths; a rename migration is optional and lower value than stopping new ones, since the already-uploaded names are known only to people who already had order scope.

#### Verification

Upload an attachment named after a customer and confirm the resulting object path contains only the generated id. Confirm the order still displays the original filename to an in-scope approver, and that downloading through the signed URL produces a file with the original name. Sign in as a `viewer` scoped to the order and confirm no filename is rendered. Confirm `stripForViewer` output contains no attachment names.

---

### FIND-20: contractPeriod fallback accepts an unbounded integer

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 4.6 (CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:N/VC:N/VI:L/VA:N) |
| CWE | [CWE-1284](https://cwe.mitre.org/data/definitions/1284.html): Improper Validation of Specified Quantity in Input |
| OWASP | A10:2025 – Mishandling of Exceptional Conditions |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Custom Mitigation |
| Component | CloudFunctions |
| Related Threats | [T03.A3](2-stride-analysis.md#cloudfunctions) |

#### Description

`createOrder` derives `contractPeriod` from the line items when financing applies and some item carries a tenure. Otherwise it preserves the client's value, coerced through `toFiniteNumber`, floored, and clamped at zero — but with no upper bound. The source comment acknowledges this directly: "Its magnitude in that fallback path remains unconstrained: no business rule currently defines a ceiling."

The same selection feeds `n` in the financing-lease PMT computation, so an extreme value propagates into a stored financial figure that approvers see and that downstream reporting consumes. A 10,000-month contract period is not a memory-safety problem, but it is a business-data integrity one: it produces a lease figure that looks authoritative because the server computed it. The permitted installment periods are already enumerated in `src/types.ts`, so the bound exists — it simply is not applied here.

#### Evidence

**Prerequisite basis:** CloudFunctions is `Reachability = External`, `Auth Required = Yes`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. Reached through `createOrder`, which requires the Requester role.

- `functions/src/index.ts`, `createOrder`: `const clientContractPeriod = Math.max(0, Math.floor(toFiniteNumber(orderData.contractPeriod) ?? 0));` — a lower bound only.
- `functions/src/index.ts`, `createOrder`: `const contractPeriod = option === "Yes" && maxContractTenure > 0 ? maxContractTenure : clientContractPeriod;` — the fallback reaches the stored document.
- `functions/src/index.ts`, `createOrder`: `const n = option === "Yes" && maxContractTenure > 0 ? maxContractTenure : clientContractPeriod;` then `const pmt = (totalFinancingRequest * r) / (1 - Math.pow(1 + r, -n));` — the same unbounded value drives the lease figure.
- `src/types.ts:56-58` — `export const INSTALLMENT_PERIODS = [1, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120];` — the enumerated business bound.

#### Remediation

Validate `contractPeriod` against `INSTALLMENT_PERIODS`, or at minimum against a maximum of 120 months, and reject values outside it with `invalid-argument` in the same style as the existing category and decision checks. Apply the same bound to `installmentPeriod` on each line item.

#### Verification

Call `createOrder` with `contractPeriod: 100000` and confirm it is rejected. Confirm a legitimate value from `INSTALLMENT_PERIODS` is accepted and that `financingLease` is unchanged for existing valid inputs.

**Prior verification history — carried forward from `threat-model-20260911-120000` FIND-56 (2026-09-11). This residual was knowingly accepted, not missed.**

Old **FIND-56** ("Client-supplied financial totals are persisted without server-side recomputation", Critical / CVSS 8.5) was **Resolved and verified**, and its remediation recorded this specific gap as an accepted residual:

> *"**Residual — `contractPeriod` magnitude in the fallback path.** When financing does not apply, or no line item carries a tenure, `contractPeriod` falls through to the client's value. The server coerces it through `toFiniteNumber`, floors it, and clamps it at zero, so a non-numeric or negative value cannot reach the PMT — but its magnitude is unconstrained, because no business rule currently defines a ceiling. It is a divisor and an exponent in the PMT and is multiplied by `financingLease` in six display sites in `src/pages/OrderDetails.tsx`, so a large value inflates the lease figure an approver sees. Flagged as a possible follow-up if a limit is ever defined; accepted as-is for now."*

The fallback path was exercised during Pass 2 verification and behaved exactly as described — recorded there as an expected non-override rather than a defect: *"Order A's `contractPeriod` was submitted as `"999.7"` and stored as `"999"`. This is correct behaviour, not a missed field: `contractPeriod` is only derived when financing applies, and Order A's `option` is `"No"`, so the client's value is kept — coerced and floored, which the stored `"999"` demonstrates."*

The same pass confirmed the derived path overrides correctly: Order B's forged `"999"` was replaced by the line-item-derived `"36"`.

**What has changed since:** the old report deferred this pending a business rule defining a ceiling. `INSTALLMENT_PERIODS` in `src/types.ts` already enumerates the permitted tenures (max 120 months), so the bound the old report was waiting for exists in the codebase — which is why this is now actionable at Low severity rather than an open acceptance. Confirm with the formula's owner that `INSTALLMENT_PERIODS` is the intended ceiling for the order-level `contractPeriod` and not only for per-line-item tenures.

### FIND-21: Authentication identifiers are serialized into thrown errors and console logs

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 4.6 (CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:N/VC:L/VI:N/VA:N) |
| CWE | [CWE-532](https://cwe.mitre.org/data/definitions/532.html): Insertion of Sensitive Information into Log File |
| OWASP | A09:2025 – Security Logging & Alerting Failures |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Custom Mitigation |
| Component | FirebaseClient |
| Related Threats | [T02.I1](2-stride-analysis.md#authprovider), [T06.I1](2-stride-analysis.md#firebaseclient) |

#### Description

`handleFirestoreError` builds an object containing the current user's UID, email, `emailVerified`, `isAnonymous`, `tenantId`, and every linked provider's id and email, serialises it with `JSON.stringify`, writes it to the console, and then throws it as the message of a new `Error`.

Because it is the message of a thrown Error, this payload can reach anywhere an error message is surfaced — and the application's callable wrappers do exactly that, passing `e?.message` into user-visible toasts. Identity attributes consequently risk appearing in the UI, in browser console output captured by screen recordings or support sessions, and in any error-reporting pipeline attached later. `AuthContext` adds to the same surface by logging the resolved role on every sign-in.

#### Evidence

**Prerequisite basis:** FirebaseClient is listed in the Component Exposure Table as `Reachability = External`. The helper reads `auth.currentUser`, so the disclosure applies to a signed-in session — prerequisite `Authenticated User`.

- `src/firebase.ts:54-73` — `handleFirestoreError` constructs `errInfo` with `userId`, `email`, `emailVerified`, `isAnonymous`, `tenantId`, and `providerInfo`.
- `src/firebase.ts:71-72` — `console.error('Firestore Error: ', JSON.stringify(errInfo)); throw new Error(JSON.stringify(errInfo));`
- `src/App.tsx:131-136` and `src/App.tsx:192-196` — `const msg = e?.message || …; toast.error(msg);` — thrown messages are rendered to the user.
- `src/context/AuthContext.tsx:64` — `console.log(\`[Auth] Loaded role "${data.role}" via getMyProfile\`);`
- `src/pages/OrderDetails.tsx:62-64, 87-90, 113-115, 134-136` — the same `e?.message` into `toast.error` pattern on every workflow action.

#### Remediation

Reduce the thrown message to a generic string plus a correlation id, and keep the identity attributes out of both the message and the console in production builds. Strip the role log from `AuthContext`. Where a user-facing message is needed, map error codes to fixed strings rather than forwarding raw messages.

#### Verification

Force a Firestore error and confirm the console output and the thrown message contain no UID, email, or provider data. Confirm the user-visible toast shows a generic message with a correlation id. Confirm no role value is logged on sign-in in a production build.

### FIND-30: Client and Storage rules disagree on the PDF size limit

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 4.6 (CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:N/VC:N/VI:N/VA:L) |
| CWE | [CWE-20](https://cwe.mitre.org/data/definitions/20.html): Improper Input Validation |
| OWASP | A06:2025 – Insecure Design |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Custom Mitigation |
| Component | Dashboard |
| Related Threats | [T04.T2](2-stride-analysis.md#dashboard) |

#### Description

The browser applies a single 100 MB ceiling to every upload regardless of type, while `storage.rules` caps PDFs at 5 MB and only allows 100 MB for the two spreadsheet types. Any PDF between 5 MB and 100 MB therefore passes client validation, begins a resumable upload, and is then refused by the rules layer.

The security impact is small, but the failure mode is poor and the underlying pattern is the one worth fixing: two enforcement points encode the same policy with different values, and the looser one is the one users see. A requester attaching a large scanned quotation gets a generic "Failed to upload" toast with no indication that the file was too large or which limit applied, and the only place the real constraint is written down is a rules file they cannot read. The practical risk is that a supporting document silently never makes it onto a request that is then approved without it.

#### Evidence

**Prerequisite basis:** Dashboard is listed in the Component Exposure Table as `Reachability = External`, `Auth Required = Yes (RequireAuth + RequireUser guards)`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`.

- `src/pages/Dashboard.tsx:68-72` — `const maxSize = 100 * 1024 * 1024;` then `if (file.size > maxSize)`. The single constant is applied to both branches; the error string interpolates `${isPdf ? "PDF" : "Excel"}` while the threshold itself does not vary.
- `storage.rules:17-19` — `request.resource.contentType == 'application/pdf' && request.resource.size < 5 * 1024 * 1024`.
- `storage.rules:22-25` — the spreadsheet branch permits `< 100 * 1024 * 1024`.
- `src/pages/Dashboard.tsx:87-91` — the upload error handler shows `Failed to upload ${file.name}` with no size-specific detail, so the mismatch surfaces to the user as an unexplained failure.

#### Remediation

Define the per-type limits once and derive both sides from that single source — a shared constants module the client imports, with the rules kept in step and a comment naming the source of truth. Make the client's check per-type so an over-size PDF is refused before the upload starts, and give the message the actual limit. Decide deliberately which ceiling is correct for PDFs; 5 MB is low for a scanned multi-page quotation, and the right fix may be to raise the rules limit rather than lower the client's.

#### Verification

Attempt a 6 MB PDF upload and confirm the client refuses it immediately with a message naming the PDF-specific limit, rather than failing at the rules layer after transferring. Confirm a 6 MB `.xlsx` still uploads. Confirm the client and rules limits derive from the same declared values.

---

### FIND-22: Optimistic department update is never reverted on failure

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 2.3 (CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:A/VC:N/VI:L/VA:N) |
| CWE | [CWE-451](https://cwe.mitre.org/data/definitions/451.html): User Interface Misrepresentation of Critical Information |
| OWASP | A06:2025 – Insecure Design |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Custom Mitigation |
| Component | AuthProvider |
| Related Threats | [T02.T1](2-stride-analysis.md#authprovider) |

#### Description

`updateDepartment` calls `setActualDepartment(newDept)` before invoking the `updateMyDepartment` callable and catches any failure with a bare `console.error`. The optimistic state change is never rolled back.

Because `updateMyDepartment` now rejects any caller whose provisioned role is not `rank4` — and rejects callers with no profile at all — the failure path is the common one, not the exceptional one. A user who triggers it sees the header render a department the server refused to store. Since the Rank 4 department is the value that decides which orders an approver may act on, showing an unaccepted value misrepresents the approver's actual scope. The function is currently unreferenced by any component, which limits present exposure but makes this a latent defect that surfaces the moment an edit control is added — as the source comment notes.

#### Evidence

**Prerequisite basis:** AuthProvider is listed in the Component Exposure Table as `Reachability = External`, `Auth Required = Yes`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. The function early-returns unless `currentUser` is set.

- `src/context/AuthContext.tsx:143-152` — `setActualDepartment(newDept);` precedes the `httpsCallable` invocation, and the `catch` block contains only `console.error`.
- `src/context/AuthContext.tsx:131-142` — the source comment documents both the dead-code status and the missing revert.
- `functions/src/index.ts`, `updateMyDepartment`: `if (!profileSnap.exists || profileSnap.data()?.role !== "rank4") { throw new HttpsError("permission-denied", …); }` — the rejection this path does not handle.
- `src/components/Header.tsx:52-63` — the header renders `department` for `rank4`, which is where the unaccepted value would appear.

#### Remediation

Apply the state change only after the callable resolves, and on failure re-read the profile through `getMyProfile` and surface an error to the user rather than swallowing it. If the capability is not intended, remove `updateDepartment` from the context value and delete the dead code.

#### Verification

Invoke `updateDepartment` as a non-rank4 account and confirm the header's displayed department is unchanged and an error is shown. Invoke it as a rank4 account and confirm the value updates only after the callable succeeds.

---

## Tier 3 — Defense-in-Depth (Prior Compromise / Host Access)

### FIND-23: Cloud Functions dependencies are unpinned with no package.json or lockfile

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 6.8 (CVSS:4.0/AV:L/AC:L/AT:P/PR:H/UI:N/VC:H/VI:H/VA:H) |
| CWE | [CWE-1104](https://cwe.mitre.org/data/definitions/1104.html): Use of Unmaintained Third Party Components |
| OWASP | A03:2025 – Software Supply Chain Failures |
| Exploitation Prerequisites | Admin Credentials |
| Exploitability Tier | Tier 3 — Defense-in-Depth |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | CloudFunctions |
| Related Threats | [T03.T4](2-stride-analysis.md#cloudfunctions) |

#### Description

The `functions/` directory contains exactly one file, `src/index.ts`. There is no `package.json` and no lockfile, so the versions of `firebase-admin` and `firebase-functions` that the deployed runtime uses are whatever the build environment happens to resolve at deploy time.

This is not hypothetical for this codebase. `getFirestore("(default)")` depends on the `databaseId` parameter introduced in firebase-admin v12; on v11 or earlier the string is interpreted as the App argument and the function throws at cold start, taking every callable down. The source comments record that the build environment was observed at v13.10.0 and state plainly that "This repository declares no firebase-admin dependency, so no lockfile enforces the floor." Beyond that specific break, unpinned transitive dependencies mean the deployed code is not reproducible and a compromised upstream package would be pulled in silently — the functions run with Admin SDK privileges that bypass every security rule.

#### Evidence

**Prerequisite basis:** Exploitation requires influence over the build or deploy pipeline, which is reached through `Admin Credentials` — consistent with the `AV:L`/`PR:H` vector and the `MigrateHeadOfCommercial`/Operator row in the Component Exposure Table.

- `functions/` contains only `functions/src/index.ts`; no `package.json`, `package-lock.json`, or `node_modules` manifest is present.
- `functions/src/index.ts:20` — `const db = getFirestore("(default)");`
- `functions/src/index.ts:12-19` — the source comment: "REQUIRES firebase-admin v12+ … On v11 and earlier a bare string is treated as the App argument and this throws at cold start … This repository declares no firebase-admin dependency, so no lockfile enforces the floor."
- `migrate-head-of-commercial.js:11-12` — the same dependency floor is restated for the migration script, which also has no manifest.
- The root `package.json` declares the client-side `firebase` SDK but neither `firebase-admin` nor `firebase-functions`, so nothing in the repository pins the server runtime.

#### Remediation

Add `functions/package.json` declaring `firebase-admin` and `firebase-functions` with explicit minimum-major constraints, set the Node engine, and commit the lockfile. Add a CI step running `npm ci` followed by an audit, and assert the resolved `firebase-admin` major version meets the v12 floor before deploy. Do the same for the migration script's dependencies.

#### Verification

Run `npm ls firebase-admin` in `functions/` and confirm a pinned version at or above v12 is resolved from the committed lockfile. Confirm a clean `npm ci` reproduces the same tree. Confirm the CI version assertion fails when the floor is not met.

### FIND-32: Cloud Functions hold unrestricted project-wide Firestore access

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 6.8 (CVSS:4.0/AV:N/AC:L/AT:P/PR:H/UI:N/VC:H/VI:H/VA:N) |
| CWE | [CWE-272](https://cwe.mitre.org/data/definitions/272.html): Least Privilege Violation |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | CloudFunctions Compromise |
| Exploitability Tier | Tier 3 — Defense-in-Depth |
| Remediation Effort | High |
| Mitigation Type | Redesign |
| Component | Firestore |
| Related Threats | [T09.E2](2-stride-analysis.md#firestore), [T09.T1](2-stride-analysis.md#firestore) |

#### Description

All ten callables run in one Cloud Functions deployment under a single service account initialised with a bare `initializeApp()`, which resolves to the App Engine default service account — typically holding project-level Editor. The Admin SDK bypasses Firestore security rules entirely by design, so `firestore.rules` provides no containment here: the deny-all ruleset that protects the system from clients offers nothing against the functions themselves.

The consequence is that every callable holds the same unrestricted authority over every collection, regardless of what it actually needs. `getMyProfile`, which only ever reads one `users` document, can write `orders` and `counters`. A defect in any single handler — an injection into a document path, a logic error, a compromised dependency reaching the runtime (FIND-23) — escalates directly to full read and write over all application data, with no secondary boundary and, given FIND-17, no audit record. This is the reason several other findings in this report have the blast radius they do: it is the missing containment layer beneath them.

This is defense-in-depth rather than a directly exploitable defect, which is why it sits at Tier 3. It requires prior compromise of the functions to realise. What it changes is the cost of every other finding being wrong.

#### Evidence

**Prerequisite basis:** Firestore is listed in the Component Exposure Table as `Reachability = External`, `Auth Required = Yes (deny-all rules for clients; service account for Admin SDK)`, `Min Prerequisite = Authenticated User`, `Derived Tier = T2`. This finding requires prior compromise of the functions runtime to exercise, so its prerequisite is `CloudFunctions Compromise` (Tier 3), above the component floor. The `PR:H` vector matches.

- `functions/src/index.ts:5` — `initializeApp();` with no credential, service-account, or scope argument, so the runtime's default identity is used.
- `functions/src/index.ts:20` — `const db = getFirestore("(default)");` — one Admin SDK handle shared by all ten exported callables; there is no per-function client and no scoping.
- `firestore.rules:5-9` — the file's own comment records that the functions "use the Admin SDK and bypass these rules", confirming the rules are not a containment boundary for this path.
- `functions/src/index.ts` — the handlers touch `orders`, `users`, and `counters`; no handler is restricted to the subset it uses, and `deleteOrder` holds delete authority over the whole `orders` collection.
- No IAM configuration, service-account binding, or per-function identity appears anywhere in the repository.

#### Remediation

Give the functions a dedicated service account rather than the default, granted only the Firestore access the application needs, and set it explicitly on the deployment. Where 2nd-gen functions allow per-function service accounts, split by privilege: read-only handlers such as `getMyProfile` and `listOrders` should not hold write authority, and `deleteOrder` should be the only identity able to delete. Pair this with the audit logging in FIND-17 so privileged operations are recorded, and with FIND-23's dependency pinning, since an unpinned dependency is the most plausible route to the compromise this finding assumes.

#### Verification

Confirm the deployed functions run under a named, non-default service account. Confirm that account's IAM bindings grant no project-level Editor or Owner role. From a test handler, attempt a write to a collection outside the granted scope and confirm it is refused. Confirm the application's normal flows are unaffected by the narrowed permissions.

**Reconciliation note.** The baseline report raised this as **FIND-49** ("Admin SDK callers hold unrestricted project-wide Firestore access"). The initial re-scan folded only part of it — threat T09.T1 captured the absence of schema validation at the datastore, but the privilege-scope argument was dropped. This finding completes the fold.

---

### FIND-24: Draft order data persists in browser localStorage and is never cleared

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 6.1 (CVSS:4.0/AV:L/AC:L/AT:N/PR:L/UI:N/VC:H/VI:N/VA:N) |
| CWE | [CWE-312](https://cwe.mitre.org/data/definitions/312.html): Cleartext Storage of Sensitive Information |
| OWASP | A04:2025 – Cryptographic Failures |
| Exploitation Prerequisites | Host/OS Access |
| Exploitability Tier | Tier 3 — Defense-in-Depth |
| Remediation Effort | Low |
| Mitigation Type | Custom Mitigation |
| Component | LocalStorage |
| Related Threats | [T01.I1](2-stride-analysis.md#approutes), [T10.T1](2-stride-analysis.md#localstorage), [T10.I1](2-stride-analysis.md#localstorage), [T10.D1](2-stride-analysis.md#localstorage), [T10.A1](2-stride-analysis.md#localstorage) |

#### Description

In-progress drafts are written to `localStorage` under `services_{uid}` and `orderMetadata_{uid}` on every state change. The payload is the full working request: company name, project brief, justification, vendor name, and for each line item the cost per unit, total cost, SST, and sales buffer — the same cost data the viewer redaction exists to protect.

The per-UID namespacing prevents one signed-in user's draft from being read by the application while another is signed in, but it does not remove the data. Nothing clears these keys on sign-out, so every account that has ever used a shared or pooled workstation leaves its last draft readable to anyone with access to the browser profile. The restored draft is also parsed straight back into application state with no validation, so anything able to write the key influences the next request submitted.

#### Evidence

**Prerequisite basis:** LocalStorage is listed in the Component Exposure Table as `Reachability = No Listener`, `Min Prerequisite = Host/OS Access`, `Derived Tier = T3` — reading it requires access to the browser profile on the host.

- `src/App.tsx:111-121` — both persistence effects call `localStorage.setItem(key, JSON.stringify(…))` on every change, with no try/catch.
- `src/App.tsx:88-105` — on user change the drafts are read back with `JSON.parse` and merged into state with no validation beyond defaulting three levy fields.
- `src/context/AuthContext.tsx:127-129` — `logout` calls `signOut(auth)` and nothing else; neither key is removed.
- `src/App.tsx:73-74` — `const servicesKey = uid ? \`services_${uid}\` : null;` — keys are namespaced but never deleted, so they accumulate per account.
- `src/types.ts:3-38` — the persisted `Service` shape includes `costPerUnit`, `totalCost`, `totalSST`, and `salesBuffer`.

#### Remediation

Remove both keys in the `logout` path, and remove other UIDs' keys on sign-in. Prefer `sessionStorage` so drafts do not outlive the browser session. Exclude cost-bearing fields from the persisted draft, or persist drafts server-side against the authenticated user instead. Wrap the `setItem` calls in try/catch so a quota failure does not break the render, and validate restored drafts before use.

#### Verification

Sign in, build a draft, sign out, and confirm both keys are absent from `localStorage`. Sign in as a second account and confirm the first account's keys have been removed. Fill the origin's storage quota and confirm the application still renders.

### FIND-25: Migration script bulk-rewrites all orders with no dry-run, backup, or audit

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 6.1 (CVSS:4.0/AV:L/AC:L/AT:N/PR:H/UI:N/VC:N/VI:H/VA:L) |
| CWE | [CWE-250](https://cwe.mitre.org/data/definitions/250.html): Execution with Unnecessary Privileges |
| OWASP | A08:2025 – Software/Data Integrity Failures |
| Exploitation Prerequisites | Admin Credentials |
| Exploitability Tier | Tier 3 — Defense-in-Depth |
| Remediation Effort | Medium |
| Mitigation Type | Standard Mitigation |
| Component | MigrateHeadOfCommercial |
| Related Threats | [T13.T1](2-stride-analysis.md#migrateheadofcommercial), [T13.R1](2-stride-analysis.md#migrateheadofcommercial), [T13.D1](2-stride-analysis.md#migrateheadofcommercial), [T13.E1](2-stride-analysis.md#migrateheadofcommercial) |

#### Description

`migrate-head-of-commercial.js` reads every document in `orders` and writes back a rewritten `services` array wherever an authority label matches one of two old values. It runs under Application Default Credentials picked up by a bare `admin.initializeApp()`, which on an operator workstation typically carries project-owner scope — far more than the two fields it edits.

The script has no dry-run mode, takes no backup, prompts for no confirmation, and is invoked simply by running the file. Its only record is `console.log` output, and the documents it touches carry no marker distinguishing a migration write from a user edit. `authorityLevel` and `finalDecisionMaker` are the fields that describe who was required to approve a request, so a mistaken or repeated run silently rewrites approval provenance on historical records with no way to tell what changed or to roll back — Firestore point-in-time recovery is not configured. The sequential per-document `await` also contends with live traffic for write quota as the collection grows.

#### Evidence

**Prerequisite basis:** MigrateHeadOfCommercial is listed in the Component Exposure Table as `Reachability = No Listener`, `Auth Required = Yes (Application Default Credentials)`, `Min Prerequisite = Admin Credentials`, `Derived Tier = T3`.

- `migrate-head-of-commercial.js:7` — `admin.initializeApp();` with no explicit credential or scope restriction.
- `migrate-head-of-commercial.js:19` — `const snapshot = await db.collection("orders").get();` — the full collection, not a query filtered to the affected documents.
- `migrate-head-of-commercial.js:42-46` — `await doc.ref.update(updates);` inside a sequential `for` loop, with `console.log` as the only record.
- `migrate-head-of-commercial.js:52` — `migrate().catch(console.error);` — no dry-run flag, no confirmation prompt, no backup step.
- `migrate-head-of-commercial.js:15-16` — the rewrite maps `["Head of Enterprise Sales Planning", "Head ES & BP"]` to `"Head of Commercial"` across `services[].authorityLevel` and `finalDecisionMaker`.

#### Remediation

Make dry-run the default and require an explicit flag to write. Export the collection before any write. Query only documents matching the old values instead of scanning everything. Run under a dedicated service account scoped to the `orders` collection rather than Application Default Credentials. Stamp each touched document with a migration id and timestamp, write a run record to the audit collection from FIND-17, and use bounded batched writes. Enable Firestore point-in-time recovery.

#### Verification

Run the script with no flags and confirm it reports intended changes without writing. Confirm a write run produces a pre-run export and a run record naming the operator. Confirm the service account it uses cannot write outside the `orders` collection. Confirm touched documents carry the migration marker.

### FIND-33: Build-time config file can silently repoint the application

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 6.1 (CVSS:4.0/AV:L/AC:L/AT:P/PR:H/UI:N/VC:H/VI:H/VA:N) |
| CWE | [CWE-15](https://cwe.mitre.org/data/definitions/15.html): External Control of System or Configuration Setting |
| OWASP | A08:2025 – Software/Data Integrity Failures |
| Exploitation Prerequisites | Admin Credentials |
| Exploitability Tier | Tier 3 — Defense-in-Depth |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | FirebaseClient |
| Related Threats | [T06.T2](2-stride-analysis.md#firebaseclient) |

#### Description

`vite.config.ts` opens `firebase-applet-config.json` from the repository root if it exists and uses its contents as a fallback source for `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`, and `firestoreDatabaseId`. The file is not required to exist, is not referenced in documentation, is not in `.gitignore`, and its absence is silent — the build simply proceeds with empty strings or `.env` values.

An added or modified copy of that file therefore repoints the built application at a different Firebase project without touching any source file, any environment variable, or any obviously security-relevant configuration. Users signing in to the resulting build authenticate against, and submit commercial data to, a project the attacker controls. The change is invisible in a source diff that reviewers are watching for code changes, and the file's plausible-looking name gives it cover.

Two conditions currently bound this. The fallback only applies when `FIREBASE_PROJECT_ID` is absent from the OS environment — `vite.config.ts` branches on `useSystemEnv`, and the production build sets that variable (established during the baseline report's FIND-17 remediation), so production builds take the system-environment path and ignore the file. And placing the file requires write access to the build workspace. The exposure is therefore against local and non-production builds, and against any future build environment where that variable is not set.

#### Evidence

**Prerequisite basis:** exercising this requires write access to the build workspace or the repository, reached through `Admin Credentials` (Tier 3). The `AV:L`/`PR:H` vector matches. This is above the FirebaseClient component floor of `None`.

- `vite.config.ts:11-19` — `const configPath = path.resolve(__dirname, 'firebase-applet-config.json'); if (fs.existsSync(configPath)) { firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')); }`, wrapped in a `try` whose `catch` only logs.
- `vite.config.ts:41-47` — the non-system-env branch: `apiKey = env.FIREBASE_API_KEY || firebaseConfig.apiKey || '';` and the same pattern for `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`, and `firestoreDatabaseId`.
- `vite.config.ts:22` — `const useSystemEnv = !!process.env.FIREBASE_PROJECT_ID;` — the single condition that decides whether the file is consulted at all.
- `.gitignore` — lists `node_modules/`, `build/`, `dist/`, `coverage/`, `.DS_Store`, `*.log`, and `.env*`; `firebase-applet-config.json` is not excluded, so a committed copy would be carried into any clone.
- `vite.config.ts:55-61` — the resolved values are inlined into the bundle through `define`, so a repointed build is baked in at compile time.

#### Remediation

Remove the file-based fallback. Configuration should come from the environment only, and a missing value should fail the build loudly rather than resolving to an empty string. If a file-based path must be retained for a specific workflow, require an explicit opt-in flag rather than mere file presence, add the filename to `.gitignore`, and assert at build time that the resolved `projectId` matches an expected value for the target environment.

#### Verification

Place a `firebase-applet-config.json` naming a different project in the repository root, build without `FIREBASE_PROJECT_ID` set, and confirm the build either ignores the file or fails with an explicit project-mismatch error. Confirm a build with no configuration at all fails rather than producing a bundle with empty Firebase values.

**Reconciliation note.** Raised in the baseline report as **FIND-51** and confirmed still live against the current working tree — `vite.config.ts` is unchanged in this respect. The initial re-scan marked the related database-id divergence (T06.T1) as mitigated and did not treat the config file as a separate repointing vector.

---

### FIND-31: Password visibility toggle renders the credential into the DOM

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 2.3 (CVSS:4.0/AV:L/AC:L/AT:P/PR:L/UI:A/VC:L/VI:N/VA:N) |
| CWE | [CWE-549](https://cwe.mitre.org/data/definitions/549.html): Missing Password Field Masking |
| OWASP | A07:2025 – Authentication Failures |
| Exploitation Prerequisites | Host/OS Access |
| Exploitability Tier | Tier 3 — Defense-in-Depth |
| Remediation Effort | Low |
| Mitigation Type | Custom Mitigation |
| Component | LoginUser |
| Related Threats | [T11.I2](2-stride-analysis.md#loginuser) |

#### Description

The sign-in form's reveal control switches the password input's `type` between `password` and `text`. While revealed, the credential is rendered as ordinary readable text in the DOM and remains so until the user toggles it back or leaves the page — there is no timeout and no automatic revert on blur or submit.

A reveal toggle is a legitimate usability feature and the finding is not that it exists. It is that the revealed state is unbounded in duration, which widens the set of observers well beyond the intended one: anyone in line of sight, anyone watching a shared screen during the increasingly common "let me just log in and show you" moment, any screen-recording or session-replay tool, and any browser extension with DOM read access. For the approver accounts covered by FIND-03, which have no second factor, an observed password is a complete account takeover.

#### Evidence

**Prerequisite basis:** LoginUser is listed in the Component Exposure Table as `Reachability = External`, `Min Prerequisite = None`, `Derived Tier = T1`. Observing the revealed DOM requires local presence, screen capture, or code running on the host, which is the canonical `Host/OS Access` prerequisite (Tier 3). The `AV:L` vector matches.

- `src/pages/LoginUser.tsx:79` — `type={showPassword ? "text" : "password"}`.
- `src/pages/LoginUser.tsx:87-94` — the toggle button flips `showPassword` with `setShowPassword((v) => !v)`; nothing resets it.
- `src/pages/LoginUser.tsx:14` — `const [showPassword, setShowPassword] = useState(false);` — no timer, and no reset in `handleLogin` (`:19-34`) or on blur.
- `src/pages/LoginUser.tsx:84` — `autoComplete="current-password"` is correctly set, so the field is otherwise handled properly; this is a targeted gap rather than a general credential-handling problem.

#### Remediation

Keep the toggle but bound it: auto-revert to masked after a few seconds, and revert on blur and on submit. Where the platform supports excluding an element from screen capture, apply it to this field. These are small changes to one component and do not affect the accessibility benefit the toggle provides.

#### Verification

Reveal the password and confirm it re-masks automatically after the configured interval, on blur, and on submit. Confirm the toggle still works for its intended purpose and that `autoComplete` behaviour is unchanged.

---

### FIND-35: Build inlines GEMINI_API_KEY into the client bundle on first reference

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 2.3 (CVSS:4.0/AV:L/AC:L/AT:P/PR:H/UI:N/VC:L/VI:N/VA:N) |
| CWE | [CWE-1188](https://cwe.mitre.org/data/definitions/1188.html): Initialization of a Resource with an Insecure Default |
| OWASP | A02:2025 – Security Misconfiguration |
| Exploitation Prerequisites | Admin Credentials |
| Exploitability Tier | Tier 3 — Defense-in-Depth |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | FirebaseClient |
| Related Threats | [T06.I3](2-stride-analysis.md#firebaseclient) |

#### Description

`vite.config.ts` declares `'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)` in its `define` block. Vite's `define` performs a compile-time textual substitution, so the literal value of the key is written into the output bundle at every site that references that identifier — and the bundle is public.

**No source file currently references it, so nothing is emitted today.** The key is not in the deployed bundle and this is not a live disclosure. What the finding records is that the mechanism remains armed: the substitution is configured, `GEMINI_API_KEY` is documented as a required secret in `.env.example` and `README.md`, and `@google/genai` sits in `dependencies` as an installed but unused package. The first developer to add a Gemini call the obvious way — reading `process.env.GEMINI_API_KEY` in a component, exactly as the existing Firebase configuration is read three lines further down in the same `define` block — ships a live API key to every visitor, with no build error, no lint failure, and nothing in review that flags it. The precedent in the file actively encourages that mistake, because every other entry in that block *is* meant to be public.

This is hardening work rather than a vulnerability, and it is recorded rather than closed precisely because "not currently exploitable" and "safe" are different claims.

#### Evidence

**Prerequisite basis:** realising the disclosure requires a code change reaching a production build, which is `Admin Credentials` (Tier 3). The `AV:L`/`PR:H` vector matches. This is above the FirebaseClient component floor of `None`.

- `vite.config.ts:53` — `'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),` as the first entry in `define`, immediately above the seven Firebase values that are legitimately public.
- `vite.config.ts:8` — `const env = loadEnv(mode, '.', '');` with an empty prefix, so unprefixed secrets in `.env` are loaded and available to `define`.
- A search across `src/` for `GEMINI_API_KEY`, `@google/genai`, and `GoogleGenAI` returns no matches — confirming nothing references it and the substitution never fires today.
- `package.json:16` — `"@google/genai": "^1.29.0"` is a declared runtime dependency with no importing code.
- `.env.example:1-4` and `README.md:18` both instruct the operator to set a real `GEMINI_API_KEY`, so the value is expected to exist in build environments.

#### Remediation

Delete the `GEMINI_API_KEY` entry from the `define` block and remove `@google/genai` from `dependencies` while neither is in use. If Gemini is added later, route the call through a Cloud Function that holds the key in the server-side runtime configuration and never expose it to the client. If the client must remain aware of the feature, expose a boolean flag rather than the key. Add a build or CI check that fails when any non-`FIREBASE_*` secret appears in `define`.

#### Verification

Confirm `GEMINI_API_KEY` no longer appears in `vite.config.ts`. Build the bundle and grep the output for the key's value to confirm absence. Confirm the application builds and runs unchanged with the dependency removed.

**Reconciliation note.** Raised in the baseline report as **FIND-08** ("Build pipeline injects GEMINI_API_KEY into the public client bundle"). The initial re-scan verified that no source file references the identifier and recorded it in the assessment's Additional Notes as explicitly *not* a finding. That verification was correct, but closing the item on it was not — the conclusion holds only for the current tree and says nothing about the configuration that makes it one line away from being false. Retained as open hardening work.

---

## Threat Coverage Verification

| Threat ID | Finding ID | Status |
|-----------|------------|--------|
| T01.T1 | FIND-11 | ✅ Mitigated (FIND-11) |
| T01.T2 | FIND-07 | ✅ Mitigated (FIND-07) |
| T01.I1 | FIND-24 | ✅ Covered (FIND-24) |
| T01.D1 | FIND-10 | ✅ Covered (FIND-10) |
| T01.E1 | FIND-11 | ✅ Mitigated (FIND-11) |
| T01.A1 | FIND-13 | ✅ Mitigated (FIND-13) |
| T02.S1 | FIND-16 | ✅ Covered (FIND-16) |
| T02.T1 | FIND-22 | ✅ Covered (FIND-22) |
| T02.I1 | FIND-21 | ✅ Covered (FIND-21) |
| T02.D1 | FIND-16 | ✅ Covered (FIND-16) |
| T02.E1 | FIND-11 | ✅ Mitigated (FIND-11) |
| T03.S1 | FIND-09 | ✅ Covered (FIND-09) |
| T03.S2 | FIND-16 | ✅ Covered (FIND-16) |
| T03.T1 | FIND-07 | ✅ Covered (FIND-07) |
| T03.T2 | FIND-08 | ✅ Covered (FIND-08) |
| T03.T3 | FIND-18 | ✅ Covered (FIND-18) |
| T03.T4 | FIND-23 | ✅ Covered (FIND-23) |
| T03.R1 | FIND-17 | ✅ Covered (FIND-17) |
| T03.R2 | FIND-13 | ✅ Covered (FIND-13) |
| T03.I1 | FIND-06 | ✅ Covered (FIND-06) |
| T03.I2 | FIND-05 | ✅ Covered (FIND-05) |
| T03.I3 | FIND-15 | ✅ Covered (FIND-15) |
| T03.D1 | FIND-10 | ✅ Covered (FIND-10) |
| T03.D2 | FIND-11 | ✅ Covered (FIND-11) |
| T03.D3 | FIND-26 | ✅ Covered (FIND-26) |
| T03.E1 | FIND-11 | ✅ Covered (FIND-11) |
| T03.E2 | FIND-14 | ✅ Covered (FIND-14) |
| T03.A1 | FIND-12 | ✅ Covered (FIND-12) |
| T03.A2 | FIND-08 | ✅ Covered (FIND-08) |
| T03.A3 | FIND-20 | ✅ Covered (FIND-20) |
| T04.T1 | FIND-34 | ✅ Covered (FIND-34) |
| T04.T2 | FIND-30 | ✅ Covered (FIND-30) |
| T04.I1 | FIND-01 | ✅ Mitigated (FIND-01) |
| T04.D1 | FIND-19 | ✅ Covered (FIND-19) |
| T04.A1 | FIND-18 | ✅ Covered (FIND-18) |
| T05.S1 | FIND-02 | ✅ Covered (FIND-02) |
| T05.S2 | FIND-03 | ✅ Covered (FIND-03) |
| T05.R1 | FIND-17 | ✅ Covered (FIND-17) |
| T05.I1 | — | 🔄 Mitigated by Platform |
| T05.D1 | — | 🔄 Mitigated by Platform |
| T05.E1 | FIND-16 | ✅ Covered (FIND-16) |
| T05.E2 | FIND-28 | ✅ Covered (FIND-28) |
| T05.A1 | FIND-02 | ✅ Covered (FIND-02) |
| T06.T1 | FIND-23 | ✅ Mitigated (FIND-23) |
| T06.T2 | FIND-33 | ✅ Covered (FIND-33) |
| T06.I1 | FIND-21 | ✅ Covered (FIND-21) |
| T06.I2 | FIND-29 | ✅ Covered (FIND-29) |
| T06.I3 | FIND-35 | ✅ Covered (FIND-35) |
| T06.A1 | FIND-02 | ✅ Mitigated (FIND-02) |
| T07.S1 | FIND-04 | ✅ Covered (FIND-04) |
| T07.T1 | FIND-04 | ✅ Covered (FIND-04) |
| T07.I1 | FIND-04 | ✅ Covered (FIND-04) |
| T07.D1 | — | 🔄 Mitigated by Platform |
| T07.A1 | FIND-04 | ✅ Mitigated (FIND-04) |
| T08.T1 | FIND-18 | ✅ Covered (FIND-18) |
| T08.I1 | FIND-01 | ✅ Mitigated (FIND-01) |
| T08.I2 | FIND-37 | ✅ Covered (FIND-37) |
| T08.D1 | FIND-19 | ✅ Covered (FIND-19) |
| T08.E1 | FIND-01 | ✅ Mitigated (FIND-01) |
| T08.A1 | FIND-18 | ✅ Covered (FIND-18) |
| T09.T1 | FIND-07 | ✅ Covered (FIND-07) |
| T09.R1 | FIND-17 | ✅ Covered (FIND-17) |
| T09.I1 | FIND-06 | ✅ Covered (FIND-06) |
| T09.D1 | FIND-10 | ✅ Covered (FIND-10) |
| T09.D2 | FIND-27 | ✅ Covered (FIND-27) |
| T09.E1 | FIND-11 | ✅ Mitigated (FIND-11) |
| T09.E2 | FIND-32 | ✅ Covered (FIND-32) |
| T09.A1 | FIND-11 | ✅ Covered (FIND-11) |
| T10.T1 | FIND-24 | ✅ Covered (FIND-24) |
| T10.I1 | FIND-24 | ✅ Covered (FIND-24) |
| T10.D1 | FIND-24 | ✅ Covered (FIND-24) |
| T10.A1 | FIND-24 | ✅ Covered (FIND-24) |
| T11.S1 | FIND-03 | ✅ Covered (FIND-03) |
| T11.I1 | FIND-02 | ✅ Mitigated (FIND-02) |
| T11.I2 | FIND-31 | ✅ Covered (FIND-31) |
| T11.D1 | — | 🔄 Mitigated by Platform |
| T11.A1 | FIND-02 | ✅ Covered (FIND-02) |
| T12.I1 | FIND-15 | ✅ Covered (FIND-15) |
| T12.E1 | FIND-13 | ✅ Mitigated (FIND-13) |
| T12.A1 | FIND-15 | ✅ Covered (FIND-15) |
| T13.T1 | FIND-25 | ✅ Covered (FIND-25) |
| T13.R1 | FIND-25 | ✅ Covered (FIND-25) |
| T13.D1 | FIND-25 | ✅ Covered (FIND-25) |
| T13.E1 | FIND-25 | ✅ Covered (FIND-25) |
| T14.T1 | FIND-11 | ✅ Mitigated (FIND-11) |
| T14.R1 | FIND-08 | ✅ Covered (FIND-08) |
| T14.I1 | FIND-06 | ✅ Covered (FIND-06) |
| T14.E1 | FIND-05 | ✅ Mitigated (FIND-05) |
| T14.A1 | FIND-08 | ✅ Covered (FIND-08) |
| T14.A2 | FIND-15 | ✅ Mitigated (FIND-15) |
| T15.T1 | FIND-07 | ✅ Covered (FIND-07) |
| T15.T2 | FIND-07 | ✅ Covered (FIND-07) |
| T15.T3 | FIND-36 | ✅ Covered (FIND-36) |
| T15.I1 | FIND-06 | ✅ Mitigated (FIND-06) |
| T15.A1 | FIND-07 | ✅ Covered (FIND-07) |
