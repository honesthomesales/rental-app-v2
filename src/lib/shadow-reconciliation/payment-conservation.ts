/**
 * Payment conservation helpers for disabled shadow candidate.
 * Enforces: one payment ID → at most one account; no double counting.
 */

import { makeAccountKey, type AccountBundle } from "./account-grouping";
import type {
  ExcessReasonBreakdown,
  ExcessSupportClass,
  HistoricalExcessReason,
  ShadowInvoice,
  ShadowLease,
  ShadowPayment,
} from "./types";

export type PaymentOwnership =
  | {
      paymentId: string;
      accountKey: string;
      link: "invoice_id" | "lease_id" | "tenant_property";
      amount: number;
    }
  | {
      paymentId: string;
      accountKey: null;
      link: "unassigned" | "ambiguous" | "miscellaneous";
      amount: number;
      note?: string;
    };

export type PaymentConservationAudit = {
  rawCompletedPaymentCount: number;
  rawCompletedPaymentTotal: number;
  uniqueCompletedPaymentCount: number;
  uniqueCompletedPaymentTotal: number;
  excludedNonCompletedCount: number;
  excludedNonCompletedTotal: number;
  duplicatePaymentIdCount: number;
  duplicateCountedAmount: number;
  assignedPaymentTotal: number;
  unassignedPaymentTotal: number;
  linkedByInvoiceIdTotal: number;
  linkedByLeaseIdOnlyTotal: number;
  linkedByTenantPropertyOnlyTotal: number;
  paymentCountedInMultipleAccountsAmount: number;
  accountsWithMultiCountedPayments: string[];
  invariantViolations: string[];
};

