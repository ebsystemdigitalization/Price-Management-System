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

The Pricing Management System is a CelcomDigi internal web application that routes enterprise service pricing requests through a four-rank financial approval chain, from Head of Sales up to the CFO. It is a React single-page application on Firebase Hosting backed by Firebase Authentication, Cloud Firestore, Cloud Storage, and ten Cloud Functions callables that hold the entire server-side authorization model. The data it handles — vendor cost bases, sales buffers, commission rates, and customer contract values — is commercially sensitive, and the decisions it records commit the company to customer pricing.

The intended security architecture is sound. The team made the two most important structural choices correctly: `firestore.rules` denies all direct client access, forcing every read and write through the Cloud Functions layer, and those callables re-read order state from the database and re-resolve the caller's role server-side rather than trusting anything the browser asserts. Viewer responses have cost fields stripped on the server, approval entries are stamped with the verified token identity and server clock, and Storage writes are scoped to the uploader's UID. These controls are documented as findings in their own right so the work is visible and preserved.

The assessment found that the first of those controls was not actually in force: `firestore.rules` was deployed to a named database while the application connects to `(default)`, and console verification confirmed `(default)` still carried permissive legacy rules. The deny-all posture the architecture rests on had therefore never applied to the database in use. **This has since been remediated and verified** — `firebase.json` now deploys the rules to both databases, and the `(default)` Rules tab confirms the deny-all ruleset is live (FIND-17, resolved). The data-layer boundary is now enforced.

A second defect found during the assessment has also been fixed: `updateMyDepartment` performed no role check and would create a profile document assigning the caller `role: "rank4"`, letting any authenticated account without an existing profile promote itself to approver. That handler has been rewritten and the fix verified against the deployed callable (FIND-15, resolved).

The workflow layer was the third and largest area of defect, and it has since been closed. `createOrder` wrote the client's order object straight through, leaving `status`, `approvalHistory`, `finalDecisionAuthorityRank`, and every financial total under the requester's control; `getOrder` applied no authorization beyond authentication and returned any order to any signed-in user; and the Rank 4 department check skipped itself entirely when an order carried no Head of Department, authorizing every Rank 4 holder rather than none. All of these were remediated and verified during the engagement (FIND-16, FIND-18, FIND-21, FIND-56). A requester can no longer pre-approve their own request, read another department's orders, or misstate any figure an approver reads.

What remains open is the perimeter around that now-sound core, rather than the core itself: the callables have no App Check, rate limiting, or invocation quota; approver accounts have no multi-factor authentication or password policy; and attachment download URLs are permanent and require no session. None of these permit a forged approval, but each weakens the assurance the approval chain provides.

The analysis covers 17 system elements across 3 trust boundaries.

### Risk Rating: Important

