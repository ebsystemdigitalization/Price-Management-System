# Security Assessment

---

## Report Files

| File | Description |
|------|-------------|
| [0-assessment.md](0-assessment.md) | This document — executive summary, risk rating, action plan, metadata |
| [0.1-architecture.md](0.1-architecture.md) | Architecture overview, components, scenarios, tech stack |
| [1-threatmodel.md](1-threatmodel.md) | Threat model DFD diagram with element, flow, and boundary tables |
| [1.1-threatmodel.mmd](1.1-threatmodel.mmd) | Pure Mermaid DFD source file |
| [1.2-threatmodel-summary.mmd](1.2-threatmodel-summary.mmd) | Summary DFD for large systems |
| [2-stride-analysis.md](2-stride-analysis.md) | Full STRIDE-A analysis for all components |
| [3-findings.md](3-findings.md) | Prioritized security findings with remediation |

---

## Executive Summary

This repository implements a Financial Approval request system: sales requesters build service costing sheets, the system derives a Level of Authority from each line item's EBITDA margin, and the request is routed through a four-rank approval chain ending at the CFO. It is a React single-page application backed entirely by Firebase — Cloud Functions callables, Firestore, Storage, and Authentication — with no self-managed infrastructure.

The backend has clearly been hardened already, and several controls are genuinely well-built. `firestore.rules` denies every direct client read and write, forcing all data access through the Admin SDK inside the callables. Every one of the nine callables begins by rejecting unauthenticated requests. `createOrder` strips client-supplied workflow state and recomputes the entire Level of Authority calculation — costs, SST, installment PMT, EBITDA margin, bucket thresholds, and the resulting approval rank — from raw line-item inputs, so the routing decision cannot be manipulated from the browser. Order numbers are allocated inside a Firestore transaction. These are real mitigations and the analysis credits them as such.

The most serious issue this analysis found has since been fixed. Attachment authorization was effectively absent: `getDownloadURL` tokens were persisted on order documents and served the underlying vendor quotes and costing spreadsheets to any unauthenticated party holding the link, while the Storage rules gave approvers no legitimate read path at all — making link possession the de facto access control. That is closed and verified as of 2026-09-23 (FIND-01): access is now brokered by an authorizing callable issuing short-lived signed URLs, and the previously-leaked tokens were revoked. One component of it remains open as FIND-37 — filenames are still disclosed to readers refused the file itself.

What remains is concentrated in two places. First, the authorization model is inconsistent between its read and write paths: the Rank 4 department check fails closed in `approveOrder` but fails open in `listOrders`, the viewer redaction misses a derived field that equals the cost it is meant to hide, and three identity-bearing fields (`orderNumber`, `version`, `createdAt`) pass into storage unvalidated. Second, the system keeps no security audit log of any kind — the only record of who approved what lives inside the order document, and `submitForApproval` clears it on every resubmission. Both clusters are unaffected by the attachment fix.

The analysis covers 17 system elements across 3 trust boundaries.

### Risk Rating: Elevated

No unauthenticated path reaches the order data or the approval workflow itself: the callables verify tokens, the security rules deny direct access, and the authority recomputation removes the most valuable tampering target. That keeps this below a Critical rating.

**The single Critical finding, FIND-01, has since been remediated and verified** (2026-09-23) — commercially sensitive attachments are no longer retrievable by URL possession, and the previously-leaked tokens were revoked rather than merely superseded. That removes the most serious exposure in this report and closes the only unauthenticated data-retrieval path.

The rating nonetheless remains **Elevated**, for reasons that were always independent of FIND-01. Two Tier 1 authentication gaps are open and Important: nothing restricts which identities the project accepts (FIND-02), and accounts that authorise material financial commitments are protected by a password alone (FIND-03). Several authorization defects are live rather than theoretical: an approver with no department assigned currently sees every request pending at their rank across all three departments (FIND-05), the viewer redaction leaks the aggregate cost it exists to withhold (FIND-06), and any requester can graft a forged higher-version document onto another user's FA number (FIND-07). The absence of audit logging (FIND-17) compounds all of it, since none of these paths would leave evidence if exercised. A downgrade to Moderate should follow the authentication and access-control cluster, not this one fix.

> **Note on threat counts:** This analysis identified 95 threats across 15 components. This count reflects comprehensive STRIDE-A coverage, not systemic insecurity. Of these, **16 are directly exploitable** without prerequisites (Tier 1). The remaining 79 represent conditional risks and defense-in-depth considerations.

---

