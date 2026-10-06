# Threat Model Reconciliation

**Baseline (archived):** `threat-model-20260911-120000/` — 56 findings, 7 remediated and verified with recorded test evidence.
**Canonical:** `threat-model-20260921-094500/` — 37 findings (1 resolved, 36 open), 95 threats, 17 elements across 3 trust boundaries.

> **Status: reconciliation complete. `threat-model-20260921-094500/` is now the single source of truth.**
>
> The candidate report initially carried 25 findings. Ten more (FIND-26..FIND-35) were folded in from the baseline after this reconciliation identified issues the clean-room re-scan had not carried forward, each verified as still live against the working tree. Two overstated statuses in the new report were corrected. The baseline report is now safe to archive; it remains the evidence-of-record for the seven findings remediated on 2026-09-11, indexed from Part A below.

---

## What changed in the canonical report

| Metric | Before reconciliation | After |
|---|---|---|
| Findings | 25 | 37 (1 resolved) |
| Threats | 85 | 95 |
| Findings by tier | T1 4 / T2 18 / T3 3 | T1 4 / T2 26 / T3 7 |
| Threats by tier | T1 16 / T2 57 / T3 12 | T1 16 / T2 63 / T3 16 |
| Findings by severity | 1 Critical / 13 Important / 8 Moderate / 3 Low | 1 Critical / 13 Important / 17 Moderate / 6 Low |

No Tier 1 finding was added and no severity was raised, so the **Elevated** risk rating is unchanged. Everything folded in is Tier 2 or Tier 3.

Ten of the twelve additions (FIND-26..FIND-35) came from the baseline fold-in. **FIND-36** and **FIND-37** were found separately, during and as a consequence of the FIND-01 remediation, and have no baseline counterpart — see Remediation status below.

**Numbering:** FIND-26..FIND-37 are placed in correct sorted position (tier, then severity, then CVSS descending), so IDs are not strictly ascending in document order from FIND-14 onward. FIND-01..FIND-25 were deliberately *not* renumbered — those IDs are referenced in this document, in the carried-forward evidence, and in active remediation planning. This follows the precedent the baseline report set with its own FIND-56.

---

## Remediation status

**FIND-01 — RESOLVED AND VERIFIED (2026-09-23).** The only Critical finding in either report is closed. The fix landed on 2026-09-22 and was deployed and verified the following day: a `getAttachmentUrl` callable that authorizes with the same predicate as `getOrder` (minus viewers) before minting a 5-minute V4 signed URL; all three client render sites switched to it; `getDownloadURL` removed from the client entirely; `createOrder` strips the `url` field; and `revoke-attachment-tokens.js` run to invalidate previously-issued tokens.

Both deployment prerequisites — which were hard blockers, not advisories — were satisfied before deploy:

| Prerequisite | Resolution |
|---|---|
| Functions SA able to sign | `roles/iam.serviceAccountTokenCreator` granted on `898927828479-compute@developer.gserviceaccount.com`, self-granted |
| Signing bucket matches upload bucket | Confirmed `celcomdigi-portal.firebasestorage.app` (the newer `.firebasestorage.app` form, not `.appspot.com`) |

Verification evidence: functions and client both deployed; an approver successfully opened an attachment through the signed-URL path; the revocation script ran clean over 10 objects, all within `draft-attachments/`, tokens removed.

**Why this closes rather than merely improves.** Brokering new access would have left every URL already distributed — in browser history, forwarded mail, exported orders — valid and unauthenticated in perpetuity. Revoking `firebaseStorageDownloadTokens` on all 10 objects is what makes the prior leak historical. The object count being small and wholly within the modelled prefix also confirms no attachments existed outside it.

**Residual split out, following the baseline's own precedent.** Closing FIND-01 exposed that one of its four related threats was not addressed by the fix: **T08.I2**, filenames embedded in the object path and rendered to every reader. Verified still live — `Dashboard.tsx:78` still concatenates `file.name` into the path, and `OrderDetails.tsx:472` still renders `attachment.name` with no role gate. It is now **FIND-37** (Moderate, T2). The fix arguably widened this half: a viewer is now refused the file but still shown its name, so the filename is the only part of the attachment they receive and the part no authorization check governs. Splitting it let FIND-01 close cleanly, exactly as baseline FIND-16 closed by splitting off FIND-56.

