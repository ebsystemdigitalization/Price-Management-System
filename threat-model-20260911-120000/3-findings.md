# Security Findings

---

## Tier 1 — Direct Exposure (No Prerequisites)

### FIND-01: Callable endpoints have no App Check, rate limiting, or invocation quota

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 8.7 (CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:H/SC:N/SI:N/SA:N) |
| CWE | [CWE-770](https://cwe.mitre.org/data/definitions/770.html): Allocation of Resources Without Limits or Throttling |
| OWASP | A02:2025 – Security Misconfiguration |
| Exploitation Prerequisites | None |
| Exploitability Tier | Tier 1 — Direct Exposure |
| Remediation Effort | Medium |
| Mitigation Type | Standard Mitigation |
| Component | CloudFunctions |
| Related Threats | [T11.S1](2-stride-analysis.md#cloudfunctions), [T11.D1](2-stride-analysis.md#cloudfunctions) |

#### Description

All ten Firebase callable functions are published as public HTTPS endpoints on `*.cloudfunctions.net`. A container is allocated and the invocation is billed before the handler's `request.auth` check executes, so an unauthenticated attacker can drive Cloud Functions cost and cold-start pressure without ever holding a credential. There is no Firebase App Check registration anywhere in the repository, which means there is also no attestation that a request originated from the official web application — any scripted HTTP client holding a valid ID token can invoke the workflow directly, outside every client-side guard.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists CloudFunctions as `Listens On: 0.0.0.0:443`, `Auth Required: No at endpoint; Yes in handler`, `Reachability: External`, `Min Prerequisite: None`. The endpoint accepts unauthenticated requests and returns an error only after the handler runs.

Every handler in `functions/src/index.ts` begins with the same pattern, which runs inside the billed invocation rather than at the edge — for example `functions/src/index.ts:63`, `:81`, `:134`, `:223`, `:290`, `:327`, `:360`, `:405`, `:427`, `:466`. No `enforceAppCheck` option is passed to any `onCall`, no `maxInstances` or concurrency limit is configured, and the repository contains no App Check initialization on the client side (`src/firebase.ts:1-26`).

#### Remediation

Register the web app with Firebase App Check using reCAPTCHA Enterprise, initialize App Check in `src/firebase.ts`, and set `enforceAppCheck: true` in the options object of every `onCall` declaration so unattested requests are rejected before the handler body runs. Set a `maxInstances` ceiling per function to bound worst-case spend, and add per-caller rate limiting keyed on `request.auth.uid` for the write-path callables.

#### Verification

Invoke any callable with `curl` and no App Check token and confirm the response is rejected at the platform layer. Confirm in the Google Cloud console that each function reports a configured maximum instance count, and that App Check enforcement metrics show unattested requests being denied.

---

### FIND-02: No multi-factor authentication or password policy on approver accounts

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 8.2 (CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-308](https://cwe.mitre.org/data/definitions/308.html): Use of Single-factor Authentication |
| OWASP | A07:2025 – Authentication Failures |
| Exploitation Prerequisites | None |
| Exploitability Tier | Tier 1 — Direct Exposure |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | FirebaseAuth |
| Related Threats | [T14.S1](2-stride-analysis.md#firebaseauth), [T14.S2](2-stride-analysis.md#firebaseauth) |

#### Description

The application authenticates exclusively with email and password, and nothing in the repository enables a second factor, a password complexity policy, rotation, or breached-credential detection. The accounts protected by this single factor include the CFO (Rank 1) and CEBO (Rank 2) approvers, whose sign-off commits the company to customer contract values. A single phished or reused password is therefore sufficient to impersonate a financial approver end-to-end.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists FirebaseAuth as `Listens On: identitytoolkit.googleapis.com:443`, `Auth Required: No (sign-in accepts unauthenticated attempts)`, `Reachability: External`, `Min Prerequisite: None`.

`src/pages/LoginUser.tsx:27` calls `signInWithEmailAndPassword(auth, email, password)` as the only sign-in path, and `src/firebase.ts:21` exports a plain `getAuth(app)` with no multi-factor resolver. No Identity Platform configuration, blocking function, or `firebase.json` authentication block is present in the repository.

#### Remediation

Upgrade the project to Firebase Authentication with Identity Platform and enable multi-factor authentication, then require enrollment for every account carrying an approver role (`rank1` through `rank4`) and for `admin`. Enable the password policy and breached-credential detection features in the same console, and handle the `multi-factor-auth-required` error in `LoginUser` to drive the second-factor prompt.

#### Verification

Sign in as a test account holding `rank1` and confirm a second factor is demanded before the ID token is issued. Attempt to set a password from a known-breached list and confirm it is rejected.

---

### FIND-03: Attachment download URLs are unauthenticated and never expire

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 7.1 (CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-1391](https://cwe.mitre.org/data/definitions/1391.html): Use of Weak Credential |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | None |
| Exploitability Tier | Tier 1 — Direct Exposure |
| Remediation Effort | Medium |
| Mitigation Type | Redesign |
| Component | FirebaseStorage |
| Related Threats | [T13.I1](2-stride-analysis.md#firebasestorage), [T06.I](2-stride-analysis.md#dashboard), [T08.I1](2-stride-analysis.md#orderdetails) |

#### Description

Attachment uploads call `getDownloadURL()`, which mints a Cloud Storage URL carrying a permanent access token. That token bypasses Firebase Storage security rules entirely: anyone who presents the URL retrieves the object with no session, no role check, and no expiry. The application then persists these URLs inside the order document and renders them as ordinary anchor links wherever the order is displayed, so the URLs propagate into browser history, referrer headers, forwarded emails, and any downstream system that receives an exported order. The objects behind them are vendor quotations and cost breakdowns.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists FirebaseStorage as `Auth Required: Yes for SDK paths; No for tokenized download URLs`, `Reachability: External`, `Min Prerequisite: None`. The tokenized URL path requires no credential.

`src/pages/Dashboard.tsx:93` performs `const url = await getDownloadURL(uploadTask.snapshot.ref)` and `src/pages/Dashboard.tsx:94-102` stores that URL in the `Attachment` record alongside the object path. The URL is then rendered directly into `href` at `src/pages/OrderDetails.tsx:452-456` and again at `src/pages/SummaryReport.tsx:791-797`. The `Attachment.url` field is declared in `src/types.ts:141` and travels with the order document into Firestore.

#### Remediation

Stop persisting download URLs. Store only `Attachment.path` (already present at `src/types.ts:142`) and add a callable that verifies the caller may view the parent order, then returns a short-lived signed URL generated server-side with the Admin SDK. Update `OrderDetails` and `SummaryReport` to fetch the URL on demand rather than reading it from the document, and revoke the existing download tokens on all stored objects.

#### Verification

Confirm that newly created orders contain no `url` field on their attachments. Copy a download link from a rendered attachment, open it in a browser with no session, and confirm it is refused once the stored token has been revoked.

---

### FIND-04: Sign-in has no application-level anti-automation controls

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 6.9 (CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:L/VA:L/SC:N/SI:N/SA:N) |
| CWE | [CWE-307](https://cwe.mitre.org/data/definitions/307.html): Improper Restriction of Excessive Authentication Attempts |
| OWASP | A07:2025 – Authentication Failures |
| Exploitation Prerequisites | None |
| Exploitability Tier | Tier 1 — Direct Exposure |
| Remediation Effort | Medium |
| Mitigation Type | Standard Mitigation |
| Component | LoginUser |
| Related Threats | [T03.S](2-stride-analysis.md#loginuser), [T03.D](2-stride-analysis.md#loginuser) |

#### Description

The sign-in screen imposes no attempt counter, no progressive delay, no lockout, and no CAPTCHA. Credential stuffing against known corporate addresses is bounded only by Firebase's default quotas, which are not tuned for this application. The same absence creates a denial-of-service path in the other direction: an attacker who deliberately fails sign-in against a known approver's address can trip Firebase's per-account throttling and lock that approver out of the portal while a request awaits their decision.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists LoginUser as `Auth Required: No (unauthenticated entry point)`, `Reachability: External`, `Min Prerequisite: None`.

`src/pages/LoginUser.tsx:19-34` shows `handleLogin` with only an empty-field guard and a `loading` flag; there is no attempt tracking across submissions, and `setLoading(false)` in the `finally` block immediately re-enables the button. No CAPTCHA component or App Check token is attached to the sign-in call.

#### Remediation

Enable Firebase App Check with reCAPTCHA Enterprise so automated clients are rejected before reaching Identity Toolkit. Add a client-side attempt counter that applies a progressive delay after repeated failures, and enable Identity Platform's built-in protections for password sign-in. Pair this with monitoring so targeted lockouts are visible to operations.

#### Verification

Script ten consecutive failed sign-ins from one client and confirm that a CAPTCHA challenge or a progressive delay is imposed before the tenth attempt reaches the identity endpoint.

---

### FIND-05: No HTTP security headers on the hosted application

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 6.3 (CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-1021](https://cwe.mitre.org/data/definitions/1021.html): Improper Restriction of Rendered UI Layers or Frames |
| OWASP | A02:2025 – Security Misconfiguration |
| Exploitation Prerequisites | None |
| Exploitability Tier | Tier 1 — Direct Exposure |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | FirebaseHosting |
| Related Threats | [T10.T](2-stride-analysis.md#firebasehosting) |

#### Description

`firebase.json` contains no `headers` block, so every response from the hosted application is served without `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, or `Strict-Transport-Security`. The approval portal can therefore be embedded in a hostile frame and overlaid to trick an approver into clicking Approve, and any script that reaches the page — through a compromised dependency or a future injection defect — executes with no origin restriction and can exfiltrate freely. The absent `Referrer-Policy` also means the tokenized attachment URLs described in FIND-03 leak in referrer headers to any external site an approver navigates to.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists FirebaseHosting as `Listens On: 0.0.0.0:443`, `Auth Required: No`, `Reachability: External`, `Min Prerequisite: None`.

`firebase.json:9-22` defines the `hosting` object with only `public`, `ignore`, and `rewrites` keys — no `headers` array is present. The rewrite at `firebase.json:16-21` returns `index.html` for every path, so the missing headers apply to every route in the application.

#### Remediation

Add a `headers` block to the `hosting` object in `firebase.json` applying to `**`, setting `Content-Security-Policy` with `frame-ancestors 'none'` and `default-src 'self'` plus the `*.googleapis.com` and `*.firebaseio.com` origins the SDK requires, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Strict-Transport-Security` with a one-year max-age. Deploy and validate the CSP in report-only mode first to catch legitimate SDK origins.

#### Verification

Fetch the deployed site and confirm the response carries all five headers. Attempt to load the portal inside an `<iframe>` on a different origin and confirm the browser blocks the frame.

---

### FIND-06: No corporate domain restriction on account provisioning

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 5.3 (CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-1391](https://cwe.mitre.org/data/definitions/1391.html): Use of Weak Credential |
| OWASP | A07:2025 – Authentication Failures |
| Exploitation Prerequisites | None |
| Exploitability Tier | Tier 1 — Direct Exposure |
| Remediation Effort | Medium |
| Mitigation Type | Standard Mitigation |
| Component | FirebaseAuth |
| Related Threats | [T14.A](2-stride-analysis.md#firebaseauth), [T03.A](2-stride-analysis.md#loginuser) |

#### Description

Nothing in the codebase, the Firebase configuration files, or the sign-in screen restricts which email domains may hold accounts in the `celcomdigi-portal` project. Any address provisioned in the project — including an externally controlled one added in error or by a compromised administrator — reaches the approval portal and is assigned the default `user` role, from which the privilege-escalation path in FIND-15 becomes available. The absence of a domain boundary also means the role and department heuristics, which key off substrings in the email address, operate on addresses the organization does not control.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists FirebaseAuth as `Auth Required: No (sign-in accepts unauthenticated attempts)`, `Reachability: External`, `Min Prerequisite: None`.

`src/pages/LoginUser.tsx:63-71` accepts any value in the email field with only `type="email"` validation and a `you@celcomdigi.com` placeholder. Server-side, `getCallerProfile` at `functions/src/index.ts:33-46` and `getDepartmentFromEmail` at `functions/src/index.ts:12-24` consume `token.email` with no domain check. The repository contains no blocking Authentication function.

#### Remediation

Add a `beforeUserCreated` blocking Authentication function that rejects any address outside the approved corporate domains, and add a matching `beforeSignIn` check so pre-existing out-of-domain accounts cannot sign in. Audit the existing user list in the Firebase console for addresses outside the allow-list.

#### Verification

Attempt to provision an account on an external domain and confirm the blocking function rejects it. Confirm an existing in-domain account still signs in normally.

---

### FIND-07: Account enumeration through the identity API

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 5.3 (CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-204](https://cwe.mitre.org/data/definitions/204.html): Observable Response Discrepancy |
| OWASP | A07:2025 – Authentication Failures |
| Exploitation Prerequisites | None |
| Exploitability Tier | Tier 1 — Direct Exposure |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | FirebaseAuth |
| Related Threats | [T14.I](2-stride-analysis.md#firebaseauth) |

#### Description

Unless email-enumeration protection is enabled on the Firebase project, the Identity Toolkit REST endpoint returns distinguishable errors for an unknown address versus a wrong password. The generic message rendered by the sign-in screen closes this channel in the UI only; an attacker calling the API directly still learns which staff addresses hold accounts, which is exactly the reconnaissance needed to target the credential-stuffing path in FIND-04 and the single-factor weakness in FIND-02. No configuration in the repository enables the protection, so its state must be confirmed in the console.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists FirebaseAuth as `Auth Required: No (sign-in accepts unauthenticated attempts)`, `Reachability: External`, `Min Prerequisite: None`.

`src/pages/LoginUser.tsx:29-31` discards the Firebase error code and renders one fixed string, so the discrepancy is not observable through the SPA. The underlying call at `src/pages/LoginUser.tsx:27` goes straight to Identity Toolkit, whose raw response the attacker can obtain by calling the endpoint directly with the public API key from `src/firebase.ts:11`. The repository contains no Identity Platform configuration file.

#### Remediation

Enable email-enumeration protection in the Firebase Authentication settings for the `celcomdigi-portal` project so the identity endpoint returns an indistinguishable error for unknown addresses and wrong passwords.

#### Verification

Call the Identity Toolkit `signInWithPassword` endpoint directly with a known-nonexistent address and with a known address plus a wrong password, and confirm both responses are identical.

---

### FIND-08: Build pipeline injects GEMINI_API_KEY into the public client bundle

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 5.1 (CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-615](https://cwe.mitre.org/data/definitions/615.html): Inclusion of Sensitive Information in Source Code Comments |
| OWASP | A04:2025 – Cryptographic Failures |
| Exploitation Prerequisites | None |
| Exploitability Tier | Tier 1 — Direct Exposure |
| Remediation Effort | Low |
| Mitigation Type | Redesign |
| Component | FirebaseClient |
| Related Threats | [T04.I1](2-stride-analysis.md#firebaseclient) |

#### Description

The Vite configuration substitutes `process.env.GEMINI_API_KEY` into the compiled bundle at build time. A Gemini API key is a genuine billing credential, unlike the Firebase web configuration alongside it, so any value present in the build environment is published verbatim to every visitor who fetches the JavaScript. The key is currently empty in `.env` and `@google/genai` is never imported anywhere under `src/`, so nothing leaks from the present build — but the substitution is unconditional, and the moment a key is configured for a future feature it will be exposed. The unused dependency makes that a plausible next step rather than a hypothetical one.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists FirebaseClient as `Auth Required: No (config shipped in public bundle)`, `Reachability: External`, `Min Prerequisite: None`. The bundle is served to unauthenticated clients by FirebaseHosting.

`vite.config.ts:53` declares `'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)` inside the `define` block, which performs a literal text substitution into the output. `.env:7` currently reads `GEMINI_API_KEY=` with no value. `package.json:16` declares `"@google/genai": "^1.29.0"` as a runtime dependency with no corresponding import under `src/`. `.env.example:1-4` documents the key as required, which invites a future operator to populate it.

#### Remediation

Remove the `GEMINI_API_KEY` entry from the `define` block in `vite.config.ts` and drop the unused `@google/genai` dependency from `package.json`. If Gemini is adopted later, call it from a Cloud Function that reads the key from a server-side secret so the credential never enters the bundle, and remove the key from `.env.example` so it is not treated as a client-side value.

#### Verification

Set a placeholder value for `GEMINI_API_KEY`, run `npm run build`, and grep the emitted files under `dist/` for that value — it must not appear.

---

### FIND-09: Privilege model and role heuristics are shipped in the public bundle

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 4.8 (CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-497](https://cwe.mitre.org/data/definitions/497.html): Exposure of Sensitive System Information to an Unauthorized Control Sphere |
| OWASP | A02:2025 – Security Misconfiguration |
| Exploitation Prerequisites | None |
| Exploitability Tier | Tier 1 — Direct Exposure |
| Remediation Effort | Medium |
| Mitigation Type | Redesign |
| Component | AuthProvider |
| Related Threats | [T02.I1](2-stride-analysis.md#authprovider), [T10.I](2-stride-analysis.md#firebasehosting) |

#### Description

Because the SPA is served in full to unauthenticated clients, the complete privilege model travels with it: the seven role names, the department mapping table, and — most usefully to an attacker — the heuristic that promotes any account whose email address contains the substring `rank4`. An unauthenticated attacker who fetches the bundle learns exactly which address patterns map to elevated roles before attempting any access, which directly informs the account-provisioning path in FIND-06 and the identity-resolution weaknesses in FIND-23.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists AuthProvider as `Auth Required: No (runs before a session exists)`, `Reachability: External`, `Min Prerequisite: None`, and FirebaseHosting as `Min Prerequisite: None`.

`src/context/AuthContext.tsx:33-45` defines `getDepartmentFromEmail` with the literal substring table `region`, `public`, `glc`, `named`, `corporate`, `strategic`, `corp`. `src/context/AuthContext.tsx:99-101` contains `else if (user.email.toLowerCase().includes("rank4"))` followed by `setActualRole("rank4")`. `src/context/AuthContext.tsx:7` enumerates every role name. The catch-all rewrite at `firebase.json:16-21` serves this bundle to any client.

#### Remediation

Remove `getDepartmentFromEmail` and the `rank4` substring branch from the client entirely, relying solely on the values returned by `getMyProfile`. Remove the equivalent server-side heuristics as described in FIND-23 so the mapping ceases to exist rather than merely moving out of view.

#### Verification

Build the bundle and grep `dist/` for the strings `rank4`, `glc`, and `ePerolehan`-adjacent department literals; the role-promotion heuristic must not appear.

---

### FIND-10: Error helper serialises user identity into logs and thrown errors

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 4.3 (CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-532](https://cwe.mitre.org/data/definitions/532.html): Insertion of Sensitive Information into Log File |
| OWASP | A09:2025 – Security Logging and Alerting Failures |
| Exploitation Prerequisites | None |
| Exploitability Tier | Tier 1 — Direct Exposure |
| Remediation Effort | Low |
| Mitigation Type | Redesign |
| Component | FirebaseClient |
| Related Threats | [T04.I2](2-stride-analysis.md#firebaseclient) |

#### Description

`handleFirestoreError` builds an object containing the signed-in user's UID, email address, email-verification state, anonymity flag, tenant id, and the provider id and email of every linked identity, then writes it to `console.error` and embeds the same JSON in the message of the `Error` it throws. Any consumer that renders an error message — a toast, an error boundary, a third-party error-reporting SDK — would surface that identity payload. The helper is imported in three modules but never actually invoked, so it is dormant code shipped in the public bundle rather than an active leak; that also means it can be removed with no behavioural change.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists FirebaseClient as `Auth Required: No (config shipped in public bundle)`, `Reachability: External`, `Min Prerequisite: None`.

`src/firebase.ts:54-73` constructs `errInfo` with `auth.currentUser?.uid`, `.email`, `.emailVerified`, `.isAnonymous`, `.tenantId`, and a map over `providerData`, then executes `console.error('Firestore Error: ', JSON.stringify(errInfo))` at line 71 and `throw new Error(JSON.stringify(errInfo))` at line 72. It is imported at `src/App.tsx:11`, `src/context/AuthContext.tsx:5`, and `src/pages/OrderDetails.tsx:16`, with no call site in any of them.

#### Remediation

Delete `handleFirestoreError`, the `FirestoreErrorInfo` interface, and the `OperationType` enum from `src/firebase.ts`, and remove the now-unused imports from `src/App.tsx`, `src/context/AuthContext.tsx`, and `src/pages/OrderDetails.tsx`. If a shared error helper is wanted later, have it emit an opaque correlation id and log the detail server-side only.

#### Verification

Confirm `tsc --noEmit` (`npm run lint`) passes after removal, and grep the built bundle for `providerInfo` and `emailVerified` to confirm the payload shape is gone.

---

### FIND-11: No release pipeline or deployment provenance

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 4.0 (CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:N/VI:L/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-1357](https://cwe.mitre.org/data/definitions/1357.html): Reliance on Insufficiently Trustworthy Component |
| OWASP | A03:2025 – Software Supply Chain Failures |
| Exploitation Prerequisites | None |
| Exploitability Tier | Tier 1 — Direct Exposure |
| Remediation Effort | Medium |
| Mitigation Type | Standard Mitigation |
| Component | FirebaseHosting |
| Related Threats | [T10.R](2-stride-analysis.md#firebasehosting) |

#### Description

The repository contains no CI/CD configuration of any kind. Deployments of the bundle, the Firestore rules, and the Storage rules are performed by hand with the Firebase CLI from an operator workstation, so there is no record tying a deployed artifact to a reviewed source commit, no approval gate on who may release, and no reproducible build. This matters more than usual here because `firestore.rules` is the control that makes the deny-all data posture real — a deployment that silently omits it removes the protection with no audit trail, and nothing in the repository would show that it had happened.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists FirebaseHosting as `Auth Required: No`, `Reachability: External`, `Min Prerequisite: None`. The deployed artifact is served to unauthenticated clients, so its provenance governs what every visitor receives.

There is no `.github/`, `.gitlab-ci.yml`, `cloudbuild.yaml`, or equivalent in the repository. `README.md:11-21` documents only local `npm install` and `npm run dev`. `package.json:6-12` defines `dev`, `build`, `preview`, `clean`, and `lint` with no deploy or release script. `firebase.json` names the rules files but nothing enforces that they are deployed together with the bundle.

#### Remediation

Add a CI/CD pipeline that builds from a tagged commit, runs `npm run lint`, deploys hosting, Firestore rules, Storage rules, and functions together as one atomic release, and records the commit SHA against the deployment. Restrict production deployment to the pipeline's service account and remove direct CLI deploy rights from individual operators.

#### Verification

Confirm that a manual `firebase deploy` from a developer workstation is refused by IAM, and that the pipeline's deployment record shows the commit SHA for the currently live release.

---

### FIND-12: Existing control — generic sign-in failure message prevents UI account enumeration

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 0.0 (CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-204](https://cwe.mitre.org/data/definitions/204.html): Observable Response Discrepancy |
| OWASP | A07:2025 – Authentication Failures |
| Exploitation Prerequisites | None |
| Exploitability Tier | Tier 1 — Direct Exposure |
| Remediation Effort | Low |
| Mitigation Type | Existing Control |
| Component | LoginUser |
| Related Threats | [T03.I](2-stride-analysis.md#loginuser) |

#### Description

The sign-in screen deliberately collapses every authentication failure into a single message rather than surfacing the Firebase error code. This is the correct behaviour and closes the account-enumeration channel at the UI layer. It is documented here so the choice is recognised as intentional and preserved through future changes; the residual enumeration risk at the API layer is tracked separately in FIND-07.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists LoginUser as `Auth Required: No (unauthenticated entry point)`, `Reachability: External`, `Min Prerequisite: None`.

`src/pages/LoginUser.tsx:29-31` implements `catch (err: any) { setError("Invalid email or password."); }` — the caught error is bound but never read, so no Firebase error code reaches the rendered output at `src/pages/LoginUser.tsx:98`.

#### Remediation

No change required. Preserve this behaviour: do not add error-code-specific messaging to the sign-in screen during future work, and pair it with the project-level enumeration protection from FIND-07 so the API layer matches the UI layer.

#### Verification

Attempt sign-in with a nonexistent address and with a valid address plus a wrong password, and confirm the rendered message is identical in both cases.

---

### FIND-13: Existing control — Firebase web configuration in the bundle is by design

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 0.0 (CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-200](https://cwe.mitre.org/data/definitions/200.html): Exposure of Sensitive Information to an Unauthorized Actor |
| OWASP | A02:2025 – Security Misconfiguration |
| Exploitation Prerequisites | None |
| Exploitability Tier | Tier 1 — Direct Exposure |
| Remediation Effort | Low |
| Mitigation Type | Existing Control |
| Component | FirebaseClient |
| Related Threats | [T04.I3](2-stride-analysis.md#firebaseclient) |

#### Description

The Firebase web configuration — API key, auth domain, project id, storage bucket, messaging sender id, and app id — is embedded in the public bundle. This is the documented and intended design for Firebase web applications: the value labelled "API key" is a project identifier used to route requests, not a credential, and it grants no access on its own. Access is governed by Firebase Authentication together with the security rules in `firestore.rules` and `storage.rules`. This finding records the analysis so the item is not re-raised as a hardcoded-secret defect in future reviews; the genuinely sensitive value in the same `define` block is handled separately in FIND-08.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists FirebaseClient as `Auth Required: No (config shipped in public bundle)`, `Reachability: External`, `Min Prerequisite: None`.

`src/firebase.ts:10-17` assembles `firebaseConfig` from the injected values, and `vite.config.ts:55-61` supplies them through `define`. `.gitignore:7-8` excludes `.env*` while permitting `.env.example`, so the real values are not committed — `.env` is present in the working tree only. The access boundary that actually protects the data is `firestore.rules:11-26`, which denies all client reads and writes.

#### Remediation

No change required. Keep the security rules as the enforcement boundary, and continue to exclude `.env` from version control. Do not attempt to obscure the Firebase configuration, which would provide no security benefit; instead ensure FIND-08 removes the one value in the same block that is a real credential.

#### Verification

Confirm `firestore.rules` remains deny-all after every deployment, and confirm that a request made with the public API key and no ID token is refused by Firestore.

---

### FIND-14: Existing control — SPA catch-all rewrite exposes no server-side routes

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 0.0 (CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-548](https://cwe.mitre.org/data/definitions/548.html): Exposure of Information Through Directory Listing |
| OWASP | A02:2025 – Security Misconfiguration |
| Exploitation Prerequisites | None |
| Exploitability Tier | Tier 1 — Direct Exposure |
| Remediation Effort | Low |
| Mitigation Type | Existing Control |
| Component | FirebaseHosting |
| Related Threats | [T10.E](2-stride-analysis.md#firebasehosting) |

#### Description

Firebase Hosting is configured with a single catch-all rewrite returning `index.html` for every unmatched path, and the deployment ignore list excludes dotfiles, `node_modules`, and `firebase.json` itself from the published artifact. The result is that no server-side route, directory listing, or configuration file is reachable from the public site — the only server behaviour is static file delivery. This is recorded so the configuration is recognised as a deliberate control rather than an incidental default.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists FirebaseHosting as `Listens On: 0.0.0.0:443`, `Auth Required: No`, `Reachability: External`, `Min Prerequisite: None`.

`firebase.json:16-21` defines the single rewrite `{ "source": "**", "destination": "/index.html" }`. `firebase.json:11-15` sets `ignore` to `["firebase.json", "**/.*", "**/node_modules/**"]`, keeping the configuration file and all dotfiles out of the published `dist/` payload.

#### Remediation

No change required. Preserve the ignore list when the hosting configuration is next edited, and add the security headers from FIND-05 to the same `hosting` object rather than replacing it.

#### Verification

Request a nonexistent path such as `/../firebase.json` and a directory path such as `/assets/`, and confirm both return the SPA shell rather than a configuration file or a listing.

---

## Tier 2 — Conditional Risk (Authenticated / Single Prerequisite)

### FIND-15: updateMyDepartment self-provisions the rank4 role with no authorization check

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Critical |
| CVSS 4.0 | 8.7 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-269](https://cwe.mitre.org/data/definitions/269.html): Improper Privilege Management |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Redesign |
| Component | CloudFunctions |
| Related Threats | [T11.E1](2-stride-analysis.md#cloudfunctions) |

#### Description

The `updateMyDepartment` callable performs no role check of any kind — it verifies only that the caller is authenticated. When the caller has neither a `users/{uid}` document nor a `users/{email}` document, the handler does not merely set a department: it creates a profile document containing `role: "rank4"` together with a department string taken directly from the request body. Because `getCallerProfile` reads that same document on every subsequent call, the caller is a Rank 4 approver from that moment onward, in a department of their own choosing.

The consequence is a complete bypass of the approval chain's first stage. Any authenticated account that does not yet have a profile document — which includes every newly provisioned user, since nothing in the codebase creates profiles at sign-up — can promote itself to approver and then approve requests routed to the department it selected. Combined with FIND-21, where the Rank 4 department check is skipped when the order omits `headOfDepartment`, the attacker need not even guess the right department. The code comment at the head of the handler states the intended restriction, but no code implements it.

**Status: Resolved — remediated and verified against the deployed function.** The handler was rewritten during this engagement, and manual testing confirmed the corrected behaviour on the live callable in the `celcomdigi-portal` project. The escalation path described above no longer exists. Severity is retained at Critical to record the seriousness of the defect that was present; the finding is closed, not downgraded.

The verification also produced an incidental result worth recording: the rejection returned by the deployed endpoint carried the exact message string introduced by this fix, which did not exist in any form in the original handler. The deployed function therefore contains this repository's corrected source. That is evidence — though not proof of the mechanism — that `functions/src/index.ts` does reach production by some path, which partially addresses the deployability question raised in FIND-11 and in the Needs Verification table of `0-assessment.md`. How the deployment happens is still undetermined and remains worth establishing.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists CloudFunctions as `Auth Required: No at endpoint; Yes in handler (request.auth)`, `Reachability: External`, `Min Prerequisite: None`. This finding requires a valid ID token to reach the handler body, so its prerequisite is `Authenticated User`, above the component floor.

As originally found at `functions/src/index.ts:465-491`:

- Line 466 checked only `if (!request.auth)`. No call to `getCallerProfile` appeared anywhere in the handler.
- Line 472 carried the comment `// Only allow if the caller is (or is becoming) rank4 — mirrors client intent.` — there was no corresponding check.
- Line 470 read `const newDept = request.data?.department ?? null;` with no type or value validation.
- Lines 484 and 487 both executed `await userRef.set({ role: "rank4", department: newDept }, { merge: true });` — the write that granted the role.

The granted role is consumed at `functions/src/index.ts:41` (`const role = data?.role || "user"`), which feeds the rank check in `approveOrder` and `rejectOrder`.

#### Remediation

The handler has been rewritten in `functions/src/index.ts`. Four changes close the defect:

- **No role is ever written.** Both `set({ role: "rank4", ... }, { merge: true })` calls are gone. The only field written is `department`.
- **No profile can be created.** The write uses `update()` rather than `set(..., { merge: true })`. `update()` fails with `NOT_FOUND` on a missing document, so creation is structurally impossible rather than merely guarded against.
- **Rank 4 is required.** The caller's existing profile is resolved `users/{uid}` then `users/{email}` — matching the order `getCallerProfile` uses — and the call is rejected unless that profile's `role` is already `"rank4"`. The resolved reference is retained so the write lands on the same document the role was read from, rather than creating a second document under a different key. A missing profile and a wrong role return an identical `permission-denied`, so the endpoint does not reveal whether an account has been provisioned.
- **The department value is validated.** `department` must be `null` or one of the three strings in the new `ALLOWED_DEPARTMENTS` constant. This blocks both the type confusion that would throw inside `order.headOfDepartment.toLowerCase()` in `approveOrder` and the ability of a Rank 4 holder to retarget themselves at another department's queue.

Two items remain open for the team. Profile creation and role assignment now have no code path at all, so approver provisioning must be performed by an administrator directly in Firestore or through a new admin-only callable — confirm with whoever owns provisioning before deploying. And the `users` collection should be audited now for documents whose `role` is `rank4` but which no administrator created, since the vulnerable handler was reachable for an unknown period.

Not addressed by this change: the read-then-write race between resolving the profile and calling `update()` remains, as does the email-keyed profile fallback tracked in FIND-23.

#### Verification

**Verified. Evidence recorded below.**

Source check: `functions/src/index.ts` contains no occurrence of `role: "rank4"` in any write path, and `updateMyDepartment` calls `profileRef.update(...)` rather than `set(..., { merge: true })`. A repository-wide search for `userRef`, `emailRef`, and `.set({` in that file returns no matches.

Runtime check against the deployed callable, performed by the repository owner using a temporary console harness:

| Case | Input | Expected | Observed |
|------|-------|----------|----------|
| Core exploit | Called from a test account holding **no** `users` profile document | `permission-denied`, no document created | `permission-denied` — `"Only a Rank 4 approver can change their department."` No `users` document was created for the test account. |
| Unrecognised department string | `department` set to an arbitrary string | `invalid-argument` | `invalid-argument` |
| Non-string department | `department` set to a number, an object, and an array | `invalid-argument` | `invalid-argument` in all three cases |

The core result is the decisive one: an authenticated account with no profile document — the exact precondition that previously triggered `set({ role: "rank4", ... }, { merge: true })` — is now rejected, and no profile is created for it. The privilege escalation is closed.

Not covered by this round of testing, and worth confirming opportunistically: that an existing `rank4` account can still change its own department successfully, and that an `admin` account is rejected. Neither affects the escalation path, but both are behaviours the fix deliberately defines.

The temporary harness used for this verification has been removed from the codebase.

---

### FIND-16: createOrder persists client-controlled workflow state and financial totals

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Critical |
| CVSS 4.0 | 8.6 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:L/VI:H/VA:N/SC:N/SI:H/SA:N) |
| CWE | [CWE-602](https://cwe.mitre.org/data/definitions/602.html): Client-Side Enforcement of Server-Side Security |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | High |
| Mitigation Type | Redesign |
| Component | CloudFunctions |
| Related Threats | [T11.T1](2-stride-analysis.md#cloudfunctions), [T07.T2](2-stride-analysis.md#summaryreport) |

#### Description

`createOrder` spreads the client's order object straight into the new Firestore document. Only `id` is discarded, and only `orderNumber` and `createdBy` are stamped server-side. Every other field arrives from the browser and is trusted, including the four that define the approval workflow — `status`, `currentApprovalRank`, `approvalHistory`, and `finalDecisionAuthorityRank` — and every financial total the approvers rely on, including `totalCost`, `totalRevenue`, and each service's `tcv`, `costPerUnit`, and `totalSST`.

Two distinct attacks follow. First, a requester can create an order that is already `status: "Approved"` with an empty `currentApprovalRank` and a fabricated `approvalHistory` naming approvers who never acted, since nothing re-derives those fields. Second, even without forging the status outright, the requester controls `finalDecisionAuthorityRank`, which `approveOrder` reads to decide where the chain terminates — setting it to `"Rank 4"` collapses a transaction requiring CFO sign-off into a single departmental approval. The financial figures that would normally trigger a higher authority rank are themselves computed in the browser, so the input to that decision is equally under the requester's control. No schema validation is applied on any callable, and `ignoreUndefinedProperties` causes malformed fields to be silently dropped rather than rejected.

**Status: Resolved and verified — closed.** `createOrder` now strips every server-owned workflow field from the request and sets them itself, and independently recomputes the Level of Authority for every line item from the raw pricing inputs rather than trusting any client-derived value. A forged order carrying `status: "Approved"`, a fabricated `approvalHistory`, and `Rank 4` stamped on every line item was confirmed against the deployed callable to store as a `Draft` with an empty history and a correctly recomputed `Rank 1`. Every approval-chain bypass path described in this finding is closed. Severity is retained at Critical to record the seriousness of the defect that was present.

The scope of this finding is now approval-workflow integrity only. The separate problem of client-supplied financial figures reaching the order document unvalidated — `totalRevenue`, `totalCost`, `outrightPrice`, `tcv`, and the per-service cost fields — was split out into [FIND-56](#find-56-client-supplied-financial-totals-are-persisted-without-server-side-recomputation) so that this finding could close cleanly. That gap has since been closed and verified in its own right, which is what allowed the report's overall risk rating to be downgraded from Critical to Important.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists CloudFunctions as `Min Prerequisite: None`; this finding requires a valid ID token and the `user` role, so its prerequisite is `Authenticated User`.

`functions/src/index.ts:359-401`:

- Line 371-374 checks `role !== "user"` and rejects — this is the only authorization performed.
- Line 377 reads `const { id, ...orderData } = order;` — only `id` is removed.
- Lines 394-398 write `await db.collection("orders").add({ ...orderData, orderNumber, createdBy: email ?? "" });` — `orderData` still carries `status`, `currentApprovalRank`, `approvalHistory`, `finalDecisionAuthorityRank`, `totalCost`, `totalRevenue`, `version`, `createdAt`, and the entire `services` array.
- Line 7 sets `db.settings({ ignoreUndefinedProperties: true })`, so malformed fields vanish instead of failing.

The values originate client-side at `src/pages/SummaryReport.tsx:313-328`, where `handleConfirm` builds the order with `totalRevenue: pricingSummary.totalTCV`, `totalCost: costingSummary.tcv.total`, `createdAt: Date.now()`, `version`, and `status: "Draft"`. The authority rank is derived in the browser at `src/pages/SummaryReport.tsx:119-149` and consumed server-side at `functions/src/index.ts:158` and `:199-210`.

#### Remediation

**Applied.** `createOrder` in `functions/src/index.ts` now does the following:

- **Workflow state is stripped and re-set server-side.** `status`, `currentApprovalRank`, `approvalHistory`, and `finalDecisionAuthorityRank` are destructured out of the request and discarded, then written explicitly as `"Draft"`, `""`, `[]`, and the server-derived rank. They are discarded rather than rejected because the legitimate client does send the first three (`src/pages/SummaryReport.tsx:325-327`); rejecting on their presence would break it.
- **Level of Authority is recomputed from raw inputs.** A server-side port of the calculation in `src/components/ServiceForm.tsx` — confirmed with the formula's owner as authoritative — derives each line item's rank from `units`, `costPerUnit`, `years`, `sstRate`, `salesBuffer`, `decision`, `installmentPeriod`, `category`, and `serviceType`. It reproduces all three stages: the cost/SST/price/installment derivation (`ServiceForm.tsx:105-169`, including the PMT formula at 5% for one-time installments), the per-service EBITDA margin (`ServiceForm.tsx:178-222`), and the Bucket A/B thresholds (`ServiceForm.tsx:224-262`). No client-supplied derived value — `totalCost`, `totalSST`, `outrightPrice`, `totalInstallmentPayment`, `tcv`, `authorityRank`, `authorityLevel` — is read. The order-level rank is the most senior any line item demands, matching the rollup in `src/pages/SummaryReport.tsx:119-149`.
- **Fails closed on invalid input.** Any line item whose numeric inputs are non-finite, or whose `serviceType` matches neither bucket, causes the whole request to be rejected with `invalid-argument`. This diverges deliberately from the client, where `ServiceForm` receives Zod-validated numbers and cannot encounter either case: server-side, `NaN` would make every threshold comparison false and silently drop that line item from the rollup, which an attacker could use to hide a Rank 1 item.
- **Stored line items are rewritten with the computed values.** Each service's `authorityLevel` and `authorityRank` are overwritten, so the persisted document cannot show an approver a level that contradicts the order's own routing.

**Residual follow-up 1 — stale-metadata divergence (not blocking).** `ServiceForm` computes a service's rank against the order metadata as it stood while that service's dialog was open, and does not re-rank services already saved when the levy settings change afterwards. The server recomputes every line item against the final submitted metadata. The server's result is the more correct one, but for an order where `cidbLevy`, `stampDuty`, or `ePerolehan` changed after services were added, it can differ from the rank the requester saw on screen — so an approver may be routed a request they did not expect. Worth aligning the client to recompute saved services on metadata change.

**Residual follow-up 2 — levy percentages still client-supplied (not blocking).** `cidbLevyAmount` and `stampDutyAmount` are operator-entered inputs rather than derived values, so they are taken from the request as-is and feed the margin directly. The UI defaults them to `0.125` and `0.5` (`src/pages/SummaryReport.tsx:360-365`), but nothing server-side pins them to those values, so a crafted request could understate them to inflate the margin and reduce the number of approvals required. This is a narrower instance of the same trust problem and should be closed by validating both against canonical values.

**Split out of this finding.** The persistence of client-supplied financial totals on the order document is tracked separately as [FIND-56](#find-56-client-supplied-financial-totals-are-persisted-without-server-side-recomputation), along with the client-supplied `createdAt` and `version` and the absence of general payload schema validation.

**Related, still open.** `finalDecisionMaker` is derived from the same chain — the `authorityLevel` of whichever service carried the lowest rank (`src/pages/SummaryReport.tsx:121,131,144`) — and remains client-supplied and unvalidated. It is display-only and does not affect routing, but it is the same class of issue and is not addressed here.

#### Verification

**Verified against the deployed function. Evidence recorded below.**

A temporary console harness submitted a fully forged order through `createOrder` as a `user`-role caller, then read the stored document back through `getOrder`. The payload carried order-level `status: "Approved"`, `finalDecisionAuthorityRank: "Rank 4"`, and a fabricated `approvalHistory` entry attributing an approval to a CFO who never acted, plus two Hardware line items both stamped `authorityRank: "Rank 4"` / `authorityLevel: "Head of Sales"`.

The two line items were given deliberately different real margins — a 5% sales buffer and a 30% sales buffer — so that a blanket override could be distinguished from the calculation actually running.

| Check | Expected | Observed |
|-------|----------|----------|
| Forged `status` discarded | `"Draft"` | `"Draft"` |
| Forged `approvalHistory` discarded | empty array | empty array |
| Order not placed into the chain | `currentApprovalRank` is `""` | `""` |
| Order-level rank recomputed | `Rank 1`, not the forged `Rank 4` | `Rank 1` |
| Per-service ranks recomputed independently | `Rank 1` on the 5% item, `Rank 4` on the 30% item | `Rank 1` and `Rank 4` respectively |

The last row is the decisive one. The two services diverged rather than both collapsing to a single value, which confirms the margin calculation ran per line item rather than a blanket rank being applied — and that the server agreed with the forged `Rank 4` on the one service where that value was genuinely correct.

**Still to verify, not covered by this run:** that a line item with a non-numeric `units` is rejected with `invalid-argument` rather than silently skipped, and that an order created through the normal UI stores a rank matching what the Summary Report displayed (for an order whose levy settings were not changed after the line items were entered). Neither affects the forgery result above.

The temporary harness used for this verification has been removed from the codebase.

---

### FIND-56: Client-supplied financial totals are persisted without server-side recomputation

> **Numbering note:** this finding was split out of FIND-16 after the rest of the report was written. It is placed here because Tier 2 findings sort by severity then CVSS descending, and its CVSS of 8.5 falls between FIND-16 (8.6) and FIND-17 (8.2). Finding IDs are therefore not strictly ascending in document order at this point. Renumbering every subsequent finding was rejected as the more harmful option, since the existing IDs are already referenced in remediation work and external tracking.

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Critical |
| CVSS 4.0 | 8.5 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:H/VA:N/SC:N/SI:H/SA:N) |
| CWE | [CWE-602](https://cwe.mitre.org/data/definitions/602.html): Client-Side Enforcement of Server-Side Security |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | High |
| Mitigation Type | Redesign |
| Component | CloudFunctions |
| Related Threats | [T07.T1](2-stride-analysis.md#summaryreport), [T07.T3](2-stride-analysis.md#summaryreport), [T11.T2](2-stride-analysis.md#cloudfunctions) |

#### Description

Every monetary figure persisted on an order document arrives from the browser and is written without recomputation. At the order level that is `totalRevenue` and `totalCost`; on each service it is `totalCost`, `totalSST`, `outrightPrice`, `monthlyRevenue`, `totalInstallmentPayment`, and `tcv`. `createdAt` and `version` are likewise client-supplied, and no callable applies schema, type, range, or size validation to the payload.

These are precisely the numbers an approver reads when deciding whether to commit the company to a contract. A requester can therefore submit an order whose displayed revenue, cost, and total contract value bear no relation to its line items — understating cost to make a deal look profitable, or overstating revenue to justify terms that would not otherwise be approved. The approval chain routes correctly and the audit trail records genuine approvals; what is false is the commercial substance those approvals attest to.

This gap was split out of FIND-16 after that finding's approval-workflow half was remediated and verified. It is deliberately scoped as its own finding because the remediation is different in kind: FIND-16 was closed by discarding client input, whereas closing this requires replicating the order-level aggregation formula server-side.

The relationship to FIND-16's fix is worth stating precisely, because it is easy to assume more was covered than was. `createOrder` already recomputes every one of these figures internally — that is how it derives the Level of Authority. It simply does not write the recomputed values back to the document, so the stored copies remain whatever the client sent.

**Status: Resolved and verified — every financial figure persisted with an order is server-computed, confirmed against the deployed function.**

The remediation ran in two passes, each verified separately. The first closed the per-service figures and the order-level `totalRevenue`/`totalCost`: `authorityForService` returns its Stage 0 outputs alongside the rank, and `createOrder` writes them onto each stored service and accumulates the rollup from them. That pass was verified with a payload forging `999999` across every monetary field on three line items — no occurrence of the sentinel survived anywhere in the stored document.

The second pass closed the remaining six fields, which reach the order through the `...metadata` spread rather than through the line items: `totalUpfrontPayment`, `totalOneTimeChargeB2S`, `totalFinancingRequest`, `financingLease`, and their two inputs `option` and `contractPeriod`. All six are recomputed in `createOrder` from the same server-computed per-service values and written over whatever the request carried. This pass was verified independently — see Verification.

A requester can no longer misstate any figure an approver reads, subject to the one residual noted at the end of Remediation.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists CloudFunctions as `Min Prerequisite: None`; `createOrder` requires a valid ID token and the `user` role, so this finding's prerequisite is `Authenticated User`.

In `functions/src/index.ts`, `createOrder` strips only the workflow fields before persisting:

```
const { id, status, currentApprovalRank, approvalHistory,
        finalDecisionAuthorityRank, ...orderData } = order;
```

`orderData` still carries `totalRevenue`, `totalCost`, `createdAt`, and `version`, and every service retains its client-supplied cost and price fields. The per-service rewrite that follows replaces only two keys:

```
return { ...s, authorityLevel: loa.level, authorityRank: `Rank ${loa.rank}` };
```

The values originate client-side at `src/pages/SummaryReport.tsx:313-328`, where `handleConfirm` sets `totalRevenue: pricingSummary.totalTCV`, `totalCost: costingSummary.tcv.total`, `createdAt: Date.now()`, and `version`. The per-service figures are set in `src/components/ServiceForm.tsx:105-169`.

Confirmed empirically during FIND-16's verification: the forged test payload carried `outrightPrice: 999999`, `tcv: 999999`, and `totalRevenue: 999999`, and those values persisted unchanged on the stored order — while the authority rank derived from the same line items was correctly recomputed to `Rank 1`. The test artifact (`companyName` beginning `ZZZ-FIND16-TEST`) still demonstrates this.

#### Remediation

**Applied — per-service figures and the order-level rollup.**

`authorityForService` now returns a `ServiceComputation` carrying its Stage 0 outputs — `totalCost`, `totalSST`, `outrightPrice`, `monthlyRevenue`, `totalInstallmentPayment`, and the per-service `tcv` — alongside the rank and level it already produced. `createOrder` writes all six onto each stored service, so no client-supplied monetary value survives on a line item.

The order-level aggregation was ported from `src/pages/SummaryReport.tsx:202-238` after its owner confirmed the formula, matching the process used for the Level of Authority. `totalRevenue` reproduces `pricingSummary.totalTCV` and `totalCost` reproduces `costingSummary.tcv.total`, both accumulated from the server-computed per-service figures rather than the submitted ones.

Two deliberate divergences from the client, both failing closed: `category` and `decision` are now validated against closed enums, because an unrecognised `category` would take the wrong Stage 0 branch *and* be excluded from `totalCost` entirely while still contributing to `totalRevenue`; `ServiceForm` constrains both through Select controls and cannot produce an invalid value, but a callable request can.

One behaviour was ported unchanged after being queried with the formula's owner and confirmed intentional: `pricingSummary.totalTCV` multiplies an Upfront Payment line item's `outrightPrice` by its `installmentPeriod`, even though `outrightPrice` already incorporates the contract duration through `years`, and the per-service `tcv` set by `ServiceForm.tsx:166` applies no such multiplier. The two quantities therefore differ by design. This is noted because the port makes the behaviour authoritative on the server rather than merely displayed.

**Applied — the financing metadata block.** The six remaining fields are now recomputed in `createOrder`, ported from the effect at `src/pages/SummaryReport.tsx:97-164` and accumulated from the server-computed per-service figures rather than the submitted metadata:

| Field | Derivation, ported verbatim |
|-------|------------------------------|
| `totalUpfrontPayment` | `Math.round(Σ outrightPrice where decision === "Upfront Payment")` — rounded once on the total, not per service |
| `option` | `oneTimeCostWithSST > totalUpfrontPayment ? "Yes" : "No"` — derived, never an operator input |
| `totalOneTimeChargeB2S` | `Math.round(option === "Yes" ? Σ (totalCost + totalSST) where category === "one-time" : 0)` |
| `totalFinancingRequest` | `Math.round(max(0, b2s − upfront))` |
| `contractPeriod` | `maxContractTenure` when financing applies and some item carries a tenure; otherwise the client's value, coerced and floored |
| `financingLease` | `PMT(5%/12, n, request) − (request / n)`, stored as a rounded string, `"0"` when not positive |

All six are stored as strings, matching the `OrderMetadata` shape that `src/types.ts:174-179` declares and every display site parses. This is inconsistent with the numeric `totalRevenue`/`totalCost` beside them, but it is the existing inconsistency and changing it would break `src/utils/orderDiff.ts`'s comparison and the display formatting.

**Three points established while porting, recorded so the reasoning is not lost.**

*Dashboard.tsx carries a near-duplicate of this effect that has diverged, and two of its rules were investigated and confirmed stale rather than missed requirements.* `src/pages/Dashboard.tsx:336-360` contains a lease-term authority escalation — `leaseTerm > 36 → Rank 1`, `> 24 → Rank 2`, `> 12 → Rank 3` — and a zero-upfront rule forcing Rank 1. Neither appears in `SummaryReport`, and neither was ported. The formula's owner confirmed that Level of Authority is determined by EBITDA margin alone across ranks 1-4, and that this code is incorrect rather than a rule the server was missing. It is a candidate for removal from `Dashboard.tsx` as technical debt, tracked separately from this finding and not security-relevant.

*`Dashboard.tsx:260`'s `costingSummary` branches on `s.decision` where `SummaryReport.tsx:220`'s branches on `s.category`.* The owner confirmed the category-based version is authoritative; it is the one already ported and feeding `order.totalCost`. Dashboard's variant is likewise stale, and produces different figures on its own screen.

*`Dashboard.tsx:301`'s `totalUpfrontPayment` omits the `decision === "Upfront Payment"` filter* that `SummaryReport.tsx:100` applies. The filtered version was confirmed correct and is what the server implements. In practice the two usually agree because Stage 0 zeroes `outrightPrice` for Installment Plan items, but they are not the same expression.

**Residual — `contractPeriod` magnitude in the fallback path.** When financing does not apply, or no line item carries a tenure, `contractPeriod` falls through to the client's value. The server coerces it through `toFiniteNumber`, floors it, and clamps it at zero, so a non-numeric or negative value cannot reach the PMT — but its magnitude is unconstrained, because no business rule currently defines a ceiling. It is a divisor and an exponent in the PMT and is multiplied by `financingLease` in six display sites in `src/pages/OrderDetails.tsx`, so a large value inflates the lease figure an approver sees. Flagged as a possible follow-up if a limit is ever defined; accepted as-is for now.

Also unchanged: `createdAt` and `version` are still taken from the client. Stamp `createdAt` with `FieldValue.serverTimestamp()` and derive `version` server-side from the existing documents for that order number. And there is still no general payload schema validation — the enum and numeric checks added here are targeted rather than comprehensive. Validating the whole payload against a Zod schema, the dependency already being present at `package.json:41`, would close `T11.T2`.

Note that the client-side and server-side margin implementations already diverge: `src/components/ServiceForm.tsx:197-204` (which drives the authority rank), `src/pages/SummaryReport.tsx:256-262`, and `src/pages/OrderDetails.tsx:218-227` compute EBITDA differently, varying in revenue basis, the commission special case, and whether financing lease is included in opex. Whichever is chosen as authoritative for the stored totals should be made the single implementation.

#### Verification

**Pass 1 — per-service figures and the order-level rollup.** A temporary console harness submitted an order through `createOrder` as a `user`-role caller with the sentinel value `999999` in every monetary field — order-level `totalRevenue` and `totalCost`, and per-service `totalCost`, `totalSST`, `outrightPrice`, `monthlyRevenue`, `totalInstallmentPayment`, and `tcv` — then read the document back through `getOrder`.

Three Hardware line items were used, with deliberately different real values so that a blanket override could be distinguished from the calculation running per item: two Upfront Payment items at 5% and 30% sales buffer, and one Installment Plan item over 12 months exercising the PMT branch.

| Check | Expected | Observed |
|-------|----------|----------|
| `order.totalRevenue` recomputed | ≈ 3562.52 | 3562.52 |
| `order.totalCost` recomputed | exactly 3000 | 3000 |
| Per-service monetary fields recomputed | no field retains 999999 | all recomputed |
| Sentinel anywhere in the stored document | none | none found |
| Authority ranks still diverge per item | regression guard on FIND-16 | ranks diverged correctly |

`order.totalCost` was asserted exactly because that path is clean integer arithmetic — three line items each contributing `1000 + 0`. `totalRevenue` includes a PMT result and was compared against a hand-derived approximation; it matched to the cent.

The final row is a regression guard: this change modified `authorityForService`, the same function FIND-16's fix depends on. The per-service authority ranks continuing to diverge confirms the Level of Authority calculation still runs per line item rather than having been flattened by the refactor.

That harness did not cover the financing metadata block, which was remediated in a later pass: its six fields were sent as benign `"0"` strings rather than forged, so the sentinel scan would not have flagged them. They were verified separately below.

**Pass 2 — the financing metadata block.** A second harness forged all four financial strings (`totalUpfrontPayment`, `totalOneTimeChargeB2S`, `totalFinancingRequest`, `financingLease`) with distinct sentinels, and submitted them across two orders constructed so that `option` could be tested in both directions. A single order cannot do this: the branch that produces a non-zero `financingLease` only runs when the *true* `option` is `"Yes"`, so forging `"Yes"` against a true `"Yes"` would prove nothing while forging `"Yes"` against a true `"No"` never reaches the PMT.

*Order A* — one annual, Upfront Payment line item, so nothing contributes to `oneTimeCostWithSST` and the true `option` is `"No"` against a forged `"Yes"`.

*Order B* — two Installment Plan items, which zeroes every `outrightPrice` and therefore `totalUpfrontPayment`, making the true `option` `"Yes"` against a forged `"No"`. The 36-month Hardware item drives both `contractPeriod` and the PMT; the second item sits in a different authority bucket so the rank rollup stays exercised. `contractPeriod` was forged as `"999"`, contradicting every line item's tenure.

| Check | Expected | Observed |
|-------|----------|----------|
| `option` overridden, `"Yes"` → `"No"` (Order A) | `"No"` | `"No"` |
| `option` overridden, `"No"` → `"Yes"` (Order B) | `"Yes"` | `"Yes"` |
| `totalUpfrontPayment` recomputed | `"3086"` / `"0"` | matched |
| `totalOneTimeChargeB2S` recomputed | `"0"` / `"108000"` | matched |
| `totalFinancingRequest` recomputed | `"0"` / `"108000"` | matched |
| `contractPeriod` derived from line items (Order B) | `"36"`, not the forged `"999"` | `"36"` |
| `financingLease` non-zero — PMT branch executed | `> 0`, ≈ 238 | matched |
| `finalDecisionAuthorityRank` still rolled up | `"Rank 3"` | `"Rank 3"` |
| `order.totalCost` unchanged by this pass | 108540 | 108540 |
| Any forged sentinel anywhere in the stored document | none | none found |

The `financingLease` row is the one that matters most: a zero there would be indistinguishable between "correctly recomputed" and "the branch never ran", which is why the payload was built to force a non-zero result. The final two rows are regression guards on pass 1 and on FIND-16 — this pass touched the same `createOrder` body that derives both.

All checks passed. `createdAt` and `version` were not tested and remain client-supplied, as recorded in Remediation.

**One expected non-override.** Order A's `contractPeriod` was submitted as `"999.7"` and stored as `"999"`. This is correct behaviour, not a missed field: `contractPeriod` is only derived when financing applies, and Order A's `option` is `"No"`, so the client's value is kept — coerced and floored, which the stored `"999"` demonstrates. The unconstrained magnitude on that path is the accepted residual described in Remediation.

---

### FIND-17: Client connects to a Firestore database the deployed rules do not cover

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Critical |
| CVSS 4.0 | 8.2 (CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:N/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-1188](https://cwe.mitre.org/data/definitions/1188.html): Initialization of a Resource with an Insecure Default |
| OWASP | A02:2025 – Security Misconfiguration |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | FirebaseClient |
| Related Threats | [T04.E](2-stride-analysis.md#firebaseclient) |

#### Description

The client selects its Firestore database from a build-injected identifier and falls back to the `(default)` database when that identifier is empty. `.env` does not define `FIREBASE_DATABASE_ID`, and `vite.config.ts` substitutes an empty string when it is absent, so the browser connects to `(default)`. Meanwhile `firebase.json` deploys `firestore.rules` to a specific named database. The deny-all rule set that the architecture depends on is therefore applied to one database while the client talks to another.

**Confirmed in the Firebase console:** the `(default)` database carries permissive legacy rules. The deny-all posture documented in `firestore.rules` has therefore never applied to the database the application actually uses. Any authenticated user can read and write the `orders`, `users`, and `counters` collections directly from the browser, bypassing every authorization check in the Cloud Functions layer — including the role, rank, department, and creator-ownership checks that the approval workflow depends on. This is the most consequential finding in the assessment: it does not merely add a weakness, it removes the foundation that the rest of the access-control model is built on. An attacker does not need FIND-15 to become an approver or FIND-16 to forge workflow state when they can write `status: "Approved"` straight into the document.

This finding was raised at Important severity while the state of `(default)` was unverified, and was upgraded to Critical once the console confirmed permissive rules. The CVSS base vector is unchanged: `AT:P` still correctly describes a weakness class whose exploitation depends on a deployment condition outside the attacker's control. The SDL Bugbar severity is the environment-aware judgement, and for this deployment that condition was present.

**Status: Resolved — remediated and verified.** `firebase.json` was changed to a multi-database `firestore` array and the rules redeployed, and the `(default)` database now carries the deny-all ruleset. Severity is retained at Critical to record the seriousness of the exposure while it was open; the finding is closed, not downgraded. One residual item remains and is tracked in the Remediation section: `FIREBASE_DATABASE_ID` is still unset, so the client reaches `(default)` by fallback rather than by intent. That is no longer a security gap now that both databases carry the same rules, but it leaves the binding implicit.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists FirebaseClient as `Min Prerequisite: None`; exploiting the mismatch requires a signed-in session to issue Firestore reads, so the prerequisite is `Authenticated User`.

`src/firebase.ts:22-24` reads `export const db = process.env.FIREBASE_DATABASE_ID ? getFirestore(app, process.env.FIREBASE_DATABASE_ID) : getFirestore(app);`. `vite.config.ts:39` and `:47` set `databaseId` from `FIREBASE_DATABASE_ID` or `firebaseConfig.firestoreDatabaseId`, both absent, and `vite.config.ts:61` injects the resulting empty string. `.env:1-7` defines six Firebase values and no `FIREBASE_DATABASE_ID`. `firebase.json:2-5` sets `"database": "ai-studio-remixremixservic-d5598bb1-8a51-4e0b-bbad-dc118e2c4552"` for the `firestore.rules` deployment. The client-side reads that would exercise the gap are at `src/context/AuthContext.tsx:74` and `:87`.

Console verification performed by the repository owner confirmed that `(default)` exists, is the database the deployed application connects to, and retains permissive rules predating the `firestore.rules` lockdown.

#### Remediation

Deploy `firestore.rules` to every database in the project, including `(default)`. Change the `firestore` key in `firebase.json` from a single object to an array with one entry per database, each pointing at `firestore.rules`:

```json
"firestore": [
  { "database": "(default)", "rules": "firestore.rules" },
  { "database": "ai-studio-remixremixservic-d5598bb1-8a51-4e0b-bbad-dc118e2c4552", "rules": "firestore.rules" }
]
```

Then deploy with `firebase deploy --only firestore:rules --project celcomdigi-portal`, confirming the CLI output names both databases. Before deploying, verify with `firebase functions:list` that `getMyProfile` is live — locking down `(default)` removes the direct-read fallback at `src/context/AuthContext.tsx:73-109`, and if that callable is unavailable every caller silently resolves to the `user` role.

**Applied.** `firebase.json` now carries the two-database array above, and the rules have been deployed to both.

**Database binding — closed.**

The implicit-default pattern that caused this finding has been removed from every caller. Each now names `(default)` outright rather than relying on a fallback:

- `src/firebase.ts:22-24` takes the explicit branch instead of falling through to `getFirestore(app)`, driven by `FIREBASE_DATABASE_ID=(default)` in `.env` for local builds and by the same variable in the production build environment.
- `functions/src/index.ts` calls `getFirestore("(default)")` rather than `getFirestore()`.
- `migrate-head-of-commercial.js` calls `getFirestore("(default)")` via the modular `firebase-admin/firestore` import; the namespaced `admin.firestore()` it previously used accepts no database argument.

`FIREBASE_DATABASE_ID` has been added to the production build environment's variables and deployed, closing the last gap. This mattered because `vite.config.ts:22` branches on `!!process.env.FIREBASE_PROJECT_ID`: when that OS variable is present the build reads `process.env.FIREBASE_DATABASE_ID` at line 39 and ignores `.env` entirely, and `.env` is excluded from version control by `.gitignore:7`. Setting it only in the repository would therefore have left production on the empty-string fallback.

Client, Cloud Functions, and the migration script now all name the same database explicitly in every environment. The `ai-studio-remixremixservic-…` database the rules were originally pointed at is confirmed vestigial — nothing reads or writes it — and both databases carry identical deny-all rules, so no configuration drift between them can reopen this finding.

**Runtime prerequisite — satisfied.** The `databaseId` parameter on `getFirestore()` was introduced in firebase-admin v12.0.0; on v11 or earlier a bare string is treated as the `App` argument and the call throws at cold start. The build environment was checked and reports **firebase-admin v13.10.0**, comfortably above the threshold, so the explicit `getFirestore("(default)")` calls in `functions/src/index.ts` and `migrate-head-of-commercial.js` are safe to deploy. The constraint is recorded in a comment at both call sites so it remains visible if the build environment is ever changed or the dependency downgraded — note that it cannot be enforced by a lockfile here, because this repository declares no `firebase-admin` dependency at all (FIND-11).

#### Verification

**Verified. Evidence recorded below.**

| Check | Method | Result |
|-------|--------|--------|
| Rules content on the correct database | Firebase Console → Firestore Database → `(default)` → Rules tab, after deploy | Deny-all ruleset confirmed present |
| Functions path serving role resolution | Signed in as a `rank4` account | `getMyProfile` returned role `rank4`; approval controls rendered |
| Data access flowing through the authorization layer | Signed in as a regular user; DevTools Network tab | `listOrders` returned 200 via the Cloud Function endpoint, not a direct Firestore call |

The second result carries more weight than it first appears. Under deny-all rules the direct-read fallback at `src/context/AuthContext.tsx:73-109` can no longer succeed — it returns `permission-denied`, and the catch at line 110 sets the role to `user`. A `rank4` role resolving correctly therefore demonstrates that `getMyProfile` served it, and that the application is not silently depending on direct Firestore access anywhere in the sign-in path. The operational risk flagged before deployment — every approver dropping to `user` if the callable were unavailable — did not materialise.

**Not directly confirmed:** a client-side `getDoc(doc(db, "users", "<uid>"))` was not executed from the browser console to observe `permission-denied` firsthand. The verification rests on the deployed rules content plus correct application behaviour through the Functions layer. That combination is sound — the Rules tab is the authoritative source for what is enforced, and a client-side probe would only corroborate it — but the direct negative test remains available if independent confirmation is wanted later.

---

### FIND-18: getOrder returns any order to any authenticated caller

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 7.7 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-639](https://cwe.mitre.org/data/definitions/639.html): Authorization Bypass Through User-Controlled Key |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | CloudFunctions |
| Related Threats | [T11.I1](2-stride-analysis.md#cloudfunctions) |

#### Description

`getOrder` authenticates the caller and then applies no authorization whatsoever. It fetches the document named by the client-supplied `orderId` and returns it in full, stripping fields only when the caller's role happens to be `viewer`. Every other role — including the default `user` role that any provisioned account holds — receives the complete order, including `totalCost`, per-service `costPerUnit`, `salesBuffer`, customer name, and the full approval history.

This is a direct object reference with no ownership or scope check, and it stands in contrast to `listOrders`, which does implement role-based filtering. Any authenticated employee who obtains an order document id — which appears in the `?id=` query parameter of every order-details URL, routinely shared in chat and email — can retrieve the full commercial detail of a request belonging to another department, bypassing the entire filtering model that `listOrders` implements.

**Status: Resolved.** `getOrder` now applies a `canAccessOrder` scope predicate mirroring the logic in `listOrders`, and returns `not-found` for out-of-scope documents. See Remediation for what changed and Verification for the extent of what was confirmed.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists CloudFunctions as `Min Prerequisite: None`; the handler requires a valid ID token, so the prerequisite is `Authenticated User`.

`functions/src/index.ts:62-77`:

- Line 63 checks `request.auth` only.
- Lines 66-69 take `orderId` from `request.data` and validate only that it is a non-empty string.
- Line 71-73 fetch and assemble the document with no scope predicate.
- Line 75-76 apply `role === "viewer" ? stripForViewer(order) : order` — the sole differentiation, which returns the full document to `user`, `rank1` through `rank4`, and `admin`.

By comparison, `listOrders` at `functions/src/index.ts:91-123` filters by role, department, approval participation, and `createdBy`. The document id is exposed to the client in the URL at `src/pages/OrderDetails.tsx:32` (`searchParams.get("id")`) and linked from `src/pages/MainPage.tsx`.

#### Remediation

**Applied.** A `canAccessOrder(order, profile)` helper was added to `functions/src/index.ts` and is now called in `getOrder` before the document is returned. It implements the same scope as `listOrders`: admins see everything; rank holders see orders pending at their rank or that they have already acted on; viewers see orders where `accountManager` matches their profile name; every other role sees only orders it created. Out-of-scope documents return `not-found` rather than `permission-denied`, so the endpoint does not confirm that an id exists. Viewers continue to receive the `stripForViewer` projection rather than being refused outright.

The Rank 4 branch of the helper applies the same fail-closed department rule introduced by FIND-21 — both the caller's department and the order's `headOfDepartment` must be present and matching.

Two items remain for a future pass. `listOrders` still carries its own copy of the scope logic rather than calling the shared helper, so the two can drift; unifying them was judged too large a change to fold into a security fix. And `listOrders` expands a rank holder's results to every version sharing an order number, whereas `canAccessOrder` evaluates only the document in hand — so a rank holder who acted on v1 sees v3 in their list but would be refused it by `getOrder`. That asymmetry is currently harmless because nothing calls `getOrder`, but it must be resolved before the endpoint is wired to any UI.

#### Verification

**Resolved. No regression observed; the authorization path itself was not directly exercised.**

`getOrder` has no caller anywhere in the client — the SPA invokes `createOrder`, `deleteOrder`, `getMyProfile`, `updateMyDepartment`, `listOrders`, `submitForApproval`, `approveOrder`, `rejectOrder`, and `withdrawFromReview`, and none of them is `getOrder`. It is a deployed endpoint with no UI consumer, which is why tightening it carried no breakage risk and why normal application use cannot exercise it either way.

A Rank 4 approval and an order-creation attempt were both performed through the UI after deployment and behaved normally, confirming no regression in the flows that share `getCallerProfile` and the department logic.

**Not directly confirmed:** no call was made to `getOrder` with an out-of-scope document id to observe `not-found`. Doing so requires driving the callable directly rather than through the UI. Recommended when convenient: sign in as a plain `user`, call `getOrder` with the id of an order created by someone else in another department, and confirm `not-found` rather than the document. Until then this finding rests on code inspection rather than an exercised test.

---

### FIND-19: Draft attachments are readable by every authenticated user

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 7.1 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-732](https://cwe.mitre.org/data/definitions/732.html): Incorrect Permission Assignment for Critical Resource |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | FirebaseStorage |
| Related Threats | [T13.I2](2-stride-analysis.md#firebasestorage) |

#### Description

The Cloud Storage rule for draft attachments scopes write and delete to the owning user's UID but grants read to any authenticated principal across the entire `draft-attachments/` prefix. The asymmetry appears deliberate in structure — the write rule explicitly compares `request.auth.uid` to the path segment while the read rule does not — but the effect is that any signed-in employee can enumerate and download every other employee's uploaded vendor quotations, cost spreadsheets, and supporting contracts, including those attached to draft requests that have never been submitted for review.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists FirebaseStorage as `Auth Required: Yes for SDK paths; No for tokenized download URLs`, `Min Prerequisite: None`. This finding concerns the SDK path, which requires a session, so the prerequisite is `Authenticated User`.

`storage.rules:7-23` defines `match /draft-attachments/{userId}/{fileName}`:

- Line 8: `allow read: if request.auth != null;` — no comparison against `{userId}`.
- Lines 9-10: `allow write: if request.auth != null && request.auth.uid == userId` — correctly scoped.
- Line 23: `allow delete: if request.auth != null && request.auth.uid == userId;` — correctly scoped.

Object paths are predictable in structure from `src/pages/Dashboard.tsx:77`: `draft-attachments/${currentUser.uid}/${attachmentId}-${file.name}`.

#### Remediation

**Applied.** `storage.rules` now reads `allow read: if request.auth != null && request.auth.uid == userId;`, matching the write and delete scoping directly below it. Where a legitimate cross-user read is required — an approver viewing an attachment on a submitted order — it should be served through the authorizing callable proposed in FIND-03 rather than by loosening the rule again.

**This fix achieves considerably less than it appears to, and should not be read as closing attachment confidentiality.** The Storage SDK is not how approvers reach attachments. `getDownloadURL()` mints a token-bearing URL that is persisted into the order document and rendered as a plain link (`src/pages/OrderDetails.tsx:452-456`, `src/pages/SummaryReport.tsx:791-797`), and **Firebase download tokens bypass security rules entirely**. Every such URL already issued remains valid and unauthenticated regardless of this change.

What this closes is the SDK read path — a caller using the Firebase SDK to read an arbitrary `draft-attachments/{uid}/...` object. What it does not close is the far more accessible path of simply holding a URL. Until FIND-03 is remediated and the existing tokens revoked, cross-user access to attachments remains trivially possible for anyone who has ever been forwarded a link. The two findings should be treated as a pair, with FIND-03 as the one that carries the actual confidentiality benefit.

#### Verification

**Resolved. Rule change applied; the refusal path was not directly exercised.**

The only SDK read in the application is `getDownloadURL()` in `src/pages/Dashboard.tsx:93`, called by the uploader against their own object, where the UID comparison passes. Normal use after deployment showed no regression, which is the expected result — no legitimate flow depended on the permissive rule.

**Not directly confirmed:** no attempt was made as user A to read an object under user B's prefix through the Storage SDK and observe the refusal. Recommended when convenient, since it is the only positive confirmation that the tightened rule behaves as intended.

Note that such a test would also demonstrate the limitation described above: the same object remains retrievable by anyone holding its `getDownloadURL()` link, because that path does not consult the rules at all.

---

### FIND-20: A single admin account can satisfy every approval rank

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 6.9 (CVSS:4.0/AV:N/AC:L/AT:N/PR:H/UI:N/VC:N/VI:H/VA:N/SC:N/SI:H/SA:N) |
| CWE | [CWE-269](https://cwe.mitre.org/data/definitions/269.html): Improper Privilege Management |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Privileged User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Custom Mitigation |
| Component | CloudFunctions |
| Related Threats | [T11.E2](2-stride-analysis.md#cloudfunctions) |

#### Description

Both `approveOrder` and `rejectOrder` resolve the caller's effective rank with a ternary that gives an `admin` whatever rank is currently pending. The check that follows then always passes, so one admin account can approve a request at Rank 4, again at Rank 3, again at Rank 2, and finally at Rank 1, walking a financial commitment through the entire authority chain without any other person participating. The audit log records four entries, each naming the same email address, so the outcome is at least visible after the fact — but nothing prevents it, and the four entries carry role labels (`Head of Sales`, `Head of Commercial`, `CEBO`, `CFO`) that imply four distinct people acted.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists CloudFunctions as `Min Prerequisite: None`; this finding requires the `admin` role, so the prerequisite is `Privileged User`.

`functions/src/index.ts:166-172` in `approveOrder`:

```
const callerRankStr = role === "admin" ? currentRank : (rankMap[role] || "");
if (callerRankStr !== currentRank) {
  throw new HttpsError("permission-denied", "You are not authorized to approve at this step.");
}
```

The same construction appears at `functions/src/index.ts:251-257` in `rejectOrder`. The role label written into the audit entry is derived from `currentRank` rather than from the caller, at `functions/src/index.ts:181-184` and `:264-267`.

#### Remediation

Track the set of principals who have already acted on an order and reject an approval from a principal already present in `approvalHistory` for that order, regardless of role. Where an admin override is genuinely needed for continuity, record it as an explicit override entry — a distinct `status` value naming the acting admin and the rank being overridden — rather than presenting it as a normal rank approval.

#### Verification

As an admin, approve the same order twice in succession and confirm the second call is refused. Confirm that a legitimate override path, if implemented, produces an audit entry that is visibly distinct from a normal approval.

---

### FIND-21: Rank 4 department check is skipped when the order omits headOfDepartment

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 6.8 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:L/VI:H/VA:N/SC:N/SI:L/SA:N) |
| CWE | [CWE-863](https://cwe.mitre.org/data/definitions/863.html): Incorrect Authorization |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Custom Mitigation |
| Component | CloudFunctions |
| Related Threats | [T11.E3](2-stride-analysis.md#cloudfunctions) |

#### Description

The departmental scoping of Rank 4 approvals is guarded by a condition that requires the order to carry a `headOfDepartment` value before the comparison is made. Because that field arrives unvalidated from the client through `createOrder` (FIND-16), a requester can simply omit it, and the check is then bypassed entirely: any Rank 4 holder in any department may approve the order. The same conditional appears in the visibility filter in `listOrders`, so an order without the field is also visible to every Rank 4 user rather than to one department's head. This is a fail-open authorization check — the absence of the data being validated causes the validation to be skipped rather than to fail.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists CloudFunctions as `Min Prerequisite: None`; creating the order and approving it both require a session, so the prerequisite is `Authenticated User`.

`functions/src/index.ts:173-178` in `approveOrder`:

```
if (role === "rank4" && department && order.headOfDepartment) {
  if (order.headOfDepartment.toLowerCase() !== department.toLowerCase()) {
    throw new HttpsError("permission-denied", "This order belongs to a different department.");
  }
}
```

The identical pattern is at `functions/src/index.ts:258-262` in `rejectOrder`, and the visibility equivalent is at `functions/src/index.ts:102-104`: `matchesDept = !o.headOfDepartment || o.headOfDepartment.toLowerCase() === department.toLowerCase();` — where a missing field evaluates to `true`. The field is supplied by the client at `src/pages/SummaryReport.tsx:65` and is optional in the type declaration at `src/types.ts:156`.

#### Remediation

**Applied as a four-part change**, deployed together after an audit confirmed no existing data would be stranded:

- **`approveOrder` and `rejectOrder` fail closed.** The `if (role === "rank4" && department && order.headOfDepartment)` guard was replaced with `if (role === "rank4")` containing three distinct rejections: no department on the caller's profile, no `headOfDepartment` on the order, and a genuine mismatch. Distinguishing the three means a blocked approval is diagnosable rather than uniformly refused — a missing `headOfDepartment` returns `failed-precondition` with an actionable message, not `permission-denied`.
- **`createOrder` requires the field.** A recognised `headOfDepartment` is now mandatory at creation, validated against the shared `ALLOWED_DEPARTMENTS` constant (hoisted to module scope, since `updateMyDepartment` uses it too). Without this the fail-closed check would have stranded every newly created order that omitted the field.
- **`canAccessOrder` uses the same rule**, so `getOrder` visibility and approval authorization agree.
- **The client matches the server.** `src/pages/OrderDetails.tsx:1649-1652` carried the same permissive expression and would have rendered approve controls that then failed server-side; it now requires both departments present and matching. `src/pages/SummaryReport.tsx` blocks Confirm until a Head of Department is selected, opening the metadata editor and showing a toast rather than letting the requester reach a raw server error.

**Deliberately not changed:** the `matchesDept` expression in `listOrders` (`functions/src/index.ts:268`) remains permissive. Enforcing at the action while leaving visibility open means an order that somehow lacks the field stays discoverable in a Rank 4's queue rather than silently vanishing. Visibility is not the security boundary here; authorization is.

#### Verification

**Resolved and verified.**

A pre-deployment audit was run against the live data using a temporary read-only harness, covering both risks identified before the change:

| Audit | Result |
|-------|--------|
| Orders pending at Rank 4 with `headOfDepartment` missing or empty | 0 |
| Orders pending at Rank 4 with `headOfDepartment` present but non-canonical | 0 |
| `users` documents with `role: "rank4"` and no `department` | 0 |

The second row was added beyond the originally specified query: the approval check compares the order's value against the *approver's resolved department*, so a present-but-non-canonical value such as a legacy `"Head of Sales"` would have been equally un-approvable while passing a naive "is it missing" test. Auditing only for missing values would have left that class undetected until after deployment.

Post-deployment, confirmed through the UI:

| Check | Result |
|-------|--------|
| A real Rank 4 approval through the normal interface | Completed normally — no regression in the legitimate flow |
| Creating an order without selecting a Head of Department | Blocked client-side with the expected toast; no raw server error reached the user |

The second confirms both halves of the client/server pair: the Confirm gate fires before the request is sent, and the requester never sees the `invalid-argument` message that `createOrder` would otherwise return.

**Not directly confirmed:** no attempt was made to approve an order from an unrelated department and observe `permission-denied`, nor to exercise the two new `failed-precondition` paths — the audit showed no data in a state that would trigger them, so producing one would require deliberately constructing it.

---

### FIND-22: Cost and commission data is delivered to roles gated only in the browser

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 6.6 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-602](https://cwe.mitre.org/data/definitions/602.html): Client-Side Enforcement of Server-Side Security |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Standard Mitigation |
| Component | SummaryReport |
| Related Threats | [T07.I](2-stride-analysis.md#summaryreport), [T08.I2](2-stride-analysis.md#orderdetails) |

#### Description

The sales-commission, EBITDA, and net-margin panels are hidden from most roles by a client-side conditional testing for `admin` or `rank1`. The server, however, strips sensitive fields only for the `viewer` role — every other role receives `totalCost`, `costPerUnit`, `totalSST`, and `salesBuffer` in the `listOrders` payload. A Rank 2, Rank 3, or Rank 4 approver therefore holds all the inputs to the commission calculation in their browser and can read them straight from the network response or from React state, regardless of which cards the UI chooses to render. The field-stripping mechanism to fix this already exists and is applied correctly for `viewer`; it simply is not extended to the intermediate ranks.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists SummaryReport as `Auth Required: Yes (RequireAuth + BlockViewer)`, `Reachability: External`, `Min Prerequisite: Authenticated User`.

`src/pages/SummaryReport.tsx:1078` gates the financing panel with `{(role === "admin" || role === "rank1") && (`, and `src/pages/OrderDetails.tsx:560` gates the commission card the same way. The commission figure itself is computed in the browser at `src/pages/OrderDetails.tsx:223` from `rawGrossMarginRM`, which derives from `orderCostingSummary.tcv.total` at `src/pages/OrderDetails.tsx:178-197` — all from fields present in the payload.

Server-side, `stripForViewer` at `functions/src/index.ts:48-59` removes `totalCost`, `costPerUnit`, `totalSST`, and `salesBuffer`, but `functions/src/index.ts:125-127` applies it only when `role === "viewer"`.

#### Remediation

Replace the single viewer-specific strip with a per-role projection applied in both `getOrder` and `listOrders`. Define which fields each of `user`, `rank1` through `rank4`, `viewer`, and `admin` may receive, and remove everything else server-side before the response is serialised. Keep the client-side conditionals as a presentation concern only, so the UI and the payload agree.

#### Verification

Sign in as a `rank3` account, capture the `listOrders` response, and confirm that `costPerUnit`, `salesBuffer`, and `totalSST` are absent from every service. Confirm an `admin` account still receives them.

---

### FIND-23: Identity resolution has divergent paths and an email-keyed profile lookup

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 6.5 (CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:N/VC:L/VI:H/VA:N/SC:N/SI:L/SA:N) |
| CWE | [CWE-287](https://cwe.mitre.org/data/definitions/287.html): Improper Authentication |
| OWASP | A07:2025 – Authentication Failures |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Redesign |
| Component | CloudFunctions |
| Related Threats | [T11.S2](2-stride-analysis.md#cloudfunctions), [T11.S3](2-stride-analysis.md#cloudfunctions), [T02.E](2-stride-analysis.md#authprovider) |

#### Description

The system resolves a caller's role through two separate implementations that disagree. `getMyProfile`, which drives the UI, promotes an account with no profile document to `rank4` when its email address contains the substring `rank4`. `getCallerProfile`, which every enforcing path uses, defaults the same account to `user`. The practical effect today is a confusing but fail-safe divergence: the UI offers approver controls that every server check then denies.

The divergence is dangerous because it is silent and because the same heuristic exists in three places, one of which is a client-side fallback that is inert only because `firestore.rules` denies the read. Any future change that relaxes those rules, or that consolidates the two resolvers toward the wrong one, converts a cosmetic inconsistency into a real privilege escalation. Separately, both resolvers fall back to a profile document keyed by email address rather than by UID; an email-keyed document is a weaker identity binding, because it is addressable by whoever controls that address at provisioning time rather than by the account Firebase actually authenticated.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists CloudFunctions as `Min Prerequisite: None`; reaching either resolver requires a valid ID token, so the prerequisite is `Authenticated User`.

`functions/src/index.ts:453-455` in `getMyProfile`:

```
} else if (email && email.toLowerCase().includes("rank4")) {
  role = "rank4";
  department = getDepartmentFromEmail(email);
```

`functions/src/index.ts:41` in `getCallerProfile`: `const role = data?.role || "user";` — no email heuristic.

The email-keyed fallback appears at `functions/src/index.ts:37-40` in `getCallerProfile` and at `functions/src/index.ts:435-438` in `getMyProfile`, both reading `db.collection("users").doc(email)`. The client-side duplicate of the heuristic is at `src/context/AuthContext.tsx:99-101`, reachable only if the deny-all rule at `firestore.rules:15-17` is relaxed.

#### Remediation

Delete the `rank4` substring heuristic from `getMyProfile` and from `src/context/AuthContext.tsx`, and have `getMyProfile` delegate to `getCallerProfile` so one implementation serves both the UI and enforcement. Key profiles solely on UID: migrate any email-keyed documents in the `users` collection to UID-keyed documents and remove both fallback branches. Remove the now-dead direct-Firestore fallback in `AuthContext` entirely rather than relying on the rules to keep it unreachable.

#### Verification

Sign in with a test address containing `rank4` and no profile document, and confirm `getMyProfile` returns `user`. Confirm the `users` collection contains no documents whose id is an email address.

---

### FIND-24: Upload content type is client-declared and never verified

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 6.3 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:P/VC:L/VI:L/VA:N/SC:L/SI:L/SA:N) |
| CWE | [CWE-434](https://cwe.mitre.org/data/definitions/434.html): Unrestricted Upload of File with Dangerous Type |
| OWASP | A05:2025 – Injection |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Standard Mitigation |
| Component | FirebaseStorage |
| Related Threats | [T13.T](2-stride-analysis.md#firebasestorage), [T06.T1](2-stride-analysis.md#dashboard), [T13.A2](2-stride-analysis.md#firebasestorage) |

#### Description

Two layers of file-type validation exist and both trust the same untrusted source. The browser checks `file.type`, which the browser derives from the file extension and which a scripted client can set arbitrarily. The Storage rule then checks `request.resource.contentType`, which is the value the uploading client declares in the request — not a property of the bytes. A client that bypasses the SPA and calls the Storage API directly can therefore store any content under an `application/pdf` label.

Combined with the permanent, unauthenticated download URLs from FIND-03, the bucket becomes a durable distribution point for arbitrary content on a `firebasestorage.googleapis.com` domain that recipients are likely to trust. No malware or content scanning is applied at any point in the pipeline.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists FirebaseStorage as `Min Prerequisite: None`; uploading requires a session, so the prerequisite is `Authenticated User`.

`src/pages/Dashboard.tsx:58-66` checks `file.type === "application/pdf"` and the two Excel MIME strings. `storage.rules:13-21` checks `request.resource.contentType == 'application/pdf'` and the Excel equivalents — both values originate with the client. Nothing inspects the object bytes: there is no Storage-triggered function in the repository, and `functions/src/index.ts` contains only `onCall` handlers.

#### Remediation

Add a Cloud Storage `onObjectFinalized` trigger that reads the first bytes of each new object, verifies the magic number against the declared content type, and deletes or quarantines mismatches before any download URL is issued. Add malware scanning in the same trigger. Keep the client-side and rules-level checks as cheap early rejection, but treat the server-side byte inspection as the authoritative control.

#### Verification

Upload a file containing HTML bytes with a `.pdf` extension through a direct Storage API call, and confirm the trigger quarantines it and that no usable download URL is produced.

---

### FIND-25: Approval transitions are not transactional

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 6.1 (CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:N/VC:N/VI:H/VA:N/SC:N/SI:L/SA:N) |
| CWE | [CWE-367](https://cwe.mitre.org/data/definitions/367.html): Time-of-check Time-of-use (TOCTOU) Race Condition |
| OWASP | A10:2025 – Mishandling of Exceptional Conditions |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Standard Mitigation |
| Component | CloudFunctions |
| Related Threats | [T11.T3](2-stride-analysis.md#cloudfunctions) |

#### Description

`approveOrder` and `rejectOrder` read the order, evaluate authorization against `currentApprovalRank`, compute the next state, and write — all outside a transaction. Two approvals arriving close together for the same order both observe the same `currentApprovalRank`, both pass the rank check, and both write. Depending on interleaving, the order advances two stages on a single approval, or one approver's audit entry is overwritten by the other because each writes a full `approvalHistory` array computed from the state it read. The same window allows an approve and a reject to race, leaving the order in a state that contradicts its own audit log. `createOrder` demonstrates the correct pattern elsewhere in the same file.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists CloudFunctions as `Min Prerequisite: None`; invoking either callable requires a valid ID token, so the prerequisite is `Authenticated User`.

`functions/src/index.ts:148-216` in `approveOrder`: the read at lines 149-151 (`await orderRef.get()`), the authorization check at lines 170-178, the history construction at line 194 (`const updatedHistory = [...(order.approvalHistory || []), newHistoryEntry];`), and the write at lines 212-216 (`await orderRef.update({...})`) are separate awaited operations with no transaction or precondition. `rejectOrder` repeats the pattern at `functions/src/index.ts:236-283`.

By contrast `createOrder` correctly uses `await db.runTransaction(...)` for counter allocation at `functions/src/index.ts:384-390`.

#### Remediation

Wrap the read, authorization check, and write of both handlers in `db.runTransaction`, re-reading the order inside the transaction and aborting if `currentApprovalRank` or `status` differs from what the authorization decision was based on. Append to `approvalHistory` with `FieldValue.arrayUnion` rather than rewriting the whole array so concurrent entries cannot overwrite one another.

#### Verification

Fire two concurrent `approveOrder` calls for the same order from two authorised approvers at the same rank and confirm exactly one succeeds, the other fails with a retryable error, and the order advances exactly one stage with one new audit entry.

---

### FIND-26: No audit trail for order creation, deletion, submission, withdrawal, or profile change

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 5.9 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:L/VA:N/SC:N/SI:H/SA:N) |
| CWE | [CWE-778](https://cwe.mitre.org/data/definitions/778.html): Insufficient Logging |
| OWASP | A09:2025 – Security Logging and Alerting Failures |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Custom Mitigation |
| Component | CloudFunctions |
| Related Threats | [T11.R1](2-stride-analysis.md#cloudfunctions), [T11.R2](2-stride-analysis.md#cloudfunctions), [T13.R](2-stride-analysis.md#firebasestorage) |

#### Description

Only `approveOrder` and `rejectOrder` write an audit record. `createOrder`, `deleteOrder`, `submitForApproval`, `withdrawFromReview`, and `updateMyDepartment` change state with no durable trace of who acted or when, and attachment uploads and deletions are likewise unrecorded by the application. For a financial-approval system this leaves most of the lifecycle unaccountable: an admin can permanently delete an approved order and nothing records that it existed, a creator can withdraw and resubmit a request repeatedly with no evidence of the cycle, and the role self-assignment in FIND-15 leaves no trace at all.

`deleteOrder` compounds this by performing a hard delete rather than a soft delete, so the document itself is gone along with its embedded approval history.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists CloudFunctions as `Min Prerequisite: None`; all of these handlers require a valid ID token, so the prerequisite is `Authenticated User`.

Handlers that write no audit record: `createOrder` at `functions/src/index.ts:394-400`, `deleteOrder` at `functions/src/index.ts:420-422`, `submitForApproval` at `functions/src/index.ts:314-322`, `withdrawFromReview` at `functions/src/index.ts:350-355`, and `updateMyDepartment` at `functions/src/index.ts:476-490`. The hard delete is `await db.collection("orders").doc(orderId).delete();` at `functions/src/index.ts:420`.

The only audit writes are `functions/src/index.ts:186-194` and `:269-277`. Attachment operations at `src/pages/Dashboard.tsx:79` and `:113` go directly to Storage with no application-side record.

#### Remediation

Add an append-only `auditLog` collection and write an entry from every state-changing callable capturing the actor UID and email, the action, a server timestamp, the target document id, and the before/after values of the fields that changed. Replace the hard delete in `deleteOrder` with a `deletedAt`/`deletedBy` soft-delete flag, filter soft-deleted orders out of `listOrders`, and move permanent removal to a separate retention process. Record attachment upload and removal through the authorizing callable introduced in FIND-03.

#### Verification

Perform one of each action — create, submit, withdraw, delete, department change — and confirm a corresponding `auditLog` entry exists naming the correct actor. Confirm a deleted order is absent from `listOrders` but still present in Firestore with its audit history intact.

---

### FIND-27: listOrders scans the entire collection on a four-second poll

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 5.8 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:N/VA:H/SC:N/SI:N/SA:N) |
| CWE | [CWE-405](https://cwe.mitre.org/data/definitions/405.html): Asymmetric Resource Consumption (Amplification) |
| OWASP | A10:2025 – Mishandling of Exceptional Conditions |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Redesign |
| Component | CloudFunctions |
| Related Threats | [T11.D2](2-stride-analysis.md#cloudfunctions), [T01.D2](2-stride-analysis.md#approutes), [T05.A](2-stride-analysis.md#mainpage) |

#### Description

`listOrders` reads every document in the `orders` collection on every invocation and performs all role filtering in memory afterwards. The SPA calls it every four seconds for every open tab, with no backoff on error, no pause when the tab is hidden, and no pagination. Firestore read volume therefore scales as the product of collection size and concurrent sessions — fifteen full-collection scans per minute per tab. The problem compounds because every order edit creates an additional document rather than updating one (FIND-29), so the collection grows monotonically with use.

The same design also delivers every order in the caller's scope to the browser on each poll, which makes scripted bulk extraction of everything a user can see trivial and indistinguishable from normal application traffic.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists CloudFunctions as `Min Prerequisite: None`; invoking `listOrders` requires a valid ID token, so the prerequisite is `Authenticated User`.

`functions/src/index.ts:88-89`: `const snap = await db.collection("orders").orderBy("createdAt", "desc").get();` followed by `const all = snap.docs.map(...)` — no `where` clause and no `limit`. Filtering happens afterwards in memory at `functions/src/index.ts:91-127`.

`src/hooks/useFirestoreOrders.ts:13` sets `const POLL_INTERVAL_MS = 4000;` and `:45` schedules `setInterval(fetchOrders, POLL_INTERVAL_MS)`. The error path at `:36-38` only logs, so a failing backend is polled just as hard. There is no `document.hidden` check.

#### Remediation

Push the role filter into the Firestore query — `where("createdBy", "==", email)` for plain users, `where("accountManager", "==", name)` for viewers, and an indexed predicate on `currentApprovalRank` and `status` for rank holders — and add `limit` with cursor-based pagination. Replace the fixed interval with a Firestore `onSnapshot` subscription routed through a callable-issued scope, or at minimum add exponential backoff on error and suspend polling when `document.hidden` is true.

#### Verification

With one thousand orders in a test project, measure the Firestore read count for a single `listOrders` call as a plain user and confirm it is bounded by the page size rather than the collection size. Confirm polling stops while the tab is backgrounded.

---

### FIND-28: Withdraw and resubmit cycles reset approval history without limit

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 5.4 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:L/VA:N/SC:N/SI:H/SA:N) |
| CWE | [CWE-841](https://cwe.mitre.org/data/definitions/841.html): Improper Enforcement of Behavioral Workflow |
| OWASP | A06:2025 – Insecure Design |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Custom Mitigation |
| Component | CloudFunctions |
| Related Threats | [T11.A1](2-stride-analysis.md#cloudfunctions), [T11.A2](2-stride-analysis.md#cloudfunctions), [T08.A1](2-stride-analysis.md#orderdetails) |

#### Description

A requester can withdraw an order from review at any point while it is pending, including immediately before an unfavourable decision, and resubmission then clears `approvalHistory` to an empty array. The combination lets a creator erase the record of a Rank 4 rejection and re-enter the chain as if it had never happened, or repeatedly stall a decision until a different approver is on duty. Neither the withdrawal nor the history reset is recorded anywhere, so the pattern is invisible to anyone reviewing the order afterwards.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists CloudFunctions as `Min Prerequisite: None`; both callables require a valid ID token and creator ownership, so the prerequisite is `Authenticated User`.

`functions/src/index.ts:319` in `submitForApproval` writes `approvalHistory: []` unconditionally as part of the update. `functions/src/index.ts:326-356` in `withdrawFromReview` checks only creator ownership (`:342-344`) and that the status starts with `"Pending Approval"` (`:346-348`); there is no cycle counter, no reason field, and no audit write. The client entry point is `src/pages/OrderDetails.tsx:125-141`.

#### Remediation

Preserve prior history across resubmission by appending a `"Resubmitted"` marker entry rather than clearing the array. Record each withdrawal as an audit entry naming the actor and requiring a stated reason, and cap the number of withdraw/resubmit cycles per order number, escalating to an admin beyond that limit.

#### Verification

Approve an order at Rank 4, withdraw it as the creator, resubmit it, and confirm the original Rank 4 entry is still present in `approvalHistory` alongside a resubmission marker.

---

### FIND-29: Client controls order number and version on edit

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 5.3 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:H/VA:L/SC:N/SI:N/SA:N) |
| CWE | [CWE-639](https://cwe.mitre.org/data/definitions/639.html): Authorization Bypass Through User-Controlled Key |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Standard Mitigation |
| Component | CloudFunctions |
| Related Threats | [T11.A3](2-stride-analysis.md#cloudfunctions), [T07.A2](2-stride-analysis.md#summaryreport), [T07.A1](2-stride-analysis.md#summaryreport) |

#### Description

`createOrder` honours an `isNew: false` flag that skips server-side counter allocation and stores whatever `orderNumber` the client supplied, with no check that the caller created the order carrying that number. A requester can therefore graft a fabricated document onto another team's order history, where it appears as a legitimate later version. Because every confirmation writes a new document rather than updating one, and no cap limits versions per order number, the same mechanism also inflates the collection that `listOrders` scans on every poll.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists CloudFunctions as `Min Prerequisite: None`; `createOrder` requires a valid ID token and the `user` role, so the prerequisite is `Authenticated User`.

`functions/src/index.ts:365` reads `const isNew = request.data?.isNew !== false;` and `:379` reads `let orderNumber = orderData.orderNumber;`. The counter transaction at `:381-391` runs only `if (isNew)`, so the client value survives otherwise. No query verifies that the caller owns the supplied order number.

The client passes the flag at `src/App.tsx:130` (`await createOrderFn({ order, isNew: reset })`), where `reset` is `!existingOrder` from `src/pages/SummaryReport.tsx:333`. A fresh document id is minted on every confirmation at `src/pages/SummaryReport.tsx:315`, and `version` is incremented client-side at `:317`.

#### Remediation

Replace the `isNew` flag with an explicit `amendsOrderId`. When present, load that order server-side, verify `createdBy` matches the caller, and derive both `orderNumber` and the next `version` from the stored document rather than from the request. Cap the number of versions permitted per order number and reject writes beyond it.

#### Verification

Call `createOrder` with `isNew: false` and another user's order number, and confirm the call is rejected. Confirm a legitimate edit still produces a document with the correct incremented version.

---

### FIND-30: Internal identities and portfolio aggregates are disclosed across roles

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 5.1 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-200](https://cwe.mitre.org/data/definitions/200.html): Exposure of Sensitive Information to an Unauthorized Actor |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Standard Mitigation |
| Component | MainPage |
| Related Threats | [T05.I1](2-stride-analysis.md#mainpage), [T05.I2](2-stride-analysis.md#mainpage), [T08.I3](2-stride-analysis.md#orderdetails), [T02.I2](2-stride-analysis.md#authprovider), [T01.I](2-stride-analysis.md#approutes) |

#### Description

Several surfaces disclose more than the role needs. The portal list renders each requester's email address to every non-`user` role, and its summary tiles aggregate total revenue across everything the caller can see, giving viewers and rank holders a portfolio figure beyond their per-record entitlement. The order detail view renders approver email addresses alongside free-text approval comments, so an internal negotiating position recorded by a CFO is visible to the requester. Separately, the resolved role is written to the browser console on every sign-in, and delete failures surface raw server error text in a toast.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists MainPage as `Auth Required: Yes (RequireAuth)`, `Reachability: External`, `Min Prerequisite: Authenticated User`.

`src/pages/MainPage.tsx:181` renders the `Created By` header for `role !== "user"` and `:287` renders `{order.createdBy || "-"}`. The revenue aggregate is at `src/pages/MainPage.tsx:143`. Approver identities and comments are rendered at `src/pages/OrderDetails.tsx:806-814`. The console role log is `src/context/AuthContext.tsx:64`, and the raw error toast is `src/App.tsx:193-195` (`const msg = e?.message || ...; toast.error(msg);`).

#### Remediation

Return a resolved display name from the server rather than the raw address and render that instead of `createdBy` and `approvedBy`. Compute aggregate figures server-side and return them only to roles entitled to portfolio totals. Remove the role from production console logging, and map `HttpsError` codes to fixed user-facing strings rather than surfacing the server message.

#### Verification

Sign in as a `viewer` and confirm no email addresses appear in the portal list or the approval log, and that the revenue tile is absent or scoped. Confirm the browser console contains no role statement after sign-in.

---

### FIND-31: No quota, retention, or cleanup for attachment storage

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 5.0 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:L/VI:N/VA:L/SC:N/SI:N/SA:N) |
| CWE | [CWE-770](https://cwe.mitre.org/data/definitions/770.html): Allocation of Resources Without Limits or Throttling |
| OWASP | A10:2025 – Mishandling of Exceptional Conditions |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Standard Mitigation |
| Component | FirebaseStorage |
| Related Threats | [T13.D](2-stride-analysis.md#firebasestorage), [T13.A1](2-stride-analysis.md#firebasestorage), [T06.D](2-stride-analysis.md#dashboard), [T06.A](2-stride-analysis.md#dashboard) |

#### Description

Any authenticated user may upload 100 MiB Excel objects with no per-user byte or object quota and no lifecycle rule, so storage cost grows without bound and a single account can inflate it deliberately. Objects also remain under the `draft-attachments/` prefix permanently — they are never moved when an order is submitted and never expired — so a path named for transient drafts accumulates an indefinite archive of vendor quotations. The client compounds the drift by removing an attachment from local metadata even when the storage delete fails, leaving an orphaned object that is still reachable through its permanent URL but no longer tracked by any order.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists FirebaseStorage as `Min Prerequisite: None`; uploading requires a session, so the prerequisite is `Authenticated User`.

`storage.rules:16-21` permits Excel objects under `100 * 1024 * 1024` bytes with no count or aggregate limit; there is no lifecycle configuration file in the repository. `src/pages/Dashboard.tsx:111-119` shows `handleRemoveAttachment` catching the `deleteObject` rejection at `:114-116` and then unconditionally removing the local reference at `:117`. Nothing relocates objects on submission — `src/pages/SummaryReport.tsx:313-328` carries the attachment records into the order unchanged.

#### Remediation

Enforce a per-user object count and byte quota in a Storage `onObjectFinalized` trigger, rejecting uploads beyond it. Add an Object Lifecycle Management rule expiring objects under `draft-attachments/` that are not referenced by any order after a defined period. Move attachments to an order-scoped prefix on submission, and remove the local attachment reference only after the delete succeeds, reconciling orphans with a scheduled sweep.

#### Verification

Upload objects until the configured per-user quota is reached and confirm further uploads are rejected. Confirm an unreferenced draft object is removed by the lifecycle rule after the retention window.

---

### FIND-32: Draft state is parsed from local storage without validation

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 4.8 (CVSS:4.0/AV:L/AC:L/AT:N/PR:L/UI:N/VC:N/VI:L/VA:H/SC:N/SI:N/SA:N) |
| CWE | [CWE-20](https://cwe.mitre.org/data/definitions/20.html): Improper Input Validation |
| OWASP | A10:2025 – Mishandling of Exceptional Conditions |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | AppRoutes |
| Related Threats | [T01.T](2-stride-analysis.md#approutes), [T01.D1](2-stride-analysis.md#approutes) |

#### Description

The services draft is rehydrated with a bare `JSON.parse` and no error handling, while the metadata draft immediately below it is correctly wrapped in `try`/`catch` — so malformed stored JSON throws inside the effect and blanks the application with no recovery path. Neither parse validates the shape or ranges of what it reads, so a modified draft injects arbitrary service objects, including negative costs or oversized numbers, directly into the order-creation path where they are persisted without server-side validation.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists AppRoutes as `Auth Required: Yes (Firebase Auth session enforced by RequireAuth)`, `Reachability: External`, `Min Prerequisite: Authenticated User`.

`src/App.tsx:88-89`: `const savedServices = localStorage.getItem(servicesKey); setServices(savedServices ? JSON.parse(savedServices) : []);` — unguarded. Compare `src/App.tsx:91-102`, where the metadata parse is wrapped in `try { ... } catch (e) { setOrderMetadata(INITIAL_METADATA); }`. Neither path checks the parsed value against the `Service` interface at `src/types.ts:3-38`.

#### Remediation

Wrap the services parse in `try`/`catch` with a fallback to an empty draft, matching the metadata path. Validate both parsed values against Zod schemas derived from `Service` and `OrderMetadata` before placing them in state, discarding anything that does not conform. Pair this with the server-side payload validation in FIND-16 so a malformed draft cannot be persisted even if it reaches `createOrder`.

#### Verification

Write invalid JSON to the `services_<uid>` key in devtools, reload the application, and confirm it renders with an empty draft rather than a blank screen. Write a structurally valid but out-of-range service and confirm it is discarded.

---

### FIND-33: Order duplication copies another team's commercial terms

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 4.6 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-200](https://cwe.mitre.org/data/definitions/200.html): Exposure of Sensitive Information to an Unauthorized Actor |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Custom Mitigation |
| Component | AppRoutes |
| Related Threats | [T01.A](2-stride-analysis.md#approutes) |

#### Description

`handleDuplicateOrder` copies every field of any order in the caller's visible set into a fresh editable draft, with no check that the caller created the source order. Where the visible set includes another department's requests — which it does for every rank holder and for admins — the feature becomes a convenient way to extract a complete pricing structure, including per-service cost basis and sales buffer, into a document the caller then owns and can export.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists AppRoutes as `Auth Required: Yes (RequireAuth)`, `Reachability: External`, `Min Prerequisite: Authenticated User`.

`src/App.tsx:144-185` copies twenty-eight metadata fields verbatim and then `setServices(order.services.map(s => ({ ...s, id: crypto.randomUUID() })));` at `:184`, which carries `costPerUnit`, `totalCost`, `totalSST`, and `salesBuffer` from `src/types.ts:25-31` into the new draft. The control is rendered at `src/pages/MainPage.tsx:262` for `role === "user"`, operating on the order objects supplied by `listOrders`.

#### Remediation

Restrict duplication to orders where `createdBy` matches the signed-in user, enforcing the check server-side when the duplicate is eventually persisted. Alternatively, strip cost, SST, and sales-buffer fields from the duplicated draft so the feature copies structure without copying commercial terms.

#### Verification

As a requester, attempt to duplicate an order created by another user and confirm the action is unavailable or that the resulting draft contains no cost fields.

---

### FIND-34: Viewer scope is keyed on a display-name string match

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 4.5 (CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-863](https://cwe.mitre.org/data/definitions/863.html): Incorrect Authorization |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Standard Mitigation |
| Component | CloudFunctions |
| Related Threats | [T11.I2](2-stride-analysis.md#cloudfunctions) |

#### Description

The `viewer` role's visibility scope is computed by comparing the order's `accountManager` field — a free-text string typed by the requester — against the viewer's profile `name`, case-insensitively. Two people sharing a display name therefore see each other's orders, and a requester who types a viewer's name into the `accountManager` field grants that viewer access to a request that is not theirs. Authorization is being derived from a human-readable label rather than from a stable identifier.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists CloudFunctions as `Min Prerequisite: None`; `listOrders` requires a valid ID token, so the prerequisite is `Authenticated User`.

`functions/src/index.ts:117-120`:

```
visible = all.filter(
  (o) => (o.accountManager || "").trim().toLowerCase() === (name || "").trim().toLowerCase()
);
```

`name` comes from the profile document at `functions/src/index.ts:44`, and `accountManager` is a plain input field declared at `src/types.ts:154` and edited at `src/pages/SummaryReport.tsx:520-525`.

#### Remediation

Store a stable account-manager identifier — the UID or the canonical email — on the order at creation time, populated from a picker backed by the `users` collection rather than from free text. Filter viewer visibility on that identifier and keep the display name purely presentational.

#### Verification

Create two test accounts with identical display names, assign an order to one, and confirm the other cannot see it in `listOrders`.

---

### FIND-35: Approval comment length is unbounded

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 4.3 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N) |
| CWE | [CWE-1284](https://cwe.mitre.org/data/definitions/1284.html): Improper Validation of Specified Quantity in Input |
| OWASP | A10:2025 – Mishandling of Exceptional Conditions |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | OrderDetails |
| Related Threats | [T08.A2](2-stride-analysis.md#orderdetails) |

#### Description

Approval and rejection both require a non-empty comment, and both validate that requirement on the client and again on the server — but neither bounds its length. An approver can therefore append a megabyte-scale comment to the `approvalHistory` array stored inside the order document, pushing it toward Firestore's 1 MiB per-document ceiling. Once that ceiling is reached the order becomes permanently unwritable and no further approval or rejection can be recorded against it.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists OrderDetails as `Auth Required: Yes (RequireAuth)`, `Reachability: External`, `Min Prerequisite: Authenticated User`.

Client-side checks at `src/pages/OrderDetails.tsx:72-75` and `:98-101` test only `!approvalComment.trim()`. Server-side, `functions/src/index.ts:143-145` and `:232-234` test `!comment || typeof comment !== "string" || !comment.trim()` — presence and type, not size. The value is written into the array at `functions/src/index.ts:192` and `:275`, and the array is rewritten whole at `:194` and `:277`.

#### Remediation

Enforce a maximum comment length server-side — a few thousand characters is ample — and reject oversized payloads before the update. Add a matching `maxLength` on the textarea so the constraint is visible to the approver. Combine this with moving audit entries into a subcollection as described in FIND-50 so document growth is bounded structurally.

#### Verification

Submit an approval with a comment exceeding the configured limit and confirm the callable rejects it with `invalid-argument`.

---

### FIND-36: Stale privileges persist for the lifetime of the ID token

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 4.2 (CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:N/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-613](https://cwe.mitre.org/data/definitions/613.html): Insufficient Session Expiration |
| OWASP | A07:2025 – Authentication Failures |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Standard Mitigation |
| Component | FirebaseAuth |
| Related Threats | [T14.E](2-stride-analysis.md#firebaseauth) |

#### Description

Firebase ID tokens remain valid for up to an hour, and the application never revokes refresh tokens or forces a refresh when a profile changes. A user who is demoted from an approver rank, or whose account is disabled during an incident, continues to pass every server-side check until their current token expires naturally. Because role is read from Firestore on each call rather than from a token claim, a demotion does take effect for the role lookup — but the underlying session remains valid, so a disabled account retains access for the remainder of the token's lifetime.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists FirebaseAuth as `Min Prerequisite: None`; retaining a session requires having been authenticated, so the prerequisite is `Authenticated User`.

No call to `revokeRefreshTokens` or `getIdToken(true)` appears anywhere in `functions/src/index.ts` or under `src/`. `updateMyDepartment` at `functions/src/index.ts:465-491` writes profile changes with no token invalidation. The callables rely on `request.auth` alone (`functions/src/index.ts:63`, `:81`, `:134`) and do not compare the token issue time against a revocation timestamp.

#### Remediation

Call `getAuth().revokeRefreshTokens(uid)` whenever a profile role changes or an account is disabled, record the revocation time on the profile document, and have `getCallerProfile` reject tokens whose `auth_time` predates it. Shorten the effective session by forcing a token refresh on role-sensitive operations.

#### Verification

Disable a test account while it holds an active session and confirm its next callable invocation is rejected rather than succeeding until token expiry.

---

### FIND-37: Development server binds to all network interfaces

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 3.4 (CVSS:4.0/AV:A/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-1327](https://cwe.mitre.org/data/definitions/1327.html): Binding to an Unrestricted IP Address |
| OWASP | A02:2025 – Security Misconfiguration |
| Exploitation Prerequisites | Internal Network |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | FirebaseHosting |
| Related Threats | [T10.A](2-stride-analysis.md#firebasehosting) |

#### Description

The `dev` script binds Vite to `0.0.0.0`, publishing the development build to every host on the developer's network rather than to localhost alone. Anyone on the same corporate or café network can load the in-progress application and the Firebase configuration injected into it, including any value present in the developer's `.env` at the time. The binding is a convenience default that carries no benefit for local work.

#### Evidence

**Prerequisite basis:** The Component Exposure Table in `0.1-architecture.md` covers the deployed application; this finding concerns the development server, which requires network adjacency to the developer's machine, so the prerequisite is `Internal Network`.

`package.json:7`: `"dev": "vite --port=3000 --host=0.0.0.0"`. The configuration injected into that build is defined at `vite.config.ts:52-62` and includes `process.env.GEMINI_API_KEY` at `:53`.

#### Remediation

Remove `--host=0.0.0.0` from the `dev` script so Vite binds to localhost by default, and add a separate `dev:lan` script for the occasions where network exposure is genuinely wanted.

#### Verification

Run `npm run dev` and confirm the server is reachable at `127.0.0.1:3000` but not at the machine's LAN address.

---

### FIND-38: Order-number counter is a single hot document

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 3.1 (CVSS:4.0/AV:N/AC:H/AT:P/PR:L/UI:N/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N) |
| CWE | [CWE-1050](https://cwe.mitre.org/data/definitions/1050.html): Excessive Platform Resource Consumption within a Loop |
| OWASP | A10:2025 – Mishandling of Exceptional Conditions |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Medium |
| Mitigation Type | Standard Mitigation |
| Component | CloudFunctions |
| Related Threats | [T11.D3](2-stride-analysis.md#cloudfunctions) |

#### Description

Every new order allocates its number by incrementing a single `counters/orders` document inside a transaction. Firestore sustains roughly one write per second to an individual document, so concurrent order creation serialises on that one key and transactions begin to fail under contention. The transaction itself is correct — the limitation is structural rather than a defect in the logic.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists CloudFunctions as `Min Prerequisite: None`; `createOrder` requires a valid ID token and the `user` role, so the prerequisite is `Authenticated User`.

`functions/src/index.ts:383-390` obtains `db.collection("counters").doc("orders")` and performs `tx.get` followed by `tx.set` on that single document for every creation.

#### Remediation

Replace the single counter with a sharded counter distributing writes across several documents, or switch to a time-ordered identifier scheme that needs no central allocation while preserving the `FA-nnnn` display format.

#### Verification

Create twenty orders concurrently in a test project and confirm all twenty receive distinct sequential numbers without transaction failures.

---

### FIND-39: Client and rules file-size limits disagree

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 2.3 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N) |
| CWE | [CWE-1284](https://cwe.mitre.org/data/definitions/1284.html): Improper Validation of Specified Quantity in Input |
| OWASP | A10:2025 – Mishandling of Exceptional Conditions |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Custom Mitigation |
| Component | Dashboard |
| Related Threats | [T06.T2](2-stride-analysis.md#dashboard) |

#### Description

The browser applies a single 100 MB ceiling to both PDF and Excel uploads, while the Storage rules cap PDFs at 5 MiB. A PDF between those two limits therefore passes local validation, uploads, and is rejected at the rules layer — where the user sees only a generic "Failed to upload" toast with no indication of the real reason. The rejection message the client does emit for oversized files also names the wrong limit for PDFs.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists Dashboard as `Auth Required: Yes (RequireAuth + RequireUser)`, `Reachability: External`, `Min Prerequisite: Authenticated User`.

`src/pages/Dashboard.tsx:68-72` sets `const maxSize = 100 * 1024 * 1024;` and emits `exceeds the 100MB limit for ${isPdf ? "PDF" : "Excel"} files`. `storage.rules:13-15` permits PDFs only when `request.resource.size < 5 * 1024 * 1024`. The upload failure path at `src/pages/Dashboard.tsx:87-91` shows only `Failed to upload ${file.name}`.

#### Remediation

Split the client-side limit to 5 MiB for PDF and 100 MiB for Excel so it matches `storage.rules`, correct the message to name the applicable limit, and surface the storage error code in the failure toast so a rules rejection is distinguishable from a network failure.

#### Verification

Attempt to upload a 10 MB PDF and confirm it is rejected client-side with a message naming the 5 MB limit.

---

### FIND-40: Department update is applied optimistically and can display unsaved state

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 2.1 (CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:N/VC:N/VI:L/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-390](https://cwe.mitre.org/data/definitions/390.html): Detection of Error Condition Without Action |
| OWASP | A10:2025 – Mishandling of Exceptional Conditions |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Custom Mitigation |
| Component | AuthProvider |
| Related Threats | [T02.T](2-stride-analysis.md#authprovider) |

#### Description

`updateDepartment` writes the new department into local state before calling the server and, if the callable rejects, only logs to the console. A Rank 4 approver can therefore see a department in the header that the server never accepted, and will form expectations about which orders they should be seeing based on a value that does not exist server-side. The mismatch persists silently until the next sign-in.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists AuthProvider as `Min Prerequisite: None`; changing a department requires a session, so the prerequisite is `Authenticated User`.

`src/context/AuthContext.tsx:131-140`: `setActualDepartment(newDept);` executes at `:133` before the `try` block, and the catch at `:137-139` contains only `console.error("[Auth] Error updating user department:", err);`. The displayed value is rendered at `src/components/Header.tsx:56-61`.

#### Remediation

Move `setActualDepartment` after the callable resolves, revert to the prior value on rejection, and surface a toast so the failure is visible.

#### Verification

Force the `updateMyDepartment` call to fail and confirm the header reverts to the previous department and an error is shown.

---

### FIND-41: Profile resolution blocks the entire interface

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 2.0 (CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:N/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N) |
| CWE | [CWE-1088](https://cwe.mitre.org/data/definitions/1088.html): Synchronous Access of Remote Resource without Timeout |
| OWASP | A10:2025 – Mishandling of Exceptional Conditions |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | AuthProvider |
| Related Threats | [T02.D](2-stride-analysis.md#authprovider) |

#### Description

`setLoading(false)` runs only after `getMyProfile` settles, and on failure only after two further Firestore round-trips that the deny-all rules guarantee will fail. Every route in the application therefore sits on the "Loading…" splash for the full duration of a slow or erroring profile call, with no timeout. A Cloud Functions cold start or a transient outage translates directly into an unusable application rather than a degraded one.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists AuthProvider as `Min Prerequisite: None`; the profile call happens after sign-in, so the prerequisite is `Authenticated User`.

`src/context/AuthContext.tsx:55-121`: the `getMyProfile` await is at `:62`, the fallback reads are at `:74-75` and `:87-88`, and `setLoading(false)` is reached only at `:121`. The guards that consume `loading` are at `src/App.tsx:20-27`, `:36-43`, and `:52-59`, each rendering the splash while it is true.

#### Remediation

Apply a client-side timeout to the `getMyProfile` call, render with a least-privilege default role when it elapses, and retry in the background. Remove the dead Firestore fallback as described in FIND-23 so a failure costs one round-trip rather than three.

#### Verification

Simulate a five-second delay on `getMyProfile` and confirm the application renders within the timeout using the default role rather than holding the splash.

---

### FIND-42: Existing control — workflow authorization is enforced server-side

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 0.0 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-602](https://cwe.mitre.org/data/definitions/602.html): Client-Side Enforcement of Server-Side Security |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Existing Control |
| Component | CloudFunctions |
| Related Threats | [T11.E4](2-stride-analysis.md#cloudfunctions), [T08.E](2-stride-analysis.md#orderdetails), [T08.T](2-stride-analysis.md#orderdetails), [T01.E](2-stride-analysis.md#approutes), [T05.E](2-stride-analysis.md#mainpage), [T06.E](2-stride-analysis.md#dashboard), [T02.S](2-stride-analysis.md#authprovider) |

#### Description

The client-side route guards and role-conditional controls are all bypassable from browser devtools, but each is backed by an independent server-side check that re-reads the order from Firestore and re-resolves the caller's role rather than trusting anything the request asserts. This is the single most important control in the system and the reason the client-side bypasses in FIND-22 and elsewhere are limited to information disclosure rather than unauthorised state change. It is recorded here so the pattern is recognised as deliberate and preserved — the code comments in the callables show it was a considered design decision.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists CloudFunctions as `Auth Required: No at endpoint; Yes in handler (request.auth)`, `Min Prerequisite: None`; these controls engage once a caller is authenticated, so the prerequisite is `Authenticated User`.

`functions/src/index.ts:147` carries the comment `// Re-read the order FRESH from the database — never trust client-supplied state.` followed by the fetch at `:148-151`. `functions/src/index.ts:153` carries `// Determine the caller's role server-side.` followed by `getCallerProfile` at `:154`. Rank enforcement is at `:165-172`, creator ownership at `:305-308` and `:341-344`, admin-only deletion at `:414-418`, and requester-only creation at `:370-374`.

#### Remediation

No change required. Preserve this pattern in all future callables: never accept a role, status, or rank from the request body, and always re-read the target document inside the handler. Extend it to close the remaining gaps identified in FIND-16, FIND-18, and FIND-25, which are places where the pattern was not applied rather than places where it failed.

#### Verification

Set `role` to `admin` in React DevTools as a plain user, click the delete control now rendered, and confirm the callable returns `permission-denied`.

---

### FIND-43: Existing control — approval audit entries use verified identity and server time

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 0.0 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-778](https://cwe.mitre.org/data/definitions/778.html): Insufficient Logging |
| OWASP | A09:2025 – Security Logging and Alerting Failures |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Existing Control |
| Component | CloudFunctions |
| Related Threats | [T11.R3](2-stride-analysis.md#cloudfunctions) |

#### Description

Approval and rejection each append an entry to `approvalHistory` whose `approvedBy` is taken from the verified ID token and whose `approvedAt` is stamped from the server clock, not from values supplied by the client. An approver therefore cannot later deny having acted, nor can a client forge an entry attributing a decision to someone else through these paths. This control covers the two most consequential actions in the workflow; the actions it does not cover are tracked in FIND-26.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists CloudFunctions as `Min Prerequisite: None`; these handlers require a valid ID token, so the prerequisite is `Authenticated User`.

`functions/src/index.ts:186-193` constructs the entry with `approvedBy: email || "Unknown Approver"` — where `email` comes from `request.auth.token.email` at `:136` — and `approvedAt: Date.now()` evaluated inside the function. The rejection equivalent is at `functions/src/index.ts:269-276`. The rendered log is at `src/pages/OrderDetails.tsx:786-817`.

#### Remediation

No change required. When extending auditing per FIND-26, follow this same pattern: derive the actor from `request.auth` and the timestamp from the server, never from the request payload. Consider upgrading `Date.now()` to `FieldValue.serverTimestamp()` for consistency with Firestore's clock.

#### Verification

Call `approveOrder` with an `approvedBy` field injected into the request body and confirm the stored entry names the authenticated caller rather than the injected value.

---

### FIND-44: Existing control — cost fields are stripped from viewer responses server-side

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 0.0 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-200](https://cwe.mitre.org/data/definitions/200.html): Exposure of Sensitive Information to an Unauthorized Actor |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Existing Control |
| Component | CloudFunctions |
| Related Threats | [T11.I3](2-stride-analysis.md#cloudfunctions), [T07.E](2-stride-analysis.md#summaryreport) |

#### Description

Responses to callers holding the `viewer` role — account managers who must not see internal cost basis — have `totalCost` removed from the order and `costPerUnit`, `totalCost`, `totalSST`, and `salesBuffer` removed from every service before serialisation. The stripping happens on the server in both `getOrder` and `listOrders`, so it holds even when the client-side `BlockViewer` guard is bypassed. This is the correct mechanism; FIND-22 recommends extending the same mechanism to the intermediate approver ranks rather than replacing it.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists CloudFunctions as `Min Prerequisite: None`; these handlers require a valid ID token, so the prerequisite is `Authenticated User`.

`functions/src/index.ts:9-10` defines `ORDER_SENSITIVE_FIELDS` and `SERVICE_SENSITIVE_FIELDS`. `stripForViewer` at `:48-59` deletes those keys from a copy of the order and from each service. It is applied at `:76` in `getOrder` and at `:125-127` in `listOrders`.

#### Remediation

No change required for the `viewer` role. Generalise this function into a per-role projection as described in FIND-22 so the same server-side mechanism protects the intermediate ranks, and keep it applied in every response path that returns order data.

#### Verification

Capture the `listOrders` response for a `viewer` account and confirm `totalCost`, `costPerUnit`, `totalSST`, and `salesBuffer` are absent from the payload.

---

### FIND-45: Existing control — Storage writes and deletes are scoped to the owning UID

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 0.0 (CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-732](https://cwe.mitre.org/data/definitions/732.html): Incorrect Permission Assignment for Critical Resource |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Authenticated User |
| Exploitability Tier | Tier 2 — Conditional Risk |
| Remediation Effort | Low |
| Mitigation Type | Existing Control |
| Component | FirebaseStorage |
| Related Threats | [T13.E](2-stride-analysis.md#firebasestorage), [T13.S](2-stride-analysis.md#firebasestorage) |

#### Description

The Storage rules bind both write and delete to a comparison between `request.auth.uid` and the UID segment of the object path, so a user cannot plant an object under another user's prefix or delete someone else's attachment. The client constructs the path from the authenticated UID rather than from any user-supplied value, so attachments are reliably attributable to their uploader. The read rule is not scoped the same way, which is the gap addressed in FIND-19 — the write and delete scoping recorded here is correct and should be preserved.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists FirebaseStorage as `Min Prerequisite: None`; these rules engage for authenticated SDK operations, so the prerequisite is `Authenticated User`.

`storage.rules:9-10`: `allow write: if request.auth != null && request.auth.uid == userId && (...)`. `storage.rules:23`: `allow delete: if request.auth != null && request.auth.uid == userId;`. The client path is built at `src/pages/Dashboard.tsx:77` as `draft-attachments/${currentUser.uid}/${attachmentId}-${file.name}`, using the session UID rather than an input field.

#### Remediation

No change required for write and delete. Apply the same `request.auth.uid == userId` comparison to the read rule per FIND-19 so all three operations are scoped consistently.

#### Verification

As user A, attempt to write an object under user B's UID prefix through the Storage SDK and confirm the rule refuses it.

---

## Tier 3 — Defense-in-Depth (Prior Compromise / Host Access)

### FIND-46: Migration script runs with unrestricted Admin SDK credentials and no safeguards

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 6.8 (CVSS:4.0/AV:L/AC:L/AT:N/PR:H/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N) |
| CWE | [CWE-250](https://cwe.mitre.org/data/definitions/250.html): Execution with Unnecessary Privileges |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Host/OS Access |
| Exploitability Tier | Tier 3 — Defense-in-Depth |
| Remediation Effort | Medium |
| Mitigation Type | Redesign |
| Component | MigrateHeadOfCommercial |
| Related Threats | [T15.E](2-stride-analysis.md#migrateheadofcommercial), [T15.T1](2-stride-analysis.md#migrateheadofcommercial), [T15.T2](2-stride-analysis.md#migrateheadofcommercial), [T15.D](2-stride-analysis.md#migrateheadofcommercial), [T15.I](2-stride-analysis.md#migrateheadofcommercial) |

#### Description

A one-shot migration script sits in the repository root and initialises the Admin SDK with ambient Application Default Credentials, giving it unrestricted, rules-bypassing write access to every Firestore collection. It targets `authorityLevel` and `finalDecisionMaker` — precisely the fields that determine who may approve a request — and offers no dry-run mode, no confirmation prompt, no backup step, and no idempotency guard. Anyone who clones the repository on a machine holding those credentials can run it against production with a single command.

Two further defects compound the risk. The update object is built as `const updates = { services }` unconditionally, so every changed document has its entire services array rewritten rather than having only the targeted field patched — a defect in the mapping would replace the whole array. And the script loads the full collection into memory and then updates documents one at a time in an awaited loop, so it scales linearly with collection size and contends with live approval traffic while it runs.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists MigrateHeadOfCommercial as `Listens On: N/A — no listener (one-shot Node.js script)`, `Auth Required: No (Application Default Credentials)`, `Reachability: No Listener`, `Min Prerequisite: Host/OS Access`.

`migrate-head-of-commercial.js`:

- Lines 2-4: `const admin = require("firebase-admin"); admin.initializeApp(); const db = admin.firestore();` — no credential scoping, no project pinning.
- Line 10: `const snapshot = await db.collection("orders").get();` — unbounded full-collection read.
- Line 27: `const updates = { services };` — the services array is always included in the write.
- Line 34: `await doc.ref.update(updates);` inside the `for` loop at line 13 — sequential writes with no batching.
- There is no argument parsing, no `--dry-run`, and no prompt anywhere in the file.

#### Remediation

Move the script out of the application repository into a controlled operations location, and run it under a dedicated service account scoped to the `orders` collection rather than under default Admin credentials. Add a `--dry-run` flag that reports the planned changes without writing, require explicit confirmation before a live run, and snapshot the collection first. Patch only the specific nested fields being migrated instead of rewriting `services` wholesale, and page through the collection with a cursor applying changes in batched writes. Note also that the file uses CommonJS `require` while `package.json:5` declares `"type": "module"`, so it would not execute as written — confirm which form is actually run in practice.

#### Verification

Confirm the script is absent from the application repository. Run the relocated script with `--dry-run` against a copy of production data and confirm it reports the intended changes without writing, then confirm a live run produces a migration audit record.

---

### FIND-47: Sensitive drafts persist in local storage after sign-out

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 5.8 (CVSS:4.0/AV:L/AC:L/AT:N/PR:N/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-922](https://cwe.mitre.org/data/definitions/922.html): Insecure Storage of Sensitive Information |
| OWASP | A04:2025 – Cryptographic Failures |
| Exploitation Prerequisites | Host/OS Access |
| Exploitability Tier | Tier 3 — Defense-in-Depth |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | LocalStorage |
| Related Threats | [T09.I](2-stride-analysis.md#localstorage), [T09.R](2-stride-analysis.md#localstorage) |

#### Description

In-progress drafts are written to browser local storage in plaintext and include vendor cost per unit, sales buffer, customer name, and project brief. Signing out does not clear them — `logout` calls only `signOut`, leaving the `services_<uid>` and `orderMetadata_<uid>` keys intact — so on a shared or re-imaged workstation the next occupant can read the previous user's commercial data straight from devtools without authenticating at all. The drafts also carry no author, timestamp, or integrity marker, so a modified draft is indistinguishable from an untouched one once it is submitted.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists LocalStorage as `Listens On: N/A — no listener (browser storage)`, `Auth Required: No`, `Reachability: No Listener`, `Min Prerequisite: Host/OS Access`.

`src/App.tsx:111-121` persists both keys on every state change: `localStorage.setItem(servicesKey, JSON.stringify(services));` and `localStorage.setItem(metadataKey, JSON.stringify(orderMetadata));`. The keys are defined at `src/App.tsx:73-74`. `src/context/AuthContext.tsx:127-129` implements `logout` as `await signOut(auth);` with no storage cleanup. The persisted `Service` shape at `src/types.ts:25-31` includes `costPerUnit`, `totalCost`, `totalSST`, and `salesBuffer`.

#### Remediation

Clear the `services_*` and `orderMetadata_*` keys in `logout` before calling `signOut`, and clear any keys belonging to a different UID when a new user signs in. For a durable fix, move in-progress drafts to a server-side draft document scoped to the owner, so the sensitive data never rests in the browser and gains a server timestamp and verifiable provenance.

#### Verification

Sign in, create a draft with cost data, sign out, and confirm no `services_*` or `orderMetadata_*` keys remain in local storage.

---

### FIND-48: No Firestore backup, point-in-time recovery, or data-access audit logging

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Important |
| CVSS 4.0 | 5.6 (CVSS:4.0/AV:L/AC:L/AT:N/PR:H/UI:N/VC:N/VI:N/VA:H/SC:N/SI:H/SA:N) |
| CWE | [CWE-1188](https://cwe.mitre.org/data/definitions/1188.html): Initialization of a Resource with an Insecure Default |
| OWASP | A09:2025 – Security Logging and Alerting Failures |
| Exploitation Prerequisites | Admin Credentials |
| Exploitability Tier | Tier 3 — Defense-in-Depth |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | Firestore |
| Related Threats | [T12.D1](2-stride-analysis.md#firestore), [T12.R](2-stride-analysis.md#firestore), [T15.R](2-stride-analysis.md#migrateheadofcommercial) |

#### Description

The repository contains no backup, point-in-time-recovery, export schedule, or retention configuration for Firestore, and no Cloud Audit Logs configuration for data access. An erroneous bulk write from the migration script, or an admin invoking the hard-delete path in `deleteOrder`, is therefore unrecoverable — and because Admin SDK operations bypass security rules and leave no application-visible trace, there is also no record of who performed it. For a system of record holding financial approvals, the combination means a destructive action is both irreversible and unattributable.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists Firestore as `Auth Required: Yes (deny-all client rules; Admin SDK only)`, `Reachability: External`, `Min Prerequisite: Admin Credentials`.

`firebase.json:2-5` configures only `database` and `rules` for Firestore — no backup or export settings. There is no `firestore.indexes.json`, no scheduled export function in `functions/src/index.ts`, and no Cloud Audit Logs policy file in the repository. The destructive paths are `functions/src/index.ts:420` (`.delete()`) and `migrate-head-of-commercial.js:34` (`doc.ref.update(updates)`), neither of which writes a record.

#### Remediation

Enable Firestore point-in-time recovery on the database and configure scheduled exports to a separate, access-controlled Cloud Storage bucket with its own retention policy. Enable Data Access audit logs for Firestore and route them to a retained log sink. Document and rehearse the restore procedure. Pair this with the soft-delete change in FIND-26 so routine deletions do not depend on backups at all.

#### Verification

Confirm point-in-time recovery is enabled and that a scheduled export completed within the last day. Perform a test delete and confirm a corresponding Data Access audit log entry names the acting principal.

---

### FIND-49: Admin SDK callers hold unrestricted project-wide Firestore access

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 5.3 (CVSS:4.0/AV:L/AC:L/AT:P/PR:H/UI:N/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-250](https://cwe.mitre.org/data/definitions/250.html): Execution with Unnecessary Privileges |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Admin Credentials |
| Exploitability Tier | Tier 3 — Defense-in-Depth |
| Remediation Effort | Medium |
| Mitigation Type | Standard Mitigation |
| Component | Firestore |
| Related Threats | [T12.T](2-stride-analysis.md#firestore) |

#### Description

Both the Cloud Functions layer and the migration script reach Firestore through the Admin SDK, which bypasses security rules entirely and operates with full project access. The deny-all rule set that protects the data from clients therefore provides no containment whatsoever against a defect or a credential compromise on the server side — a single flawed handler has unrestricted write access to `orders`, `users`, and `counters` alike. FIND-15 is a concrete illustration: one missing role check in one handler was sufficient to grant a caller an approver role, because nothing below the handler constrains what it may write.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists Firestore as `Min Prerequisite: Admin Credentials`.

`functions/src/index.ts:2-6` initialises with `initializeApp()` and `getFirestore()` using the default service account, which holds project-wide Datastore access. `migrate-head-of-commercial.js:2-4` does the same. The rules at `firestore.rules:11-26` govern client access only and are not evaluated for Admin SDK operations.

#### Remediation

Run each function under a dedicated service account granted only the Firestore permissions and collection scopes it needs, rather than the default project service account. Separate the read-heavy `listOrders` and `getOrder` identity from the write-capable approval and creation identities so a defect in a read path cannot write. Apply the same scoping to the migration service account per FIND-46.

#### Verification

Confirm each deployed function's runtime service account in the Google Cloud console and verify that a read-only function's account is denied a write to `orders`.

---

### FIND-50: approvalHistory grows unbounded toward the document size limit

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 4.6 (CVSS:4.0/AV:L/AC:L/AT:P/PR:H/UI:N/VC:N/VI:N/VA:H/SC:N/SI:N/SA:N) |
| CWE | [CWE-770](https://cwe.mitre.org/data/definitions/770.html): Allocation of Resources Without Limits or Throttling |
| OWASP | A10:2025 – Mishandling of Exceptional Conditions |
| Exploitation Prerequisites | Admin Credentials |
| Exploitability Tier | Tier 3 — Defense-in-Depth |
| Remediation Effort | Medium |
| Mitigation Type | Redesign |
| Component | Firestore |
| Related Threats | [T12.D2](2-stride-analysis.md#firestore) |

#### Description

Audit entries are stored as an array inside the order document itself, and the array is rewritten in full on every approval and rejection. Firestore enforces a 1 MiB ceiling per document, so a sufficiently long comment thread — reachable deliberately through the unbounded comment length in FIND-35, or accidentally over a long-lived order with many versions — renders the order permanently unwritable, at which point no further approval or rejection can be recorded against it. Rewriting the whole array on each update also makes concurrent writes lossy, which is the mechanism behind FIND-25.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists Firestore as `Min Prerequisite: Admin Credentials`; the document structure is written exclusively through the Admin SDK.

`functions/src/index.ts:194`: `const updatedHistory = [...(order.approvalHistory || []), newHistoryEntry];` followed by the write at `:212-216`. The rejection equivalent is `functions/src/index.ts:277` and `:279-283`. The entry shape including the unbounded `comment` field is declared at `src/types.ts:185-192`.

#### Remediation

Move audit entries into an `orders/{orderId}/approvalHistory` subcollection so each entry is its own document and the parent order stops growing. Write entries with `add()` rather than rewriting an array, which also removes the concurrent-write loss described in FIND-25. Bound comment length per FIND-35 as a second layer.

#### Verification

Confirm new approvals create documents in the subcollection and that the parent order's size stays constant as history accumulates.

---

### FIND-51: Build-time config file can silently repoint the application

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 4.5 (CVSS:4.0/AV:L/AC:L/AT:P/PR:H/UI:N/VC:L/VI:H/VA:N/SC:N/SI:L/SA:N) |
| CWE | [CWE-1188](https://cwe.mitre.org/data/definitions/1188.html): Initialization of a Resource with an Insecure Default |
| OWASP | A03:2025 – Software Supply Chain Failures |
| Exploitation Prerequisites | Host/OS Access |
| Exploitability Tier | Tier 3 — Defense-in-Depth |
| Remediation Effort | Low |
| Mitigation Type | Redesign |
| Component | FirebaseClient |
| Related Threats | [T04.T](2-stride-analysis.md#firebaseclient) |

#### Description

The Vite configuration checks for a `firebase-applet-config.json` file in the project root at build time and, when it exists, merges its contents into the configuration compiled into the bundle. The file is not present in the repository and is not referenced in any documentation, so a build machine that acquires one — through a compromised dependency's postinstall script, a stale artifact, or a malicious pull request — silently produces a bundle pointing at a different Firebase project. The substitution happens with no warning and no build failure; the only visible symptom would be users authenticating against the wrong backend.

#### Evidence

**Prerequisite basis:** Modifying the build workspace requires filesystem access to the build machine, so the prerequisite is `Host/OS Access`, consistent with the `Host/OS Access` floor that `0.1-architecture.md` assigns to non-listener components on an operator workstation.

`vite.config.ts:10-19`:

```
const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
if (fs.existsSync(configPath)) {
  firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}
```

The parsed values are then used as fallbacks at `vite.config.ts:41-47` for `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`, and `firestoreDatabaseId`, and injected at `:55-61`. The `catch` at `:17-19` logs and continues, so a malformed file does not fail the build either.

#### Remediation

Remove the implicit file-based configuration path, or require an explicit environment flag before it is consulted so its use is always deliberate. Pin build configuration to reviewed environment variables supplied by the CI pipeline introduced in FIND-11, and fail the build when a required Firebase value is missing rather than falling back to an empty string.

#### Verification

Place a `firebase-applet-config.json` containing a different project id in the workspace, run the build, and confirm the build either fails or ignores the file rather than silently adopting its values.

---

### FIND-52: No field-level encryption for cost and margin data

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Moderate |
| CVSS 4.0 | 4.3 (CVSS:4.0/AV:L/AC:L/AT:P/PR:H/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-311](https://cwe.mitre.org/data/definitions/311.html): Missing Encryption of Sensitive Data |
| OWASP | A04:2025 – Cryptographic Failures |
| Exploitation Prerequisites | Admin Credentials |
| Exploitability Tier | Tier 3 — Defense-in-Depth |
| Remediation Effort | High |
| Mitigation Type | Standard Mitigation |
| Component | Firestore |
| Related Threats | [T12.I1](2-stride-analysis.md#firestore) |

#### Description

Vendor cost basis, sales buffer, commission inputs, and customer contract values are stored as plain fields in Firestore. Google's at-rest encryption protects the underlying storage medium but is transparent to any principal that reaches the data plane, so a compromised service account, an over-broad IAM grant, or an exported backup exposes the values in the clear. For the most commercially sensitive fields in the system this leaves no defence between data-plane access and full disclosure.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists Firestore as `Auth Required: Yes (deny-all client rules; Admin SDK only)`, `Min Prerequisite: Admin Credentials`.

The sensitive fields are declared at `src/types.ts:25-31` (`costPerUnit`, `totalCost`, `sstRate`, `totalSST`, `salesBuffer`) and written unmodified by `createOrder` at `functions/src/index.ts:394-398`. The values the application itself treats as most sensitive are enumerated at `functions/src/index.ts:9-10`, which are stripped on read for viewers but stored in plaintext. No KMS or encryption helper appears anywhere in the repository.

#### Remediation

Apply application-layer encryption backed by Cloud KMS to the fields listed in `ORDER_SENSITIVE_FIELDS` and `SERVICE_SENSITIVE_FIELDS`, decrypting only in the callables that are entitled to return them. Accept that encrypted fields cannot be queried or ordered, and keep the derived aggregates the workflow needs as separate plaintext fields where they are not themselves sensitive.

#### Verification

Inspect a stored order document directly in the Firestore console and confirm the cost fields are ciphertext, while a `getOrder` call as an entitled role still returns readable values.

---

### FIND-53: Local storage writes are unguarded against quota exhaustion

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 3.1 (CVSS:4.0/AV:L/AC:L/AT:P/PR:N/UI:N/VC:N/VI:L/VA:L/SC:N/SI:N/SA:N) |
| CWE | [CWE-248](https://cwe.mitre.org/data/definitions/248.html): Uncaught Exception |
| OWASP | A10:2025 – Mishandling of Exceptional Conditions |
| Exploitation Prerequisites | Host/OS Access |
| Exploitability Tier | Tier 3 — Defense-in-Depth |
| Remediation Effort | Low |
| Mitigation Type | Standard Mitigation |
| Component | LocalStorage |
| Related Threats | [T09.D](2-stride-analysis.md#localstorage), [T09.T](2-stride-analysis.md#localstorage) |

#### Description

Both draft keys are written with bare `setItem` calls inside effects, with no error handling. A draft that exceeds the origin's storage quota — reachable with a large number of line items, or with the quota already consumed by other data on the origin — throws `QuotaExceededError` inside the effect and breaks the screen with no recovery path and no message explaining what happened. Nothing validates the stored shape on the way back in either, so a modified draft flows unchecked into the order-creation path.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists LocalStorage as `Reachability: No Listener`, `Min Prerequisite: Host/OS Access`.

`src/App.tsx:111-115` and `:117-121` each perform an unguarded `localStorage.setItem(...)` inside a `useEffect`. Neither is wrapped in `try`/`catch`, and no cap limits the number of entries in the `services` array that is serialised.

#### Remediation

Wrap both writes in `try`/`catch`, surface a clear message when the quota is exceeded, and cap the number of line items permitted in a single draft. Combine with the shape validation in FIND-32 on the read path and with the server-side draft storage recommended in FIND-47.

#### Verification

Fill the origin's storage quota, add a line item to a draft, and confirm the application shows a clear message and remains usable rather than blanking.

---

### FIND-54: Password visibility toggle exposes the credential in the DOM

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 2.1 (CVSS:4.0/AV:P/AC:L/AT:P/PR:N/UI:P/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-549](https://cwe.mitre.org/data/definitions/549.html): Missing Password Field Masking |
| OWASP | A04:2025 – Cryptographic Failures |
| Exploitation Prerequisites | Host/OS Access |
| Exploitability Tier | Tier 3 — Defense-in-Depth |
| Remediation Effort | Low |
| Mitigation Type | Custom Mitigation |
| Component | LoginUser |
| Related Threats | [T03.T](2-stride-analysis.md#loginuser) |

#### Description

The sign-in form offers a visibility toggle that switches the password input from `type="password"` to `type="text"`, rendering the credential in plaintext in the DOM until the user toggles it back or navigates away. A browser extension with content-script access, a screen-sharing session, or an onlooker can read it during that window. The toggle is a normal usability affordance, but it currently has no time limit and no indication that the credential is exposed.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists LoginUser as `Min Prerequisite: None` for network-reachable threats; reading the rendered DOM requires access to the user's machine or screen, so the prerequisite is `Host/OS Access`.

`src/pages/LoginUser.tsx:79`: `type={showPassword ? "text" : "password"}`, driven by the toggle at `:87-94` which calls `setShowPassword((v) => !v)`. The password itself is held in component state at `:13`.

#### Remediation

Auto-revert the toggle to masked after a few seconds, and reset `showPassword` to false whenever the field loses focus. Document the browser-extension hardening expectation for managed workstations that access the approval portal.

#### Verification

Toggle password visibility on the sign-in form and confirm the field re-masks automatically after the configured interval and on blur.

---

### FIND-55: Existing control — deny-all Firestore security rules

| Attribute | Value |
|-----------|-------|
| SDL Bugbar Severity | Low |
| CVSS 4.0 | 0.0 (CVSS:4.0/AV:L/AC:L/AT:N/PR:H/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N) |
| CWE | [CWE-732](https://cwe.mitre.org/data/definitions/732.html): Incorrect Permission Assignment for Critical Resource |
| OWASP | A01:2025 – Broken Access Control |
| Exploitation Prerequisites | Admin Credentials |
| Exploitability Tier | Tier 3 — Defense-in-Depth |
| Remediation Effort | Low |
| Mitigation Type | Existing Control |
| Component | Firestore |
| Related Threats | [T12.E](2-stride-analysis.md#firestore) |

#### Description

`firestore.rules` denies every client read and write across `orders`, `users`, `counters`, and a `{document=**}` catch-all, forcing all application data access through the Cloud Functions layer where server-side authorization is applied. The rules file documents this as a deliberate correction of a prior state in which any authenticated user could read and write everything. This is the foundation the rest of the access-control model rests on and should be preserved without exception; the one place where it may not be taking effect is the database-selection mismatch tracked in FIND-17.

#### Evidence

**Prerequisite basis:** `0.1-architecture.md` Component Exposure Table lists Firestore as `Auth Required: Yes (deny-all client rules; Admin SDK only)`, `Min Prerequisite: Admin Credentials`.

`firestore.rules:11-26` declares `allow read, write: if false;` for `/orders/{orderId}`, `/users/{userId}`, `/counters/{counterId}`, and `/{document=**}`. The accompanying comment at `:5-9` records the intent: all access goes through Cloud Functions using the Admin SDK, closing the previous "any authenticated user can read/write everything" hole.

#### Remediation

No change required to the rule content. Ensure the rules are deployed to every database in the project, including `(default)`, per FIND-17, and that they are deployed atomically with the functions and hosting bundle by the pipeline in FIND-11 so the deny-all posture cannot be lost through a partial release.

#### Verification

Attempt a direct `getDoc(doc(db, "orders", "<id>"))` from the browser console of the deployed application and confirm it is refused with `permission-denied` on the database the client actually connects to.

---

## Threat Coverage Verification

| Threat ID | Finding ID | Status |
|-----------|------------|--------|
| T01.T | FIND-32 | ✅ Covered (FIND-32) |
| T01.I | FIND-30 | ✅ Covered (FIND-30) |
| T01.D1 | FIND-32 | ✅ Covered (FIND-32) |
| T01.D2 | FIND-27 | ✅ Covered (FIND-27) |
| T01.E | FIND-42 | ✅ Mitigated (FIND-42) |
| T01.A | FIND-33 | ✅ Covered (FIND-33) |
| T02.I1 | FIND-09 | ✅ Covered (FIND-09) |
| T02.S | FIND-42 | ✅ Mitigated (FIND-42) |
| T02.T | FIND-40 | ✅ Covered (FIND-40) |
| T02.I2 | FIND-30 | ✅ Covered (FIND-30) |
| T02.D | FIND-41 | ✅ Covered (FIND-41) |
| T02.E | FIND-23 | ✅ Covered (FIND-23) |
| T03.S | FIND-04 | ✅ Covered (FIND-04) |
| T03.I | FIND-12 | ✅ Mitigated (FIND-12) |
| T03.D | FIND-04 | ✅ Covered (FIND-04) |
| T03.A | FIND-06 | ✅ Covered (FIND-06) |
| T03.T | FIND-54 | ✅ Covered (FIND-54) |
| T04.I1 | FIND-08 | ✅ Covered (FIND-08) |
| T04.I2 | FIND-10 | ✅ Covered (FIND-10) |
| T04.I3 | FIND-13 | ✅ Mitigated (FIND-13) |
| T04.E | FIND-17 | ✅ Mitigated (FIND-17) |
| T04.T | FIND-51 | ✅ Covered (FIND-51) |
| T05.I1 | FIND-30 | ✅ Covered (FIND-30) |
| T05.I2 | FIND-30 | ✅ Covered (FIND-30) |
| T05.E | FIND-42 | ✅ Mitigated (FIND-42) |
| T05.A | FIND-27 | ✅ Covered (FIND-27) |
| T06.T1 | FIND-24 | ✅ Covered (FIND-24) |
| T06.T2 | FIND-39 | ✅ Covered (FIND-39) |
| T06.I | FIND-03 | ✅ Covered (FIND-03) |
| T06.D | FIND-31 | ✅ Covered (FIND-31) |
| T06.E | FIND-42 | ✅ Mitigated (FIND-42) |
| T06.A | FIND-31 | ✅ Covered (FIND-31) |
| T07.T1 | FIND-56 | ✅ Mitigated (FIND-56) |
| T07.T2 | FIND-16 | ✅ Mitigated (FIND-16) |
| T07.T3 | FIND-56 | ✅ Covered (FIND-56) |
| T07.I | FIND-22 | ✅ Covered (FIND-22) |
| T07.E | FIND-44 | ✅ Mitigated (FIND-44) |
| T07.A1 | FIND-29 | ✅ Covered (FIND-29) |
| T07.A2 | FIND-29 | ✅ Covered (FIND-29) |
| T08.I1 | FIND-03 | ✅ Covered (FIND-03) |
| T08.I2 | FIND-22 | ✅ Covered (FIND-22) |
| T08.I3 | FIND-30 | ✅ Covered (FIND-30) |
| T08.A1 | FIND-28 | ✅ Covered (FIND-28) |
| T08.A2 | FIND-35 | ✅ Covered (FIND-35) |
| T08.T | FIND-42 | ✅ Mitigated (FIND-42) |
| T08.E | FIND-42 | ✅ Mitigated (FIND-42) |
| T09.I | FIND-47 | ✅ Covered (FIND-47) |
| T09.T | FIND-53 | ✅ Covered (FIND-53) |
| T09.R | FIND-47 | ✅ Covered (FIND-47) |
| T09.D | FIND-53 | ✅ Covered (FIND-53) |
| T10.T | FIND-05 | ✅ Covered (FIND-05) |
| T10.I | FIND-09 | ✅ Covered (FIND-09) |
| T10.R | FIND-11 | ✅ Covered (FIND-11) |
| T10.S | — | 🔄 Mitigated by Platform |
| T10.D | — | 🔄 Mitigated by Platform |
| T10.E | FIND-14 | ✅ Mitigated (FIND-14) |
| T10.A | FIND-37 | ✅ Covered (FIND-37) |
| T11.S1 | FIND-01 | ✅ Covered (FIND-01) |
| T11.D1 | FIND-01 | ✅ Covered (FIND-01) |
| T11.E1 | FIND-15 | ✅ Mitigated (FIND-15) |
| T11.T1 | FIND-16 | ✅ Mitigated (FIND-16) |
| T11.I1 | FIND-18 | ✅ Mitigated (FIND-18) |
| T11.E2 | FIND-20 | ✅ Covered (FIND-20) |
| T11.E3 | FIND-21 | ✅ Mitigated (FIND-21) |
| T11.S2 | FIND-23 | ✅ Covered (FIND-23) |
| T11.S3 | FIND-23 | ✅ Covered (FIND-23) |
| T11.T2 | FIND-56 | ✅ Covered (FIND-56) |
| T11.T3 | FIND-25 | ✅ Covered (FIND-25) |
| T11.I2 | FIND-34 | ✅ Covered (FIND-34) |
| T11.R1 | FIND-26 | ✅ Covered (FIND-26) |
| T11.R2 | FIND-26 | ✅ Covered (FIND-26) |
| T11.D2 | FIND-27 | ✅ Covered (FIND-27) |
| T11.D3 | FIND-38 | ✅ Covered (FIND-38) |
| T11.A1 | FIND-28 | ✅ Covered (FIND-28) |
| T11.A2 | FIND-28 | ✅ Covered (FIND-28) |
| T11.A3 | FIND-29 | ✅ Covered (FIND-29) |
| T11.I3 | FIND-44 | ✅ Mitigated (FIND-44) |
| T11.E4 | FIND-42 | ✅ Mitigated (FIND-42) |
| T11.R3 | FIND-43 | ✅ Mitigated (FIND-43) |
| T12.T | FIND-49 | ✅ Covered (FIND-49) |
| T12.I1 | FIND-52 | ✅ Covered (FIND-52) |
| T12.R | FIND-48 | ✅ Covered (FIND-48) |
| T12.D1 | FIND-48 | ✅ Covered (FIND-48) |
| T12.D2 | FIND-50 | ✅ Covered (FIND-50) |
| T12.E | FIND-55 | ✅ Mitigated (FIND-55) |
| T12.I2 | — | 🔄 Mitigated by Platform |
| T13.I1 | FIND-03 | ✅ Covered (FIND-03) |
| T13.I2 | FIND-19 | ✅ Mitigated (FIND-19) |
| T13.T | FIND-24 | ✅ Covered (FIND-24) |
| T13.D | FIND-31 | ✅ Covered (FIND-31) |
| T13.A1 | FIND-31 | ✅ Covered (FIND-31) |
| T13.A2 | FIND-24 | ✅ Covered (FIND-24) |
| T13.R | FIND-26 | ✅ Covered (FIND-26) |
| T13.E | FIND-45 | ✅ Mitigated (FIND-45) |
| T13.S | FIND-45 | ✅ Mitigated (FIND-45) |
| T14.S1 | FIND-02 | ✅ Covered (FIND-02) |
| T14.S2 | FIND-02 | ✅ Covered (FIND-02) |
| T14.I | FIND-07 | ✅ Covered (FIND-07) |
| T14.A | FIND-06 | ✅ Covered (FIND-06) |
| T14.D | — | 🔄 Mitigated by Platform |
| T14.T | — | 🔄 Mitigated by Platform |
| T14.R | — | 🔄 Mitigated by Platform |
| T14.E | FIND-36 | ✅ Covered (FIND-36) |
| T15.E | FIND-46 | ✅ Covered (FIND-46) |
| T15.T1 | FIND-46 | ✅ Covered (FIND-46) |
| T15.T2 | FIND-46 | ✅ Covered (FIND-46) |
| T15.I | FIND-46 | ✅ Covered (FIND-46) |
| T15.D | FIND-46 | ✅ Covered (FIND-46) |
| T15.R | FIND-48 | ✅ Covered (FIND-48) |

**Coverage summary:** 109 threats total — 79 `✅ Covered`, 24 `✅ Mitigated`, 6 `🔄 Mitigated by Platform`. Platform ratio is 5.5%, within the 20% limit for a standalone application. No threat is unmapped.

Four threats moved from `✅ Covered` to `✅ Mitigated` during this engagement as their findings were remediated: T11.E1 (FIND-15, `updateMyDepartment` privilege escalation, verified against the deployed function), T04.E (FIND-17, unruled Firestore database, verified in console), and T11.T1 + T07.T2 (FIND-16, client-controlled workflow state and authority rank, fixed in source and pending deployment verification).

T11.T2, T07.T1, and T07.T3 were remapped from FIND-16 to FIND-56 when the financial-totals gap was split into its own finding, since FIND-16's fix closed only the workflow-routing half of those threats.

T07.T1 has since moved to `✅ Mitigated`: every financial figure persisted with an order is now server-computed and verified. T07.T3 and T11.T2 remain `✅ Covered` — `createdAt` and `version` are still taken from the client, and there is still no general payload schema validation. Both are described in FIND-56's Remediation as explicitly out of the remediated scope.
