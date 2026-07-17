/**
 * CANDIDATE shadow account summary.
 * Read-only / in-memory only. NEVER insert invoices, never invent late fees,
 * never write DB. Results are DISABLED_FOR_UI and must not drive screens.
 *
 * Account continuity + forward-only credit are applied here when options are
 * provided. Different tenants never share balances, payments, or credits.
 */

import { normalizeCadence } from "@/lib/rent/cadence";
import { buildMissingInvoicePreview } from "@/lib/missing-invoice-preview";
import { groupLeasesIntoAccounts, type AccountBundle } from "./account-grouping";
import {
  creditPolicyStatusFor,
  indexDecisions,
  resolveContinuityRule,
} from "./continuity";
import { analyzeMissingObligations } from "./missing-obligation-detail";
import {
  assignPaymentsToAccounts,
  classifyExcessSupportClass,
  classifyHistoricalExcessReason,
} from "./payment-conservation";
import type {
  AccountContinuityDecision,
  CandidateAccountSummary,
  CandidateEngineOptions,
  CandidateObligation,
  DataProblemCode,
  ExcessReasonBreakdown,
  ExcessSupportClass,
  GraceStatus,
  HistoricalExcessReason,
  PaymentAllocationShadow,
  ShadowDataset,
  ShadowInvoice,
  ShadowLease,
  ShadowLeaseTerms,
  ShadowPayment,
} from "./types";

const DEFAULT_GRACE_DAYS = 5;

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

function emptyExcessReasons(): ExcessReasonBreakdown {
  return {
    confirmed_payment_above_recorded_obligations: 0,
    missing_historical_obligations_not_approved: 0,
    lease_gap_obligations_not_approved: 0,
    payment_after_verified_account_closure: 0,
    payment_before_reliable_occupancy_start: 0,
    miscellaneous_or_non_rent_income: 0,
    payment_linked_to_missing_invoice: 0,
    payment_linked_to_void_invoice: 0,
    payment_linked_to_inactive_or_expired_lease: 0,
    payment_allocation_mismatch: 0,
    refund_reversal_not_represented: 0,
    account_mapping_problem: 0,
    data_cleanup_required: 0,
    other: 0,
  };
}

export function computeCandidateAccountSummaries(
  dataset: ShadowDataset,
  options: CandidateEngineOptions = {},
): CandidateAccountSummary[] {
  const asOf = toDateOnly(dataset.asOfDate) || dataset.asOfDate;
  const defaultGrace = dataset.defaultGraceDays ?? DEFAULT_GRACE_DAYS;
  const termsByLease = new Map(
    (dataset.leaseTerms || []).map((t) => [t.lease_id, t]),
  );
  const decisionsByKey = indexDecisions(options.decisions);
  const creditEffectiveDate =
    toDateOnly(options.creditCarryForwardEffectiveDate) || null;

  // As-of: future-dated payments never enter allocation, excess, or credit.
  const eligiblePayments = dataset.payments.filter((p) => {
    const d = toDateOnly(p.payment_date);
    return !d || d <= asOf;
  });

  const bundles = groupLeasesIntoAccounts(
    dataset.leases,
    dataset.tenants,
    eligiblePayments,
    asOf,
  );

  const invoiceById = new Map(dataset.invoices.map((i) => [i.id, i]));
  const invoicesByLease = new Map<string, ShadowInvoice[]>();
  for (const inv of dataset.invoices) {
    if (!invoicesByLease.has(inv.lease_id)) invoicesByLease.set(inv.lease_id, []);
    invoicesByLease.get(inv.lease_id)!.push(inv);
  }

  const { paymentsByAccount, audit: paymentAudit } = assignPaymentsToAccounts({
    payments: eligiblePayments,
    bundles,
    invoices: dataset.invoices,
    leases: dataset.leases,
  });

  if (paymentAudit.invariantViolations.length > 0) {
    throw new Error(
      `Payment conservation invariant violated: ${paymentAudit.invariantViolations.join("; ")}`,
    );
  }

  const leaseToAccount = new Map<string, string>();
  for (const b of bundles) {
    for (const l of b.leases) leaseToAccount.set(l.id, b.accountKey);
  }

  return bundles.map((bundle) =>
    summarizeAccount({
      bundle,
      asOf,
      defaultGrace,
      termsByLease,
      invoicesByLease,
      invoiceById,
      accountPayments: paymentsByAccount.get(bundle.accountKey) || [],
      leaseToAccount,
      allBundles: bundles,
      decision: decisionsByKey.get(bundle.accountKey),
      creditEffectiveDate,
      allLeases: dataset.leases,
      paymentAudit,
    }),
  );
}

