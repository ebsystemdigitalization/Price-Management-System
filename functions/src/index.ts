import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

initializeApp();

// Database pinned explicitly rather than relying on the implicit default.
// An unset FIREBASE_DATABASE_ID on the client used to fall through to the same
// implicit default, which silently diverged from the database firebase.json
// deployed security rules to — see FIND-17. Client (src/firebase.ts), these
// functions, and migrate-head-of-commercial.js now all name (default) outright.
//
// REQUIRES firebase-admin v12+, which introduced the databaseId parameter on
// getFirestore(). On v11 and earlier a bare string is treated as the App
// argument and this throws at cold start. Verified: the build environment runs
// v13.10.0. This repository declares no firebase-admin dependency, so no
// lockfile enforces the floor — re-check with `npm ls firebase-admin` if the
// build environment changes.
const db = getFirestore("(default)");
db.settings({ ignoreUndefinedProperties: true });

const ORDER_SENSITIVE_FIELDS = ["totalCost"];
const SERVICE_SENSITIVE_FIELDS = ["costPerUnit", "totalCost", "totalSST", "salesBuffer"];

// The only department values the approval chain recognises. `approveOrder`
// compares these against `order.headOfDepartment`, so a value outside this set
// would never match — and a non-string would throw inside `.toLowerCase()`.
// Consumed by createOrder (validation at creation) and updateMyDepartment.
const ALLOWED_DEPARTMENTS = [
  "Head of Enterprise Sales, Region",
  "Head of Enterprise Sales, Public Sector, GLCs & Named Accounts",
  "Head of Enterprise Sales (Strategic & Corporate Accounts)",
];

// Closed enums from src/types.ts. ServiceForm constrains these through Select
// controls so the client cannot produce an invalid value; a callable request
// can, and an unrecognised one changes the arithmetic silently — see the notes
// in createOrder.
const SERVICE_CATEGORIES = ["one-time", "annual"];
const SERVICE_DECISIONS = ["Upfront Payment", "Installment Plan"];

// ---------- Level of Authority ----------
// Server-side port of the per-service Level of Authority calculation in
// src/components/ServiceForm.tsx, confirmed with the formula's owner as the
// authoritative version. Three stages mirroring the client:
//   Stage 0 — ServiceForm.tsx:105-169  derive cost/SST/price/installment
//   Stage 1 — ServiceForm.tsx:178-222  per-service EBITDA margin %
//   Stage 2 — ServiceForm.tsx:224-262  Bucket A/B thresholds -> level -> rank
// Every figure is recomputed from the raw line-item inputs. No derived value
// supplied by the client is trusted (FIND-16).

const BUCKET_A_SERVICE_TYPES = ["Hardware", "Software", "License"];
const BUCKET_B_SERVICE_TYPES = [
  "Maintenance",
  "Installation",
  "Professional Service",
  "Consultancy",
  "Others",
];

const AUTHORITY_LEVEL_TO_RANK: Record<string, number> = {
  Finance: 1,
  CEBO: 2,
  "Head of Commercial": 3,
  "Head of Sales": 4,
};

// ServiceForm receives these through a Zod-validated form, so they are always
// numbers there. A callable request can carry anything, and NaN would propagate
// silently through the margin and make every threshold comparison false —
// dropping the line item from the rank rollup. Return null so the caller can
// fail closed instead.
function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// Order-level levy and duty percentages, read the same way as
// ServiceForm.tsx:179-184. These are operator-entered inputs rather than
// derived values, so they are taken from the request as-is.
function levyPercentages(order: any) {
  const cidb =
    order?.cidbLevy === "Yes" ? toFiniteNumber(order?.cidbLevyAmount) ?? 0 : 0;
  const stampDuty =
    order?.stampDuty === "Yes" ? toFiniteNumber(order?.stampDutyAmount) ?? 0 : 0;
  let ePerolehan = 0;
  if (order?.ePerolehan === "0.8%") ePerolehan = 0.8;
  else if (order?.ePerolehan === "0.4%") ePerolehan = 0.4;
  return { cidb, stampDuty, ePerolehan };
}

// Everything Stage 0 derives for one line item, plus the Stage 2 outcome.
// createOrder writes the financial figures back onto the stored service so the
// persisted document cannot carry client-supplied numbers (FIND-56).
interface ServiceComputation {
  rank: number;
  level: string;
  totalCost: number;
  totalSST: number;
  outrightPrice: number;
  monthlyRevenue: number;
  totalInstallmentPayment: number;
  tcv: number;
}

