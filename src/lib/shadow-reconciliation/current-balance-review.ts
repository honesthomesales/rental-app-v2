/**
 * Current-balance vs historical-only reconciliation review.
 * Candidate remains DISABLED_FOR_UI. Never writes DB. Never carries credit.
 */

import type {
  CandidateAccountSummary,
  ShadowInvoice,
  ShadowLease,
  ShadowPayment,
} from "./types";

export type ReviewClassification =
  | "HISTORICAL_ONLY_NO_CURRENT_EFFECT"
  | "CURRENT_BALANCE_DECISION_REQUIRED";

export type ImmediateDecisionType =
  | "payment_allocation"
  | "missing_current_obligation"
  | "current_lease_continuity"
  | "current_occupancy_start_date"
  | "grace_status_only"
  | "other_current_balance";

export type PreOccupancyLabel =
  | "prior_lease_history"
  | "lease_start_date_likely_inaccurate"
  | "lease_gap_history"
  | "truly_before_known_occupancy"
  | "unresolved";

export type MissingInvoiceAction =
  | "no_current_action_retain_as_history"
  | "attach_to_existing_same_period_invoice"
  | "approve_missing_obligation_and_allocate"
  | "payment_allocation_review_required"
  | "data_cleanup_required";

function toDateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return String(iso).split("T")[0];
}

