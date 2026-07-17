/**
 * Shadow account reconciliation types.
 * Candidate results MUST NOT be consumed by visible UI screens.
 */

export type GraceStatus = "current" | "grace_period" | "late";

export type ContinuityDecisionType =
  | "sold_closed"
  | "moved_closed"
  | "vacant_closed"
  | "lease_never_effective"
  | "expired_closed"
  | "replaced_by_new_tenant"
  | "current"
  | "current_new_tenant"
  | "current_holdover"
  | "unresolved";

export type AccountContinuityDecision = {
  tenantId: string;
  propertyId: string;
  decisionType: ContinuityDecisionType;
  /** Optional explicit cutoff (YYYY-MM-DD). Defaults to lease end when applicable. */
  obligationCutoffDate?: string | null;
  /** Optional occupancy/move-in start for new tenants (YYYY-MM-DD). */
  occupancyStartDate?: string | null;
  billyLabel?: string;
  notes?: string;
};

export type CandidateEngineOptions = {
  /** Billy continuity overlay (by tenant_id + property_id). */
  decisions?: AccountContinuityDecision[];
  /**
   * Forward-only credit cutover. When unset, excess never becomes available
   * credit (historical_excess_payment_not_carried). Do not hard-code today.
   */
  creditCarryForwardEffectiveDate?: string | null;
};

export type CreditPolicyStatus =
  | "no_effective_date_historical_excess_not_carried"
  | "forward_only_from_effective_date"
  | "credit_closeout_review";

export type HistoricalExcessReason =
  | "confirmed_payment_above_recorded_obligations"
  | "missing_historical_obligations_not_approved"
  | "lease_gap_obligations_not_approved"
  | "payment_after_verified_account_closure"
  | "payment_before_reliable_occupancy_start"
  | "miscellaneous_or_non_rent_income"
  | "payment_linked_to_missing_invoice"
  | "payment_linked_to_void_invoice"
  | "payment_linked_to_inactive_or_expired_lease"
  | "payment_allocation_mismatch"
  | "refund_reversal_not_represented"
  | "account_mapping_problem"
  | "data_cleanup_required"
  | "other";

export type ExcessSupportClass =
  | "supported_historical_excess"
  | "depends_on_missing_obligation_review"
  | "depends_on_lease_continuity_review"
  | "payment_allocation_review_required"
  | "non_rent_payment_review_required"
  | "closure_timing_review_required"
  | "data_cleanup_required";

export type ExcessReasonBreakdown = Record<HistoricalExcessReason, number>;

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
  | "historical_excess_payment_not_carried"
  | "forward_credit"
  | "credit_closeout_review"
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
  | "no_reliable_lease_evidence"
  | "data_cleanup_required"
  | "continuity_confirmation_required"
  | "historical_excess_payment_not_carried"
  | "credit_closeout_review";

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
  source: "real_invoice" | "expected_preview" | "holdover_preview";
  leaseId: string;
  dueDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  rentAmount: number;
  recordedLateFee: number;
  amountTotal: number;
  /** Remaining capacity for historical settlement (starts at amountTotal for real invoices). */
  historicalCapacityRemaining: number;
  allocated: number;
  /** Current collections balance (PAID = 0; does not erase historicalCapacity). */
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
  /** Deprecated available credit path — always 0 under forward-only policy when unused. */
  unappliedCredit: number;
  historicalExcessPayment: number;
  /** Always 0 — Billy rejected retroactive credits. */
  historicalCreditCarried: 0;
  forwardCredit: number;
  creditCloseoutReview: number;
  creditEffectiveDate: string | null;
  creditPolicyStatus: CreditPolicyStatus;
  decisionType: ContinuityDecisionType | "unset";
  continuityClassification: "current" | "closed" | "unresolved" | "unset";
  obligationCutoffDate: string | null;
  obligationStartDate: string | null;
  continuityRuleDescription: string;
  holdoverObligations: number;
  historicalBalanceReview: number;
  historicalPaymentReview: number;
  /** Reason-coded excess dollars (sums to historicalExcessPayment / historicalPaymentReview). */
  excessByReason: ExcessReasonBreakdown;
  rawCompletedPaymentTotal: number;
  uniqueCompletedPaymentTotal: number;
  realInvoiceObligationTotal: number;
  approvedCandidateObligationTotal: number;
  unapprovedMissingObligationTotal: number;
  unapprovedHoldoverObligationTotal: number;
  historicalExcessDiagnosticTotal: number;
  duplicateCountedAmount: number;
  unsupportedExcessAmount: number;
  excessSupportClass: ExcessSupportClass;
  totalOwed: number;
  oldestUnpaidDate: string | null;
  graceStatus: GraceStatus;
  daysLate: number;
  lastPaymentDate: string | null;
  lastPaymentAmount: number | null;
  holdoverCandidate: boolean;
  confirmedHoldover: boolean;
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