function authorityForService(
  service: any,
  order: any
): ServiceComputation | null {
  const category = service?.category;
  const decision = service?.decision;
  const serviceType = service?.serviceType;

  const units = toFiniteNumber(service?.units);
  const costPerUnit = toFiniteNumber(service?.costPerUnit);
  const sstRate = toFiniteNumber(service?.sstRate);
  const years = toFiniteNumber(service?.years);
  const salesBuffer = toFiniteNumber(service?.salesBuffer);
  const installmentPeriod = toFiniteNumber(service?.installmentPeriod);

  if (
    units === null || costPerUnit === null || sstRate === null ||
    years === null || salesBuffer === null || installmentPeriod === null
  ) {
    return null;
  }

  // --- Stage 0: ServiceForm.tsx:105-169 ---
  const totalCost =
    category === "one-time"
      ? Math.round(units * costPerUnit * years * 100) / 100
      : Math.round(units * costPerUnit * years);
  const totalSST =
    category === "one-time"
      ? Math.round(((totalCost * sstRate) / 100) * 100) / 100
      : Math.round((totalCost * sstRate) / 100);

  const bufferDecimal = salesBuffer / 100;
  let baseOutrightPrice = 0;
  if (bufferDecimal < 1) {
    baseOutrightPrice =
      Math.round(((totalCost + totalSST) / (1 - bufferDecimal)) * 100) / 100;
  }

  const isInstallment = decision === "Installment Plan";
  // Mirrors ServiceForm.tsx:124-129 — outrightPrice is zeroed for installments.
  const outrightPrice = isInstallment ? 0 : baseOutrightPrice;

  let totalInstallmentPayment = 0;
  let monthlyRevenue = 0;
  if (isInstallment && installmentPeriod > 0 && baseOutrightPrice > 0) {
    if (category === "annual") {
      monthlyRevenue =
        Math.round((baseOutrightPrice / installmentPeriod) * 100) / 100;
    } else {
      // PMT with 5% annual interest — ServiceForm.tsx:143-151.
      const monthlyRate = 0.05 / 12;
      const n = installmentPeriod;
      const pmt =
        (baseOutrightPrice * monthlyRate * Math.pow(1 + monthlyRate, n)) /
        (Math.pow(1 + monthlyRate, n) - 1);
      monthlyRevenue = Math.round(pmt * 100) / 100;
    }
    totalInstallmentPayment =
      Math.round(monthlyRevenue * installmentPeriod * 100) / 100;
  }

  // --- Stage 1: ServiceForm.tsx:178-222 ---
  const pct = levyPercentages(order);
  const revenue = isInstallment ? totalInstallmentPayment : outrightPrice;

  const cidbLevyAmount = (revenue * pct.cidb) / 100;
  const stampDutyAmount = (revenue * pct.stampDuty) / 100;
  const ePerolehanAmount = (revenue * pct.ePerolehan) / 100;

  const totalCostWithSST = totalCost + totalSST;
  const rawGrossMarginRM = revenue - totalCostWithSST;

  const commissionAmount =
    category === "annual" && decision === "Upfront Payment"
      ? outrightPrice * 0.0685
      : (rawGrossMarginRM -
          (cidbLevyAmount + stampDutyAmount + ePerolehanAmount)) * 0.0685;

  const totalOpexRM =
    cidbLevyAmount + stampDutyAmount + ePerolehanAmount + commissionAmount;
  const ebitdaMarginRM = rawGrossMarginRM - totalOpexRM;
  const ebitdaMarginPercentage =
    revenue !== 0 ? (ebitdaMarginRM / revenue) * 100 : 0;
  const margin = Math.ceil(ebitdaMarginPercentage * 10) / 10;

  // --- Stage 2: ServiceForm.tsx:224-262 ---
  const inA = BUCKET_A_SERVICE_TYPES.includes(serviceType);
  const inB = BUCKET_B_SERVICE_TYPES.includes(serviceType);

  let level = "";
  if (inA && margin >= 15) level = "Head of Sales";
  else if (inA && margin >= 10 && margin < 15) level = "Head of Commercial";
  else if (inA && margin < 10) level = "Finance";
  else if (inB && margin >= 25) level = "Head of Sales";
  else if (inB && margin >= 20 && margin < 25) level = "Head of Commercial";
  else if (inB && margin >= 15 && margin < 20) level = "CEBO";
  else if (inB && margin < 15) level = "Finance";

  if (!level) return null;

  // Per-service TCV — ServiceForm.tsx:158-168. Note this is NOT the same
  // quantity the order-level rollup calls TCV; see the note in createOrder.
  const tcv = isInstallment ? totalInstallmentPayment : baseOutrightPrice;

  return {
    rank: AUTHORITY_LEVEL_TO_RANK[level],
    level,
    totalCost,
    totalSST,
    outrightPrice,
    monthlyRevenue,
    totalInstallmentPayment,
    tcv,
  };
}

function getDepartmentFromEmail(email: string): string | null {
  const e = email.toLowerCase();
  if (e.includes("region")) {
    return "Head of Enterprise Sales, Region";
  }
  if (e.includes("public") || e.includes("glc") || e.includes("named")) {
    return "Head of Enterprise Sales, Public Sector, GLCs & Named Accounts";
  }
  if (e.includes("corporate") || e.includes("strategic") || e.includes("corp")) {
    return "Head of Enterprise Sales (Strategic & Corporate Accounts)";
  }
  return null;
}

interface CallerProfile {
  role: string;
  department: string | null;
  name: string | null;
  email: string | undefined;
}

async function getCallerProfile(uid: string, email: string | undefined): Promise<CallerProfile> {
  let data: any = null;
  const byUid = await db.collection("users").doc(uid).get();
  if (byUid.exists) data = byUid.data();
  if (!data && email) {
    const byEmail = await db.collection("users").doc(email).get();
    if (byEmail.exists) data = byEmail.data();
  }
  const role = data?.role || "user";
  let department = data?.department || null;
  if (!department && email) department = getDepartmentFromEmail(email);
  const name = data?.name || null;
  return { role, department, name, email };
}