function money(n: number | string | null | undefined): number {
  const v = parseFloat(String(n ?? 0));
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function statusBucket(
  grace: CandidateAccountSummary["graceStatus"] | undefined,
  lateOrCurrent: "late" | "current" | undefined,
): "late" | "grace" | "current" | "paid" {
  if (grace === "late") return "late";
  if (grace === "grace_period") return "grace";
  if (lateOrCurrent === "late") return "late";
  return "current";
}

/** Lease windows for same tenant+property, sorted by start. */
export function leaseSegmentsForAccount(
  leases: ShadowLease[],
  tenantId: string,
  propertyId: string,
): Array<{ id: string; start: string; end: string | null; status: string }> {
  return leases
    .filter(
      (l) =>
        l.tenant_id === tenantId &&
        l.property_id === propertyId &&
        toDateOnly(l.lease_start_date),
    )
    .map((l) => ({
      id: l.id,
      start: toDateOnly(l.lease_start_date)!,
      end: toDateOnly(l.lease_end_date),
      status: String(l.status || "").toLowerCase(),
    }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Label a payment flagged as before obligationStartDate / occupancy start.
 * Never treats the amount as overpayment or credit.
 */
export function labelPreOccupancyPayment(args: {
  paymentDate: string;
  segments: Array<{ id: string; start: string; end: string | null }>;
  obligationStartDate: string | null;
  newestSegmentStart: string | null;
  hasRegularPaymentsAround?: boolean;
}): PreOccupancyLabel {
  const pay = toDateOnly(args.paymentDate);
  if (!pay) return "unresolved";

  const inAnyLease = args.segments.some((s) => {
    const end = s.end || "9999-12-31";
    return pay >= s.start && pay <= end;
  });
  if (inAnyLease) {
    // During an older segment, but before the newest / obligation start.
    if (
      args.newestSegmentStart &&
      pay < args.newestSegmentStart &&
      args.segments.some((s) => pay >= s.start && pay < (args.newestSegmentStart || ""))
    ) {
      return "prior_lease_history";
    }
    return "prior_lease_history";
  }

  // Between lease segments (gap)
  for (let i = 0; i < args.segments.length - 1; i++) {
    const a = args.segments[i];
    const b = args.segments[i + 1];
    const aEnd = a.end || a.start;
    if (pay > aEnd && pay < b.start) return "lease_gap_history";
  }

  const earliest = args.segments[0]?.start || args.obligationStartDate;
  if (earliest && pay < earliest) {
    // Regular rent after a later obligationStart that differs from earliest lease
    // suggests the Billy start overlay is wrong — else truly before occupancy.
    if (
      args.hasRegularPaymentsAround &&
      args.obligationStartDate &&
      args.obligationStartDate > earliest
    ) {
      return "lease_start_date_likely_inaccurate";
    }
    return "truly_before_known_occupancy";
  }

  if (
    args.obligationStartDate &&
    pay < args.obligationStartDate &&
    args.segments.some((s) => s.start < args.obligationStartDate!)
  ) {
    return "lease_start_date_likely_inaccurate";
  }

  return "unresolved";
}

export function preOccupancyWouldChangeCurrentBalance(args: {
  label: PreOccupancyLabel;
  baselineTotal: number;
  candidateTotal: number;
  isOccupied: boolean;
  continuityClassification: string;
}): boolean {
  if (!args.isOccupied) return false;
  if (args.continuityClassification === "closed") return false;
  if (args.label === "prior_lease_history") return false;
  if (args.label === "truly_before_known_occupancy") return false;
  if (args.label === "lease_gap_history") return false;
  // Inaccurate start date may change which current invoices/periods count.
  if (args.label === "lease_start_date_likely_inaccurate") {
    return Math.abs(args.candidateTotal - args.baselineTotal) > 0.009;
  }
  if (args.label === "unresolved") {
    return Math.abs(args.candidateTotal - args.baselineTotal) > 0.009;
  }
  return false;
}

export type MissingInvoicePaymentReview = {
  paymentId: string;
  accountKey: string;
  amount: number;
  paymentDate: string;
  missingInvoiceId: string;
  samePeriodInvoiceExists: boolean;
  samePeriodInvoiceId: string | null;
  reflectedInPaymentsBaseline: boolean;
  wouldChangeCurrentBalance: boolean;
  missingInvoiceEra: "historical" | "current" | "unknown";
  proposedAction: MissingInvoiceAction;
};

export function reviewMissingInvoicePayment(args: {
  payment: ShadowPayment;
  accountKey: string;
  invoices: ShadowInvoice[];
  leases: ShadowLease[];
  baselineTotal: number;
  candidateTotal: number;
  isOccupied: boolean;
  continuityClassification: string;
  asOf: string;
}): MissingInvoicePaymentReview {
  const payDate = toDateOnly(args.payment.payment_date) || "";
  const missingId = String(args.payment.invoice_id || "");
  const amount = money(args.payment.amount);

  // Same-period = invoice due within ±16 days of payment (heuristic) on same lease/account
  const accountLeaseIds = new Set(
    args.leases
      .filter((l) => `${l.tenant_id}::${l.property_id}` === args.accountKey)
      .map((l) => l.id),
  );
  const samePeriod = args.invoices.find((inv) => {
    if (!accountLeaseIds.has(inv.lease_id)) return false;
    if (String(inv.status || "").toUpperCase() === "VOID") return false;
    const due = toDateOnly(inv.due_date);
    if (!due || !payDate) return false;
    const dDue = new Date(due + "T12:00:00").getTime();
    const dPay = new Date(payDate + "T12:00:00").getTime();
    const days = Math.abs(dDue - dPay) / (1000 * 60 * 60 * 24);
    return days <= 16;
  });

  const occupiedLease = args.leases.find(
    (l) =>
      `${l.tenant_id}::${l.property_id}` === args.accountKey &&
      String(l.status || "").toLowerCase() === "occupied",
  );
  const occStart = toDateOnly(occupiedLease?.lease_start_date);
  const era: "historical" | "current" | "unknown" =
    !payDate || !occStart
      ? "unknown"
      : payDate < occStart
        ? "historical"
        : "current";

  // Payments page already recognizes completed payments by invoice_id linkage;
  // a missing invoice ID means the payment may still sit on the account via lease_id.
  const reflectedInPaymentsBaseline = true; // cash received is already in Payments history

  const closed = args.continuityClassification === "closed";
  const balanceDiff = Math.abs(args.candidateTotal - args.baselineTotal) > 0.009;
  const wouldChange =
    args.isOccupied &&
    !closed &&
    (balanceDiff ||
      (era === "current" && !!samePeriod) ||
      (era === "current" && args.candidateTotal > 0.009));

  let action: MissingInvoiceAction = "no_current_action_retain_as_history";
  if (!args.isOccupied || closed || era === "historical") {
    action = "no_current_action_retain_as_history";
  } else if (samePeriod) {
    action = wouldChange
      ? "attach_to_existing_same_period_invoice"
      : "no_current_action_retain_as_history";
  } else if (era === "current" && balanceDiff) {
    action = "approve_missing_obligation_and_allocate";
  } else if (era === "current") {
    action = "payment_allocation_review_required";
  } else {
    action = "data_cleanup_required";
  }

  return {
    paymentId: args.payment.id,
    accountKey: args.accountKey,
    amount,
    paymentDate: payDate,
    missingInvoiceId: missingId,
    samePeriodInvoiceExists: !!samePeriod,
    samePeriodInvoiceId: samePeriod?.id || null,
    reflectedInPaymentsBaseline,
    wouldChangeCurrentBalance: wouldChange && action !== "no_current_action_retain_as_history",
    missingInvoiceEra: era,
    proposedAction: action,
  };
}

export type AllocationMismatchReview = {
  paymentId: string;
  accountKey: string;
  amount: number;
  paymentsRecognizedAmount: number;
  candidateRecognizedAmount: number;
  currentBalanceImpact: number;
  reason: string;
  proposedCorrection: string;
};

/**
 * Impact = how much candidate current totalOwed differs from Payments baseline
 * for allocation-driven differences. Exclude zero-impact rows.
 */
export function allocationMismatchImpact(args: {
  baselineTotal: number;
  candidateTotal: number;
  allocationMismatchAmount: number;
}): number {
  if (args.allocationMismatchAmount <= 0.009) return 0;
  // Candidate does not apply historical excess as credit; impact is only the
  // present collections delta vs Payments.
  return round2(args.candidateTotal - args.baselineTotal);
}

export type ImmediateDecisionRow = {
  accountKey: string;
  tenantId: string;
  propertyId: string;
  tenantName?: string;
  propertyName?: string;
  propertyAddress?: string;
  baselineTotal: number;
  candidateTotal: number;
  difference: number;
  currentStatus: string;
  proposedStatus: string;
  issueType: ImmediateDecisionType;
  amountInvolved: number;
  decisionBillyMustMake: string;
  recommendedAction: string;
  groupOrder: number;
};

export type AccountReviewResult = {
  accountKey: string;
  classification: ReviewClassification;
  historicalOnlyAmount: number;
  currentBalanceImpactAmount: number;
  immediateDecision: ImmediateDecisionRow | null;
  reasons: string[];
};

function pickIssueType(c: CandidateAccountSummary, balanceDiff: number): {
  type: ImmediateDecisionType;
  groupOrder: number;
  decision: string;
  action: string;
  amount: number;
} {
  const r = c.excessByReason;
  const alloc =
    (r.payment_allocation_mismatch || 0) +
    (r.payment_linked_to_missing_invoice || 0) +
    (c.unlinkedPaymentsAmount || 0);
  const missing =
    c.unapprovedMissingObligationTotal + c.unapprovedHoldoverObligationTotal;
  const startAmt = r.payment_before_reliable_occupancy_start || 0;
  const otherAmt = r.other || 0;

  if (alloc > 0.009 && Math.abs(balanceDiff) > 0.009) {
    return {
      type: "payment_allocation",
      groupOrder: 1,
      decision:
        "Decide how this payment should allocate to current open invoices (or confirm Payments baseline).",
      action: "Payment allocation review — do not invent credit.",
      amount: round2(Math.min(alloc, Math.abs(balanceDiff) || alloc)),
    };
  }
  if (missing > 0.009 && Math.abs(balanceDiff) > 0.009) {
    return {
      type: "missing_current_obligation",
      groupOrder: 2,
      decision:
        "Approve missing current-period obligations OR retain Payments total.",
      action: "Approve/reject missing current obligations.",
      amount: missing,
    };
  }
  if (
    (c.decisionType === "current_holdover" ||
      c.continuityClassification === "unresolved" ||
      (c.decisionType === "unset" &&
        c.dataProblems?.includes("continuity_confirmation_required"))) &&
    Math.abs(balanceDiff) > 0.009
  ) {
    return {
      type: "current_lease_continuity",
      groupOrder: 3,
      decision: "Confirm current lease continuity / occupancy for this account.",
      action: "Set continuity decision for current occupied account.",
      amount: round2(Math.abs(balanceDiff)),
    };
  }
  if (startAmt > 0.009 && Math.abs(balanceDiff) > 0.009) {
    return {
      type: "current_occupancy_start_date",
      groupOrder: 4,
      decision:
        "Correct occupancy/lease-start boundary only if it changes current balance.",
      action: "Confirm start date; do not apply pre-start cash as credit.",
      amount: startAmt,
    };
  }
  if (Math.abs(balanceDiff) <= 0.009 && c.graceStatus === "grace_period") {
    return {
      type: "grace_status_only",
      groupOrder: 5,
      decision: "Confirm grace vs late presentation (balance unchanged).",
      action: "Grace-status decision only.",
      amount: 0,
    };
  }
  return {
    type: "other_current_balance",
    groupOrder: 6,
    decision: "Resolve current-balance discrepancy vs Payments.",
    action: otherAmt > 0.009 ? "Classify residual dollars; no credit." : "Align candidate with Payments or approve deltas.",
    amount: round2(Math.abs(balanceDiff) || otherAmt),
  };
}

/**
 * Classify one account: historical-only vs current-balance decision.
 * Historical excess never alone qualifies for the immediate queue.
 */
export function classifyAccountReview(args: {
  candidate: CandidateAccountSummary;
  baseline: {
    totalOwed: number;
    lateOrCurrent: "late" | "current";
    oldestUnpaidDate?: string | null;
  } | null;
  isOccupied: boolean;
  preOccupancyNeedsDecision?: boolean;
  missingInvoiceNeedsDecision?: boolean;
  allocationNeedsDecision?: boolean;
  otherNeedsDecision?: boolean;
}): AccountReviewResult {
  const c = args.candidate;
  const r = c.excessByReason;
  const confirmed = r.confirmed_payment_above_recorded_obligations || 0;
  const histExcess = c.historicalExcessPayment || 0;

  const baselineTotal = args.baseline?.totalOwed ?? 0;
  const balanceDiff = round2(c.totalOwed - baselineTotal);
  const absDiff = Math.abs(balanceDiff);

  const closed = c.continuityClassification === "closed";

  // Closed / non-occupied → historical only for immediate Billy queue
  if (closed || !args.isOccupied) {
    return {
      accountKey: c.accountKey,
      classification: "HISTORICAL_ONLY_NO_CURRENT_EFFECT",
      historicalOnlyAmount: histExcess,
      currentBalanceImpactAmount: 0,
      immediateDecision: null,
      reasons: ["closed_or_not_occupied"],
    };
  }

  const needs =
    !!args.preOccupancyNeedsDecision ||
    !!args.missingInvoiceNeedsDecision ||
    !!args.allocationNeedsDecision ||
    !!args.otherNeedsDecision ||
    (c.missingExpectedObligations > 0 && absDiff > 0.009) ||
    (absDiff > 0.009 &&
      (c.decisionType === "unset" || c.decisionType === "unresolved"));

  // Grace-only: status change without dollar delta (optional, rare)
  const graceOnly =
    absDiff <= 0.009 &&
    args.baseline &&
    statusBucket(c.graceStatus, undefined) === "grace" &&
    args.baseline.lateOrCurrent === "late";

  if (!needs && !graceOnly) {
    return {
      accountKey: c.accountKey,
      classification: "HISTORICAL_ONLY_NO_CURRENT_EFFECT",
      historicalOnlyAmount: histExcess,
      currentBalanceImpactAmount: 0,
      immediateDecision: null,
      reasons: ["no_current_balance_effect"],
    };
  }

  // Supported historical excess alone never enters the queue.
  if (
    histExcess > 0.009 &&
    absDiff <= 0.009 &&
    !args.preOccupancyNeedsDecision &&
    !args.missingInvoiceNeedsDecision &&
    !args.allocationNeedsDecision &&
    !args.otherNeedsDecision &&
    c.missingExpectedObligations === 0 &&
    !graceOnly
  ) {
    return {
      accountKey: c.accountKey,
      classification: "HISTORICAL_ONLY_NO_CURRENT_EFFECT",
      historicalOnlyAmount: histExcess,
      currentBalanceImpactAmount: 0,
      immediateDecision: null,
      reasons: ["supported_historical_excess_only"],
    };
  }

  const picked = pickIssueType(c, balanceDiff);
  if (graceOnly) {
    picked.type = "grace_status_only";
    picked.groupOrder = 5;
    picked.amount = 0;
    picked.decision = "Confirm grace vs late (balance unchanged).";
    picked.action = "Grace-status decision only.";
  }

  const immediate: ImmediateDecisionRow = {
    accountKey: c.accountKey,
    tenantId: c.tenantId,
    propertyId: c.propertyId,
    baselineTotal,
    candidateTotal: round2(c.totalOwed),
    difference: balanceDiff,
    currentStatus: statusBucket(
      undefined,
      args.baseline?.lateOrCurrent,
    ),
    proposedStatus: statusBucket(c.graceStatus, undefined),
    issueType: picked.type,
    amountInvolved: picked.amount,
    decisionBillyMustMake: picked.decision,
    recommendedAction: picked.action,
    groupOrder: picked.groupOrder,
  };

  return {
    accountKey: c.accountKey,
    classification: "CURRENT_BALANCE_DECISION_REQUIRED",
    historicalOnlyAmount: round2(confirmed),
    currentBalanceImpactAmount: round2(Math.abs(balanceDiff) || picked.amount),
    immediateDecision: immediate,
    reasons: [picked.type],
  };
}

/**
 * Confirm historical payment never transfers to replacement tenant.
 */
export function paymentsTransferToReplacement(args: {
  predecessorPayments: ShadowPayment[];
  replacementAccountPayments: ShadowPayment[];
}): boolean {
  const predIds = new Set(args.predecessorPayments.map((p) => p.id));
  return args.replacementAccountPayments.some((p) => predIds.has(p.id));
}

export function buildImmediateDecisionQueue(
  rows: ImmediateDecisionRow[],
): ImmediateDecisionRow[] {
  // One row per account (already should be); sort by group then |difference|.
  const byAccount = new Map<string, ImmediateDecisionRow>();
  for (const row of rows) {
    const prev = byAccount.get(row.accountKey);
    if (!prev || row.groupOrder < prev.groupOrder) {
      byAccount.set(row.accountKey, row);
    } else if (prev && row.groupOrder === prev.groupOrder) {
      // Keep higher amount
      if (row.amountInvolved > prev.amountInvolved) {
        byAccount.set(row.accountKey, row);
      }
    }
  }
  return [...byAccount.values()].sort((a, b) => {
    if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
    return Math.abs(b.difference) - Math.abs(a.difference);
  });
}

export { money as reviewMoney, round2 as reviewRound2, toDateOnly as reviewToDateOnly };
