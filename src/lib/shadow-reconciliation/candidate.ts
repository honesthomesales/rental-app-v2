/**
 * CANDIDATE shadow account summary.
 * Read-only / in-memory only. NEVER insert invoices, never invent late fees,
 * never write DB. Results are DISABLED_FOR_UI and must not drive screens.
 */

import { normalizeCadence } from "@/lib/rent/cadence";
import { buildMissingInvoicePreview } from "@/lib/missing-invoice-preview";
import { groupLeasesIntoAccounts, type AccountBundle } from "./account-grouping";
import type {
  CandidateAccountSummary,
  CandidateObligation,
  DataProblemCode,
  GraceStatus,
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

function isCompletedPayment(p: ShadowPayment): boolean {
  const s = String(p.status || "completed").toLowerCase();
  if (s === "failed" || s === "pending" || s === "void" || s === "cancelled") {
    return false;
  }
  // Baseline does not filter; candidate excludes non-completed
  return s === "completed" || s === "" || !p.status;
}

export function computeCandidateAccountSummaries(
  dataset: ShadowDataset,
): CandidateAccountSummary[] {
  const asOf = toDateOnly(dataset.asOfDate) || dataset.asOfDate;
  const defaultGrace = dataset.defaultGraceDays ?? DEFAULT_GRACE_DAYS;
  const termsByLease = new Map(
    (dataset.leaseTerms || []).map((t) => [t.lease_id, t]),
  );

  const bundles = groupLeasesIntoAccounts(
    dataset.leases,
    dataset.tenants,
    dataset.payments,
    asOf,
  );

  const invoiceById = new Map(dataset.invoices.map((i) => [i.id, i]));
  const invoicesByLease = new Map<string, ShadowInvoice[]>();
  for (const inv of dataset.invoices) {
    if (!invoicesByLease.has(inv.lease_id)) invoicesByLease.set(inv.lease_id, []);
    invoicesByLease.get(inv.lease_id)!.push(inv);
  }

  const completedPayments = dataset.payments.filter(isCompletedPayment);

  // Precompute lease → account for matching
  const leaseToAccount = new Map<string, string>();
  for (const b of bundles) {
    for (const l of b.leases) leaseToAccount.set(l.id, b.accountKey);
  }

  // Ambiguous tenant+property payment targets: count accounts per pair is always 1
  // Ambiguous = payment has tenant+property that map to zero or multiple accounts
  // (multiple shouldn't happen by construction). Also: payment with only loose refs.

  return bundles.map((bundle) =>
    summarizeAccount({
      bundle,
      asOf,
      defaultGrace,
      termsByLease,
      invoicesByLease,
      invoiceById,
      completedPayments,
      leaseToAccount,
      allBundles: bundles,
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
  completedPayments: ShadowPayment[];
  leaseToAccount: Map<string, string>;
  allBundles: AccountBundle[];
}): CandidateAccountSummary {
  const {
    bundle,
    asOf,
    defaultGrace,
    termsByLease,
    invoicesByLease,
    invoiceById,
    completedPayments,
    leaseToAccount,
    allBundles,
  } = args;

  const problems = new Set<DataProblemCode>(bundle.dataProblems);
  const obligations = buildObligations({
    bundle,
    asOf,
    termsByLease,
    invoicesByLease,
    problems,
  });

  const accountPayments = selectAccountPayments({
    bundle,
    completedPayments,
    leaseToAccount,
  });

  const {
    allocations,
    linkedAmount,
    unlinkedAmount,
    unappliedCredit,
    paymentsReceived,
    ambiguous,
  } = allocatePayments({
    obligations,
    payments: accountPayments,
    bundle,
    invoiceById,
    leaseToAccount,
    allBundles,
    problems,
  });

  if (ambiguous) problems.add("ambiguous_payment");

  const rentDue = round2(
    obligations.reduce((s, o) => s + o.rentAmount, 0),
  );
  const recordedLateFees = round2(
    obligations.reduce((s, o) => s + o.recordedLateFee, 0),
  );
  const totalOwed = round2(
    obligations.reduce((s, o) => s + Math.max(0, o.balance), 0),
  );

  const unpaid = obligations
    .filter((o) => o.balance > 0.0001)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const oldestUnpaidDate = unpaid[0]?.dueDate ?? null;

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
    (o) => o.source === "expected_preview",
  ).length;

  const currentLeaseIds = bundle.leases
    .filter((l) => String(l.status || "").toLowerCase() === "occupied")
    .map((l) => l.id);
  const relatedLeaseIds = bundle.leases.map((l) => l.id);

  const explanation = [
    "Candidate shadow summary (DISABLED_FOR_UI).",
    `Account ${bundle.accountKey}: ${relatedLeaseIds.length} lease segment(s).`,
    `Real invoices authoritative; ${missingExpected} in-memory expected gap(s).`,
    `Completed payments received $${paymentsReceived}.`,
    `Linked $${linkedAmount}; unlinked/unapplied flagged $${unlinkedAmount}; credit $${unappliedCredit}.`,
    `Recorded late fees only (never invented): $${recordedLateFees}.`,
    `Grace days=${graceDays}; status=${graceStatus}; daysLate=${daysLate}.`,
    bundle.holdoverCandidate
      ? "Labeled holdover_candidate (not converted to active lease)."
      : "No holdover_candidate label.",
    `totalOwed=$${totalOwed} from unmet obligation balances after FIFO allocation.`,
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
    unappliedCredit,
    totalOwed,
    oldestUnpaidDate,
    graceStatus,
    daysLate,
    lastPaymentDate: last ? toDateOnly(last.payment_date) : null,
    lastPaymentAmount: last ? money(last.amount) : null,
    holdoverCandidate: bundle.holdoverCandidate,
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
}): CandidateObligation[] {
  const { bundle, asOf, termsByLease, invoicesByLease, problems } = args;
  const obligations: CandidateObligation[] = [];

  for (const lease of bundle.leases) {
    const start = toDateOnly(lease.lease_start_date);
    if (!start) {
      problems.add("no_reliable_lease_evidence");
      continue;
    }

    const terms = resolveLeaseTerms(lease, termsByLease);
    if (terms.unknownCadence) problems.add("unknown_cadence");

    const real = (invoicesByLease.get(lease.id) || []).filter((inv) => {
      const d = toDateOnly(inv.due_date);
      if (!d) return false;
      if (d < start) return false;
      if (d > asOf) return false;
      // Never reconstruct before reliable evidence — keep real invoices in range
      return String(inv.status || "").toUpperCase() !== "VOID";
    });

    // Duplicate invoice detection (same lease + due_date)
    const dueCounts = new Map<string, number>();
    for (const inv of real) {
      const d = toDateOnly(inv.due_date)!;
      dueCounts.set(d, (dueCounts.get(d) || 0) + 1);
    }
    for (const [, c] of dueCounts) {
      if (c > 1) problems.add("duplicate_invoice");
    }

    for (const inv of real) {
      if (String(inv.status || "").toUpperCase() === "PARTIAL") {
        problems.add("partial_invoice_ignored_by_baseline");
      }
      const recordedLateFee = money(inv.amount_late);
      const rentAmount =
        money(inv.amount_rent) ||
        Math.max(0, money(inv.amount_total) - recordedLateFee);
      const amountTotal = money(inv.amount_total) || rentAmount + recordedLateFee;
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
        allocated: 0,
        balance: amountTotal,
        invoiceId: inv.id,
        invoiceStatus: inv.status,
      });
      if (recordedLateFee > 0) {
        // informational — category recorded_late_fee in diff report
      }
    }

    // In-memory missing expected obligations (past/current only; never insert)
    if (terms.cadence) {
      const existingDueDates = real.map((i) => toDateOnly(i.due_date)!);
      const endForPreview =
        toDateOnly(lease.lease_end_date) &&
        toDateOnly(lease.lease_end_date)! < asOf
          ? toDateOnly(lease.lease_end_date)
          : asOf;

      const gaps = buildMissingInvoicePreview({
        leaseStartDate: start,
        leaseEndDate: endForPreview,
        rentCadence: terms.cadence,
        rentDueDay: terms.rentDueDay ?? 1,
        rentAmount: terms.rent,
        existingDueDates,
        asOfDate: asOf,
      }).filter((g) => g.periodClass === "past" || g.periodClass === "current");

      for (const gap of gaps) {
        problems.add("missing_expected_obligation");
        obligations.push({
          key: `expected:${lease.id}:${gap.dueDate}`,
          source: "expected_preview",
          leaseId: lease.id,
          dueDate: gap.dueDate,
          periodStart: gap.periodStart,
          periodEnd: gap.periodEnd,
          rentAmount: gap.amount,
          recordedLateFee: 0, // never invent late fees
          amountTotal: gap.amount,
          allocated: 0,
          balance: gap.amount,
        });
      }
    }
  }

  return obligations.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function selectAccountPayments(args: {
  bundle: AccountBundle;
  completedPayments: ShadowPayment[];
  leaseToAccount: Map<string, string>;
}): ShadowPayment[] {
  const { bundle, completedPayments, leaseToAccount } = args;
  const leaseIds = new Set(bundle.leases.map((l) => l.id));

  return completedPayments.filter((p) => {
    if (p.invoice_id) {
      // may belong via invoice lease — include if lease in account OR tenant/property match
    }
    if (p.lease_id && leaseIds.has(p.lease_id)) return true;
    if (
      p.tenant_id === bundle.tenantId &&
      p.property_id === bundle.propertyId
    ) {
      return true;
    }
    if (p.lease_id && leaseToAccount.get(p.lease_id) === bundle.accountKey) {
      return true;
    }
    return false;
  });
}

function allocatePayments(args: {
  obligations: CandidateObligation[];
  payments: ShadowPayment[];
  bundle: AccountBundle;
  invoiceById: Map<string, ShadowInvoice>;
  leaseToAccount: Map<string, string>;
  allBundles: AccountBundle[];
  problems: Set<DataProblemCode>;
}): {
  allocations: PaymentAllocationShadow[];
  linkedAmount: number;
  unlinkedAmount: number;
  unappliedCredit: number;
  paymentsReceived: number;
  ambiguous: boolean;
} {
  const {
    obligations,
    payments,
    bundle,
    invoiceById,
    leaseToAccount,
    allBundles,
    problems,
  } = args;

  const allocations: PaymentAllocationShadow[] = [];
  let linkedAmount = 0;
  let unlinkedAmount = 0;
  let unappliedCredit = 0;
  let ambiguous = false;

  const sortedPayments = [...payments].sort((a, b) => {
    const da = toDateOnly(a.payment_date) || "";
    const db = toDateOnly(b.payment_date) || "";
    if (da !== db) return da.localeCompare(db);
    return a.id.localeCompare(b.id);
  });

  const paymentsReceived = round2(
    sortedPayments.reduce((s, p) => s + money(p.amount), 0),
  );

  const applyToOldest = (
    payment: ShadowPayment,
    amount: number,
    source: PaymentAllocationShadow["source"],
    leaseFilter?: string,
  ): number => {
    let remaining = amount;
    const targets = obligations
      .filter((o) => o.balance > 0.0001)
      .filter((o) => !leaseFilter || o.leaseId === leaseFilter)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    for (const o of targets) {
      if (remaining <= 0) break;
      const applied = Math.min(o.balance, remaining);
      o.allocated = round2(o.allocated + applied);
      o.balance = round2(o.balance - applied);
      remaining = round2(remaining - applied);
      allocations.push({
        paymentId: payment.id,
        obligationKey: o.key,
        amount: applied,
        source,
      });
    }
    return remaining;
  };

  for (const payment of sortedPayments) {
    let remaining = money(payment.amount);

    // 1. Valid invoice_id
    if (payment.invoice_id && invoiceById.has(payment.invoice_id)) {
      const inv = invoiceById.get(payment.invoice_id)!;
      const ob = obligations.find((o) => o.invoiceId === inv.id);
      if (ob && remaining > 0) {
        const applied = Math.min(ob.balance, remaining);
        if (applied > 0) {
          ob.allocated = round2(ob.allocated + applied);
          ob.balance = round2(ob.balance - applied);
          remaining = round2(remaining - applied);
          allocations.push({
            paymentId: payment.id,
            obligationKey: ob.key,
            amount: applied,
            source: "invoice_id",
          });
          linkedAmount = round2(linkedAmount + applied);
        }
      } else if (!ob) {
        // Invoice may be outside account — do not guess other tenant/property
        // Try continue with other rules only if lease/property matches
      }
      // leftover after covering that invoice continues as credit toward oldest
      if (remaining > 0) {
        const before = remaining;
        remaining = applyToOldest(payment, remaining, "credit_forward");
        linkedAmount = round2(linkedAmount + (before - remaining));
      }
    } else if (payment.lease_id && leaseToAccount.has(payment.lease_id)) {
      // 2. Valid lease_id → oldest unpaid for that lease/account
      const acct = leaseToAccount.get(payment.lease_id)!;
      if (acct !== bundle.accountKey) {
        // belongs elsewhere — should not be in selectAccountPayments
        continue;
      }
      problems.add("unlinked_payment");
      const before = remaining;
      remaining = applyToOldest(
        payment,
        remaining,
        "lease_id",
        payment.lease_id,
      );
      // if lease obligations covered, rest to account oldest
      if (remaining > 0) {
        remaining = applyToOldest(payment, remaining, "lease_id");
      }
      linkedAmount = round2(linkedAmount + (before - remaining));
      unlinkedAmount = round2(unlinkedAmount + before);
    } else if (payment.tenant_id && payment.property_id) {
      // 3. Exact tenant_id + property_id with one unambiguous account
      const matches = allBundles.filter(
        (b) =>
          b.tenantId === payment.tenant_id &&
          b.propertyId === payment.property_id,
      );
      if (matches.length === 1 && matches[0].accountKey === bundle.accountKey) {
        problems.add("unlinked_payment");
        const before = remaining;
        remaining = applyToOldest(payment, remaining, "tenant_property");
        linkedAmount = round2(linkedAmount + (before - remaining));
        unlinkedAmount = round2(unlinkedAmount + before);
      } else {
        // 4. Ambiguous — remain unapplied
        ambiguous = true;
        problems.add("ambiguous_payment");
        unlinkedAmount = round2(unlinkedAmount + remaining);
        remaining = remaining; // stay as credit? User: remain unapplied
        // Do not assign; carry as unapplied credit for reporting only if on this account
        // For ambiguous, don't put on wrong account — skip applying
        remaining = 0;
        // amount already counted in unlinkedAmount; not in credit
      }
    } else {
      // No usable linkage — unapplied + flag
      ambiguous = true;
      problems.add("ambiguous_payment");
      unlinkedAmount = round2(unlinkedAmount + remaining);
      remaining = 0;
    }

    if (remaining > 0) {
      unappliedCredit = round2(unappliedCredit + remaining);
    }
  }

  // Recompute credit as leftover after all obligations covered
  const obligationRemainder = round2(
    obligations.reduce((s, o) => s + Math.max(0, o.balance), 0),
  );
  if (obligationRemainder <= 0 && paymentsReceived > linkedAmount) {
    // ensure credit reflects overpayment
    const covered = round2(
      obligations.reduce((s, o) => s + o.allocated, 0),
    );
    unappliedCredit = round2(Math.max(unappliedCredit, paymentsReceived - covered));
  }

  return {
    allocations,
    linkedAmount,
    unlinkedAmount,
    unappliedCredit,
    paymentsReceived,
    ambiguous,
  };
}