// Can this caller see this order? Mirrors the scope logic in listOrders:
// admins see everything; rank holders see orders pending at their rank or that
// they have already acted on; viewers see orders they are account manager for;
// everyone else sees only what they created.
function canAccessOrder(order: any, profile: CallerProfile): boolean {
  const { role, department, name, email } = profile;

  if (role === "admin") return true;

  if (role === "rank4" || role === "rank3" || role === "rank2" || role === "rank1") {
    const rankMap: Record<string, string> = {
      rank4: "Rank 4", rank3: "Rank 3", rank2: "Rank 2", rank1: "Rank 1",
    };
    const userRankStr = rankMap[role] || "";

    // Rank 4 is additionally scoped by department, failing closed when either
    // side of the comparison is missing — same rule as approveOrder (FIND-21).
    let deptOk = true;
    if (role === "rank4") {
      deptOk =
        !!department &&
        !!order?.headOfDepartment &&
        order.headOfDepartment.toLowerCase() === department.toLowerCase();
    }

    const isPendingToApprove =
      deptOk &&
      order?.currentApprovalRank === userRankStr &&
      (order?.status || "").startsWith("Pending Approval");

    const hasActed = (order?.approvalHistory || []).some(
      (h: any) =>
        h?.rank === userRankStr &&
        h?.approvedBy?.toLowerCase() === email?.toLowerCase() &&
        (h?.status === "Approved" || h?.status === "Rejected")
    );

    return isPendingToApprove || hasActed;
  }

  if (role === "viewer") {
    return (
      (order?.accountManager || "").trim().toLowerCase() ===
      (name || "").trim().toLowerCase()
    );
  }

  // Default "user" role — creator only.
  return (order?.createdBy || "").toLowerCase() === (email || "").toLowerCase();
}

function stripForViewer(order: any) {
  const clean = { ...order };
  for (const f of ORDER_SENSITIVE_FIELDS) delete clean[f];
  if (Array.isArray(clean.services)) {
    clean.services = clean.services.map((s: any) => {
      const cs = { ...s };
      for (const f of SERVICE_SENSITIVE_FIELDS) delete cs[f];
      return cs;
    });
  }
  return clean;
}

// ---------- getOrder (single) ----------
export const getOrder = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const { uid, token } = request.auth;

  const orderId = request.data?.orderId;
  if (!orderId || typeof orderId !== "string") {
    throw new HttpsError("invalid-argument", "orderId is required.");
  }

  const snap = await db.collection("orders").doc(orderId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
  const order = { id: snap.id, ...snap.data() };

  const profile = await getCallerProfile(uid, token.email);

  // AUTHORIZATION: previously absent — any signed-in caller received any order
  // by document id (FIND-18). Out-of-scope orders return not-found rather than
  // permission-denied so the endpoint does not confirm that an id exists.
  if (!canAccessOrder(order, profile)) {
    throw new HttpsError("not-found", "Order not found.");
  }

  // Viewers keep the sanitized projection rather than being refused outright.
  return profile.role === "viewer" ? stripForViewer(order) : order;
});

// ---------- getAttachmentUrl (authorizing, short-lived signed URL) ----------
// Replaces the persisted getDownloadURL token on order documents (FIND-01).
// Previously the client called getDownloadURL and stored the resulting URL on
// the order; that URL carries a permanent access token, bypasses storage.rules
// entirely, and was rendered to every reader — so possession of a link was the
// effective authorization for vendor quotes and costing spreadsheets.
//
// Two modes, kept separate because they authorize on different grounds:
//   "order" — an attachment on a persisted order. Same predicate getOrder uses
//     (canAccessOrder), MINUS viewers — see the narrowing note below.
//   "draft" — an attachment the caller uploaded that is not yet on any order.
//     Authorized purely on path ownership, mirroring the rule in storage.rules
//     for draft-attachments/{userId}/.
//
// REQUIRES the functions' service account to hold
// roles/iam.serviceAccountTokenCreator ON ITSELF: getSignedUrl falls back to
// the IAM signBlob API when no private key is present, and the default 2nd-gen
// runtime service account does not carry that permission. Without it every
// call fails at runtime with "Permission 'iam.serviceAccounts.signBlob'
// denied". Verify before deploying.
const ATTACHMENT_URL_TTL_MS = 5 * 60 * 1000;
const DRAFT_PREFIX = "draft-attachments/";

async function signAttachment(path: string): Promise<string> {
  const [url] = await getStorage()
    .bucket()
    .file(path)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + ATTACHMENT_URL_TTL_MS,
    });
  return url;
}

