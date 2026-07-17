/**
 * Non-destructive rent-change preview and invoice patch planning.
 * Never deletes invoices or payments. Never touches PAID/VOID.
 */

export type RentApplyMode =
  | "all_unpaid_partial"
  | "unpaid_on_or_after"
  | "future_only"
  | "lease_terms_only";

export type InvoiceForRentChange = {
  id: string;
  due_date: string;
  status: string;
  amount_rent: number;
  amount_late: number;
  amount_other: number;
  amount_total: number;
  amount_paid: number;
  balance_due: number;
};

export type RentChangeInvoicePatch = {
  id: string;
  due_date: string;
  previous_amount_rent: number;
  new_amount_rent: number;
  previous_amount_total: number;
  new_amount_total: number;
  previous_balance_due: number;
  new_balance_due: number;
  previous_status: string;
  new_status: string;
  amount_paid: number;
};

export type RentChangePreview = {
  mode: RentApplyMode;
  newRent: number;
  effectiveDate: string | null;
  businessDate: string;
  affectedInvoiceCount: number;
  currentInvoiceTotal: number;
  proposedInvoiceTotal: number;
  totalBalanceChange: number;
  earliestAffectedDate: string | null;
  latestAffectedDate: string | null;
  patches: RentChangeInvoicePatch[];
  skippedPaid: number;
  skippedVoid: number;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function deriveStatus(
  amountPaid: number,
  balanceDue: number,
  previousStatus: string,
): string {
  if (balanceDue <= 0.009) return "PAID";
  if (amountPaid > 0.009) return "PARTIAL";
  // Preserve OPEN for unpaid; do not invent other statuses
  if (String(previousStatus).toUpperCase() === "PARTIAL" && amountPaid <= 0)
    return "OPEN";
  return "OPEN";
}

export function invoiceEligibleForRentChange(
  inv: InvoiceForRentChange,
  mode: RentApplyMode,
  opts: { effectiveDate: string | null; businessDate: string },
): boolean {
  const status = String(inv.status || "").toUpperCase();
  if (status === "PAID" || status === "VOID") return false;
  if (status !== "OPEN" && status !== "PARTIAL") return false;
  if (mode === "lease_terms_only") return false;

  const due = String(inv.due_date).split("T")[0];
  if (mode === "all_unpaid_partial") return true;
  if (mode === "unpaid_on_or_after") {
    if (!opts.effectiveDate) return false;
    return due >= opts.effectiveDate;
  }
  if (mode === "future_only") {
    return due > opts.businessDate;
  }
  return false;
}

/**
 * Build a read-only preview of rent amount updates for existing invoices.
 * Uses amount_paid as the preserved payment total (caller may pre-fill from
 * actual eligible payments if desired).
 */
export function buildRentChangePreview(args: {
  invoices: InvoiceForRentChange[];
  newRent: number;
  mode: RentApplyMode;
  effectiveDate?: string | null;
  businessDate: string;
}): RentChangePreview {
  const newRent = round2(Number(args.newRent) || 0);
  const effectiveDate = args.effectiveDate
    ? String(args.effectiveDate).split("T")[0]
    : null;
  const businessDate = String(args.businessDate).split("T")[0];

  let skippedPaid = 0;
  let skippedVoid = 0;
  for (const inv of args.invoices) {
    const s = String(inv.status || "").toUpperCase();
    if (s === "PAID") skippedPaid++;
    if (s === "VOID") skippedVoid++;
  }

  const patches: RentChangeInvoicePatch[] = [];

  for (const inv of args.invoices) {
    if (
      !invoiceEligibleForRentChange(inv, args.mode, {
        effectiveDate,
        businessDate,
      })
    ) {
      continue;
    }

    const amountLate = round2(Number(inv.amount_late) || 0);
    const amountOther = round2(Number(inv.amount_other) || 0);
    const amountPaid = round2(Number(inv.amount_paid) || 0);
    const newTotal = round2(newRent + amountLate + amountOther);
    const newBalance = round2(Math.max(0, newTotal - amountPaid));
    const newStatus = deriveStatus(
      amountPaid,
      newBalance,
      String(inv.status || "OPEN"),
    );

    patches.push({
      id: inv.id,
      due_date: String(inv.due_date).split("T")[0],
      previous_amount_rent: round2(Number(inv.amount_rent) || 0),
      new_amount_rent: newRent,
      previous_amount_total: round2(Number(inv.amount_total) || 0),
      new_amount_total: newTotal,
      previous_balance_due: round2(Number(inv.balance_due) || 0),
      new_balance_due: newBalance,
      previous_status: String(inv.status || "").toUpperCase(),
      new_status: newStatus,
      amount_paid: amountPaid,
    });
  }

  patches.sort((a, b) => a.due_date.localeCompare(b.due_date));

  const currentInvoiceTotal = round2(
    patches.reduce((s, p) => s + p.previous_amount_total, 0),
  );
  const proposedInvoiceTotal = round2(
    patches.reduce((s, p) => s + p.new_amount_total, 0),
  );
  const previousBalanceSum = round2(
    patches.reduce((s, p) => s + p.previous_balance_due, 0),
  );
  const proposedBalanceSum = round2(
    patches.reduce((s, p) => s + p.new_balance_due, 0),
  );

  return {
    mode: args.mode,
    newRent,
    effectiveDate,
    businessDate,
    affectedInvoiceCount: patches.length,
    currentInvoiceTotal,
    proposedInvoiceTotal,
    totalBalanceChange: round2(proposedBalanceSum - previousBalanceSum),
    earliestAffectedDate: patches[0]?.due_date ?? null,
    latestAffectedDate: patches[patches.length - 1]?.due_date ?? null,
    patches,
    skippedPaid,
    skippedVoid,
  };
}
