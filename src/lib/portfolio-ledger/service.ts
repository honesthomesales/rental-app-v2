/**
 * Portfolio Ledger — authoritative server-side financial facts.
 * Version identifier lets every screen report which calc produced totals.
 *
 * Allocation truth (production-compatible): RENT_payments.invoice_id direct links.
 * Do not invent RENT_payment_allocations.
 *
 * Current tenant balance baseline: Payments page / calculateUnpaidInvoices
 * (OPEN invoices with due_date <= business date and positive recalculated balance).
 */

import {
  isPaymentEligibleAsOf,
  partitionPaymentsByAsOf,
} from "@/lib/payment-eligibility";
import { isPastGrace, LATE_FEE_GRACE_DAYS } from "@/lib/late-fees/rules";
import {
  analyzeLeaseCadence,
  inferInvoiceCadence,
} from "@/lib/invoice-cadence";

export const PORTFOLIO_LEDGER_VERSION = "portfolio-ledger-v1";

export function roundMoney(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function toDateOnly(iso: string | null | undefined): string {
  return String(iso || "").split("T")[0];
}

export type LedgerLease = {
  id: string;
  property_id: string;
  tenant_id: string;
  status: string;
  rent: number;
  rent_cadence?: string | null;
  cadence_effective_date?: string | null;
  prior_rent_cadence?: string | null;
  rent_due_day?: number | null;
  lease_start_date?: string | null;
  lease_end_date?: string | null;
  rent_effective_date?: string | null;
  prior_rent?: number | null;
  late_fee_amount?: number | null;
  grace_days?: number | null;
  property_name?: string | null;
  tenant_name?: string | null;
  property?: Record<string, unknown> | null;
  tenant?: Record<string, unknown> | null;
};

export type LedgerInvoice = {
  id: string;
  lease_id: string;
  due_date: string;
  period_start?: string | null;
  period_end?: string | null;
  status: string;
  amount_rent: number;
  amount_late: number;
  amount_other: number;
  amount_total: number;
  amount_paid?: number;
  balance_due?: number;
  late_fee_waived?: boolean;
  rent_cadence?: string | null;
  created_at?: string | null;
};

export type LedgerPayment = {
  id: string;
  lease_id: string;
  invoice_id: string | null;
  payment_date: string;
  amount: number;
  status?: string | null;
  payment_method?: string | null;
};

export type InvoiceCollectionStatus =
  | "future"
  | "current"
  | "partial"
  | "paid"
  | "past_due"
  | "void"
  | "credit"
  | "manual_review";

export type LedgerInvoiceDetail = {
  invoiceId: string;
  dueDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  storedStatus: string;
  storedRent: number;
  storedLateFee: number;
  storedOtherCharges: number;
  cadence: string;
  lateFeeWaived: boolean;
  cadenceException: boolean;
  cadenceExceptionReasons: string[];
  calculatedTotal: number;
  eligiblePaidAmount: number;
  calculatedBalance: number;
  rentBalance: number;
  lateFeeBalance: number;
  otherChargeBalance: number;
  collectionStatus: InvoiceCollectionStatus;
  isFuture: boolean;
};

export type LedgerPaymentDetail = {
  paymentId: string;
  paymentDate: string;
  amount: number;
  status: string;
  paymentMethod: string | null;
  invoiceId: string | null;
  eligible: boolean;
  allocatedAmount: number;
  unallocatedAmount: number;
};

export type LedgerAccountSummary = {
  ledgerVersion: string;
  asOfDate: string;
  propertyId: string;
  propertyName: string;
  tenantId: string;
  tenantName: string;
  leaseId: string;
  leaseStatus: string;
  cadence: string;
  currentRent: number;
  rentEffectiveDate: string | null;
  priorRent: number | null;
  /** Payments-page baseline total owed (OPEN + positive balance, due <= asOf). */
  totalBalanceDue: number;
  unpaidInvoiceCount: number;
  /** Count of current invoices that are past the 5-day grace window. */
  pastDueInvoiceCount: number;
  /** Sum of balances for past-due invoices only (excludes within-grace unpaid). */
  pastDueBalanceDue: number;
  rentBalance: number;
  lateFeeBalance: number;
  otherChargeBalance: number;
  futureScheduledCharges: number;
  eligibleUnappliedCredit: number;
  lastEligiblePositivePaymentDate: string | null;
  oldestUnpaidDueDate: string | null;
  daysLate: number | null;
  collectionStatus: string;
  invoices: LedgerInvoiceDetail[];
  payments: LedgerPaymentDetail[];
  eligiblePayments: LedgerPaymentDetail[];
  futureOrIneligiblePayments: LedgerPaymentDetail[];
  allocatedPayments: LedgerPaymentDetail[];
  unallocatedPayments: LedgerPaymentDetail[];
  propertyTotalCollected: number;
  exceptionFlags: string[];
};

export type CollectionsSummaryRow = {
  leaseId: string;
  propertyId: string;
  propertyName: string;
  propertyAddress: string;
  tenantId: string;
  tenantName: string;
  leaseStatus: string;
  cadence: string;
  currentRent: number;
  leaseStartDate: string | null;
  totalOwed: number;
  rentBalance: number;
  lateFeeBalance: number;
  otherChargeBalance: number;
  unpaidInvoicesCount: number;
  pastDueInvoicesCount: number;
  pastDueBalanceDue: number;
  lastPaidDate: string | null;
  oldestUnpaidDueDate: string | null;
  daysLate: number | null;
  collectionStatus: string;
  propertyTotalCollected: number;
  /** Nested objects for existing Payments UI consumers */
  lease: Record<string, unknown>;
  property: Record<string, unknown>;
  tenant: Record<string, unknown>;
};

function daysBetween(earlier: string, later: string): number {
  const a = new Date(earlier + "T12:00:00").getTime();
  const b = new Date(later + "T12:00:00").getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

function classifyInvoice(
  inv: LedgerInvoiceDetail,
  asOf: string,
): InvoiceCollectionStatus {
  if (inv.storedStatus === "VOID") return "void";
  if (inv.storedStatus === "PAID") return "paid";
  if (inv.cadenceException) return "manual_review";
  if (inv.isFuture) return "future";
  if (inv.calculatedBalance < -0.009) return "credit";
  if (inv.calculatedBalance <= 0.009) return "paid";
  if (
    isPastGrace({
      dueDate: inv.dueDate,
      graceDays: LATE_FEE_GRACE_DAYS,
      businessDate: asOf,
    })
  ) {
    return "past_due";
  }
  if (inv.eligiblePaidAmount > 0.009) return "partial";
  return "current";
}

/**
 * Build one lease account ledger as of a New York business date.
 */
export function buildAccountLedger(args: {
  lease: LedgerLease;
  invoices: LedgerInvoice[];
  payments: LedgerPayment[];
  asOfDate: string;
}): LedgerAccountSummary {
  const asOf = toDateOnly(args.asOfDate);
  const lease = args.lease;
  const completedPositive = args.payments.filter(
    (payment) =>
      String(payment.status || "completed").toLowerCase() === "completed" &&
      Number(payment.amount) > 0,
  );
  const { eligible, excludedFuture } = partitionPaymentsByAsOf(
    completedPositive,
    asOf,
  );

  const paidByInvoice = new Map<string, number>();
  for (const p of eligible) {
    if (!p.invoice_id) continue;
    paidByInvoice.set(
      p.invoice_id,
      roundMoney((paidByInvoice.get(p.invoice_id) || 0) + (Number(p.amount) || 0)),
    );
  }
  const paymentInvoiceIds = new Set(
    args.payments
      .filter((payment) => payment.invoice_id)
      .map((payment) => String(payment.invoice_id)),
  );
  const cadenceAudit = analyzeLeaseCadence({
    currentCadence: lease.rent_cadence,
    cadenceEffectiveDate: lease.cadence_effective_date,
    invoices: args.invoices,
    paymentInvoiceIds,
  });
  const cadenceExceptionById = new Map(
    cadenceAudit.exceptions.map((exception) => [
      exception.invoiceId,
      exception,
    ]),
  );

  const invoiceDetails: LedgerInvoiceDetail[] = args.invoices
    .filter((inv) => String(inv.status || "").toUpperCase() !== "VOID")
    .map((inv) => {
      const dueDate = toDateOnly(inv.due_date);
      const isFuture = dueDate > asOf;
      const storedRent = roundMoney(Number(inv.amount_rent) || 0);
      const storedLateFee = roundMoney(Number(inv.amount_late) || 0);
      const storedOtherCharges = roundMoney(Number(inv.amount_other) || 0);
      const calculatedTotal = roundMoney(
        storedRent + storedLateFee + storedOtherCharges,
      );
      const eligiblePaidAmount = paidByInvoice.get(inv.id) || 0;
      const calculatedBalance = roundMoney(calculatedTotal - eligiblePaidAmount);
      let remainingPaid = Math.max(0, eligiblePaidAmount);
      const paidToLate = Math.min(remainingPaid, storedLateFee);
      remainingPaid = roundMoney(remainingPaid - paidToLate);
      const paidToRent = Math.min(remainingPaid, storedRent);
      remainingPaid = roundMoney(remainingPaid - paidToRent);
      const paidToOther = Math.min(remainingPaid, storedOtherCharges);
      const cadenceException = cadenceExceptionById.get(inv.id);
      const draft: LedgerInvoiceDetail = {
        invoiceId: inv.id,
        dueDate,
        periodStart: inv.period_start ? toDateOnly(inv.period_start) : null,
        periodEnd: inv.period_end ? toDateOnly(inv.period_end) : null,
        storedStatus: String(inv.status || "OPEN").toUpperCase(),
        storedRent,
        storedLateFee,
        storedOtherCharges,
        cadence:
          inv.rent_cadence ||
          inferInvoiceCadence(inv) ||
          String(lease.rent_cadence || "monthly"),
        lateFeeWaived: Boolean(inv.late_fee_waived),
        cadenceException: Boolean(cadenceException),
        cadenceExceptionReasons: cadenceException?.reasons || [],
        calculatedTotal,
        eligiblePaidAmount,
        calculatedBalance,
        rentBalance: roundMoney(Math.max(0, storedRent - paidToRent)),
        lateFeeBalance: roundMoney(Math.max(0, storedLateFee - paidToLate)),
        otherChargeBalance: roundMoney(
          Math.max(0, storedOtherCharges - paidToOther),
        ),
        collectionStatus: "current",
        isFuture,
      };
      draft.collectionStatus = classifyInvoice(draft, asOf);
      return draft;
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const currentInvoices = invoiceDetails.filter((i) => !i.isFuture);
  const futureInvoices = invoiceDetails.filter((i) => i.isFuture);
  const collectibleCurrent = currentInvoices.filter(
    (invoice) =>
      (invoice.storedStatus === "OPEN" || invoice.storedStatus === "PARTIAL") &&
      invoice.calculatedBalance > 0.009,
  );
  const totalBalanceDue = roundMoney(
    collectibleCurrent.reduce(
      (sum, invoice) => sum + invoice.calculatedBalance,
      0,
    ),
  );
  const rentBalance = roundMoney(
    collectibleCurrent.reduce((sum, invoice) => sum + invoice.rentBalance, 0),
  );
  const lateFeeBalance = roundMoney(
    collectibleCurrent.reduce(
      (sum, invoice) => sum + invoice.lateFeeBalance,
      0,
    ),
  );
  const otherChargeBalance = roundMoney(
    collectibleCurrent.reduce(
      (sum, invoice) => sum + invoice.otherChargeBalance,
      0,
    ),
  );

  const futureScheduledCharges = roundMoney(
    futureInvoices.reduce((s, i) => s + Math.max(0, i.calculatedBalance), 0),
  );

  const positiveEligible = eligible.filter((p) => Number(p.amount) > 0);
  let lastEligiblePositivePaymentDate: string | null = null;
  for (const p of positiveEligible) {
    const pd = toDateOnly(p.payment_date);
    if (!lastEligiblePositivePaymentDate || pd > lastEligiblePositivePaymentDate) {
      lastEligiblePositivePaymentDate = pd;
    }
  }

  const unpaidDueDates = collectibleCurrent
    .map((invoice) => invoice.dueDate)
    .sort();
  const overdueInvoices = collectibleCurrent.filter(
    (invoice) => invoice.collectionStatus === "past_due",
  );
  const overdueUnpaid = overdueInvoices.map((invoice) => invoice.dueDate).sort();
  const oldestUnpaidDueDate = unpaidDueDates[0] || null;
  const oldestLateDueDate = overdueUnpaid[0] || null;
  const daysLate =
    oldestLateDueDate != null ? daysBetween(oldestLateDueDate, asOf) : null;
  const pastDueBalanceDue = roundMoney(
    overdueInvoices.reduce(
      (sum, invoice) => sum + Math.max(0, invoice.calculatedBalance),
      0,
    ),
  );

  const remainingInvoiceCapacity = new Map(
    invoiceDetails.map((invoice) => [
      invoice.invoiceId,
      Math.max(0, invoice.calculatedTotal),
    ]),
  );
  const orderedPayments = [...args.payments].sort((a, b) => {
    const byDate = toDateOnly(a.payment_date).localeCompare(
      toDateOnly(b.payment_date),
    );
    return byDate || a.id.localeCompare(b.id);
  });
  const paymentDetails: LedgerPaymentDetail[] = orderedPayments.map((p) => {
    const amount = roundMoney(Number(p.amount) || 0);
    const completed =
      String(p.status || "completed").toLowerCase() === "completed";
    const eligibleFlag =
      completed && amount > 0 && isPaymentEligibleAsOf(p, asOf);
    let allocated = 0;
    let unallocated = 0;
    if (eligibleFlag && p.invoice_id) {
      const capacity = remainingInvoiceCapacity.get(p.invoice_id) || 0;
      allocated = roundMoney(Math.min(amount, capacity));
      unallocated = roundMoney(Math.max(0, amount - allocated));
      remainingInvoiceCapacity.set(
        p.invoice_id,
        roundMoney(Math.max(0, capacity - allocated)),
      );
    } else if (eligibleFlag) {
      unallocated = amount;
    }
    return {
      paymentId: p.id,
      paymentDate: toDateOnly(p.payment_date),
      amount,
      status: String(p.status || "completed"),
      paymentMethod: p.payment_method ? String(p.payment_method) : null,
      invoiceId: p.invoice_id,
      eligible: eligibleFlag,
      allocatedAmount: allocated,
      unallocatedAmount: unallocated,
    };
  });
  const totalUnallocatedEligible = roundMoney(
    paymentDetails.reduce(
      (sum, payment) => sum + payment.unallocatedAmount,
      0,
    ),
  );

  const exceptionFlags: string[] = [];
  if (excludedFuture.length > 0) exceptionFlags.push("has_future_dated_payments");
  if (totalUnallocatedEligible > 0.009) {
    exceptionFlags.push("unapplied_eligible_credit");
  }
  if (cadenceAudit.exceptions.length > 0) {
    exceptionFlags.push("cadence_review_required");
  }

  return {
    ledgerVersion: PORTFOLIO_LEDGER_VERSION,
    asOfDate: asOf,
    propertyId: lease.property_id,
    propertyName: lease.property_name || "",
    tenantId: lease.tenant_id,
    tenantName: lease.tenant_name || "",
    leaseId: lease.id,
    leaseStatus: String(lease.status || ""),
    cadence: String(lease.rent_cadence || "monthly"),
    currentRent: roundMoney(Number(lease.rent) || 0),
    rentEffectiveDate: lease.rent_effective_date
      ? toDateOnly(lease.rent_effective_date)
      : null,
    priorRent:
      lease.prior_rent != null ? roundMoney(Number(lease.prior_rent)) : null,
    totalBalanceDue,
    unpaidInvoiceCount: collectibleCurrent.length,
    pastDueInvoiceCount: overdueInvoices.length,
    pastDueBalanceDue,
    rentBalance,
    lateFeeBalance,
    otherChargeBalance,
    futureScheduledCharges,
    eligibleUnappliedCredit: totalUnallocatedEligible,
    lastEligiblePositivePaymentDate,
    oldestUnpaidDueDate,
    daysLate,
    collectionStatus:
      totalBalanceDue > 0.009
        ? daysLate != null
          ? "past_due"
          : "balance_due"
        : "current",
    invoices: invoiceDetails,
    payments: paymentDetails,
    eligiblePayments: paymentDetails.filter((payment) => payment.eligible),
    futureOrIneligiblePayments: paymentDetails.filter(
      (payment) => !payment.eligible,
    ),
    allocatedPayments: paymentDetails.filter(
      (payment) => payment.allocatedAmount > 0,
    ),
    unallocatedPayments: paymentDetails.filter(
      (payment) => payment.unallocatedAmount > 0,
    ),
    propertyTotalCollected: roundMoney(
      paymentDetails.reduce(
        (sum, payment) => sum + payment.allocatedAmount,
        0,
      ),
    ),
    exceptionFlags,
  };
}

export function toCollectionsSummaryRow(
  account: LedgerAccountSummary,
  lease?: LedgerLease,
): CollectionsSummaryRow {
  const property = (lease?.property || {}) as Record<string, unknown>;
  const tenant = (lease?.tenant || {}) as Record<string, unknown>;
  const propertyAddress =
    String(property.address || account.propertyName || "");
  return {
    leaseId: account.leaseId,
    propertyId: account.propertyId,
    propertyName: account.propertyName,
    propertyAddress,
    tenantId: account.tenantId,
    tenantName: account.tenantName,
    leaseStatus: account.leaseStatus,
    cadence: account.cadence,
    currentRent: account.currentRent,
    leaseStartDate: lease?.lease_start_date
      ? toDateOnly(lease.lease_start_date)
      : null,
    totalOwed: account.totalBalanceDue,
    rentBalance: account.rentBalance,
    lateFeeBalance: account.lateFeeBalance,
    otherChargeBalance: account.otherChargeBalance,
    unpaidInvoicesCount: account.unpaidInvoiceCount,
    pastDueInvoicesCount: account.pastDueInvoiceCount,
    pastDueBalanceDue: account.pastDueBalanceDue,
    lastPaidDate: account.lastEligiblePositivePaymentDate,
    oldestUnpaidDueDate: account.oldestUnpaidDueDate,
    daysLate: account.daysLate,
    collectionStatus: account.collectionStatus,
    propertyTotalCollected: account.propertyTotalCollected,
    lease: {
      id: account.leaseId,
      status: account.leaseStatus,
      rent: account.currentRent,
      rent_cadence: account.cadence,
      property_id: account.propertyId,
      tenant_id: account.tenantId,
      lease_start_date: lease?.lease_start_date || null,
      lease_end_date: lease?.lease_end_date || null,
      RENT_properties: property,
      RENT_tenants: tenant,
    },
    property: {
      id: account.propertyId,
      name: account.propertyName,
      address: propertyAddress,
      ...property,
    },
    tenant: {
      id: account.tenantId,
      full_name: account.tenantName,
      ...tenant,
    },
  };
}

/**
 * Build collections rows for many leases from batched invoice/payment maps.
 */
export function buildCollectionsSummary(args: {
  leases: LedgerLease[];
  invoicesByLease: Map<string, LedgerInvoice[]>;
  paymentsByLease: Map<string, LedgerPayment[]>;
  asOfDate: string;
}): {
  ledgerVersion: string;
  asOfDate: string;
  rows: CollectionsSummaryRow[];
  totalOwed: number;
} {
  const asOf = toDateOnly(args.asOfDate);
  const rows: CollectionsSummaryRow[] = [];
  for (const lease of args.leases) {
    const account = buildAccountLedger({
      lease,
      invoices: args.invoicesByLease.get(lease.id) || [],
      payments: args.paymentsByLease.get(lease.id) || [],
      asOfDate: asOf,
    });
    rows.push(toCollectionsSummaryRow(account, lease));
  }
  rows.sort((a, b) => b.totalOwed - a.totalOwed);
  return {
    ledgerVersion: PORTFOLIO_LEDGER_VERSION,
    asOfDate: asOf,
    rows,
    totalOwed: roundMoney(rows.reduce((s, r) => s + r.totalOwed, 0)),
  };
}

/** Profit attribution: eligible payments belong to the invoice due month. */
export function buildDueMonthCollectionFacts(args: {
  invoices: Array<{
    id: string;
    property_id?: string | null;
    due_date: string;
    status?: string | null;
  }>;
  payments: LedgerPayment[];
  monthStart: string;
  monthEnd: string;
  asOfDate: string;
}): {
  totalCollected: number;
  collectedByProperty: Map<string, number>;
  eligiblePayments: LedgerPayment[];
} {
  const invoiceById = new Map(
    args.invoices
      .filter(
        (invoice) =>
          toDateOnly(invoice.due_date) >= args.monthStart &&
          toDateOnly(invoice.due_date) <= args.monthEnd &&
          String(invoice.status || "").toUpperCase() !== "VOID",
      )
      .map((invoice) => [invoice.id, invoice]),
  );
  const eligiblePayments = args.payments.filter(
    (payment) =>
      Boolean(payment.invoice_id && invoiceById.has(payment.invoice_id)) &&
      String(payment.status || "completed").toLowerCase() === "completed" &&
      Number(payment.amount) > 0 &&
      isPaymentEligibleAsOf(payment, args.asOfDate),
  );
  const collectedByProperty = new Map<string, number>();
  for (const payment of eligiblePayments) {
    const invoice = invoiceById.get(payment.invoice_id as string);
    const propertyId = String(invoice?.property_id || "");
    if (!propertyId) continue;
    collectedByProperty.set(
      propertyId,
      roundMoney(
        (collectedByProperty.get(propertyId) || 0) + Number(payment.amount),
      ),
    );
  }
  return {
    totalCollected: roundMoney(
      eligiblePayments.reduce(
        (sum, payment) => sum + Number(payment.amount),
        0,
      ),
    ),
    collectedByProperty,
    eligiblePayments,
  };
}