export const getAttachmentUrl = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const { uid, token } = request.auth;

  const mode = request.data?.mode;
  if (mode !== "order" && mode !== "draft") {
    throw new HttpsError("invalid-argument", 'mode must be "order" or "draft".');
  }

  if (mode === "draft") {
    const path = request.data?.path;
    if (typeof path !== "string" || !path) {
      throw new HttpsError("invalid-argument", "path is required.");
    }
    // Ownership IS the authorization here, so the prefix match must be exact.
    if (!path.startsWith(`${DRAFT_PREFIX}${uid}/`) || path.includes("..")) {
      throw new HttpsError("permission-denied", "Not your attachment.");
    }
    return { url: await signAttachment(path), expiresInMs: ATTACHMENT_URL_TTL_MS };
  }

  const orderId = request.data?.orderId;
  const attachmentId = request.data?.attachmentId;
  if (!orderId || typeof orderId !== "string") {
    throw new HttpsError("invalid-argument", "orderId is required.");
  }
  if (!attachmentId || typeof attachmentId !== "string") {
    throw new HttpsError("invalid-argument", "attachmentId is required.");
  }

  const snap = await db.collection("orders").doc(orderId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
  const order = { id: snap.id, ...snap.data() } as any;

  const profile = await getCallerProfile(uid, token.email);

  // Same not-found-rather-than-permission-denied posture as getOrder, so the
  // endpoint does not confirm that an order id exists.
  if (!canAccessOrder(order, profile)) {
    throw new HttpsError("not-found", "Order not found.");
  }
  // DELIBERATE NARROWING relative to canAccessOrder. Attachments are vendor
  // quotes and costing spreadsheets — exactly what stripForViewer exists to
  // withhold (FIND-06). Granting a viewer the file would defeat the redaction
  // the projection performs, so viewers are refused here even though
  // canAccessOrder admits them for the order body.
  if (profile.role === "viewer") {
    throw new HttpsError("permission-denied", "Attachments are not available to this role.");
  }

  const attachment = (order.attachments || []).find((a: any) => a?.id === attachmentId);
  if (!attachment) throw new HttpsError("not-found", "Attachment not found.");

  // Trust only the stored path, never a client-supplied url, and re-check the
  // prefix: attachment metadata is currently unvalidated at write time
  // (FIND-18), so without this check a crafted order document would turn this
  // callable into a signing oracle for any object in the bucket.
  const path = attachment.path;
  if (typeof path !== "string" || !path.startsWith(DRAFT_PREFIX) || path.includes("..")) {
    throw new HttpsError("failed-precondition", "Attachment has no usable storage path.");
  }

  return { url: await signAttachment(path), expiresInMs: ATTACHMENT_URL_TTL_MS };
});

// ---------- listOrders (role-filtered) ----------
export const listOrders = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const { uid, token } = request.auth;
  const email = token.email;

  const profile = await getCallerProfile(uid, email);
  const { role, department, name } = profile;

  const snap = await db.collection("orders").orderBy("createdAt", "desc").get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

  let visible: any[] = [];

  if (role === "admin") {
    visible = all;
  } else if (role === "rank4" || role === "rank3" || role === "rank2" || role === "rank1") {
    const rankMap: Record<string, string> = {
      rank4: "Rank 4", rank3: "Rank 3", rank2: "Rank 2", rank1: "Rank 1",
    };
    const userRankStr = rankMap[role] || "";
    visible = all.filter((o) => {
      let matchesDept = true;
      if (role === "rank4" && department) {
        matchesDept = !o.headOfDepartment || o.headOfDepartment.toLowerCase() === department.toLowerCase();
      }
      const isPendingToApprove = matchesDept
        && o.currentApprovalRank === userRankStr
        && (o.status || "").startsWith("Pending Approval");
      const hasActed = o.approvalHistory?.some(
        (h: any) => h.rank === userRankStr
          && h.approvedBy?.toLowerCase() === email?.toLowerCase()
          && (h.status === "Approved" || h.status === "Rejected")
      );
      return isPendingToApprove || hasActed;
    });
    const visibleNums = new Set(visible.map((o) => o.orderNumber));
    visible = all.filter((o) => visibleNums.has(o.orderNumber));
  } else if (role === "viewer") {
    visible = all.filter(
      (o) => (o.accountManager || "").trim().toLowerCase() === (name || "").trim().toLowerCase()
    );
  } else {
    visible = all.filter((o) => o.createdBy?.toLowerCase() === email?.toLowerCase());
  }

  if (role === "viewer") {
    visible = visible.map(stripForViewer);
  }

  return { orders: visible };
});