**Downgraded from Critical.** The report carries four Critical findings and **all four are now closed**, each remediated and verified against the deployed system during this engagement. With no open Critical remaining, the rating is set by the highest open severity, which is Important — led by [FIND-01](3-findings.md#find-01-callable-endpoints-have-no-app-check-rate-limiting-or-invocation-quota) (CVSS 8.7, Tier 1, exploitable with no prerequisites at all).

This is a downgrade in residual risk, not a statement that the system is finished. Nineteen Important findings remain open, and the rating should be re-examined again once the Tier 1 items are addressed.

Three were closed first, in this order:

- [FIND-15](3-findings.md#find-15-updatemydepartment-self-provisions-the-rank4-role-with-no-authorization-check) — self-service promotion to Rank 4 approver through `updateMyDepartment`. **Resolved and verified.**
- [FIND-16](3-findings.md#find-16-createorder-persists-client-controlled-workflow-state-and-financial-totals) — client-controlled approval state on `createOrder`. **Resolved and verified**: a forged order carrying `status: "Approved"`, a fabricated `approvalHistory`, and `Rank 4` stamped on every line item was confirmed to store as a `Draft` with an empty history and a correctly recomputed `Rank 1`.
- [FIND-17](3-findings.md#find-17-client-connects-to-a-firestore-database-the-deployed-rules-do-not-cover) — the `(default)` database carrying permissive legacy rules while the deny-all ruleset deployed elsewhere. **Resolved and verified.**

Together those close every path by which a requester could grant themselves approval authority, pre-approve their own request, or write approval state directly into the database. The approval chain now routes correctly and enforces rank, department, and creator ownership server-side.

**The fourth Critical is now closed.** [FIND-56](3-findings.md#find-56-client-supplied-financial-totals-are-persisted-without-server-side-recomputation) was split out of FIND-16 once that finding's workflow half was verified, and was remediated across two passes, each verified independently against the deployed function. **Resolved and verified.**

The first pass covered `totalRevenue`, `totalCost`, and every per-service monetary field, confirmed by a test that forged `999999` across all of them and found none surviving in the stored document. The second covered the six fields that reach the order through the metadata spread rather than the line items — `totalUpfrontPayment`, `totalOneTimeChargeB2S`, `totalFinancingRequest`, `financingLease`, and their inputs `option` and `contractPeriod` — confirmed by a two-order test that forged all four financial strings and drove `option` in both directions, since only one of those directions reaches the financing-lease calculation. The stored documents carried the server's own figures throughout: `option` recomputed against the forged flag in both directions, `contractPeriod` derived from the line items rather than the contradicting value submitted, and a non-zero `financingLease` proving the PMT branch actually executed rather than merely defaulting to zero.

Every financial figure persisted with an order is therefore recomputed server-side from the raw line items, and a requester can no longer misstate any number an approver reads.

Two lesser items remain within the finding, neither Critical: `createdAt` and `version` are still client-supplied, and `contractPeriod` retains an unconstrained magnitude in the fallback path used when financing does not apply, since no business rule defines a ceiling.

The order in which these were closed matters to how the result should be read. While `(default)` remained permissive, an attacker had no need of the workflow defects at all — they could set `status: "Approved"` on a document directly, bypassing every server-side check. FIND-17 was therefore the precondition for the rest of the model being meaningful, and the server-side fixes to `createOrder` only became load-bearing once it was closed. That sequencing held: FIND-17 was remediated and console-verified before the workflow fixes were relied upon.

One consideration works against the downgrade and should be weighed alongside it. The `functions/` directory contains only `src/index.ts` — there is no `package.json`, no `tsconfig.json`, and no `functions` block in `firebase.json` — and the root `tsconfig.json` explicitly excludes `functions` from compilation while `firebase-admin` and `firebase-functions` appear in neither `package.json` nor `package-lock.json`. The authorization layer that the entire model depends on therefore cannot be built, type-checked, or deployed from this repository by any documented means.

This was partially resolved during the engagement. Each remediation was confirmed by behavioural test against the live callable, and FIND-15's verification returned an error string introduced in this source — establishing that this source does reach production. The deployment mechanism remains undocumented, so the provenance gap itself stands (FIND-11, Moderate). It bears on the downgrade because every "verified" claim above rests on the deployed function continuing to match this source; without a release pipeline there is nothing enforcing that beyond the tests already run.

> **Note on threat counts:** This analysis identified 109 threats across 15 components. This count reflects comprehensive STRIDE-A coverage, not systemic insecurity. Of these, **24 are directly exploitable** without prerequisites (Tier 1). The remaining 85 represent conditional risks and defense-in-depth considerations.

---

## Action Summary

| Tier | Description | Threats | Findings | Priority |
|------|-------------|---------|----------|----------|
| [Tier 1](3-findings.md#tier-1--direct-exposure-no-prerequisites) | Directly exploitable | 24 | 14 | 🔴 Critical Risk |
| [Tier 2](3-findings.md#tier-2--conditional-risk-authenticated--single-prerequisite) | Requires authenticated access | 66 | 32 | 🟠 Elevated Risk |
| [Tier 3](3-findings.md#tier-3--defense-in-depth-prior-compromise--host-access) | Requires prior compromise | 19 | 10 | 🟡 Moderate Risk |
| **Total** | | **109** | **56** | |

### Priority by Tier and CVSS Score (Top 10)

| Finding | Tier | CVSS Score | SDL Severity | Title |
|---------|------|------------|-------------|-------|
| [FIND-01](3-findings.md#find-01-callable-endpoints-have-no-app-check-rate-limiting-or-invocation-quota) | T1 | 8.7 | Important | Callable endpoints have no App Check, rate limiting, or invocation quota |
| [FIND-02](3-findings.md#find-02-no-multi-factor-authentication-or-password-policy-on-approver-accounts) | T1 | 8.2 | Important | No multi-factor authentication or password policy on approver accounts |
| [FIND-03](3-findings.md#find-03-attachment-download-urls-are-unauthenticated-and-never-expire) | T1 | 7.1 | Important | Attachment download URLs are unauthenticated and never expire |
| [FIND-04](3-findings.md#find-04-sign-in-has-no-application-level-anti-automation-controls) | T1 | 6.9 | Important | Sign-in has no application-level anti-automation controls |
| [FIND-05](3-findings.md#find-05-no-http-security-headers-on-the-hosted-application) | T1 | 6.3 | Important | No HTTP security headers on the hosted application |
| [FIND-06](3-findings.md#find-06-no-corporate-domain-restriction-on-account-provisioning) | T1 | 5.3 | Important | No corporate domain restriction on account provisioning |
| [FIND-07](3-findings.md#find-07-account-enumeration-through-the-identity-api) | T1 | 5.3 | Moderate | Account enumeration through the identity API |
| [FIND-08](3-findings.md#find-08-build-pipeline-injects-gemini_api_key-into-the-public-client-bundle) | T1 | 5.1 | Moderate | Build pipeline injects GEMINI_API_KEY into the public client bundle |
| [FIND-09](3-findings.md#find-09-privilege-model-and-role-heuristics-are-shipped-in-the-public-bundle) | T1 | 4.8 | Moderate | Privilege model and role heuristics are shipped in the public bundle |
| [FIND-10](3-findings.md#find-10-error-helper-serialises-user-identity-into-logs-and-thrown-errors) | T1 | 4.3 | Moderate | Error helper serialises user identity into logs and thrown errors |

The four Critical findings in this report — [FIND-15](3-findings.md#find-15-updatemydepartment-self-provisions-the-rank4-role-with-no-authorization-check) (CVSS 8.7), [FIND-16](3-findings.md#find-16-createorder-persists-client-controlled-workflow-state-and-financial-totals) (CVSS 8.6), [FIND-56](3-findings.md#find-56-client-supplied-financial-totals-are-persisted-without-server-side-recomputation) (CVSS 8.5), and [FIND-17](3-findings.md#find-17-client-connects-to-a-firestore-database-the-deployed-rules-do-not-cover) (CVSS 8.2) — are Tier 2 and therefore fall outside this Tier-ordered table. **All four are resolved and verified.** Every approval-chain bypass path is closed and every persisted financial figure is server-computed.

With no Critical outstanding, the table above is now the work queue. [FIND-01](3-findings.md#find-01-callable-endpoints-have-no-app-check-rate-limiting-or-invocation-quota) is the first item: at CVSS 8.7 it is the highest-scoring open finding in the report, and being Tier 1 it needs no authentication at all.

### Quick Wins

| Finding | Title | Why Quick |
|---------|-------|-----------|
| [FIND-05](3-findings.md#find-05-no-http-security-headers-on-the-hosted-application) | No HTTP security headers on the hosted application | Adding a `headers` block to `firebase.json` is a configuration-only change with no code impact. |
| [FIND-02](3-findings.md#find-02-no-multi-factor-authentication-or-password-policy-on-approver-accounts) | No multi-factor authentication or password policy on approver accounts | Multi-factor authentication, password policy, and breach detection are console toggles on Identity Platform. |
| [FIND-07](3-findings.md#find-07-account-enumeration-through-the-identity-api) | Account enumeration through the identity API | Email-enumeration protection is a single setting in the Firebase Authentication console. |
| [FIND-08](3-findings.md#find-08-build-pipeline-injects-gemini_api_key-into-the-public-client-bundle) | Build pipeline injects GEMINI_API_KEY into the public client bundle | Deleting one `define` line in `vite.config.ts` and one unused dependency removes the exposure path entirely. |
| [FIND-10](3-findings.md#find-10-error-helper-serialises-user-identity-into-logs-and-thrown-errors) | Error helper serialises user identity into logs and thrown errors | The helper is imported but never invoked, so deleting it and its three imports is behaviour-neutral. |

---

## Analysis Context & Assumptions

### Analysis Scope

| Constraint | Description |
|------------|-------------|
| Scope | Full repository — React SPA (`src/`), Cloud Functions (`functions/src/`), Firebase configuration (`firebase.json`, `firestore.rules`, `storage.rules`), build configuration (`vite.config.ts`), and the operations script at the repository root. |
| Excluded | `node_modules/`, `dist/`, `.git/`, the vendored `skills (1)/` directory, and the shadcn/ui primitives under `components/ui/`, which are unmodified third-party presentation components with no security-relevant logic. |
| Focus Areas | Approval-workflow integrity, role and rank authorization, separation of the client and server trust boundaries, and handling of commercially sensitive cost and margin data. |

### Infrastructure Context

| Category | Discovered from Codebase | Findings Affected |
|----------|--------------------------|-------------------|
| Deployment Model | Public cloud SPA on Firebase Hosting with a catch-all SPA rewrite, backed by public HTTPS callables ([firebase.json](../firebase.json), [package.json](../package.json)) | All findings — classification `NETWORK_SERVICE`, Tier 1 permitted |
| Network Exposure | No reverse proxy, WAF, rate limiter, or private networking; all components reached over the public internet ([firebase.json](../firebase.json), [src/firebase.ts](../src/firebase.ts)) | FIND-01, FIND-04, FIND-05 |
| Data-Layer Access Control | Deny-all client rules ([firestore.rules](../firestore.rules)) now deployed to both `(default)` and the named database via the multi-database `firestore` array in [firebase.json](../firebase.json); console-verified live on `(default)` | FIND-17 (resolved), FIND-55 |
| Object-Layer Access Control | Write and delete scoped by UID; read granted to any authenticated user ([storage.rules](../storage.rules)) | FIND-19, FIND-24, FIND-45 |
| Server-Side Authorization | Role resolved server-side, order state re-read on every workflow call ([functions/src/index.ts](../functions/src/index.ts)) | FIND-15, FIND-16, FIND-18, FIND-42 |
| Deployment Pipeline | No CI/CD configuration of any kind; manual Firebase CLI deployment ([README.md](../README.md), [package.json](../package.json)) | FIND-11, FIND-51 |
| Functions Deployability | `functions/` contains only `src/index.ts` — no `package.json`, no `tsconfig.json`, and no `functions` block in [firebase.json](../firebase.json) | FIND-11, and the deployability question below |
| Secret Handling | `.env*` excluded from version control except the example; Vite `define` injects values at build time ([.gitignore](../.gitignore), [vite.config.ts](../vite.config.ts)) | FIND-08, FIND-13 |
| Deployment Pattern | Standalone application, not a Kubernetes operator — Platform classification limit is 20%; measured ratio is 5.5% (6 of 109 threats) | All Platform-classified threats |

### Needs Verification

| Item | Question | What to Check | Why Uncertain |
|------|----------|---------------|---------------|
| Retirement of the unused database | Does `ai-studio-remixremixservic-d5598bb1-…` hold any data, and can it be retired? | Compare document counts in `orders` across both databases. | Housekeeping only — not a security question. The client, the Cloud Functions Admin SDK, and the migration script now all name `(default)` explicitly, and `FIREBASE_DATABASE_ID=(default)` is set in both the repository and the production build environment, so the named database is confirmed vestigial. Both databases carry identical deny-all rules, so leaving it in place is safe; retiring it is a tidiness decision. |
| Cloud Functions deployment mechanism | By what path does `functions/src/index.ts` reach production, given this repository cannot deploy it? | Identify and document the pipeline, repository, or manual process that deploys the callables, then bring it under the release controls recommended in FIND-11. Cloud Shell is a likely candidate — it holds a firebase-admin install and was used for the rules deployment. | Partially resolved: FIND-15 verification confirmed the deployed callable returns an error string introduced by this repository's fix, so this source does reach production somehow, and the build environment is confirmed to run firebase-admin v13.10.0. But `functions/` still has no `package.json` or `tsconfig.json`, `firebase.json` has no `functions` block, and `firebase-admin`/`firebase-functions` are absent from the lockfile — so the mechanism remains undocumented, unreproducible from this repository, and unable to pin its own dependency versions. |
| Email-enumeration protection | Is email-enumeration protection enabled on the `celcomdigi-portal` project? | Firebase Authentication settings in the console. | The setting is not expressible in any repository file. Drives FIND-07. |
| Existing rank4 profile documents | Have any `users` documents been created with `role: "rank4"` by the `updateMyDepartment` path rather than by an administrator? | Audit the `users` collection for `rank4` documents and correlate against the intended approver roster. | FIND-15 shows the self-provisioning path exists; whether it has been exercised cannot be determined from code. |
| Migration script execution | Has `migrate-head-of-commercial.js` been run, and in what form? | Ask the operations owner; check Firestore for orders still carrying the legacy `authorityLevel` values. | The script uses CommonJS `require` while `package.json:5` declares `"type": "module"`, so it would not execute as written — it may have been run in a modified form. Drives FIND-46. |
| Storage object inventory | How many draft attachments exist, and do any carry content that does not match its declared type? | Enumerate the `draft-attachments/` prefix and sample object magic bytes against stored content types. | FIND-24 shows the type check is unenforceable server-side; whether it has been abused requires inspecting live data. |

### Finding Overrides

| Finding ID | Original Severity | Override | Justification | New Status |
|------------|-------------------|----------|---------------|------------|
| — | — | — | No overrides applied. Update this section after review. | — |

### Additional Notes

Two items about how this analysis was produced are worth recording. First, shell execution was unavailable in the analysis environment — every `bash` invocation failed with a fork error — so git metadata was read directly from the `.git` directory rather than obtained from git commands, and the timestamps in Report Metadata reflect the analysis session date rather than values captured from `Get-Date`. The repository has no configured remote and no commits on `master`, which is consistent with a downloaded working copy rather than a clone.

Second, one item that a review of this kind commonly flags has been deliberately recorded as a non-finding. The Firebase web configuration embedded in the client bundle, including the value labelled "API key", is the documented and intended design for Firebase web applications — that value is a project identifier rather than a credential, and access is governed by Firebase Authentication together with the security rules. It is documented in [FIND-13](3-findings.md#find-13-existing-control--firebase-web-configuration-in-the-bundle-is-by-design) so it is not re-raised as a hardcoded-secret defect. The genuinely sensitive value in the same `define` block, `GEMINI_API_KEY`, is a separate finding ([FIND-08](3-findings.md#find-08-build-pipeline-injects-gemini_api_key-into-the-public-client-bundle)) and is currently empty, so nothing leaks from the present build.

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
| NIST SP 800-53 Rev. 5 | https://csrc.nist.gov/pubs/sp/800-53/r5/upd1/final | Control mapping for audit, backup, and least-privilege recommendations |

### Component Documentation

| Component | Documentation URL | Relevant Section |
|-----------|------------------|------------------|
| Cloud Functions for Firebase | https://firebase.google.com/docs/functions/callable | Callable function authentication context and App Check enforcement |
| Firebase App Check | https://firebase.google.com/docs/app-check | Client attestation for callables and Storage |
| Cloud Firestore Security Rules | https://firebase.google.com/docs/firestore/security/get-started | Rule evaluation, deny-all posture, and multi-database rule deployment |
| Cloud Storage Security Rules | https://firebase.google.com/docs/storage/security | Read and write scoping, `request.resource.contentType` semantics |
| Firebase Storage download URLs | https://firebase.google.com/docs/storage/web/download-files | Download token behaviour and token revocation |
| Firebase Authentication | https://firebase.google.com/docs/auth/web/password-auth | Email and password sign-in, enumeration protection |
| Identity Platform multi-factor auth | https://cloud.google.com/identity-platform/docs/web/mfa | Multi-factor enrollment and enforcement |
| Firebase blocking functions | https://firebase.google.com/docs/auth/extend-with-blocking-functions | `beforeUserCreated` domain restriction |
| Firebase Hosting headers | https://firebase.google.com/docs/hosting/full-config#headers | `headers` block configuration for CSP and HSTS |
| Cloud Firestore transactions | https://firebase.google.com/docs/firestore/manage-data/transactions | Transactional read-modify-write and `arrayUnion` |
| Cloud Firestore PITR and exports | https://firebase.google.com/docs/firestore/use-pitr | Point-in-time recovery and scheduled export configuration |
| Firebase API key security | https://firebase.google.com/docs/projects/api-keys | Confirmation that web API keys are identifiers, not secrets |
| Vite environment variables | https://vite.dev/guide/env-and-mode | `define` substitution semantics and build-time injection |

---

## Report Metadata

| Field | Value |
|-------|-------|
| Source Location | `c:\Users\202122\Downloads\remix_-remix_-service-cost-management-system (1)` |
| Git Repository | `Unavailable — no remote configured in .git/config` |
| Git Branch | `master` |
| Git Commit | `Unavailable — no commits on branch` (`Unavailable`) |
| Model | `Claude Opus 5 (claude-opus-5)` |
| Machine Name | `Unavailable — shell execution failed in this environment` |
| Analysis Started | `2026-09-11 (session start date; Get-Date unavailable)` |
| Analysis Completed | `2026-09-14 (session end date; Get-Date unavailable)` |
| Duration | `Unavailable — shell execution failed in this environment, so no measured start or end timestamp exists` |
| Output Folder | `threat-model-20260911-120000` |
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
