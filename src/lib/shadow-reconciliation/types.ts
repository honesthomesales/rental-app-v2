/**
 * Shadow account reconciliation types.
 * Candidate results MUST NOT be consumed by visible UI screens.
 */

export type GraceStatus = "current" | "grace_period" | "late";

export type DifferenceCategory =
  | "overpayment_credit"
  | "unlinked_payment"
  | "missing_invoice"
  | "partial_invoice_status"
  | "payment_after_lease_end"
  | "lease_not_extended"
  | "holdover_candidate"
  | "duplicate_invoice"
  | "recorded_late_fee"
  | "grace_period_change"
  | "ambiguous_account"
  | "other";

export type DataProblemCode =
  | "ambiguous_payment"
  | "unknown_cadence"
  | "duplicate_invoice"
  | "holdover_candidate"
  | "payment_after_lease_end"
  | "missing_expected_obligation"
  | "unlinked_payment"
  | "partial_invoice_ignored_by_baseline"
  | "no_reliable_lease_evidence";

export type ShadowLease = {
  id: string;
  tenant_id?: string | null;
  property_id?: string | null;
  lease_start_date?: string | null;
  lease_end_date?: string | null;
  rent?: number | null;
  rent_cadence?: string | null;
  rent_due_day?: number | null;
  due_weekday?: number | null;
  period_anchor_date?: string | null;
  status?: string | null;
  late_fee_amount?: number | null;
  /** Optional lease-specific grace days if a reliable field exists */
  grace_days?: number | null;
};

export type ShadowTenant = {
  id: string;
  is_active?: boolean | null;
  property_id?: string | null;
};

export type ShadowInvoice = {
  id: string;
  lease_id: string;
  due_date: string;
  period_start?: string | null;
  period_end?: string | null;
  status: string;
  amount_total: number | string;
  amount_paid?: number | string;
  amount_rent?: number | string;
  amount_late?: number | string;
  balance_due?: number | string;
};

export type ShadowPayment = {
  id: string;
  amount: number | string;
  payment_date: string;
  status?: string | null;
  invoice_id?: string | null;
  lease_id?: string | null;
  tenant_id?: string | null;
  property_id?: string | null;
};

/** Optional normalized v3 lease terms (read-only input; never written). */
export type ShadowLeaseTerms = {
  lease_id: string;
  rent_amount?: number | null;
  rent_cadence?: string | null;
  rent_due_day?: number | null;
  due_weekday?: number | null;
  period_anchor_date?: string | null;
  effective_start?: string | null;
  effective_end?: string | null;
  grace_days?: number | null;
};

export type ShadowDataset = {
  leases: ShadowLease[];
  tenants?: ShadowTenant[];
  invoices: ShadowInvoice[];
  payments: ShadowPayment[];
  leaseTerms?: ShadowLeaseTerms[];
  asOfDate: string;
  /** Default grace days when lease-specific value absent. */
  defaultGraceDays?: number;
};

export type BaselineLeaseResult = {
  /** Payments page account = occupied lease */
  leaseId: string;
  tenantId: string | null;
  propertyId: string | null;
  accountKey: string | null;
  totalOwed: number;
  unpaidCount: number;
  oldestUnpaidDate: string | null;
  lastPaymentDate: string | null;
  lateOrCurrent: "late" | "current";
};

export type PaymentAllocationShadow = {
  paymentId: string;
  obligationKey: string;
  amount: number;
  source: "invoice_id" | "lease_id" | "tenant_property" | "credit_forward";
};

export type CandidateObligation = {
  key: string;
  source: "real_invoice" | "expected_preview";
  leaseId: string;
  dueDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  rentAmount: number;
  recordedLateFee: number;
  amountTotal: number;
  allocated: number;
  balance: number;
  invoiceId?: string;
  invoiceStatus?: string;
};

export type CandidateAccountSummary = {
  accountKey: string;
  propertyId: string;
  tenantId: string;
  currentLeaseIds: string[];
  relatedLeaseIds: string[];
  rentDue: number;
  recordedLateFees: number;
  paymentsReceived: number;
  linkedPaymentsAmount: number;
  unlinkedPaymentsAmount: number;
  paymentAllocations: PaymentAllocationShadow[];
  unappliedCredit: number;
  totalOwed: number;
  oldestUnpaidDate: string | null;
  graceStatus: GraceStatus;
  daysLate: number;
  lastPaymentDate: string | null;
  lastPaymentAmount: number | null;
  holdoverCandidate: boolean;
  missingExpectedObligations: number;
  dataProblems: DataProblemCode[];
  explanation: string;
  /** Candidate-only; not for UI consumption */
  DISABLED_FOR_UI: true;
};

export type AccountDifference = {
  accountKey: string;
  anonymizedAccountId: string;
  anonymizedLeaseIds: string[];
  baselineTotal: number;
  candidateTotal: number;
  numericDifference: number;
  baselineLateOrCurrent: "late" | "current" | "n/a";
  candidateGraceStatus: GraceStatus | "n/a";
  linkedPaymentsAmount: number;
  unlinkedPaymentsAmount: number;
  carriedCredit: number;
  missingExpectedObligations: number;
  holdoverCandidate: boolean;
  categories: DifferenceCategory[];
  dataProblems: DataProblemCode[];
};

export type DifferenceReport = {
  asOfDate: string;
  baselineAccountCount: number;
  baselineExactMatchCount: number;
  candidateDifferenceCount: number;
  countsByCategory: Record<DifferenceCategory, number>;
  totalUnlinkedPaymentAmount: number;
  totalCandidateCredit: number;
  holdoverCandidateCount: number;
  ambiguousAccountCount: number;
  gracePeriodStatusChangeCount: number;
  differences: AccountDifference[];
  note: string;
};