// ---------- approveOrder (authorized, server-enforced) ----------
export const approveOrder = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const { uid, token } = request.auth;
  const email = token.email;

  const orderId = request.data?.orderId;
  const comment = request.data?.comment;
  if (!orderId || typeof orderId !== "string") {
    throw new HttpsError("invalid-argument", "orderId is required.");
  }
  if (!comment || typeof comment !== "string" || !comment.trim()) {
    throw new HttpsError("invalid-argument", "A comment is required.");
  }

  // Re-read the order FRESH from the database — never trust client-supplied state.
  const orderRef = db.collection("orders").doc(orderId);
  const snap = await orderRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
  const order = snap.data() as any;

  // Determine the caller's role server-side.
  const profile = await getCallerProfile(uid, email);
  const { role, department } = profile;

  const currentRank = order.currentApprovalRank || "Rank 4";
  const finalRank = order.finalDecisionAuthorityRank || "Rank 4";

  // The order must actually be pending approval.
  if (!(order.status || "").startsWith("Pending Approval")) {
    throw new HttpsError("failed-precondition", "This order is not awaiting approval.");
  }

  // AUTHORIZATION: caller must hold the rank currently pending (or be admin).
  const rankMap: Record<string, string> = {
    rank4: "Rank 4", rank3: "Rank 3", rank2: "Rank 2", rank1: "Rank 1",
  };
  const callerRankStr = role === "admin" ? currentRank : (rankMap[role] || "");
  if (callerRankStr !== currentRank) {
    throw new HttpsError("permission-denied", "You are not authorized to approve at this step.");
  }
  // Rank 4 additionally must match the order's department. Fails closed: the
  // check previously ran only when BOTH values were present, so an order with
  // no headOfDepartment was approvable by every Rank 4 holder (FIND-21). The
  // three cases are distinguished so a blocked approval is diagnosable rather
  // than silently refused.
  if (role === "rank4") {
    if (!department) {
      throw new HttpsError(
        "permission-denied",
        "Your account has no department assigned, so it cannot approve departmental requests."
      );
    }
    if (!order.headOfDepartment) {
      throw new HttpsError(
        "failed-precondition",
        "This request has no Head of Department set and cannot be approved until one is assigned."
      );
    }
    if (order.headOfDepartment.toLowerCase() !== department.toLowerCase()) {
      throw new HttpsError("permission-denied", "This order belongs to a different department.");
    }
  }

  // Role display name for the audit entry.
  let roleName = order.headOfDepartment || "Head of Sales";
  if (currentRank === "Rank 3") roleName = "Head of Commercial";
  if (currentRank === "Rank 2") roleName = "CEBO";
  if (currentRank === "Rank 1") roleName = "CFO";

  const newHistoryEntry = {
    rank: currentRank,
    role: roleName,
    status: "Approved" as const,
    approvedBy: email || "Unknown Approver",
    approvedAt: Date.now(),
    comment: comment.trim(),
  };
  const updatedHistory = [...(order.approvalHistory || []), newHistoryEntry];

  // Same progression logic as the client, now enforced server-side.
  let nextStatus = "";
  let nextRank = "";
  if (currentRank === "Rank 4") {
    if (finalRank.includes("Rank 4")) { nextStatus = "Approved"; nextRank = ""; }
    else { nextStatus = "Pending Approval - Rank 3"; nextRank = "Rank 3"; }
  } else if (currentRank === "Rank 3") {
    if (finalRank.includes("Rank 3")) { nextStatus = "Approved"; nextRank = ""; }
    else { nextStatus = "Pending Approval - Rank 2"; nextRank = "Rank 2"; }
  } else if (currentRank === "Rank 2") {
    if (finalRank.includes("Rank 2")) { nextStatus = "Approved"; nextRank = ""; }
    else { nextStatus = "Pending Approval - Rank 1"; nextRank = "Rank 1"; }
  } else if (currentRank === "Rank 1") {
    nextStatus = "Approved"; nextRank = "";
  }

  await orderRef.update({
    status: nextStatus,
    currentApprovalRank: nextRank,
    approvalHistory: updatedHistory,
  });

  return { success: true, roleName };
});

// ---------- rejectOrder (authorized, server-enforced) ----------
export const rejectOrder = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const { uid, token } = request.auth;
  const email = token.email;

  const orderId = request.data?.orderId;
  const comment = request.data?.comment;
  if (!orderId || typeof orderId !== "string") {
    throw new HttpsError("invalid-argument", "orderId is required.");
  }
  if (!comment || typeof comment !== "string" || !comment.trim()) {
    throw new HttpsError("invalid-argument", "A comment is required.");
  }

  const orderRef = db.collection("orders").doc(orderId);
  const snap = await orderRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
  const order = snap.data() as any;

  const profile = await getCallerProfile(uid, email);
  const { role, department } = profile;

  const currentRank = order.currentApprovalRank || "Rank 4";

  if (!(order.status || "").startsWith("Pending Approval")) {
    throw new HttpsError("failed-precondition", "This order is not awaiting approval.");
  }

  // AUTHORIZATION: caller must hold the rank currently pending (or be admin).
  const rankMap: Record<string, string> = {
    rank4: "Rank 4", rank3: "Rank 3", rank2: "Rank 2", rank1: "Rank 1",
  };
  const callerRankStr = role === "admin" ? currentRank : (rankMap[role] || "");
  if (callerRankStr !== currentRank) {
    throw new HttpsError("permission-denied", "You are not authorized to reject at this step.");
  }
  // Rank 4 department check, failing closed — mirrors approveOrder (FIND-21).
  if (role === "rank4") {
    if (!department) {
      throw new HttpsError(
        "permission-denied",
        "Your account has no department assigned, so it cannot reject departmental requests."
      );
    }
    if (!order.headOfDepartment) {
      throw new HttpsError(
        "failed-precondition",
        "This request has no Head of Department set and cannot be actioned until one is assigned."
      );
    }
    if (order.headOfDepartment.toLowerCase() !== department.toLowerCase()) {
      throw new HttpsError("permission-denied", "This order belongs to a different department.");
    }
  }

  let roleName = order.headOfDepartment || "Head of Sales";
  if (currentRank === "Rank 3") roleName = "Head of Commercial";
  if (currentRank === "Rank 2") roleName = "CEBO";
  if (currentRank === "Rank 1") roleName = "CFO";

  const newHistoryEntry = {
    rank: currentRank,
    role: roleName,
    status: "Rejected" as const,
    approvedBy: email || "Unknown Approver",
    approvedAt: Date.now(),
    comment: comment.trim(),
  };
  const updatedHistory = [...(order.approvalHistory || []), newHistoryEntry];

  await orderRef.update({
    status: "Rejected",
    currentApprovalRank: "",
    approvalHistory: updatedHistory,
  });

  return { success: true, roleName };
});