Threat status changes: T04.I1, T08.I1, T08.E1 → `Mitigated`; T08.I2 stays `Open` under FIND-37. `FirebaseStorage` component risk moved High → Medium.

**Behaviour change now live:** viewers (account managers) could previously open attachments, because the attachment block in `OrderDetails` carries no role gate. They now receive `permission-denied`. Deliberate and confirmed as intended policy — attachments are the costing data `stripForViewer` exists to withhold (FIND-06). Note the block still renders filenames to them, which is precisely FIND-37.

**Regression watch.** Reintroducing any `getDownloadURL` call in the client silently re-mints a permanent token and reopens FIND-01 with no error surfacing. A grep returning only comment matches is the cheapest guard and is worth adding to CI.

**FIND-36 discovered during that work.** `SummaryReport.tsx:53-95` rebuilds `metadata` from an existing order field by field and omits `attachments`, so opening an order for edit drops them and re-confirming persists a version with none. Logged as its own finding and **deliberately not fixed** in the FIND-01 change, which touched only URL resolution. It is independent of FIND-01: attachments that are dropped are dropped regardless of how the surviving ones are served.

---

## Part A — Old Resolved findings vs the new independent scan

Verdict key: **Confirmed fixed** — the new scan does not re-flag the issue. **Partially confirmed** — the core is closed but the new scan flags a narrower residual. **Contradicted** — the new scan flags something the old report treated as closed or as an existing control.

| Old finding | Old severity | New scan verdict | New counterpart | What the new scan says |
|---|---|---|---|---|
| FIND-15 — `updateMyDepartment` self-provisions rank4 | Critical | **Confirmed fixed** | — (T02.E1 `Mitigated`) | The escalation path is not re-flagged anywhere. The new report credits `updateMyDepartment` as rejecting non-rank4 callers and never writing `role`. |
| FIND-16 — `createOrder` persists client workflow state | Critical | **Confirmed fixed** | — (credited as a control) | Listed in the new report's Security Infrastructure Inventory as "Server-side Level of Authority recomputation — strong existing control". No workflow-forgery finding exists in the new report. |
| FIND-56 — client-supplied financial totals persisted | Critical | **Partially confirmed** | FIND-07, FIND-20 | Core closed and credited. Both residuals the old report itself recorded are independently re-found: `version`/`createdAt` (→ FIND-07) and unbounded `contractPeriod` (→ FIND-20). |
| FIND-17 — client connects to an uncovered database | Critical | **Confirmed fixed** | — (T06.T1 `Mitigated`) | New scan reads `firebase.json` as a two-database array with identical rules and both call sites pinning `(default)`. Flagged only as a Needs-Verification item because the console could not be checked. See also FIND-33 — the *config-file* repointing vector is separate and still open. |
| FIND-18 — `getOrder` returns any order to any caller | Important | **Partially confirmed** | FIND-15 | `canAccessOrder` is credited as present and fail-closed. The documented residual — `listOrders` expanding results by order number while `canAccessOrder` evaluates one document — is independently re-found and escalated to its own finding. |
| FIND-19 — draft attachments readable by all authenticated | Important | **Confirmed fixed (SDK path only)** | FIND-01 (see Part B) | The SDK read path is not re-flagged. The owner-only read rule the fix introduced now appears in the new report as *part of the reason* FIND-01 is Critical. |
| FIND-21 — rank 4 department check fails open | Important | **Split: Confirmed fixed / Contradicted** | FIND-05 | `approveOrder`/`rejectOrder` confirmed fail-closed and credited. `listOrders` re-flagged as Important — but this was a **documented deliberate exclusion**, not a regression. See Part A.1. |

All seven have their evidence carried into the canonical report (Part F). The baseline report remains the full archive.

### A.1 — FIND-21 / new FIND-05: the one genuine disagreement

The old report closed FIND-21 across four code paths and explicitly declined a fifth:

> **Deliberately not changed:** the `matchesDept` expression in `listOrders` remains permissive. Enforcing at the action while leaving visibility open means an order that somehow lacks the field stays discoverable in a Rank 4's queue rather than silently vanishing. Visibility is not the security boundary here; authorization is.

