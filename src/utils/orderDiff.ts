import { Order, Service } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Order version diffing (Approach A: computed from existing version snapshots).
// Pure display logic — does NOT touch any pricing/costing calculation.
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldChange {
  field: string;      // human-readable label
  key: string;        // raw field key
  before: unknown;
  after: unknown;
}

export interface ServiceChange {
  type: "added" | "removed" | "modified";
  serviceName: string;
  serviceId: string;
  changes?: FieldChange[]; // populated when type === "modified"
}

export interface OrderDiff {
  fieldChanges: FieldChange[];
  serviceChanges: ServiceChange[];
  hasChanges: boolean;
}

// Order-level fields we surface in the diff, with friendly labels.
// (Excludes computed/among-version-noise fields like id, version, createdAt,
// approval workflow state, and the services array which is diffed separately.)
const ORDER_FIELD_LABELS: Record<string, string> = {
  companyName: "Company Name",
  servicesProducts: "Services/Products",
  projectBrief: "Project Brief",
  justification: "Justification",
  accountManager: "Account Manager",
  regionalManager: "Regional Manager",
  headOfDepartment: "Head of Department",
  pricer: "Pricer",
  solutionArchitect: "Solution Architect",
  salesforceId: "S/Force/FA ID",
  vendorName: "Vendor Name",
  businessDevelop: "Business Develop",
  preSales: "Pre-Sales",
  cidbLevy: "CIDB Levy",
  cidbLevyAmount: "CIDB Levy Amount",
  stampDuty: "Stamp Duty",
  stampDutyAmount: "Stamp Duty Amount",
  ePerolehan: "E-Perolehan",
  solutionServiceType: "Solution Service Type",
  date: "Date",
  contractType: "Contract Type",
  exchangeRate: "Exchange Rate",
  option: "Financing Option",
  totalOneTimeChargeB2S: "Total One-time Charge B2S",
  totalUpfrontPayment: "Total Upfront Payment",
  totalFinancingRequest: "Total Financing Request",
  financingLease: "Financing Lease",
  contractPeriod: "Contract Period",
  finalDecisionMaker: "Final Decision Maker",
  finalDecisionAuthorityRank: "Final Decision Authority Rank",
  totalRevenue: "Total Revenue (RM)",
  totalCost: "Total Cost (RM)",
};

// Service-level fields we surface, with friendly labels.
const SERVICE_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  category: "Category",
  serviceType: "Service Type",
  units: "Units",
  years: "Years",
  outrightPrice: "Outright Price (RM)",
  monthlyRevenue: "Monthly Revenue (RM)",
  totalInstallmentPayment: "Total Installment Payment (RM)",
  tcv: "TCV (RM)",
  decision: "Payment Decision",
  installmentPeriod: "Installment Period",
  costPerUnit: "Cost Per Unit (RM)",
  totalCost: "Total Cost (RM)",
  sstRate: "SST Rate",
  totalSST: "Total SST (RM)",
  salesBuffer: "Sales Buffer",
  entity: "Entity",
  authorityLevel: "Authority Level",
  // authorityRank: "Authority Rank", // hidden from change log for now
};

// Normalize for comparison so "12" (string) and 12 (number) don't false-positive,
// and null/undefined/"" are treated as equivalent "empty".
function normalize(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  return String(v).trim();
}

function valuesDiffer(a: unknown, b: unknown): boolean {
  return normalize(a) !== normalize(b);
}

function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string>
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const key of Object.keys(labels)) {
    if (valuesDiffer(before[key], after[key])) {
      changes.push({ field: labels[key], key, before: before[key], after: after[key] });
    }
  }
  return changes;
}

function diffServices(beforeServices: Service[], afterServices: Service[]): ServiceChange[] {
  const changes: ServiceChange[] = [];
  const beforeById = new Map(beforeServices.map((s) => [s.id, s]));
  const afterById = new Map(afterServices.map((s) => [s.id, s]));

  // Removed: in before, not in after
  for (const s of beforeServices) {
    if (!afterById.has(s.id)) {
      changes.push({ type: "removed", serviceName: s.name, serviceId: s.id });
    }
  }

  // Added: in after, not in before
  for (const s of afterServices) {
    if (!beforeById.has(s.id)) {
      changes.push({ type: "added", serviceName: s.name, serviceId: s.id });
    }
  }

  // Modified: in both, with field differences
  for (const s of afterServices) {
    const prev = beforeById.get(s.id);
    if (!prev) continue;
    const fieldChanges = diffFields(
      prev as unknown as Record<string, unknown>,
      s as unknown as Record<string, unknown>,
      SERVICE_FIELD_LABELS
    );
    if (fieldChanges.length > 0) {
      changes.push({ type: "modified", serviceName: s.name, serviceId: s.id, changes: fieldChanges });
    }
  }

  return changes;
}

/**
 * Compare an order version against its immediate predecessor.
 * Returns the list of order-field changes and service-level changes.
 */
export function diffOrderVersions(before: Order | undefined, after: Order): OrderDiff {
  if (!before) {
    return { fieldChanges: [], serviceChanges: [], hasChanges: false };
  }
  const fieldChanges = diffFields(
    before as unknown as Record<string, unknown>,
    after as unknown as Record<string, unknown>,
    ORDER_FIELD_LABELS
  );
  const serviceChanges = diffServices(before.services || [], after.services || []);
  return {
    fieldChanges,
    serviceChanges,
    hasChanges: fieldChanges.length > 0 || serviceChanges.length > 0,
  };
}

/** Format a value for display in the diff table. */
export function formatDiffValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(v);
}