// ---------- submitForApproval (creator-authorized) ----------
export const submitForApproval = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const { token } = request.auth;
  const email = token.email;

  const orderId = request.data?.orderId;
  const submissionNote = request.data?.submissionNote ?? "";
  if (!orderId || typeof orderId !== "string") {
    throw new HttpsError("invalid-argument", "orderId is required.");
  }

  const orderRef = db.collection("orders").doc(orderId);
  const snap = await orderRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
  const order = snap.data() as any;

  // AUTHORIZATION: only the creator may submit.
  if ((order.createdBy || "").toLowerCase() !== (email || "").toLowerCase()) {
    throw new HttpsError("permission-denied", "Only the creator can submit this request.");
  }
  // Can only submit something in Draft.
  if ((order.status || "Draft") !== "Draft") {
    throw new HttpsError("failed-precondition", "Only draft requests can be submitted.");
  }

  await orderRef.update({
    status: "Pending Approval - Rank 4",
    currentApprovalRank: "Rank 4",
    submissionNote: submissionNote,
    submittedAt: Date.now(),
    approvalHistory: [],
  });

  return { success: true };
});

// ---------- withdrawFromReview (creator-authorized) ----------
export const withdrawFromReview = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const { token } = request.auth;
  const email = token.email;

  const orderId = request.data?.orderId;
  if (!orderId || typeof orderId !== "string") {
    throw new HttpsError("invalid-argument", "orderId is required.");
  }

  const orderRef = db.collection("orders").doc(orderId);
  const snap = await orderRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
  const order = snap.data() as any;

  // AUTHORIZATION: only the creator may withdraw.
  if ((order.createdBy || "").toLowerCase() !== (email || "").toLowerCase()) {
    throw new HttpsError("permission-denied", "Only the creator can withdraw this request.");
  }
  // Can only withdraw something currently under review.
  if (!(order.status || "").startsWith("Pending Approval")) {
    throw new HttpsError("failed-precondition", "Only requests under review can be withdrawn.");
  }

  await orderRef.update({
    status: "Draft",
    currentApprovalRank: "",
  });

  return { success: true };
});

