/**
 * Detailed missing-obligation analysis for as-of reconciliation.
 * Forward from last real invoice; period-dedup; no invoice creation.
 */

import { normalizeCadence, type Cadence } from "@/lib/rent/cadence";
import type { ShadowInvoice, ShadowPayment } from "./types";

export type MissingObligationDetailRow = {
  leaseId: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  rentAmount: number;
  cadence: Cadence;
  periodAnchorOrDueDayRule: string;
  existingInvoiceId: string | null;
  existingInvoiceStatus: string | null;
  paymentReceivedForPeriod: number;
  paymentId: string | null;
  periodClass: "past" | "current" | "future";
  reason: string;
  affectsBalanceAsOf: boolean;
  amountAffectingBalance: number;
};

export type MissingObligationAnalysis = {
  leaseId: string;
  storedRent: number;
  storedCadence: Cadence | null;
  rentDueDay: number;
  leaseStartDate: string | null;
  leaseEndDate: string | null;
  lastRealInvoiceDate: string | null;
  lastRealInvoiceId: string | null;
  sanityNotes: string[];
  /** Rows that affect as-of balance (due <= asOf, no same-period invoice). */
  proposedMissing: MissingObligationDetailRow[];
  totalProposedMissingAmount: number;
  /** Future preview rows (due > asOf); current impact always $0. */
  futurePreview: MissingObligationDetailRow[];
  /** Running balance after each proposed current obligation is added. */
  balanceAfterEach: Array<{
    dueDate: string;
    amount: number;
    balanceAfter: number;
  }>;
};

function toDateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return String(iso).split("T")[0];
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function money(n: number | string | null | undefined): number {
  const v = parseFloat(String(n ?? 0));
  return Number.isFinite(v) ? round2(v) : 0;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function weekKey(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  const day = d.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + mondayOffset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function classifyPeriod(
  dueDate: string,
  asOf: string,
): "past" | "current" | "future" {
  if (dueDate < asOf) return "past";
  if (dueDate === asOf) return "current";
  return "future";
}

function expectedSchedule(args: {
  leaseStartDate: string;
  endDate: string;
  cadence: Cadence;
  rentDueDay: number;
  rentAmount: number;
}): Array<{
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  cadence: Cadence;
  rule: string;
}> {
  const { leaseStartDate, endDate, cadence, rentDueDay, rentAmount } = args;
  const out: Array<{
    dueDate: string;
    periodStart: string;
    periodEnd: string;
    amount: number;
    cadence: Cadence;
    rule: string;
  }> = [];

  const addDays = (iso: string, days: number): string => {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  if (cadence === "weekly" || cadence === "biweekly") {
    const step = cadence === "weekly" ? 7 : 14;
    let dueDate = leaseStartDate;
    let guard = 0;
    while (dueDate <= endDate && guard < 800) {
      guard += 1;
      out.push({
        dueDate,
        periodStart: dueDate,
        periodEnd: addDays(dueDate, step - 1),
        amount: rentAmount,
        cadence,
        rule: `${cadence}_from_lease_start_${leaseStartDate}`,
      });
      dueDate = addDays(dueDate, step);
    }
    return out;
  }

  // monthly (noon anchors avoid DST/UTC day shifts)
  const start = new Date(leaseStartDate + "T12:00:00");
  const current = new Date(start.getFullYear(), start.getMonth(), 1, 12, 0, 0);
  const endObj = new Date(endDate + "T12:00:00");
  let guard = 0;
  while (current <= endObj && guard < 240) {
    guard += 1;
    const year = current.getFullYear();
    const month = current.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dueDay = Math.min(rentDueDay, daysInMonth);
    const dueDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`;
    const periodStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const periodEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
    if (dueDate >= leaseStartDate && dueDate <= endDate) {
      out.push({
        dueDate,
        periodStart,
        periodEnd,
        amount: rentAmount,
        cadence: "monthly",
        rule: `monthly_due_day_${rentDueDay}`,
      });
    }
    current.setMonth(current.getMonth() + 1);
  }
  return out;
}

function periodCoveredByInvoice(
  cadence: Cadence,
  periodStart: string,
  periodEnd: string,
  dueDate: string,
  invoices: ShadowInvoice[],
): ShadowInvoice | null {
  for (const inv of invoices) {
    const invDue = toDateOnly(inv.due_date);
    if (!invDue) continue;
    if (invDue === dueDate) return inv;

    const invPs = toDateOnly(inv.period_start) || invDue;
    const invPe = toDateOnly(inv.period_end) || invDue;

    if (cadence === "monthly") {
      if (monthKey(invDue) === monthKey(dueDate)) return inv;
      if (monthKey(invPs) === monthKey(periodStart)) return inv;
    } else {
      // weekly / biweekly: match by due week only — do not let a
      // month-spanning invoice period_end swallow later weekly dues.
      if (weekKey(invDue) === weekKey(dueDate)) return inv;
      if (invDue === dueDate) return inv;
      const spanDays =
        (new Date(invPe + "T12:00:00").getTime() -
          new Date(invPs + "T12:00:00").getTime()) /
        86400000;
      if (spanDays <= 13 && !(invPe < periodStart || invPs > periodEnd)) {
        return inv;
      }
    }
  }
  return null;
}

function paymentsForPeriod(
  payments: ShadowPayment[],
  periodStart: string,
  periodEnd: string,
  invoiceId: string | null,
): { amount: number; paymentId: string | null } {
  let amount = 0;
  let paymentId: string | null = null;
  for (const p of payments) {
    const d = toDateOnly(p.payment_date);
    if (!d) continue;
    const linked = invoiceId && p.invoice_id === invoiceId;
    const inWindow = d >= periodStart && d <= periodEnd;
    if (linked || inWindow) {
      amount = round2(amount + money(p.amount));
      if (!paymentId) paymentId = p.id;
    }
  }
  return { amount, paymentId };
}

/**
 * Build detailed missing obligations for one lease.
 * Only periods after the last real invoice (forward) through schedule end
 * are considered; same-period invoices block duplicates.
 * Balance impact only for dueDate <= asOfDate.
 */
export function analyzeMissingObligations(args: {
  leaseId: string;
  leaseStartDate: string | null | undefined;
  leaseEndDate: string | null | undefined;
  rent: number | string | null | undefined;
  rentCadence: string | null | undefined;
  rentDueDay?: number | null;
  invoices: ShadowInvoice[];
  payments: ShadowPayment[];
  asOfDate: string;
  /** Cap schedule generation at asOf (never through far lease end for current). */
  scheduleEndDate?: string;
}): MissingObligationAnalysis {
  const asOf = toDateOnly(args.asOfDate) || args.asOfDate;
  const leaseStart = toDateOnly(args.leaseStartDate);
  const leaseEnd = toDateOnly(args.leaseEndDate);
  const cadence =
    normalizeCadence(args.rentCadence || "monthly") || ("monthly" as Cadence);
  const rentDueDay = args.rentDueDay ?? 1;
  const storedRent = money(args.rent);
  const sanityNotes: string[] = [];

  if (!leaseStart) {
    return {
      leaseId: args.leaseId,
      storedRent,
      storedCadence: cadence,
      rentDueDay,
      leaseStartDate: null,
      leaseEndDate: leaseEnd,
      lastRealInvoiceDate: null,
      lastRealInvoiceId: null,
      sanityNotes: ["No reliable lease start — no missing obligations proposed."],
      proposedMissing: [],
      totalProposedMissingAmount: 0,
      futurePreview: [],
      balanceAfterEach: [],
    };
  }

  if (cadence === "weekly" && storedRent >= 1000) {
    sanityNotes.push(
      `Stored weekly rent $${storedRent.toFixed(2)} is unusually large; do not assume cadence/rent are correct.`,
    );
  }

  const realInvoices = args.invoices
    .filter((i) => String(i.status || "").toUpperCase() !== "VOID")
    .filter((i) => i.lease_id === args.leaseId);

  const invoicesThroughAsOf = realInvoices
    .map((i) => ({ inv: i, due: toDateOnly(i.due_date)! }))
    .filter((x) => x.due && x.due <= asOf)
    .sort((a, b) => a.due.localeCompare(b.due));

  const last = invoicesThroughAsOf[invoicesThroughAsOf.length - 1] || null;
  const lastRealInvoiceDate = last?.due || null;
  const lastRealInvoiceId = last?.inv.id || null;

  // Cap at asOf for current-balance proposals (never through 2028/2030 end).
  const scheduleEnd =
    toDateOnly(args.scheduleEndDate) ||
    (leaseEnd && leaseEnd < asOf ? leaseEnd : asOf);

  // Generate slightly past asOf for future preview only (one cadence step).
  const previewEndDate = (() => {
    let capped = asOf;
    if (cadence === "weekly") capped = addDaysIso(asOf, 14);
    else if (cadence === "biweekly") capped = addDaysIso(asOf, 28);
    else capped = addMonthsIso(asOf, 2);
    return leaseEnd && leaseEnd < capped ? leaseEnd : capped;
  })();

  const schedule = expectedSchedule({
    leaseStartDate: leaseStart,
    endDate: previewEndDate,
    cadence,
    rentDueDay,
    rentAmount: storedRent,
  });

  const proposedMissing: MissingObligationDetailRow[] = [];
  const futurePreview: MissingObligationDetailRow[] = [];

  for (const gap of schedule) {
    // Forward-only: after last real invoice date
    if (lastRealInvoiceDate && gap.dueDate <= lastRealInvoiceDate) continue;

    const covering = periodCoveredByInvoice(
      cadence,
      gap.periodStart,
      gap.periodEnd,
      gap.dueDate,
      realInvoices,
    );
    if (covering) continue;

    const periodClass = classifyPeriod(gap.dueDate, asOf);
    const payInfo = paymentsForPeriod(
      args.payments.filter((p) => {
        const d = toDateOnly(p.payment_date);
        return !d || d <= asOf;
      }),
      gap.periodStart,
      gap.periodEnd,
      null,
    );

    const affects = periodClass !== "future" && gap.dueDate <= asOf;
    const row: MissingObligationDetailRow = {
      leaseId: args.leaseId,
      dueDate: gap.dueDate,
      periodStart: gap.periodStart,
      periodEnd: gap.periodEnd,
      rentAmount: gap.amount,
      cadence: gap.cadence,
      periodAnchorOrDueDayRule: gap.rule,
      existingInvoiceId: null,
      existingInvoiceStatus: null,
      paymentReceivedForPeriod: payInfo.amount,
      paymentId: payInfo.paymentId,
      periodClass,
      reason: `No real invoice for expected ${gap.cadence} due ${gap.dueDate} after last invoice ${lastRealInvoiceDate || "(none)"}`,
      affectsBalanceAsOf: affects,
      amountAffectingBalance: affects ? gap.amount : 0,
    };

    if (affects) proposedMissing.push(row);
    else if (periodClass === "future") futurePreview.push(row);
  }

  // Cap current proposals at scheduleEnd (asOf)
  const currentOnly = proposedMissing.filter((r) => r.dueDate <= scheduleEnd);
  const totalProposedMissingAmount = round2(
    currentOnly.reduce((s, r) => s + r.amountAffectingBalance, 0),
  );

  if (Math.abs(totalProposedMissingAmount) > 0.009 && currentOnly.length === 0) {
    throw new Error(
      `Invariant: nonzero missing total with empty rows for lease ${args.leaseId}`,
    );
  }
  const rowSum = round2(
    currentOnly.reduce((s, r) => s + r.rentAmount, 0),
  );
  if (Math.abs(rowSum - totalProposedMissingAmount) > 0.009) {
    throw new Error(
      `Invariant: missing rows sum ${rowSum} != total ${totalProposedMissingAmount}`,
    );
  }

  let running = 0;
  const balanceAfterEach = currentOnly.map((r) => {
    running = round2(running + r.rentAmount);
    return { dueDate: r.dueDate, amount: r.rentAmount, balanceAfter: running };
  });

  if (
    lastRealInvoiceDate &&
    cadence === "monthly" &&
    currentOnly.length === 0
  ) {
    sanityNotes.push(
      `Last real invoice ${lastRealInvoiceDate}; next monthly due after that is after as-of ${asOf} or already covered by period — current missing $0.`,
    );
  }

  return {
    leaseId: args.leaseId,
    storedRent,
    storedCadence: cadence,
    rentDueDay,
    leaseStartDate: leaseStart,
    leaseEndDate: leaseEnd,
    lastRealInvoiceDate,
    lastRealInvoiceId,
    sanityNotes,
    proposedMissing: currentOnly,
    totalProposedMissingAmount,
    futurePreview,
    balanceAfterEach,
  };
}