The new scan, working from code alone, re-flagged exactly that expression as FIND-05 (Important, CVSS 7.1, `VC:H`).

**Assessment: the new report is substantively right, but the old report's operational concern is real and the new finding does not account for it.**

The old rationale holds only if visibility discloses nothing. It does not — `listOrders` returns *complete* order documents, so an out-of-department or department-less Rank 4 approver receives customer names, vendor costs, margins, and full approval history for departments they have no standing in. That is a confidentiality boundary, so "visibility is not the security boundary here" is the weaker half of the argument. But the old report's worry is legitimate: naively scoping visibility makes an order with a missing or non-canonical `headOfDepartment` vanish from every queue with nobody notified.

Both concerns are satisfiable at once, and the fix should do so rather than picking a side:
1. Scope `listOrders` with the fail-closed rule (reuse `canAccessOrder`, per new FIND-05's remediation).
2. Add an explicit unassigned/exception queue visible to admins so a stranded order surfaces somewhere instead of disappearing.
3. Keep the `createOrder` mandatory-`headOfDepartment` validation, which is what makes stranding rare in the first place.

Note the old report's pre-deployment audit found **0** orders in the stranding state, so the practical blast radius of step 1 is currently nil. That audit evidence is the reason step 1 is now low-risk, and it is carried into FIND-05.

---

## Part B — New FIND-01 vs old FIND-03 and FIND-19

**Direct answer: new FIND-01 is primarily a re-statement of old FIND-03, which was never remediated. It is not a re-opening of FIND-19 — FIND-19's fix holds. But FIND-01 is genuinely broader than FIND-03 was, and one of the three reasons it is broader is a direct consequence of FIND-19's fix.**

Lineage:

| Component of new FIND-01 | Origin | Status |
|---|---|---|
| `getDownloadURL` tokens are permanent, unauthenticated, and persisted on the order document | Old **FIND-03**, Important / CVSS 7.1 | **Never remediated.** Carried forward essentially unchanged. |
| Tokenized URLs survive the viewer redaction and outlive order-level scope | Old **FIND-19**'s explicitly documented residual | **Known and recorded**, not a new discovery. |
| Storage rules give approvers *no* legitimate read path, so link possession is the only working access mechanism | **New** (new-report threat T08.E1) | **Genuinely new** — and it is a consequence of FIND-19's fix. |

The old report anticipated most of this with unusual precision. FIND-19's remediation states:

> **This fix achieves considerably less than it appears to, and should not be read as closing attachment confidentiality.** […] Firebase download tokens bypass security rules entirely. Every such URL already issued remains valid and unauthenticated regardless of this change. […] The two findings should be treated as a pair, with FIND-03 as the one that carries the actual confidentiality benefit.

So FIND-19 did not "partially fix" FIND-01 — the two address disjoint paths. FIND-19 closed the SDK read path; FIND-01 is the token path, which FIND-19 never touched and said so.

**Why the escalation from Important/7.1 to Critical/8.7 is justified, and it is not double-counting.** Three things changed:

1. **FIND-03 was never fixed**, so its exposure has simply persisted.
2. **FIND-19's fix removed the legitimate alternative.** Before it, an approver could in principle reach an attachment through the SDK. After it, `allow read: if request.auth.uid == userId` means only the uploader can — so the tokenized URL is no longer a sloppy convenience running alongside a proper path, it is the *sole* mechanism by which approvals happen. Authorization for the deal's supporting evidence is now entirely outside the access-control system. That is a structural downgrade, and it is the correct trigger for Critical.
3. The new report also adds the attachment-swap and filename-disclosure angles (T08.A1, T08.I2) that FIND-03 did not cover.

**Practical consequence for sequencing:** FIND-01 and old FIND-19 must not be treated as independent items on a backlog. FIND-19 is closed and should stay closed — do *not* loosen `storage.rules` to give approvers access. The correct fix is FIND-01's: an authorizing callable that mints short-lived signed URLs, plus revocation of every existing download token. Until that lands, the FIND-19 fix makes the approver workflow depend on an unauthenticated URL, which is worse than it looks from either finding read alone.

Note that **FIND-34** (content type never verified) now compounds this: the object behind that unauthenticated URL is not verified to be the file type it claims.

---

## Part C — Folded in: old findings now carried as new findings

These were live in the code, had no adequate counterpart in the initial re-scan, and are now first-class findings in the canonical report. Each was re-verified against the working tree rather than accepted from the baseline text.

| Old | New | Severity / Tier | Code evidence confirming it is still live |
|---|---|---|---|
| FIND-35 — approval comment length unbounded | **FIND-26** | Moderate / T2 | `approveOrder` and `rejectOrder` validate only `!comment.trim()`; no `.length` check. `OrderDetails` `Textarea` has no `maxLength`. |
| FIND-50 — `approvalHistory` toward the 1 MB limit | **FIND-27** | Moderate / T2 | Whole-array rewrite per decision, inline on the order document, no cap. |
| FIND-36 — stale privileges for the ID token lifetime | **FIND-28** | Moderate / T2 | No callable calls `verifyIdToken(token, true)`; revocation is never consulted. |
| FIND-37 — dev server binds all interfaces | **FIND-29** | Moderate / T2 | `package.json:7` → `"dev": "vite --port=3000 --host=0.0.0.0"`. |
| FIND-39 — client and rules size limits disagree | **FIND-30** | Low / T2 | `Dashboard.tsx:68` applies one 100 MB ceiling to both types; `storage.rules:18` caps PDFs at 5 MB. |
| FIND-54 — password toggle exposes the credential | **FIND-31** | Low / T3 | `LoginUser.tsx:79` → `type={showPassword ? "text" : "password"}`, with no timeout or revert. |
| FIND-49 — Admin SDK unrestricted project-wide access | **FIND-32** | Moderate / T3 | `functions/src/index.ts:5` bare `initializeApp()`; one shared `getFirestore` handle for all ten callables. **Completes the partial fold** — T09.T1 had captured only the schema-validation half. |
| FIND-51 — build-time config file can repoint the app | **FIND-33** | Moderate / T3 | `vite.config.ts:11-19` reads `firebase-applet-config.json`; `:41-47` uses it as fallback; not in `.gitignore`. **Confirmed still a live risk.** |
| FIND-24 — upload content type client-declared | **FIND-34** | Moderate / T2 | `storage.rules:17-25` tests `request.resource.contentType`, the client-declared value. No content verification anywhere. |
| FIND-08 — `GEMINI_API_KEY` in the public bundle | **FIND-35** | Low / T3 | `vite.config.ts:53` still declares the `define` substitution. Nothing references the identifier today, so nothing is emitted — retained as hardening, not disclosure. |

### C.1 — Two corrections this fold-in forced on the new report

Both were cases where the re-scan **overstated a control**, and both are recorded inside the relevant findings rather than silently amended.

**Threat T04.T1 — was `Mitigated`, now `Open`.** The re-scan credited `storage.rules` with enforcing content type. It does not: `request.resource.contentType` is what the uploading client declares, so the rule compares an assertion to a string. The baseline report's FIND-24 was correct. Now carried by FIND-34, and the misjudgement is documented in that finding's Verification section.

**`GEMINI_API_KEY` — was a documented non-finding, now FIND-35.** The re-scan's observation was accurate: no source file references `process.env.GEMINI_API_KEY`, so Vite's substitution never fires and the key is not in the bundle. Closing on that was still wrong — the conclusion holds only for the current tree, and the `define` entry sits in the same block as seven legitimately-public Firebase values, which makes referencing it the natural mistake. "Not currently exploitable" and "safe" are different claims.

### C.2 — A modelling limitation the fold-in introduced

FIND-29, FIND-33 and FIND-35 all concern the build and dev-configuration surface (`vite.config.ts`, `package.json` scripts), which the canonical report's DFD does not model as a component — it models the deployed system. All three are attributed to **FirebaseClient**, whose fingerprint already carries the `FIREBASE_*` build-time config keys. This is defensible but imprecise. A future full re-run should model a distinct build/dev component so these stop sharing a component with the SDK bootstrap.

---

## Part D — Old findings superseded and safe to archive

These have a new counterpart equal or broader in scope. Work from the canonical report; the baseline text is historical.

| Old | New | Note |
|---|---|---|
| FIND-01 App Check / rate limiting / quota | FIND-10 | New finding folds App Check into the read-amplification remediation. |
| FIND-02 MFA and password policy | FIND-03 | Equivalent. New adds the step-up-before-approval recommendation. |
| FIND-05 No HTTP security headers | FIND-04 | Equivalent; new adds clickjacking-of-approval framing. |
| FIND-06 No corporate domain restriction | FIND-02 | New is broader — adds the unverified-`email_verified` angle. |
| FIND-10 Error helper serialises identity | FIND-21 | Equivalent. |
| FIND-20 One admin satisfies every rank | FIND-14 | Equivalent. |
| FIND-22 Cost data gated only in browser | FIND-06 + T14.I1 | New is broader (see Part E.3). |
| FIND-23 Divergent identity resolution | FIND-16 | Equivalent; new adds the uid/email dual-key disagreement. |
| FIND-25 Approval transitions not transactional | FIND-12 | Equivalent. |
| FIND-26 No audit trail | FIND-17 | Equivalent. |
| FIND-27 `listOrders` full scan on 4s poll | FIND-10 | Equivalent. |
| FIND-28 Withdraw/resubmit resets history | FIND-08 | Equivalent. |
| FIND-29 Client controls order number and version | FIND-07 | New is broader — adds `createdAt` and the version-grafting attack. |
| FIND-31 No attachment quota or retention | FIND-19 | Equivalent. |
| FIND-32 Draft state parsed without validation | FIND-24 (T10.T1) | Equivalent. |
| FIND-33 Duplication copies another team's terms | FIND-15 (T12.A1) | Equivalent. |
| FIND-34 Viewer scope on display-name match | FIND-09 | Equivalent. |
| FIND-40 Optimistic department update | FIND-22 | Equivalent. |
| FIND-46 Migration script unrestricted | FIND-25 | Equivalent. |
| FIND-47 Drafts persist after sign-out | FIND-24 | Equivalent. |
| FIND-52 No field-level encryption | FIND-06 / T09.I1 | Folded in; new proposes subcollection split. |
| FIND-53 Local storage quota unguarded | FIND-24 (T10.D1) | Equivalent. |
| FIND-04 Sign-in anti-automation | T11.D1 `Platform` | Divergence, accepted: the new report classifies provider-side throttling as a platform control rather than a finding. |
| FIND-07 Account enumeration via identity API | T05.I1 `Platform` | Same — depends on the project-level enumeration-protection setting, which is in Needs Verification. |
| FIND-09 Privilege model in the public bundle | FIND-16 (partly) | The role-heuristic half is covered; shipping client-side guards is inherent to an SPA and credited as mitigated. |
| FIND-11 No release pipeline or provenance | FIND-23 | Narrower in the new report (dependency pinning); the provenance question survives in Needs Verification. |
| FIND-38 Order-number counter hot document | T09.A1 | Folded as counter consumption rather than write contention. |
| FIND-41 Profile resolution blocks the interface | T02.D1 | Folded. |
| FIND-48 No backup / PITR / audit logging | FIND-17 | Folded; PITR appears in FIND-13 and FIND-17 remediation. |
| FIND-12/13/14/42/43/45/55 "Existing control" entries | Credited in new report | Carried as `Mitigated` threats and Security Infrastructure Inventory rows. |

Plus the seven resolved findings in Part A.

---

## Part E — Where the two reports contradicted each other

**E.1 — `GEMINI_API_KEY`.** Resolved in the baseline's favour on the substance, the new report's on the facts: the key is not in today's bundle, but the mechanism is armed. Now **FIND-35**.

**E.2 — Upload content type.** Resolved in the baseline's favour. The new report's `Mitigated` status was wrong. Now **FIND-34**, with T04.T1 reverted to `Open`.

**E.3 — Viewer cost stripping.** Resolved in the new report's favour. Old FIND-44 recorded the mechanism as an *existing control*; new FIND-06 shows `ORDER_SENSITIVE_FIELDS` contains only `totalCost`, so `totalOneTimeChargeB2S` — the sum of one-time `totalCost + totalSST` — reaches viewers intact, along with `totalRevenue` for margin derivation.

E.3 is the most instructive item in this reconciliation. **Old FIND-56's own remediation added `totalOneTimeChargeB2S` as a server-computed field, and the strip list was never extended to match** — a verified fix silently degraded a separate verified control. FIND-44's assessment was accurate when written and was invalidated by a later fix. Whatever regression check you adopt should assert that *every* server-computed cost field appears in the viewer strip list, rather than enumerating fields by hand.

---

## Part F — Evidence carry-over

The baseline report's verification evidence is carried into the seven corresponding findings in the canonical report, appended to each one's existing `#### Verification` section under a bolded **"Prior verification history — carried forward from …"** lead naming the source finding and date (2026-09-11).

Applied to: **FIND-01** (← old FIND-03, FIND-19), **FIND-05** (← FIND-21), **FIND-06** (← FIND-44, FIND-22, FIND-56), **FIND-07** (← FIND-56, FIND-29), **FIND-15** (← FIND-18), **FIND-16** (← FIND-23, FIND-15), **FIND-20** (← FIND-56).

What was carried: test-harness method and result tables, the exact checks run, what was explicitly *not* covered, deliberate-exclusion rationale, and any recorded outstanding action — including the `users`-collection audit for unexplained `rank4` documents, noted in FIND-16 and still outstanding.

The ten folded findings (FIND-26..FIND-35) each carry a **Reconciliation note** naming their baseline origin instead, since none of them had remediation evidence to carry.

**Why it went inside `#### Verification` rather than into a new sub-section.** The skill's `verification-checklist.md` Phase 1 asserts every `### FIND-` block has exactly four sub-headings — `Description`, `Evidence`, `Remediation`, `Verification` — and fails on extras. A fifth heading would have made the canonical report fail its own structural gate.

**Not carried, deliberately:** evidence from old findings with no re-flagged counterpart (Part D) was left in the baseline. Copying closed, uncontested history into 35 findings would bury the live items. The baseline is the archive of record; this document is the index into it.

---

## Part G — Known deviations from the skill's conventions

Recorded so a future verification run does not read them as defects:

| Deviation | Rule | Why |
|---|---|---|
| Finding IDs not ascending in document order from FIND-14 onward | Orchestrator Rule 21 ("renumber after sorting") | FIND-26..FIND-35 are in correct *sorted* position but keep appended IDs. Renumbering FIND-01..FIND-25 would break every reference in this document, in the carried-forward evidence, and in active remediation planning. Same precedent as the baseline's FIND-56. |
| Three findings attributed to FirebaseClient that concern build/dev config | Component must appear in the Exposure Table | No build/dev component is modelled; see Part C.2. |
| Empty-tier placeholder wording in `2-stride-analysis.md` | Skeleton says `*No Tier N threats identified.*` | The verification checklist requires `*…identified for this component.*` and governs pass/fail. Checklist followed. |

---

## Suggested sequence

1. ~~**FIND-01**~~ — **done** (resolved and verified 2026-09-23). The attachment work it opened is not finished, though: **FIND-34** (the object behind those URLs is still not verified to be the type it claims), **FIND-36** (the edit path silently deletes attachments), and **FIND-37** (filenames still disclosed, including to viewers now refused the file). These three are small, share the same code, and are best done as one pass while the context is fresh.
2. **FIND-02 + FIND-11 together** — one exposure: unrestricted identity plus a default write-capable role. Add **FIND-28**, since deprovisioning is the other half of identity control.
3. **FIND-06** — one-line strip-list fix, plus the regression assertion from Part E.3.
4. **FIND-05** — apply the combined fix from Part A.1, not the new report's remediation alone.
5. **FIND-17 first, then FIND-07, FIND-08, FIND-12, FIND-26, FIND-27** — the audit-integrity cluster. FIND-17 must land first because the others need somewhere to write. **FIND-08 and FIND-27 must land together**: fixing FIND-08 removes the accidental entry-count cap that currently bounds FIND-27, so fixing it alone converts an audit fix into a denial-of-service vector.
6. **Quick wins, any time:** FIND-04, FIND-29, FIND-30, FIND-31, FIND-35 — all Low effort, none coupled to anything above.
7. **FIND-32 and FIND-23 together** — least-privilege plus dependency pinning; an unpinned dependency is the most plausible route to the compromise FIND-32 assumes.