function summarizeAccount(args: {
  bundle: AccountBundle;
  asOf: string;
  defaultGrace: number;
  termsByLease: Map<string, ShadowLeaseTerms>;
  invoicesByLease: Map<string, ShadowInvoice[]>;
  invoiceById: Map<string, ShadowInvoice>;
  accountPayments: ShadowPayment[];
  leaseToAccount: Map<string, string>;
  allBundles: AccountBundle[];
  decision: AccountContinuityDecision | undefined;
  creditEffectiveDate: string | null;
  allLeases: ShadowLease[];
  paymentAudit: import("./payment-conservation").PaymentConservationAudit;
}): CandidateAccountSummary {
  const {
    bundle,
    asOf,
    defaultGrace,
    termsByLease,
    invoicesByLease,
    invoiceById,
    accountPayments,
    leaseToAccount,
    allBundles,
    decision,
    creditEffectiveDate,
    allLeases,
    paymentAudit,
  } = args;

  const problems = new Set<DataProblemCode>(bundle.dataProblems);
  const continuity = resolveContinuityRule(decision, bundle.leases, asOf);

  // Replacement / sale / vacancy stops holdover confirmation even if labeled.
  const replacementConflict = allLeases.some(
    (other) =>
      other.property_id === bundle.propertyId &&
      other.tenant_id &&
      other.tenant_id !== bundle.tenantId &&
      String(other.status || "").toLowerCase() === "occupied",
  );

  const confirmedHoldover =
    continuity.allowHoldoverContinuation &&
    !replacementConflict &&
    continuity.decisionType === "current_holdover";

  if (
    continuity.decisionType === "current_holdover" &&
    replacementConflict
  ) {
    problems.add("continuity_confirmation_required");
  }

  if (continuity.needsBillyReview) {
    problems.add("continuity_confirmation_required");
  }

  const obligations = buildObligations({
    bundle,
    asOf,
    termsByLease,
    invoicesByLease,
    problems,
    continuity,
    confirmedHoldover,
  });

  // Lease never effective: real history retained but flagged for cleanup.
  if (continuity.decisionType === "lease_never_effective") {
    const hasHistory =
      obligations.some((o) => o.source === "real_invoice") ||
      accountPayments.length > 0;
    if (hasHistory) problems.add("data_cleanup_required");
  }

  const realInvoiceObligationTotal = round2(
    obligations
      .filter((o) => o.source === "real_invoice")
      .reduce((s, o) => s + o.amountTotal, 0),
  );
  const unapprovedMissingObligationTotal = round2(
    obligations
      .filter((o) => o.source === "expected_preview")
      .reduce((s, o) => s + o.amountTotal, 0),
  );
  const unapprovedHoldoverObligationTotal = round2(
    obligations
      .filter((o) => o.source === "holdover_preview")
      .reduce((s, o) => s + o.amountTotal, 0),
  );
  const approvedCandidateObligationTotal = round2(
    obligations
      .filter((o) => o.source === "real_invoice")
      .reduce((s, o) => s + o.amountTotal, 0) +
      (continuity.allowExpectedObligations
        ? unapprovedMissingObligationTotal + unapprovedHoldoverObligationTotal
        : 0),
  );

  const {
    allocations,
    linkedAmount,
    unlinkedAmount,
    historicalExcessPayment,
    forwardCredit,
    paymentsReceived,
    ambiguous,
    excessByReason,
    settledHistoricalAmount,
  } = allocatePayments({
    obligations,
    payments: accountPayments,
    bundle,
    invoiceById,
    leaseToAccount,
    allBundles,
    problems,
    creditEffectiveDate,
    continuity,
  });

  if (ambiguous) problems.add("ambiguous_payment");

  // Conservation per payment: allocations + unapplied <= payment (checked in allocate)
  if (historicalExcessPayment - paymentsReceived > 0.009) {
    throw new Error(
      `Invariant5 violated for ${bundle.accountKey}: historical excess ${historicalExcessPayment} > payments ${paymentsReceived}`,
    );
  }

  let creditCloseoutReview = 0;
  let forwardCreditFinal = forwardCredit;
  if (continuity.classification === "closed" && forwardCreditFinal > 0) {
    creditCloseoutReview = forwardCreditFinal;
    forwardCreditFinal = 0;
    problems.add("credit_closeout_review");
  }

  if (historicalExcessPayment > 0) {
    problems.add("historical_excess_payment_not_carried");
  }

  const rentDue = round2(obligations.reduce((s, o) => s + o.rentAmount, 0));
  const recordedLateFees = round2(
    obligations.reduce((s, o) => s + o.recordedLateFee, 0),
  );

  // Closed accounts: exclude from current collections; unpaid real balances → historical review
  let totalOwed = round2(
    obligations.reduce((s, o) => s + Math.max(0, o.balance), 0),
  );
  let historicalBalanceReview = 0;
  let historicalPaymentReview = 0;
  if (continuity.classification === "closed") {
    historicalBalanceReview = totalOwed;
    historicalPaymentReview = historicalExcessPayment;
    totalOwed = 0; // not current collections
  }

  const unpaid = obligations
    .filter((o) => o.balance > 0.0001)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const oldestUnpaidDate =
    continuity.classification === "closed" ? null : unpaid[0]?.dueDate ?? null;

  const graceDays = resolveGraceDays(bundle.leases, termsByLease, defaultGrace);
  const { graceStatus, daysLate } = computeGraceStatus(
    oldestUnpaidDate,
    totalOwed,
    asOf,
    graceDays,
  );

  const lastPay = [...accountPayments].sort((a, b) =>
    String(a.payment_date).localeCompare(String(b.payment_date)),
  );
  const last = lastPay[lastPay.length - 1];

  const missingExpected = obligations.filter(
    (o) => o.source === "expected_preview" || o.source === "holdover_preview",
  ).length;
  const holdoverObligations = obligations.filter(
    (o) => o.source === "holdover_preview",
  ).length;

  const currentLeaseIds = bundle.leases
    .filter((l) => String(l.status || "").toLowerCase() === "occupied")
    .map((l) => l.id);
  const relatedLeaseIds = bundle.leases.map((l) => l.id);

  const creditPolicyStatus =
    creditCloseoutReview > 0
      ? ("credit_closeout_review" as const)
      : creditPolicyStatusFor(creditEffectiveDate);

  const reasonSum = round2(
    Object.values(excessByReason).reduce((s, n) => s + n, 0),
  );
  if (Math.abs(reasonSum - historicalExcessPayment) > 0.02) {
    const delta = round2(historicalExcessPayment - reasonSum);
    excessByReason.other = round2(excessByReason.other + delta);
  }

  const excessSupportClass: ExcessSupportClass = classifyExcessSupportClass({
    historicalExcessPayment,
    excessByReason,
    unapprovedMissingObligationTotal,
    unapprovedHoldoverObligationTotal,
    unlinkedPaymentsAmount: unlinkedAmount,
    continuityClassification: continuity.classification,
    dataProblems: [...problems],
  });

  const unsupportedExcessAmount = round2(
    Math.max(
      0,
      historicalExcessPayment -
        (excessByReason.confirmed_payment_above_recorded_obligations || 0),
    ),
  );

  const explanation = [
    "Candidate shadow summary (DISABLED_FOR_UI).",
    `Account ${bundle.accountKey}: decision=${continuity.decisionType} (${continuity.classification}).`,
    continuity.ruleDescription,
    `Real invoices authoritative; ${missingExpected} in-memory expected/holdover gap(s).`,
    `Exclusive account payments $${paymentsReceived} (settled historical $${settledHistoricalAmount}).`,
    `Linked $${linkedAmount}; unlinked flagged $${unlinkedAmount}.`,
    `Historical excess $${historicalExcessPayment} (not credit); forwardCredit=$${forwardCreditFinal}.`,
    continuity.classification === "closed"
      ? `Closed: historicalBalanceReview=$${historicalBalanceReview}; historicalPaymentReview=$${historicalPaymentReview}.`
      : `Current totalOwed=$${totalOwed}.`,
    `Never transfers credit/balance across tenants or properties.`,
  ].join(" ");

  return {
    accountKey: bundle.accountKey,
    propertyId: bundle.propertyId,
    tenantId: bundle.tenantId,
    currentLeaseIds,
    relatedLeaseIds,
    rentDue,
    recordedLateFees,
    paymentsReceived,
    linkedPaymentsAmount: linkedAmount,
    unlinkedPaymentsAmount: unlinkedAmount,
    paymentAllocations: allocations,
    unappliedCredit: 0,
    historicalExcessPayment,
    historicalCreditCarried: 0,
    forwardCredit: forwardCreditFinal,
    creditCloseoutReview,
    creditEffectiveDate,
    creditPolicyStatus,
    decisionType: continuity.decisionType,
    continuityClassification: continuity.classification,
    obligationCutoffDate: continuity.obligationCutoffDate,
    obligationStartDate: continuity.obligationStartDate,
    continuityRuleDescription: continuity.ruleDescription,
    holdoverObligations,
    historicalBalanceReview,
    historicalPaymentReview,
    excessByReason,
    rawCompletedPaymentTotal: paymentAudit.rawCompletedPaymentTotal,
    uniqueCompletedPaymentTotal: paymentAudit.uniqueCompletedPaymentTotal,
    realInvoiceObligationTotal,
    approvedCandidateObligationTotal,
    unapprovedMissingObligationTotal,
    unapprovedHoldoverObligationTotal,
    historicalExcessDiagnosticTotal: historicalExcessPayment,
    duplicateCountedAmount: paymentAudit.duplicateCountedAmount,
    unsupportedExcessAmount,
    excessSupportClass,
    totalOwed,
    oldestUnpaidDate,
    graceStatus,
    daysLate,
    lastPaymentDate: last ? toDateOnly(last.payment_date) : null,
    lastPaymentAmount: last ? money(last.amount) : null,
    holdoverCandidate: bundle.holdoverCandidate,
    confirmedHoldover,
    missingExpectedObligations: missingExpected,
    dataProblems: [...problems],
    explanation,
    DISABLED_FOR_UI: true,
  };
}