// ---------- createOrder (user-authorized, server-side counter) ----------
export const createOrder = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const { uid, token } = request.auth;
  const email = token.email;

  const order = request.data?.order;
  const isNew = request.data?.isNew !== false; // default true, matches `reset`
  if (!order || typeof order !== "object") {
    throw new HttpsError("invalid-argument", "order payload is required.");
  }

  // AUTHORIZATION: only a "user" role may create/submit requests.
  const { role } = await getCallerProfile(uid, email);
  if (role !== "user") {
    throw new HttpsError("permission-denied", "Only requesters can create FA requests.");
  }

  // Strip every field the server owns. These previously passed through verbatim
  // (FIND-16), letting a requester submit an order already marked "Approved",
  // with a fabricated approvalHistory, or with the authority rank lowered to
  // skip CFO sign-off. Discarded even when present — the current client does
  // send status/currentApprovalRank/approvalHistory, so rejecting rather than
  // stripping would break it.
  const {
    id: _clientId,
    status: _clientStatus,
    currentApprovalRank: _clientCurrentRank,
    approvalHistory: _clientApprovalHistory,
    finalDecisionAuthorityRank: _clientFinalRank,
    ...orderData
  } = order;

  // Head of Department must be present and recognised. It was previously
  // optional, and the Rank 4 authorization check in approveOrder/rejectOrder
  // skipped itself entirely when the field was absent — authorizing every Rank
  // 4 holder rather than none (FIND-21). Requiring it here is what stops the
  // fail-closed version of that check from stranding newly created orders.
  const headOfDepartment = orderData.headOfDepartment;
  if (
    typeof headOfDepartment !== "string" ||
    !ALLOWED_DEPARTMENTS.includes(headOfDepartment)
  ) {
    throw new HttpsError(
      "invalid-argument",
      "A recognised Head of Department must be selected before a request can be created."
    );
  }

  // Recompute Level of Authority for every line item from its raw inputs, then
  // roll up to the order. The most senior authority any item demands governs
  // the whole order — ServiceForm.tsx:224-262 + SummaryReport.tsx:119-149.
  // The computed values also overwrite each stored service, so the persisted
  // document cannot show an approver a level that contradicts its own routing.
  const submitted = Array.isArray(orderData.services) ? orderData.services : [];
  let lowestRank = 4;

  // FIND-01: never persist a getDownloadURL token. Only the object path is
  // stored; getAttachmentUrl mints a short-lived signed URL at read time.
  // NOTE: this drops `url` only. Full validation of the remaining attachment
  // fields (path ownership, type, size, name) is FIND-18 and is not done here.
  const sanitizedAttachments = Array.isArray(orderData.attachments)
    ? orderData.attachments.map((a: any) => {
        const { url: _droppedUrl, ...rest } = a || {};
        return rest;
      })
    : [];

  // Order-level rollup, ported from src/pages/SummaryReport.tsx:202-238.
  // Accumulated from the SERVER-computed figures, never the submitted ones.
  let totalRevenue = 0; // pricingSummary.totalTCV  -> order.totalRevenue
  let totalCost = 0;    // costingSummary.tcv.total -> order.totalCost

  // Accumulators for the financing metadata block — SummaryReport.tsx:97-164.
  let upfrontSum = 0;         // Σ outrightPrice where decision is Upfront Payment
  let oneTimeCostWithSST = 0; // Σ (totalCost + totalSST) where category is one-time
  let maxContractTenure = 0;  // highest installmentPeriod across all line items

  const services = submitted.map((s: any, i: number) => {
    // Category and decision steer both the Stage 0 arithmetic and the rollup
    // branches below. An unrecognised value would silently take the wrong
    // branch — an unknown category is excluded from totalCost entirely while
    // still contributing to totalRevenue — so reject rather than guess.
    if (!SERVICE_CATEGORIES.includes(s?.category)) {
      throw new HttpsError(
        "invalid-argument",
        `Line item ${i + 1} has an unrecognised category.`
      );
    }
    if (!SERVICE_DECISIONS.includes(s?.decision)) {
      throw new HttpsError(
        "invalid-argument",
        `Line item ${i + 1} has an unrecognised payment decision.`
      );
    }

    const loa = authorityForService(s, orderData);
    if (!loa) {
      throw new HttpsError(
        "invalid-argument",
        `Line item ${i + 1} has missing or invalid pricing inputs, or an ` +
          `unrecognised service type, so its level of authority cannot be determined.`
      );
    }
    if (loa.rank < lowestRank) lowestRank = loa.rank;

    const installmentPeriod = Number(s.installmentPeriod);

    // pricingSummary.totalTCV — SummaryReport.tsx:205-210. The `||` fallback is
    // reproduced as written: a zero totalInstallmentPayment falls through to
    // monthlyRevenue * installmentPeriod.
    totalRevenue +=
      s.decision === "Installment Plan"
        ? loa.totalInstallmentPayment || loa.monthlyRevenue * installmentPeriod
        : loa.outrightPrice * installmentPeriod;

    // costingSummary.tcv.total — SummaryReport.tsx:218-238. Both categories
    // contribute cost + SST; the upfront/installment split the client keeps is
    // only used for display, and tcv.total is their sum.
    totalCost += loa.totalCost + loa.totalSST;

    // --- financing metadata inputs, from the SERVER-computed figures ---
    // SummaryReport.tsx:99-104 — the explicit decision filter is the correct
    // form; Dashboard.tsx:301 omits it and was confirmed stale.
    if (s.decision === "Upfront Payment") upfrontSum += loa.outrightPrice;
    // SummaryReport.tsx:107-112 — category-based, confirmed authoritative over
    // Dashboard.tsx:260's decision-based variant.
    if (s.category === "one-time") oneTimeCostWithSST += loa.totalCost + loa.totalSST;
    // SummaryReport.tsx:152-154
    const period = Number(s.installmentPeriod);
    if (period > maxContractTenure) maxContractTenure = period;

    // Every derived financial field is replaced with the server's own value.
    return {
      ...s,
      authorityLevel: loa.level,
      authorityRank: `Rank ${loa.rank}`,
      totalCost: loa.totalCost,
      totalSST: loa.totalSST,
      outrightPrice: loa.outrightPrice,
      monthlyRevenue: loa.monthlyRevenue,
      totalInstallmentPayment: loa.totalInstallmentPayment,
      tcv: loa.tcv,
    };
  });

  let orderNumber = orderData.orderNumber;

  if (isNew) {
    // Allocate a globally-unique sequential number inside a transaction.
    const counterRef = db.collection("counters").doc("orders");
    orderNumber = await db.runTransaction(async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const current = counterSnap.exists ? (counterSnap.data()?.current || 0) : 0;
      const next = current + 1;
      tx.set(counterRef, { current: next }, { merge: true });
      return `FA-${next.toString().padStart(4, "0")}`;
    });
  }

  // ---- Financing metadata block, ported from SummaryReport.tsx:97-164 ----
  // Every figure below derives from the server-computed per-service values
  // accumulated above, never from the submitted metadata (FIND-56).

  // SummaryReport.tsx:99-104 — rounded once on the total, not per service.
  const totalUpfrontPayment = Math.round(upfrontSum);

  // SummaryReport.tsx:115 — `option` is DERIVED, not an operator input. The
  // client auto-sets it and renders it read-only, so it needs no validation;
  // it is simply recomputed and overwritten.
  const option = oneTimeCostWithSST > totalUpfrontPayment ? "Yes" : "No";

  // SummaryReport.tsx:116-117
  const totalOneTimeChargeB2S = Math.round(option === "Yes" ? oneTimeCostWithSST : 0);
  const totalFinancingRequest = Math.round(
    Math.max(0, totalOneTimeChargeB2S - totalUpfrontPayment)
  );

  // SummaryReport.tsx:186 — contractPeriod is derived ONLY when financing
  // applies and some line item carries a tenure. Otherwise the client's value
  // is preserved, so it is coerced and floored rather than trusted outright.
  // Its magnitude in that fallback path remains unconstrained: no business rule
  // currently defines a ceiling. See FIND-56.
  const clientContractPeriod = Math.max(
    0,
    Math.floor(toFiniteNumber(orderData.contractPeriod) ?? 0)
  );
  const contractPeriod =
    option === "Yes" && maxContractTenure > 0 ? maxContractTenure : clientContractPeriod;

  // SummaryReport.tsx:156-164. `n` follows the same selection as
  // contractPeriod. The formula is PMT(5%/12, n, request) minus straight-line
  // monthly principal.
  let financingLease = 0;
  const n = option === "Yes" && maxContractTenure > 0 ? maxContractTenure : clientContractPeriod;
  if (option === "Yes" && totalFinancingRequest > 0 && n > 0) {
    const r = 0.05 / 12;
    const pmt = (totalFinancingRequest * r) / (1 - Math.pow(1 + r, -n));
    const monthlyPrincipal = totalFinancingRequest / n;
    financingLease = pmt - monthlyPrincipal;
  }
  // SummaryReport.tsx:185 — stored as a rounded string, "0" when not positive.
  const financingLeaseStored =
    financingLease > 0 ? Math.round(financingLease).toString() : "0";

  // Persist. Everything below the spread is server-owned and overrides the
  // request.
  const docRef = await db.collection("orders").add({
    ...orderData,
    services,
    // Server-owned: the client's `url` field is dropped (FIND-01).
    attachments: sanitizedAttachments,
    orderNumber,
    createdBy: email ?? "",
    // Workflow state is server-owned. A new order always starts as a Draft with
    // no pending rank and no history; submitForApproval is the only path into
    // the approval chain, and it sets "Pending Approval - Rank 4" itself.
    status: "Draft",
    currentApprovalRank: "",
    approvalHistory: [],
    // Recomputed from the line items above, never accepted from the request.
    totalRevenue,
    totalCost,
    finalDecisionAuthorityRank: `Rank ${lowestRank}`,
    // Financing metadata, recomputed above. Stored as strings to match the
    // OrderMetadata shape the client and the display code both expect.
    option,
    totalUpfrontPayment: totalUpfrontPayment.toString(),
    totalOneTimeChargeB2S: totalOneTimeChargeB2S.toString(),
    totalFinancingRequest: totalFinancingRequest.toString(),
    contractPeriod: contractPeriod.toString(),
    financingLease: financingLeaseStored,
  });

  return { success: true, orderNumber, id: docRef.id };
});