function money(n: number | string | null | undefined): number {
  const v = parseFloat(String(n ?? 0));
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function isCompletedPayment(p: ShadowPayment): boolean {
  const s = String(p.status || "completed").toLowerCase();
  if (s === "failed" || s === "pending" || s === "void" || s === "cancelled") {
    return false;
  }
  return true;
}

/** Deduplicate by payment id — keep first occurrence. */
export function uniqueCompletedPayments(payments: ShadowPayment[]): {
  unique: ShadowPayment[];
  rawCount: number;
  rawTotal: number;
  duplicateIds: string[];
  duplicateCountedAmount: number;
  excluded: ShadowPayment[];
  excludedTotal: number;
} {
  const excluded = payments.filter((p) => !isCompletedPayment(p));
  const completed = payments.filter(isCompletedPayment);
  const seen = new Map<string, ShadowPayment>();
  const duplicateIds: string[] = [];
  let duplicateCountedAmount = 0;

  for (const p of completed) {
    if (!p.id) continue;
    if (seen.has(p.id)) {
      duplicateIds.push(p.id);
      duplicateCountedAmount = round2(duplicateCountedAmount + money(p.amount));
      continue;
    }
    seen.set(p.id, p);
  }

  const unique = [...seen.values()];
  return {
    unique,
    rawCount: completed.length,
    rawTotal: round2(completed.reduce((s, p) => s + money(p.amount), 0)),
    duplicateIds: [...new Set(duplicateIds)],
    duplicateCountedAmount,
    excluded,
    excludedTotal: round2(excluded.reduce((s, p) => s + money(p.amount), 0)),
  };
}

/**
 * Assign each unique payment to exactly one account (or unassigned).
 * Priority: invoice_id → lease_id → unique tenant+property.
 */
export function assignPaymentsToAccounts(args: {
  payments: ShadowPayment[];
  bundles: AccountBundle[];
  invoices: ShadowInvoice[];
  leases: ShadowLease[];
}): {
  ownership: Map<string, PaymentOwnership>;
  paymentsByAccount: Map<string, ShadowPayment[]>;
  audit: PaymentConservationAudit;
} {
  const { payments, bundles, invoices } = args;
  const uniquePack = uniqueCompletedPayments(payments);
  const leaseToAccount = new Map<string, string>();
  for (const b of bundles) {
    for (const l of b.leases) leaseToAccount.set(l.id, b.accountKey);
  }
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const accountByKey = new Map(bundles.map((b) => [b.accountKey, b]));

  const ownership = new Map<string, PaymentOwnership>();
  const paymentsByAccount = new Map<string, ShadowPayment[]>();
  const claimCount = new Map<string, Set<string>>();

  let linkedByInvoiceIdTotal = 0;
  let linkedByLeaseIdOnlyTotal = 0;
  let linkedByTenantPropertyOnlyTotal = 0;
  let unassignedPaymentTotal = 0;

  for (const p of uniquePack.unique) {
    const amount = money(p.amount);
    let chosen: PaymentOwnership | null = null;

    if (p.invoice_id && invoiceById.has(p.invoice_id)) {
      const inv = invoiceById.get(p.invoice_id)!;
      const acct = leaseToAccount.get(inv.lease_id);
      if (acct) {
        chosen = {
          paymentId: p.id,
          accountKey: acct,
          link: "invoice_id",
          amount,
        };
        linkedByInvoiceIdTotal = round2(linkedByInvoiceIdTotal + amount);
      }
    }

    if (!chosen && p.lease_id && leaseToAccount.has(p.lease_id)) {
      chosen = {
        paymentId: p.id,
        accountKey: leaseToAccount.get(p.lease_id)!,
        link: "lease_id",
        amount,
      };
      linkedByLeaseIdOnlyTotal = round2(linkedByLeaseIdOnlyTotal + amount);
    }

    if (!chosen && p.tenant_id && p.property_id) {
      const key = makeAccountKey(p.tenant_id, p.property_id);
      if (accountByKey.has(key)) {
        chosen = {
          paymentId: p.id,
          accountKey: key,
          link: "tenant_property",
          amount,
        };
        linkedByTenantPropertyOnlyTotal = round2(
          linkedByTenantPropertyOnlyTotal + amount,
        );
      } else {
        chosen = {
          paymentId: p.id,
          accountKey: null,
          link: "miscellaneous",
          amount,
          note: "tenant+property did not match a candidate account",
        };
        unassignedPaymentTotal = round2(unassignedPaymentTotal + amount);
      }
    }

    if (!chosen) {
      chosen = {
        paymentId: p.id,
        accountKey: null,
        link: "unassigned",
        amount,
        note: "no invoice/lease/tenant-property link",
      };
      unassignedPaymentTotal = round2(unassignedPaymentTotal + amount);
    }

    const claimants = new Set<string>();
    for (const b of bundles) {
      const leaseIds = new Set(b.leases.map((l) => l.id));
      if (p.lease_id && leaseIds.has(p.lease_id)) claimants.add(b.accountKey);
      if (p.tenant_id === b.tenantId && p.property_id === b.propertyId) {
        claimants.add(b.accountKey);
      }
      if (p.invoice_id) {
        const inv = invoiceById.get(p.invoice_id);
        if (inv && leaseIds.has(inv.lease_id)) claimants.add(b.accountKey);
      }
    }
    claimCount.set(p.id, claimants);

    ownership.set(p.id, chosen);
    if (chosen.accountKey) {
      if (!paymentsByAccount.has(chosen.accountKey)) {
        paymentsByAccount.set(chosen.accountKey, []);
      }
      paymentsByAccount.get(chosen.accountKey)!.push(p);
    }
  }

  let multiAmount = 0;
  const multiAccounts: string[] = [];
  for (const [pid, set] of claimCount) {
    if (set.size > 1) {
      const own = ownership.get(pid);
      multiAmount = round2(multiAmount + (own?.amount || 0));
      for (const a of set) {
        if (!multiAccounts.includes(a)) multiAccounts.push(a);
      }
    }
  }

  const assignedPaymentTotal = round2(
    [...ownership.values()]
      .filter((o) => o.accountKey)
      .reduce((s, o) => s + o.amount, 0),
  );

  const invariantViolations: string[] = [];
  const seenInAccounts = new Map<string, string>();
  for (const [acct, list] of paymentsByAccount) {
    for (const p of list) {
      if (seenInAccounts.has(p.id) && seenInAccounts.get(p.id) !== acct) {
        invariantViolations.push(
          `Payment ${p.id} assigned to both ${seenInAccounts.get(p.id)} and ${acct}`,
        );
      }
      seenInAccounts.set(p.id, acct);
    }
  }

  const uniqueTotal = round2(
    uniquePack.unique.reduce((s, p) => s + money(p.amount), 0),
  );
  if (assignedPaymentTotal - uniqueTotal > 0.009) {
    invariantViolations.push(
      `Invariant4 violated: assigned ${assignedPaymentTotal} > unique ${uniqueTotal}`,
    );
  }

  const audit: PaymentConservationAudit = {
    rawCompletedPaymentCount: uniquePack.rawCount,
    rawCompletedPaymentTotal: uniquePack.rawTotal,
    uniqueCompletedPaymentCount: uniquePack.unique.length,
    uniqueCompletedPaymentTotal: uniqueTotal,
    excludedNonCompletedCount: uniquePack.excluded.length,
    excludedNonCompletedTotal: uniquePack.excludedTotal,
    duplicatePaymentIdCount: uniquePack.duplicateIds.length,
    duplicateCountedAmount: uniquePack.duplicateCountedAmount,
    assignedPaymentTotal,
    unassignedPaymentTotal,
    linkedByInvoiceIdTotal,
    linkedByLeaseIdOnlyTotal,
    linkedByTenantPropertyOnlyTotal,
    paymentCountedInMultipleAccountsAmount: multiAmount,
    accountsWithMultiCountedPayments: multiAccounts,
    invariantViolations,
  };

  return { ownership, paymentsByAccount, audit };
}

export function classifyHistoricalExcessReason(args: {
  payment: ShadowPayment;
  remaining: number;
  allocatedToReal: number;
  hasUnapprovedMissing: boolean;
  hasUnapprovedHoldover: boolean;
  continuityClassification: string;
  obligationCutoffDate: string | null;
  obligationStartDate: string | null;
  invoiceValid: boolean | null;
  linkedToVoidInvoice: boolean;
  leaseStatus: string | null;
  settledAgainstPaidInvoice: boolean;
  isMiscellaneousIncome?: boolean;
  isRefundOrReversal?: boolean;
  allocationMismatch?: boolean;
}): HistoricalExcessReason {
  const payDate = String(args.payment.payment_date || "").split("T")[0];
  if (args.remaining <= 0) return "other";

  if (args.isRefundOrReversal) {
    return "refund_reversal_not_represented";
  }
  if (args.isMiscellaneousIncome) {
    return "miscellaneous_or_non_rent_income";
  }
  if (args.linkedToVoidInvoice) {
    return "payment_linked_to_void_invoice";
  }
  if (args.invoiceValid === false) {
    return "payment_linked_to_missing_invoice";
  }
  if (
    args.obligationCutoffDate &&
    payDate &&
    payDate > args.obligationCutoffDate
  ) {
    return "payment_after_verified_account_closure";
  }
  if (
    args.obligationStartDate &&
    payDate &&
    payDate < args.obligationStartDate
  ) {
    return "payment_before_reliable_occupancy_start";
  }
  if (args.hasUnapprovedMissing) {
    return "missing_historical_obligations_not_approved";
  }
  if (args.hasUnapprovedHoldover) {
    return "lease_gap_obligations_not_approved";
  }
  if (args.allocationMismatch) {
    return "payment_allocation_mismatch";
  }
  if (args.settledAgainstPaidInvoice || args.allocatedToReal > 0) {
    return "confirmed_payment_above_recorded_obligations";
  }
  if (
    ["inactive", "empty", "sold", "expired"].includes(
      String(args.leaseStatus || "").toLowerCase(),
    )
  ) {
    return "payment_linked_to_inactive_or_expired_lease";
  }
  if (args.continuityClassification === "closed") {
    return "payment_after_verified_account_closure";
  }
  return "other";
}

export function classifyExcessSupportClass(args: {
  historicalExcessPayment: number;
  excessByReason: ExcessReasonBreakdown;
  unapprovedMissingObligationTotal: number;
  unapprovedHoldoverObligationTotal: number;
  unlinkedPaymentsAmount: number;
  continuityClassification: string;
  dataProblems: string[];
}): ExcessSupportClass {
  if (args.historicalExcessPayment <= 0.0001) {
    return "supported_historical_excess";
  }
  const r = args.excessByReason;
  if (
    (r.data_cleanup_required || 0) > 0.009 ||
    (r.account_mapping_problem || 0) > 0.009 ||
    args.dataProblems.includes("data_cleanup_required")
  ) {
    return "data_cleanup_required";
  }
  if ((r.miscellaneous_or_non_rent_income || 0) > 0.009) {
    return "non_rent_payment_review_required";
  }
  if (
    (r.payment_allocation_mismatch || 0) > 0.009 ||
    (r.payment_linked_to_missing_invoice || 0) > 0.009 ||
    (r.payment_linked_to_void_invoice || 0) > 0.009 ||
    args.unlinkedPaymentsAmount > 0.009
  ) {
    return "payment_allocation_review_required";
  }
  if (
    (r.payment_after_verified_account_closure || 0) > 0.009 ||
    (r.payment_before_reliable_occupancy_start || 0) > 0.009 ||
    (r.lease_gap_obligations_not_approved || 0) > 0.009 ||
    args.unapprovedHoldoverObligationTotal > 0.009 ||
    args.continuityClassification === "unresolved" ||
    args.continuityClassification === "unset"
  ) {
    return "closure_timing_review_required";
  }
  if (
    (r.missing_historical_obligations_not_approved || 0) > 0.009 ||
    args.unapprovedMissingObligationTotal > 0.009
  ) {
    return "depends_on_missing_obligation_review";
  }
  if ((r.lease_gap_obligations_not_approved || 0) > 0.009) {
    return "depends_on_lease_continuity_review";
  }
  return "supported_historical_excess";
}