function resolveGraceDays(
  leases: ShadowLease[],
  termsByLease: Map<string, ShadowLeaseTerms>,
  defaultGrace: number,
): number {
  for (const l of [...leases].reverse()) {
    const terms = termsByLease.get(l.id);
    if (terms?.grace_days != null && Number(terms.grace_days) >= 0) {
      return Number(terms.grace_days);
    }
    if (l.grace_days != null && Number(l.grace_days) >= 0) {
      return Number(l.grace_days);
    }
  }
  return defaultGrace;
}

function computeGraceStatus(
  oldestUnpaidDate: string | null,
  totalOwed: number,
  asOf: string,
  graceDays: number,
): { graceStatus: GraceStatus; daysLate: number } {
  if (totalOwed <= 0 || !oldestUnpaidDate) {
    return { graceStatus: "current", daysLate: 0 };
  }
  const due = new Date(oldestUnpaidDate + "T12:00:00");
  const today = new Date(asOf + "T12:00:00");
  const diffDays = Math.floor(
    (today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24),
  );
  const daysLate = Math.max(0, diffDays);
  if (diffDays <= graceDays) {
    return { graceStatus: "grace_period", daysLate };
  }
  return { graceStatus: "late", daysLate };
}

function resolveLeaseTerms(
  lease: ShadowLease,
  termsByLease: Map<string, ShadowLeaseTerms>,
): {
  rent: number;
  cadence: string | null;
  rentDueDay: number | null;
  unknownCadence: boolean;
} {
  const t = termsByLease.get(lease.id);
  const rent = money(t?.rent_amount ?? lease.rent);
  const rawCadence = t?.rent_cadence ?? lease.rent_cadence;
  const cadence = normalizeCadence(rawCadence);
  return {
    rent,
    cadence,
    rentDueDay: t?.rent_due_day ?? lease.rent_due_day ?? null,
    unknownCadence: !!rawCadence && !cadence,
  };
}

