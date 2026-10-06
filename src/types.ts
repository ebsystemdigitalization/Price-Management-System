export type ServiceCategory = 'one-time' | 'annual';

export interface Service {
  id: string;
  category: ServiceCategory;
  
  // General Info
  name: string;
  description: string;
  serviceType: string;
  units: number;
  years: number;

  // Price to Customer
  outrightPrice: number;
  monthlyRevenue: number;
  totalInstallmentPayment: number;
  tcv: number;

  // Payment Term
  decision: string;
  installmentPeriod: number;

  // Cost From Vendor
  costPerUnit: number;
  totalCost: number;
  sstRate: number;
  totalSST: number;

  // Governance & Buffer
  salesBuffer: number;
  entity: string;
  authorityLevel: string;
  authorityRank: string;

  createdAt: number;
  updatedAt: number;
}

export const SERVICE_TYPES = [
  "Hardware",
  "Software",
  "License",
  "Maintenance",
  "Installation",
  "Professional Service",
  "Consultancy",
  "Others"
];

export const DECISIONS = [
  "Upfront Payment",
  "Installment Plan"
];

export const INSTALLMENT_PERIODS = [
  1, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120
];

export const ENTITIES = [
  "Telco",
  "TechCo"
];

export const AUTHORITY_LEVELS = [
  "Head of Sales",
  "Head of Commercial",
  "CEBO",
  "Finance"
];

export const AUTHORITY_RANKS = [
  "Rank 1",
  "Rank 2",
  "Rank 3",
  "Rank 4"
];

export const CONTRACT_TYPES = [
  "New Contract",
  "Renewal",
  "Add-on",
  "Amendment"
];

export const INITIAL_METADATA: OrderMetadata = {
  servicesProducts: "",
  companyName: "",
  projectBrief: "",
  justification: "",
  currency: "Malaysian Ringgit",
  accountManager: "",
  regionalManager: "",
  headOfDepartment: "",
  pricer: "",
  solutionArchitect: "",
  salesforceId: "",
  vendorName: "",
  businessDevelop: "",
  preSales: "",
  cidbLevy: "No",
  cidbLevyAmount: "0",
  stampDuty: "No",
  stampDutyAmount: "0",
  ePerolehan: "No",
  solutionServiceType: "",
  date: new Date().toISOString().split('T')[0],
  contractType: "New Contract",
  exchangeRate: "1.00",
  option: "",
  totalOneTimeChargeB2S: "0",
  totalUpfrontPayment: "0",
  totalFinancingRequest: "0",
  financingLease: "0",
  contractPeriod: "",
  finalDecisionMaker: "",
  finalDecisionAuthorityRank: "",
  orderNumber: ""
};

export const CURRENCIES = [
  "Australian Dollar",
  "Canadian Dollar",
  "Chinese Yuan",
  "EURO",
  "Indian Rupee",
  "Indonesian Rupiah",
  "Japanese Yen",
  "Pound Sterling",
  "Malaysian Ringgit",
  "Singapore Dollar",
  "Swiss Franc",
  "Turkish Lira",
  "USD",
  "Korean Won"
];

export interface Attachment {
  id: string;
  name: string;
  /**
   * @deprecated FIND-01 — no longer written. `getDownloadURL` minted a
   * permanent, rules-bypassing access token, so the URL is no longer persisted
   * and `createOrder` strips this field. Still present on documents created
   * before that change; never read it. Resolve a short-lived signed URL through
   * the `getAttachmentUrl` callable using `path` instead (see
   * `src/lib/attachments.ts`).
   */
  url?: string;
  path: string;      // Storage path, needed to delete the file later
  size: number;       // bytes
  type: "pdf" | "excel";
  uploadedAt: string; // ISO timestamp
}

export interface OrderMetadata {
  servicesProducts: string;
  companyName: string;
  projectBrief: string;
  justification: string;
  attachments?: Attachment[];
  accountManager: string;
  regionalManager: string;
  headOfDepartment: string;
  pricer: string;
  solutionArchitect: string;
  salesforceId: string;
  vendorName: string;
  businessDevelop: string;
  preSales: string;
  cidbLevy: string;
  cidbLevyAmount: string;
  stampDuty: string;
  stampDutyAmount: string;
  ePerolehan: string;
  solutionServiceType: string;
  date: string;
  contractType: string;
  exchangeRate: string;
  currency?: string;
  // Financing fields
  option: string;
  totalOneTimeChargeB2S: string;
  totalUpfrontPayment: string;
  totalFinancingRequest: string;
  financingLease: string;
  contractPeriod: string;
  finalDecisionMaker: string;
  finalDecisionAuthorityRank: string;
  orderNumber?: string;
}

export interface ApprovalHistoryEntry {
  rank: string;         // e.g., "Rank 4", "Rank 3", "Rank 2", "Rank 1"
  role: string;         // e.g., "Head of Sales", "Head of Commercial", "CEBO", "Finance"
  status: "Approved" | "Rejected";
  approvedBy: string;   // User email
  approvedAt: number;   // Timestamp
  comment?: string;
}

export interface Order extends Partial<OrderMetadata> {
  id: string;
  orderNumber: string;
  version: number;
  services: Service[];
  totalRevenue: number;
  totalCost: number;
  createdAt: number;
  // Added for auth/RBAC: the email of the user who created the order.
  createdBy?: string;
  status?: string;
  currentApprovalRank?: string; // e.g., "Rank 4", "Rank 3", etc.
  approvalHistory?: ApprovalHistoryEntry[];
}