// ---------- deleteOrder (admin-authorized) ----------
export const deleteOrder = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const { uid, token } = request.auth;
  const email = token.email;

  const orderId = request.data?.orderId;
  if (!orderId || typeof orderId !== "string") {
    throw new HttpsError("invalid-argument", "orderId is required.");
  }

  // AUTHORIZATION: only admins may delete.
  const { role } = await getCallerProfile(uid, email);
  if (role !== "admin") {
    throw new HttpsError("permission-denied", "Only admins can delete requests.");
  }

  await db.collection("orders").doc(orderId).delete();

  return { success: true };
});

// ---------- getMyProfile (caller's own role/department/name) ----------
export const getMyProfile = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const { uid, token } = request.auth;
  const email = token.email;

  // Read users/{uid}, then fall back to users/{email}.
  let data: any = null;
  const byUid = await db.collection("users").doc(uid).get();
  if (byUid.exists) data = byUid.data();
  if ((!data || !data.role) && email) {
    const byEmail = await db.collection("users").doc(email).get();
    if (byEmail.exists) data = byEmail.data();
  }

  let role: string;
  let department: string | null = null;
  let name: string | null = null;

  if (data && data.role) {
    role = data.role;
    name = data.name || null;
    const loadedDept = data.department || null;
    if (role === "rank4" && !loadedDept && email) {
      department = getDepartmentFromEmail(email);
    } else {
      department = loadedDept;
    }
  } else if (email && email.toLowerCase().includes("rank4")) {
    role = "rank4";
    department = getDepartmentFromEmail(email);
  } else {
    role = "user";
    department = null;
  }

  return { role, department, name };
});

// ---------- updateMyDepartment (rank4 updates their own department) ----------

export const updateMyDepartment = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const { uid, token } = request.auth;
  const email = token.email;

  const newDept = request.data?.department ?? null;

  // Reject an unrecognised department before touching any document. `null`
  // is permitted so a Rank 4 approver can clear their assignment.
  if (
    newDept !== null &&
    (typeof newDept !== "string" || !ALLOWED_DEPARTMENTS.includes(newDept))
  ) {
    throw new HttpsError("invalid-argument", "Unrecognised department.");
  }

  // Resolve the caller's EXISTING profile — uid first, then email. This is the
  // same order getCallerProfile uses, so enforcement and this function agree on
  // which document represents the caller. We keep the ref we actually read the
  // role from, so the write below lands on that same document rather than
  // creating a second one under a different key.
  let profileRef = db.collection("users").doc(uid);
  let profileSnap = await profileRef.get();
  if (!profileSnap.exists && email) {
    profileRef = db.collection("users").doc(email);
    profileSnap = await profileRef.get();
  }

  // A caller with no profile, or a profile that is not rank4, is rejected.
  // This function must never create a profile: doing so is what allowed an
  // unprovisioned caller to self-assign an approver role. Both cases return the
  // same error so the response does not reveal whether a profile exists.
  if (!profileSnap.exists || profileSnap.data()?.role !== "rank4") {
    throw new HttpsError(
      "permission-denied",
      "Only a Rank 4 approver can change their department."
    );
  }

  // update() writes the single field and fails if the document is missing, so
  // this cannot create a profile even if the guard above were somehow bypassed.
  // `role` is never written here.
  await profileRef.update({ department: newDept });

  return { success: true };
});