function buildObligations(args: {
  bundle: AccountBundle;
  asOf: string;
  termsByLease: Map<string, ShadowLeaseTerms>;
  invoicesByLease: Map<string, ShadowInvoice[]>;
  problems: Set<DataProblemCode>;
  continuity: ReturnType<typeof resolveContinuityRule>;
  confirmedHoldover: boolean;
}): CandidateObligation[] {
  const {
    bundle,
    asOf,
    termsByLease,
    invoicesByLease,
    problems,
    continuity,
    confirmedHoldover,
  } = args;
  const obligations: CandidateObligation[] = [];

  for (const lease of bundle.leases) {
    const start = toDateOnly(lease.lease_start_date);
    if (!start) {
      problems.add("no_reliable_lease_evidence");
      continue;
    }

    // New tenant / start gate: do not generate expected before occupancy start.
    const minStart =
      continuity.obligationStartDate && continuity.obligationStartDate > start
        ? continuity.obligationStartDate
        : start;

    const terms = resolveLeaseTerms(lease, termsByLease);
    if (terms.unknownCadence) problems.add("unknown_cadence");

    const real = (invoicesByLease.get(lease.id) || []).filter((inv) => {
      const d = toDateOnly(inv.due_date);
      if (!d) return false;
      if (d < start) return false;
      if (d > asOf) return false;
      return String(inv.status || "").toUpperCase() !== "VOID";
    });

    const dueCounts = new Map<string, number>();
    for (const inv of real) {
      const d = toDateOnly(inv.due_date)!;
      dueCounts.set(d, (dueCounts.get(d) || 0) + 1);
    }
    for (const [, c] of dueCounts) {
      if (c > 1) problems.add("duplicate_invoice");
    }

    for (const inv of real) {
      const status = String(inv.status || "").toUpperCase();
      if (status === "PARTIAL") {
        problems.add("partial_invoice_ignored_by_baseline");
      }
      const recordedLateFee = money(inv.amount_late);
      const rentAmount =
        money(inv.amount_rent) ||
        Math.max(0, money(inv.amount_total) - recordedLateFee);
      const amountTotal = money(inv.amount_total) || rentAmount + recordedLateFee;
      const amountPaid = money(inv.amount_paid);
      // PAID keeps historical obligation (amountTotal / capacity) but not current debt.
      const openingBalance =
        status === "PAID"
          ? 0
          : Math.max(0, round2(amountTotal - amountPaid));
      obligations.push({
        key: `inv:${inv.id}`,
        source: "real_invoice",
        leaseId: lease.id,
        dueDate: toDateOnly(inv.due_date)!,
        periodStart: toDateOnly(inv.period_start),
        periodEnd: toDateOnly(inv.period_end),
        rentAmount,
        recordedLateFee,
        amountTotal,
        historicalCapacityRemaining: amountTotal,
        allocated: 0,
        balance: openingBalance,
        invoiceId: inv.id,
        invoiceStatus: inv.status,
      });
    }

    // Expected / holdover preview rules
    const allowExpected = continuity.allowExpectedObligations && !!terms.cadence;
    if (!allowExpected) continue;

    const leaseEnd = toDateOnly(lease.lease_end_date);
    const existingDueDates = real.map((i) => toDateOnly(i.due_date)!);

    if (confirmedHoldover && leaseEnd && leaseEnd < asOf) {
      // During lease term: expected gaps up to lease end
      const duringGaps = buildMissingInvoicePreview({
        leaseStartDate: minStart,
        leaseEndDate: leaseEnd,
        rentCadence: terms.cadence!,
        rentDueDay: terms.rentDueDay ?? 1,
        rentAmount: terms.rent,
        existingDueDates,
        asOfDate: asOf,
      }).filter((g) => g.periodClass === "past" || g.periodClass === "current");

      for (const gap of duringGaps) {
        if (gap.dueDate > leaseEnd) continue;
        problems.add("missing_expected_obligation");
        obligations.push({
          key: `expected:${lease.id}:${gap.dueDate}`,
          source: "expected_preview",
          leaseId: lease.id,
          dueDate: gap.dueDate,
          periodStart: gap.periodStart,
          periodEnd: gap.periodEnd,
          rentAmount: gap.amount,
          recordedLateFee: 0,
          amountTotal: gap.amount,
          historicalCapacityRemaining: 0,
          allocated: 0,
          balance: gap.amount,
        });
      }

      // After lease end through asOf: holdover continuation (same rent/cadence)
      const holdoverGaps = buildMissingInvoicePreview({
        leaseStartDate: minStart,
        leaseEndDate: asOf,
        rentCadence: terms.cadence!,
        rentDueDay: terms.rentDueDay ?? 1,
        rentAmount: terms.rent,
        existingDueDates: [
          ...existingDueDates,
          ...duringGaps.map((g) => g.dueDate),
        ],
        asOfDate: asOf,
      }).filter(
        (g) =>
          (g.periodClass === "past" || g.periodClass === "current") &&
          g.dueDate > leaseEnd,
      );

      for (const gap of holdoverGaps) {
        problems.add("missing_expected_obligation");
        obligations.push({
          key: `holdover:${lease.id}:${gap.dueDate}`,
          source: "holdover_preview",
          leaseId: lease.id,
          dueDate: gap.dueDate,
          periodStart: gap.periodStart,
          periodEnd: gap.periodEnd,
          rentAmount: gap.amount,
          recordedLateFee: 0,
          amountTotal: gap.amount,
          historicalCapacityRemaining: 0,
          allocated: 0,
          balance: gap.amount,
        });
      }
      continue;
    }

    // Standard current: forward from last real invoice only; period-dedup;
    // never generate through far lease end (cap at asOf / cutoff).
    let endForPreview: string = asOf;
    if (leaseEnd && leaseEnd < asOf) {
      endForPreview = leaseEnd;
    }
    if (continuity.obligationCutoffDate) {
      endForPreview = continuity.obligationCutoffDate;
    }

    const analysis = analyzeMissingObligations({
      leaseId: lease.id,
      leaseStartDate: minStart,
      leaseEndDate: endForPreview,
      rent: terms.rent,
      rentCadence: terms.cadence!,
      rentDueDay: terms.rentDueDay ?? 1,
      invoices: real,
      payments: [],
      asOfDate: asOf,
      scheduleEndDate: endForPreview,
    });

    for (const gap of analysis.proposedMissing) {
      if (
        continuity.obligationCutoffDate &&
        gap.dueDate > continuity.obligationCutoffDate
      ) {
        continue;
      }
      problems.add("missing_expected_obligation");
      obligations.push({
        key: `expected:${lease.id}:${gap.dueDate}`,
        source: "expected_preview",
        leaseId: lease.id,
        dueDate: gap.dueDate,
        periodStart: gap.periodStart,
        periodEnd: gap.periodEnd,
        rentAmount: gap.rentAmount,
        recordedLateFee: 0,
        amountTotal: gap.rentAmount,
        historicalCapacityRemaining: 0,
        allocated: 0,
        balance: gap.rentAmount,
      });
    }
  }

  return obligations.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function allocatePayments(args: {
  obligations: CandidateObligation[];
  payments: ShadowPayment[];
  bundle: AccountBundle;
  invoiceById: Map<string, ShadowInvoice>;
  leaseToAccount: Map<string, string>;
  allBundles: AccountBundle[];
  problems: Set<DataProblemCode>;
  creditEffectiveDate: string | null;
  continuity: ReturnType<typeof resolveContinuityRule>;
}): {
  allocations: PaymentAllocationShadow[];
  linkedAmount: number;
  unlinkedAmount: number;
  historicalExcessPayment: number;
  forwardCredit: number;
  paymentsReceived: number;
  ambiguous: boolean;
  excessByReason: ExcessReasonBreakdown;
  settledHistoricalAmount: number;
} {
  const {
    obligations,
    payments,
    bundle,
    invoiceById,
    leaseToAccount,
    problems,
    creditEffectiveDate,
    continuity,
  } = args;

  const allocations: PaymentAllocationShadow[] = [];
  let linkedAmount = 0;
  let unlinkedAmount = 0;
  let historicalExcessPayment = 0;
  let forwardCredit = 0;
  let ambiguous = false;
  let settledHistoricalAmount = 0;
  const excessByReason = emptyExcessReasons();
  const seenPaymentIds = new Set<string>();

  // Deduplicate if any accidental repeats in the exclusive list
  const uniquePays: ShadowPayment[] = [];
  for (const p of payments) {
    if (seenPaymentIds.has(p.id)) {
      // Second copy must not re-enter totals; flag for cleanup only.
      excessByReason.data_cleanup_required = round2(
        excessByReason.data_cleanup_required + 0,
      );
      problems.add("data_cleanup_required");
      continue;
    }
    seenPaymentIds.add(p.id);
    uniquePays.push(p);
  }

  const sortedPayments = [...uniquePays].sort((a, b) => {
    const da = toDateOnly(a.payment_date) || "";
    const db = toDateOnly(b.payment_date) || "";
    if (da !== db) return da.localeCompare(db);
    return a.id.localeCompare(b.id);
  });

  const paymentsReceived = round2(
    sortedPayments.reduce((s, p) => s + money(p.amount), 0),
  );

  const hasUnapprovedMissing = obligations.some(
    (o) => o.source === "expected_preview",
  );
  const hasUnapprovedHoldover = obligations.some(
    (o) => o.source === "holdover_preview",
  );
  const latestLease = bundle.leases[bundle.leases.length - 1];

  const applyToOldest = (
    payment: ShadowPayment,
    amount: number,
    source: PaymentAllocationShadow["source"],
    opts?: {
      leaseFilter?: string;
      maxDueDate?: string | null;
      sources?: Array<CandidateObligation["source"]>;
    },
  ): { remaining: number; applied: number } => {
    let remaining = amount;
    let applied = 0;
    // Spillover uses current debt only — never other invoices' historical capacity.
    const targets = obligations
      .filter((o) => o.balance > 0.0001)
      .filter((o) => !opts?.leaseFilter || o.leaseId === opts.leaseFilter)
      .filter((o) => !opts?.maxDueDate || o.dueDate <= opts.maxDueDate)
      .filter((o) => !opts?.sources || opts.sources.includes(o.source))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    for (const o of targets) {
      if (remaining <= 0) break;
      const use = Math.min(o.balance, remaining);
      o.allocated = round2(o.allocated + use);
      o.balance = round2(Math.max(0, o.balance - use));
      // Keep capacity in sync when current debt is paid from spillover.
      if (o.source === "real_invoice") {
        o.historicalCapacityRemaining = round2(
          Math.max(0, o.historicalCapacityRemaining - use),
        );
      }
      remaining = round2(remaining - use);
      applied = round2(applied + use);
      allocations.push({
        paymentId: payment.id,
        obligationKey: o.key,
        amount: use,
        source,
      });
    }
    return { remaining, applied };
  };

  const applyToLinkedInvoice = (
    payment: ShadowPayment,
    ob: CandidateObligation,
    amount: number,
  ): { remaining: number; applied: number } => {
    let remaining = amount;
    let applied = 0;
    // Historical obligation = amount_total capacity (status must not erase it).
    const capUse = Math.min(ob.historicalCapacityRemaining, remaining);
    if (capUse > 0) {
      ob.historicalCapacityRemaining = round2(
        Math.max(0, ob.historicalCapacityRemaining - capUse),
      );
      ob.allocated = round2(ob.allocated + capUse);
      // Current debt only when balance > 0 (PAID stays 0).
      ob.balance = round2(Math.max(0, ob.balance - capUse));
      remaining = round2(remaining - capUse);
      applied = round2(applied + capUse);
      allocations.push({
        paymentId: payment.id,
        obligationKey: ob.key,
        amount: capUse,
        source: "invoice_id",
      });
    }
    return { remaining, applied };
  };

  const addExcess = (
    payment: ShadowPayment,
    remaining: number,
    reason: HistoricalExcessReason,
  ) => {
    if (remaining <= 0) return;
    historicalExcessPayment = round2(historicalExcessPayment + remaining);
    excessByReason[reason] = round2(excessByReason[reason] + remaining);
  };

  for (const payment of sortedPayments) {
    const paymentAmount = money(payment.amount);
    let remaining = paymentAmount;
    let allocatedThisPayment = 0;
    const payDate = toDateOnly(payment.payment_date) || "";
    let settledAgainstPaidInvoice = false;
    let invoiceValid: boolean | null = null;
    let linkedToVoidInvoice = false;
    let allocatedToReal = 0;
    let allocationMismatch = false;

    const preCutoverMaxDue =
      creditEffectiveDate && payDate && payDate < creditEffectiveDate
        ? (() => {
            const d = new Date(creditEffectiveDate + "T12:00:00");
            d.setDate(d.getDate() - 1);
            return d.toISOString().slice(0, 10);
          })()
        : null;

    const applyOpts = preCutoverMaxDue
      ? { maxDueDate: preCutoverMaxDue as string }
      : {};

    if (payment.invoice_id) {
      invoiceValid = invoiceById.has(payment.invoice_id);
      if (invoiceValid) {
        const inv = invoiceById.get(payment.invoice_id)!;
        const status = String(inv.status || "").toUpperCase();
        const invDue = toDateOnly(inv.due_date);
        const invAllowed =
          !preCutoverMaxDue || (invDue && invDue <= preCutoverMaxDue);

        if (status === "VOID") {
          linkedToVoidInvoice = true;
          problems.add("unlinked_payment");
          // VOID creates no obligation; try other real capacity, then flag.
          const r = applyToOldest(payment, remaining, "credit_forward", {
            ...applyOpts,
            sources: ["real_invoice"],
          });
          remaining = r.remaining;
          allocatedThisPayment = round2(allocatedThisPayment + r.applied);
          allocatedToReal = round2(allocatedToReal + r.applied);
          linkedAmount = round2(linkedAmount + r.applied);
        } else {
          const ob = obligations.find((o) => o.invoiceId === inv.id);
          if (ob && remaining > 0 && invAllowed) {
            const beforeCap = ob.historicalCapacityRemaining;
            const r = applyToLinkedInvoice(payment, ob, remaining);
            remaining = r.remaining;
            allocatedThisPayment = round2(allocatedThisPayment + r.applied);
            allocatedToReal = round2(allocatedToReal + r.applied);
            linkedAmount = round2(linkedAmount + r.applied);
            if (r.applied > 0) {
              settledAgainstPaidInvoice =
                status === "PAID" || settledAgainstPaidInvoice;
              settledHistoricalAmount = round2(
                settledHistoricalAmount + Math.min(r.applied, beforeCap),
              );
            }
            if (status === "PAID") {
              settledAgainstPaidInvoice = true;
            }
          } else if (ob && status === "PAID") {
            settledAgainstPaidInvoice = true;
          }

          if (remaining > 0) {
            // Leftover after settling a PAID/historical linked invoice must not
            // reduce later current obligations unless forward-credit cutover is set.
            const maySpillToLater =
              !settledAgainstPaidInvoice ||
              (!!creditEffectiveDate &&
                !!payDate &&
                payDate >= creditEffectiveDate);
            if (maySpillToLater) {
              const r = applyToOldest(payment, remaining, "credit_forward", {
                ...applyOpts,
                sources: ["real_invoice"],
              });
              remaining = r.remaining;
              allocatedThisPayment = round2(allocatedThisPayment + r.applied);
              allocatedToReal = round2(allocatedToReal + r.applied);
              linkedAmount = round2(linkedAmount + r.applied);
            }
          }
          if (
            remaining > 0 &&
            continuity.allowExpectedObligations &&
            (!settledAgainstPaidInvoice ||
              (!!creditEffectiveDate &&
                !!payDate &&
                payDate >= creditEffectiveDate))
          ) {
            const r = applyToOldest(payment, remaining, "credit_forward", {
              ...applyOpts,
              sources: ["expected_preview", "holdover_preview"],
            });
            remaining = r.remaining;
            allocatedThisPayment = round2(allocatedThisPayment + r.applied);
            linkedAmount = round2(linkedAmount + r.applied);
          }
        }
      } else {
        // missing invoice id
        problems.add("unlinked_payment");
        allocationMismatch = true;
        unlinkedAmount = round2(unlinkedAmount + remaining);
        const r = applyToOldest(payment, remaining, "lease_id", {
          ...applyOpts,
          sources: ["real_invoice"],
        });
        remaining = r.remaining;
        allocatedThisPayment = round2(allocatedThisPayment + r.applied);
        linkedAmount = round2(linkedAmount + r.applied);
      }
    } else if (payment.lease_id && leaseToAccount.has(payment.lease_id)) {
      problems.add("unlinked_payment");
      allocationMismatch = true;
      const before = remaining;
      const r1 = applyToOldest(payment, remaining, "lease_id", {
        ...applyOpts,
        leaseFilter: payment.lease_id,
        sources: ["real_invoice"],
      });
      remaining = r1.remaining;
      let applied = r1.applied;
      if (remaining > 0) {
        const r2 = applyToOldest(payment, remaining, "lease_id", {
          ...applyOpts,
          sources: ["real_invoice"],
        });
        remaining = r2.remaining;
        applied = round2(applied + r2.applied);
      }
      if (remaining > 0 && continuity.allowExpectedObligations) {
        const r3 = applyToOldest(payment, remaining, "lease_id", applyOpts);
        remaining = r3.remaining;
        applied = round2(applied + r3.applied);
      }
      allocatedThisPayment = round2(allocatedThisPayment + applied);
      linkedAmount = round2(linkedAmount + applied);
      unlinkedAmount = round2(unlinkedAmount + before);
    } else if (
      payment.tenant_id === bundle.tenantId &&
      payment.property_id === bundle.propertyId
    ) {
      problems.add("unlinked_payment");
      allocationMismatch = true;
      const before = remaining;
      const r = applyToOldest(payment, remaining, "tenant_property", {
        ...applyOpts,
        sources: ["real_invoice"],
      });
      remaining = r.remaining;
      if (remaining > 0 && continuity.allowExpectedObligations) {
        const r2 = applyToOldest(payment, remaining, "tenant_property", applyOpts);
        remaining = r2.remaining;
        allocatedThisPayment = round2(
          allocatedThisPayment + r.applied + r2.applied,
        );
        linkedAmount = round2(linkedAmount + r.applied + r2.applied);
      } else {
        allocatedThisPayment = round2(allocatedThisPayment + r.applied);
        linkedAmount = round2(linkedAmount + r.applied);
      }
      unlinkedAmount = round2(unlinkedAmount + before);
    } else {
      ambiguous = true;
      problems.add("ambiguous_payment");
      addExcess(payment, remaining, "account_mapping_problem");
      remaining = 0;
      allocatedThisPayment = paymentAmount;
    }

    // Invariant: allocated + remaining == payment amount
    const check = round2(allocatedThisPayment + remaining);
    if (Math.abs(check - paymentAmount) > 0.009) {
      throw new Error(
        `Invariant3 violated for payment ${payment.id}: allocated ${allocatedThisPayment} + remaining ${remaining} != ${paymentAmount}`,
      );
    }
    if (allocatedThisPayment - paymentAmount > 0.009) {
      throw new Error(
        `Invariant2 violated for payment ${payment.id}: allocated exceeds amount`,
      );
    }

    if (remaining > 0) {
      if (!creditEffectiveDate || payDate < (creditEffectiveDate || "")) {
        if (continuity.decisionType === "lease_never_effective") {
          addExcess(payment, remaining, "miscellaneous_or_non_rent_income");
        } else {
          const reason = classifyHistoricalExcessReason({
            payment,
            remaining,
            allocatedToReal,
            hasUnapprovedMissing:
              (hasUnapprovedMissing && !continuity.allowExpectedObligations) ||
              (hasUnapprovedMissing &&
                continuity.classification === "closed") ||
              (!continuity.allowExpectedObligations &&
                continuity.classification === "current" &&
                false),
            hasUnapprovedHoldover:
              hasUnapprovedHoldover && !continuity.allowHoldoverContinuation,
            continuityClassification: continuity.classification,
            obligationCutoffDate: continuity.obligationCutoffDate,
            obligationStartDate: continuity.obligationStartDate,
            invoiceValid,
            linkedToVoidInvoice,
            leaseStatus: latestLease?.status || null,
            settledAgainstPaidInvoice,
            allocationMismatch,
            isMiscellaneousIncome:
              continuity.decisionType === "lease_never_effective",
          });
          addExcess(payment, remaining, reason);
        }
      } else {
        forwardCredit = round2(forwardCredit + remaining);
      }
    }
  }

  if (forwardCredit > 0.0001 && creditEffectiveDate) {
    let remainingCredit = forwardCredit;
    const targets = obligations
      .filter((o) => o.balance > 0.0001)
      .filter((o) => o.dueDate >= creditEffectiveDate)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    for (const o of targets) {
      if (remainingCredit <= 0) break;
      const applied = Math.min(o.balance, remainingCredit);
      o.allocated = round2(o.allocated + applied);
      o.balance = round2(Math.max(0, o.balance - applied));
      remainingCredit = round2(remainingCredit - applied);
      allocations.push({
        paymentId: `forward-credit:${bundle.accountKey}`,
        obligationKey: o.key,
        amount: applied,
        source: "credit_forward",
      });
      linkedAmount = round2(linkedAmount + applied);
    }
    forwardCredit = remainingCredit;
  }

  return {
    allocations,
    linkedAmount,
    unlinkedAmount,
    historicalExcessPayment,
    forwardCredit,
    paymentsReceived,
    ambiguous,
    excessByReason,
    settledHistoricalAmount,
  };
}