## Action Summary

| Tier | Description | Threats | Findings | Priority |
|------|-------------|---------|----------|----------|
| [Tier 1](3-findings.md#tier-1--direct-exposure-no-prerequisites) | Directly exploitable | 16 | 4 | 🔴 Critical Risk |
| [Tier 2](3-findings.md#tier-2--conditional-risk-authenticated--single-prerequisite) | Requires authenticated access | 63 | 26 | 🟠 Elevated Risk |
| [Tier 3](3-findings.md#tier-3--defense-in-depth-prior-compromise--host-access) | Requires prior compromise | 16 | 7 | 🟡 Moderate Risk |
| **Total** | | **95** | **37** | |

Counts include findings that have been remediated and closed. **1 of 37 findings is resolved** (FIND-01, verified 2026-09-23); 36 remain open.

### Priority by Tier and CVSS Score (Top 10)

| Finding | Tier | CVSS Score | SDL Severity | Title |
|---------|------|------------|-------------|-------|
| [FIND-01](3-findings.md#find-01-attachment-download-urls-are-unauthenticated-bearer-capabilities) | T1 | 8.7 | Critical | Attachment download URLs are unauthenticated bearer capabilities |
| [FIND-02](3-findings.md#find-02-no-identity-provider-restriction-on-account-provisioning-or-sign-in) | T1 | 8.7 | Important | No identity-provider restriction on account provisioning or sign-in |
| [FIND-03](3-findings.md#find-03-no-multi-factor-authentication-on-financial-approval-accounts) | T1 | 8.2 | Important | No multi-factor authentication on financial-approval accounts |
| [FIND-04](3-findings.md#find-04-firebase-hosting-serves-the-application-without-security-response-headers) | T1 | 5.1 | Moderate | Firebase Hosting serves the application without security response headers |
| [FIND-05](3-findings.md#find-05-rank-4-department-scoping-fails-open-in-listorders) | T2 | 7.1 | Important | Rank 4 department scoping fails open in listOrders |
| [FIND-06](3-findings.md#find-06-viewer-redaction-leaks-aggregate-cost-through-totalonetimechargeb2s) | T2 | 7.1 | Important | Viewer redaction leaks aggregate cost through totalOneTimeChargeB2S |
| [FIND-07](3-findings.md#find-07-createorder-trusts-client-supplied-ordernumber-version-and-createdat) | T2 | 7.1 | Important | createOrder trusts client-supplied orderNumber, version and createdAt |
| [FIND-08](3-findings.md#find-08-submitforapproval-erases-the-approval-audit-trail) | T2 | 7.1 | Important | submitForApproval erases the approval audit trail |
| [FIND-09](3-findings.md#find-09-viewer-authorization-is-keyed-to-a-free-text-account-manager-name) | T2 | 7.1 | Important | Viewer authorization is keyed to a free-text account-manager name |
| [FIND-10](3-findings.md#find-10-unbounded-firestore-read-amplification-from-the-four-second-poll) | T2 | 7.1 | Important | Unbounded Firestore read amplification from the four-second poll |

This table is the mechanical tier-then-CVSS ordering and retains FIND-01 at its original severity, per the convention for resolved findings. **FIND-01 is closed and needs no action** — the highest-priority open item is FIND-02.

### Quick Wins

| Finding | Title | Why Quick |
|---------|-------|-----------|
| [FIND-02](3-findings.md#find-02-no-identity-provider-restriction-on-account-provisioning-or-sign-in) | No identity-provider restriction on account provisioning or sign-in | A single `beforeSignIn` blocking function plus disabling self-service sign-up in the console closes a Tier 1 authentication gap without touching application code. |
| [FIND-04](3-findings.md#find-04-firebase-hosting-serves-the-application-without-security-response-headers) | Firebase Hosting serves the application without security response headers | One `headers` block added to `firebase.json` and redeployed; no code change, and it removes the clickjacking and referrer-leak paths at once. |

---

## Analysis Context & Assumptions

### Analysis Scope

| Constraint | Description |
|------------|-------------|
| Scope | Entire repository at the working-tree state: the React SPA under [src/](../src/) and [components/ui/](../components/ui/), the Cloud Functions callables in [functions/src/index.ts](../functions/src/index.ts), the security rules in [firestore.rules](../firestore.rules) and [storage.rules](../storage.rules), the hosting and database configuration in [firebase.json](../firebase.json), the build configuration in [vite.config.ts](../vite.config.ts), and the maintenance script [migrate-head-of-commercial.js](../migrate-head-of-commercial.js). |
| Excluded | `node_modules/`, `.git/`, `dist/` build output, and the prior report folder `threat-model-20260911-120000/` (preserved untouched). Third-party npm package internals were not audited beyond declared versions. |
| Focus Areas | Authorization correctness across the approval chain, the read/write consistency of role scoping, client-versus-server trust boundaries, attachment access control, audit and non-repudiation, and resource-consumption limits. |

### Infrastructure Context

| Category | Discovered from Codebase | Findings Affected |
|----------|--------------------------|-------------------|
| Deployment pattern | Standalone application (React SPA on Firebase Hosting plus 2nd-gen callable functions) — [firebase.json](../firebase.json), [package.json](../package.json). No Kubernetes, containers, or operator patterns, so the ≤20% Platform-mitigation limit applies; the actual ratio is 4/85 (4.7%). | All |
| Identity | Firebase Authentication email/password only, with no blocking function, domain allow-list, MFA policy, or `email_verified` check — [src/pages/LoginUser.tsx](../src/pages/LoginUser.tsx), [functions/src/index.ts](../functions/src/index.ts). | FIND-02, FIND-03, FIND-16 |
| Data access control | `allow read, write: if false` on `orders`, `users`, `counters`, plus a catch-all deny — [firestore.rules](../firestore.rules). All access is forced through the Admin SDK. Verified effective; documented as a control, not a gap. | FIND-05, FIND-06, FIND-11, FIND-15 |
| Object storage | Owner-scoped path rules with content-type and size conditions — [storage.rules](../storage.rules). Tokenized `getDownloadURL` links are outside the reach of these rules. | FIND-01, FIND-19 |
| Server-side recomputation | `authorityForService` plus the `createOrder` rollup re-derive cost, SST, PMT, EBITDA margin, authority level, and rank from raw inputs — [functions/src/index.ts](../functions/src/index.ts). Strong existing control; it is what keeps client-side tampering out of the routing decision. | FIND-07 (scope limited to the three fields it does not cover) |
| Supply chain | Root [package.json](../package.json) declares the client `firebase` SDK; `functions/` declares nothing and has no lockfile, so the Admin SDK version is environment-determined. | FIND-23 |
| Transport and edge | Firebase Hosting managed TLS with platform HSTS on `*.web.app`; no `headers` block, no App Check, no WAF or rate limiting configured anywhere. | FIND-04, FIND-10 |
| Databases configured | [firebase.json](../firebase.json) deploys the same ruleset to two Firestore databases: `(default)` and `ai-studio-remixremixservic-d5598bb1-8a51-4e0b-bbad-dc118e2c4552`. The functions and the migration script pin `(default)` explicitly; the client falls through to the implicit default when `FIREBASE_DATABASE_ID` is unset. | Noted under Needs Verification |

### Needs Verification

| Item | Question | What to Check | Why Uncertain |
|------|----------|---------------|---------------|
| Self-service account creation | Is Email/Password self-service sign-up disabled for this project? | Identity Platform console → Sign-in method → Email/Password → user actions; attempt `accounts:signUp` against the Identity Toolkit REST API with the public web API key. | The repository has no sign-up UI, but the provider's REST sign-up endpoint is enabled by default and nothing in the code disables it. If enabled, FIND-02 combined with FIND-11 means anyone on the internet can obtain write access. |
| Email-enumeration protection | Is the project-level email-enumeration protection setting enabled? | Identity Platform console → Settings → User actions. | Threat T05.I1 is classified `Platform` on the assumption this control is on; it is a console setting with no repository representation. |
| User provisioning practice | Do `users` documents exist for every real user, and are they keyed by UID or by email? | Enumerate the `users` collection and compare document ids against Firebase Auth UIDs. | `getCallerProfile` accepts either key and defaults to the Requester role when neither exists. The severity of FIND-11 and FIND-16 depends on how many principals are unprovisioned or dual-keyed. |
| Active Firestore database | Which of the two configured databases holds production data, and is `FIREBASE_DATABASE_ID` set in the deployed build? | Firebase console → Firestore → database list and document counts; inspect the deployed bundle for the injected `FIREBASE_DATABASE_ID` value. | `firebase.json` configures two databases. The functions pin `(default)`; if the client build injects the other id, the two would diverge. Both currently resolve to `(default)`, so T06.T1 is recorded as mitigated. |
| Admin SDK version | Which `firebase-admin` major version does the deploy environment resolve? | Run `npm ls firebase-admin` in the functions deploy environment. | `getFirestore("(default)")` requires v12+; the source comment records v13.10.0 was observed, but no lockfile enforces it. See FIND-23. |
| App Check enrolment | Is Firebase App Check enabled at project level even though the code does not enforce it? | Firebase console → App Check → apps and enforcement status per service. | No `initializeAppCheck` call exists in [src/firebase.ts](../src/firebase.ts) and no `enforceAppCheck` option is set on any callable, so the analysis assumes it is absent. This affects the severity of FIND-10. |
| Records retention obligation | What retention period applies to approved FA requests? | Finance and legal records-retention policy. | FIND-13 recommends retention over hard deletion; the required period is a business input the repository does not contain. |
| Git history baseline | Was this working tree ever committed? | `git log` on the repository. | `HEAD` points at `refs/heads/master`, which does not resolve, and no remote is configured — so no commit SHA or commit date could be recorded, and no commit-to-commit comparison was possible. |

### Finding Overrides

| Finding ID | Original Severity | Override | Justification | New Status |
|------------|-------------------|----------|---------------|------------|
| — | — | — | No overrides applied. Update this section after review. | — |

### Additional Notes

**FIND-01 was remediated, deployed, and verified on 2026-09-23** — see that finding's Verification section for the evidence, including the IAM grant, the confirmed signing bucket, and the token-revocation run. Its status is `Resolved`; severity is retained at Critical to record the exposure while it was open. Closing it surfaced one residual that its fix did not address, now tracked as **FIND-37** (attachment filenames disclosed to readers refused the file). Threats T04.I1, T08.I1 and T08.E1 moved to `Mitigated`; T08.I2 remains `Open` under FIND-37. `FirebaseStorage` risk moved from High to Medium, since both of its Tier 1 threats are now closed.

**This report was revised after a reconciliation against the baseline report `threat-model-20260911-120000`.** FIND-26 through FIND-35 were folded in from that baseline — issues it had raised that the independent re-scan did not carry forward, verified as still live against the working tree. The reconciliation, including the full old-to-new mapping and the verification evidence carried across, is recorded in [THREAT-MODEL-RECONCILIATION.md](../THREAT-MODEL-RECONCILIATION.md). Finding IDs are therefore not strictly ascending in document order in `3-findings.md`; see the numbering note at the head of that file. This report is the canonical source of truth going forward.

Two statuses were also corrected during that revision, both because this report had **overstated** a control:

- **Threat T04.T1 (upload content type)** was recorded as `Mitigated` on the reasoning that `storage.rules` enforces content type. That was wrong: `request.resource.contentType` is the value the uploading client declares, so the rule checks an assertion rather than the bytes. The baseline report's FIND-24 had this right. T04.T1 is now `Open` and carried by FIND-34.
- **`GEMINI_API_KEY`** was recorded here as explicitly not a finding, on the correct observation that no source file references the identifier and so nothing is emitted into the bundle today. The observation holds; closing on it did not. `vite.config.ts` still declares the `define` substitution, so the key ships the moment any file reads that identifier — and the seven legitimately-public Firebase entries sitting beside it in the same block make that an easy mistake to walk into. Retained as open hardening work in FIND-35.

One item remains deliberately **not** recorded as a finding, because verification showed it to be secure by design:

- **Firebase web configuration in the client bundle.** [vite.config.ts](../vite.config.ts) injects the API key, project id, and app id into the compiled bundle. This is the documented Firebase web model — the config is a project identifier, not a credential — and every callable independently verifies an ID token while `firestore.rules` denies direct access. Recorded as threat T06.A1 with status `Mitigated`.

**Modelling limitation introduced by the fold-in.** FIND-29 (dev server binding), FIND-33 (config-file repointing) and FIND-35 (GEMINI substitution) all concern the build and development configuration surface — `vite.config.ts` and the `package.json` scripts — which this report's DFD does not model as a distinct component, because the DFD models the deployed system. All three are recorded against FirebaseClient, whose fingerprint already carries the `FIREBASE_*` build-time configuration keys. A future full re-run should consider modelling a separate build/dev component so these stop sharing a component with the SDK bootstrap.

The analysis environment had **no working shell**: every `Bash` invocation failed with a fork error (`Resource temporarily unavailable`). Git metadata was therefore read directly from `.git/`, and the `Get-Date` timestamps required by the workflow could not be captured. The Analysis Started and Analysis Completed values below are session dates rather than command-captured timestamps, `Duration` could not be measured, and `Machine Name` could not be obtained. The output folder name encodes the start date; the analysis ran across the 2026-09-21/2026-09-22 date boundary.

Per the skill's Rule 34, the prior report folder `threat-model-20260911-120000/` was read for component-identifier stability only and was not modified, moved, or deleted. Component IDs, boundary IDs, and data-flow IDs were deliberately kept consistent with that baseline so the two runs remain comparable.

---

## References Consulted

### Security Standards

| Standard | URL | How Used |
|----------|-----|----------|
| Microsoft SDL Bug Bar | https://www.microsoft.com/en-us/msrc/sdlbugbar | Severity classification |
| OWASP Top 10:2025 | https://owasp.org/Top10/2025/ | Threat categorization |
| CVSS 4.0 | https://www.first.org/cvss/v4.0/specification-document | Risk scoring |
| CWE | https://cwe.mitre.org/ | Weakness classification |
| STRIDE | https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats | Threat enumeration |
| OWASP Application Security Verification Standard | https://owasp.org/www-project-application-security-verification-standard/ | Access-control and logging control expectations |

### Component Documentation

| Component | Documentation URL | Relevant Section |
|-----------|------------------|------------------|
| CloudFunctions | https://firebase.google.com/docs/functions/callable | Callable request authentication context and App Check enforcement |
| FirebaseAuth | https://firebase.google.com/docs/auth/extend-with-blocking-functions | `beforeCreate` and `beforeSignIn` blocking functions for domain and verification gating |
| FirebaseAuth | https://firebase.google.com/docs/auth/web/multi-factor | Multi-factor enrolment and the sign-in resolver flow |
| Firestore | https://firebase.google.com/docs/firestore/security/get-started | Security rules evaluation and Admin SDK rule bypass |
| Firestore | https://firebase.google.com/docs/firestore/manage-data/transactions | Transactions for read-modify-write consistency |
| FirebaseStorage | https://firebase.google.com/docs/storage/web/download-files | Download URLs, access tokens, and token revocation |
| FirebaseHosting | https://firebase.google.com/docs/hosting/full-config#headers | Custom response headers configuration |
| Firebase App Check | https://firebase.google.com/docs/app-check | Attestation for callable functions and Storage |

---

## Report Metadata

| Field | Value |
|-------|-------|
| Source Location | `c:\Users\202122\Downloads\remix_-remix_-service-cost-management-system (1)` |
| Git Repository | `unavailable — no git remote configured` |
| Git Branch | `master` |
| Git Commit | `unavailable — HEAD points at refs/heads/master, which does not resolve` (`unavailable — no commits on HEAD`) |
| Model | `claude-opus-5` |
| Machine Name | `unavailable — no shell available in the analysis environment` |
| Analysis Started | `2026-09-21 (session date at start; Get-Date unavailable)` |
| Analysis Completed | `2026-09-22 (session date at completion; Get-Date unavailable)` |
| Duration | `unavailable — no shell available to capture start and end timestamps` |
| Output Folder | `threat-model-20260921-094500` |
| Prompt | `Run the STRIDE analysis based on the skills folder against the whole project` |

---

## Classification Reference

| Classification | Values |
|---------------|--------|
| **Exploitability Tiers** | **T1** Direct Exposure (no prerequisites) · **T2** Conditional Risk (single prerequisite) · **T3** Defense-in-Depth (multiple prerequisites or infrastructure access) |
| **STRIDE + Abuse** | **S** Spoofing · **T** Tampering · **R** Repudiation · **I** Information Disclosure · **D** Denial of Service · **E** Elevation of Privilege · **A** Abuse (feature misuse) |
| **SDL Severity** | `Critical` · `Important` · `Moderate` · `Low` |
| **Remediation Effort** | `Low` · `Medium` · `High` |
| **Mitigation Type** | `Redesign` · `Standard Mitigation` · `Custom Mitigation` · `Existing Control` · `Accept Risk` · `Transfer Risk` |
| **Threat Status** | `Open` · `Mitigated` · `Platform` |
| **Incremental Tags** | `[Existing]` · `[Fixed]` · `[Partial]` · `[New]` · `[Removed]` (incremental reports only) |
| **CVSS** | CVSS 4.0 vector with `CVSS:4.0/` prefix |
| **CWE** | Hyperlinked CWE ID (e.g., [CWE-306](https://cwe.mitre.org/data/definitions/306.html)) |
| **OWASP** | OWASP Top 10:2025 mapping (e.g., A01:2025 – Broken Access Control) |
