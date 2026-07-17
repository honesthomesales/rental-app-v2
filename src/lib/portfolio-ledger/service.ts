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

import { calculateUnpaidInvoices } from "@/lib/invoice-calculations";
import {
  isPaymentEligibleAsOf,
  partitionPaymentsByAsOf,
} from "@/lib/payment-eligibility";

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
  lease_start_date?: string | null;
  lease_end_date?: string | null;
  rent_effective_date?: string | null;
  prior_rent?: number | null;
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
  storedRent: number;
  storedLateFee: number;
  storedOtherCharges: number;
  calculatedTotal: number;
  eligiblePaidAmount: number;
  calculatedBalance: number;
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
  unpaidInvoicesCount: number;
  lastPaidDate: string | null;
  oldestUnpaidDueDate: string | null;
  daysLate: number | null;
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
  const status = String(
    // carried separately — use calculated fields
    inv.collectionStatus,
  );
  void status;
  if (inv.isFuture) return "future";
  if (inv.calculatedBalance < -0.009) return "credit";
  if (inv.calculatedBalance <= 0.009) return "paid";
  if (inv.dueDate < asOf) return "past_due";
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
  const { eligible, excludedFuture } = partitionPaymentsByAsOf(
    args.payments,
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
      const draft: LedgerInvoiceDetail = {
        invoiceId: inv.id,
        dueDate,
        periodStart: inv.period_start ? toDateOnly(inv.period_start) : null,
        periodEnd: inv.period_end ? toDateOnly(inv.period_end) : null,
        storedRent,
        storedLateFee,
        storedOtherCharges,
        calculatedTotal,
        eligiblePaidAmount,
        calculatedBalance,
        collectionStatus: "current",
        isFuture,
      };
      draft.collectionStatus = classifyInvoice(draft, asOf);
      if (String(inv.status || "").toUpperCase() === "VOID") {
        draft.collectionStatus = "void";
      }
      return draft;
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const unpaidBaseline = calculateUnpaidInvoices(
    args.invoices as never[],
    args.payments as never[],
    lease.lease_start_date,
    asOf,
  );

  const currentInvoices = invoiceDetails.filter((i) => !i.isFuture);
  const futureInvoices = invoiceDetails.filter((i) => i.isFuture);

  const rentBalance = roundMoney(
    currentInvoices.reduce(
      (s, i) =>
        s +
        Math.max(
          0,
          roundMoney(i.storedRent - Math.min(i.eligiblePaidAmount, i.storedRent)),
        ),
      0,
    ),
  );
  // Simpler component balances for unpaid OPEN baseline invoices
  let lateFeeBalance = 0;
  let otherChargeBalance = 0;
  for (const u of unpaidBaseline.unpaidInvoices) {
    lateFeeBalance += roundMoney(Number(u.amount_late) || 0);
    otherChargeBalance += roundMoney(Number(u.amount_other) || 0);
  }
  lateFeeBalance = roundMoney(lateFeeBalance);
  otherChargeBalance = roundMoney(otherChargeBalance);

  const futureScheduledCharges = roundMoney(
    futureInvoices.reduce((s, i) => s + Math.max(0, i.calculatedBalance), 0),
  );

  const unallocatedEligible = roundMoney(
    eligible
      .filter((p) => !p.invoice_id)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0),
  );

  const positiveEligible = eligible.filter((p) => Number(p.amount) > 0);
  let lastEligiblePositivePaymentDate: string | null = null;
  for (const p of positiveEligible) {
    const pd = toDateOnly(p.payment_date);
    if (!lastEligiblePositivePaymentDate || pd > lastEligiblePositivePaymentDate) {
      lastEligiblePositivePaymentDate = pd;
    }
  }

  const overdueUnpaid = unpaidBaseline.unpaidInvoices
    .map((i) => toDateOnly(i.due_date))
    .filter((d) => d <= asOf)
    .sort();
  const oldestUnpaidDueDate = overdueUnpaid[0] || null;
  const daysLate =
    oldestUnpaidDueDate != null ? daysBetween(oldestUnpaidDueDate, asOf) : null;

  const paymentDetails: LedgerPaymentDetail[] = args.payments.map((p) => {
    const amount = roundMoney(Number(p.amount) || 0);
    const eligibleFlag = isPaymentEligibleAsOf(p, asOf);
    const allocated = p.invoice_id && eligibleFlag ? amount : 0;
    const unallocated =
      !p.invoice_id && eligibleFlag ? amount : eligibleFlag ? 0 : 0;
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

  // Conserve: for invoice-linked eligible payments, allocated === amount
  for (const pd of paymentDetails) {
    if (pd.eligible && pd.invoiceId) {
      pd.allocatedAmount = pd.amount;
      pd.unallocatedAmount = 0;
    } else if (pd.eligible && !pd.invoiceId) {
      pd.allocatedAmount = 0;
      pd.unallocatedAmount = pd.amount;
    } else {
      pd.allocatedAmount = 0;
      pd.unallocatedAmount = 0;
    }
  }

  const exceptionFlags: string[] = [];
  if (excludedFuture.length > 0) exceptionFlags.push("has_future_dated_payments");
  if (unallocatedEligible > 0.009) exceptionFlags.push("unapplied_eligible_credit");

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
    totalBalanceDue: roundMoney(unpaidBaseline.totalOwed),
    unpaidInvoiceCount: unpaidBaseline.unpaidCount,
    rentBalance,
    lateFeeBalance,
    otherChargeBalance,
    futureScheduledCharges,
    eligibleUnappliedCredit: unallocatedEligible,
    lastEligiblePositivePaymentDate,
    oldestUnpaidDueDate,
    daysLate,
    collectionStatus:
      unpaidBaseline.totalOwed > 0.009
        ? daysLate != null && daysLate > 0
          ? "past_due"
          : "balance_due"
        : "current",
    invoices: invoiceDetails,
    payments: paymentDetails,
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
    unpaidInvoicesCount: account.unpaidInvoiceCount,
    lastPaidDate: account.lastEligiblePositivePaymentDate,
    oldestUnpaidDueDate: account.oldestUnpaidDueDate,
    daysLate: account.daysLate,
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
