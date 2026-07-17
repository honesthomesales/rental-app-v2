/**
 * Prospective-only rent-change preview and invoice patch planning.
 * Never deletes invoices or payments. Never touches PAID/VOID or past dues.
 */

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
  oldRent: number;
  newRent: number;
  effectiveDate: string;
  businessDate: string;
  affectedInvoiceCount: number;
  currentInvoiceTotal: number;
  proposedInvoiceTotal: number;
  totalBalanceChange: number;
  earliestAffectedDate: string | null;
  latestAffectedDate: string | null;
  patches: RentChangeInvoicePatch[];
  skippedPast: number;
  skippedPaid: number;
  skippedVoid: number;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toDateOnly(iso: string): string {
  return String(iso).split("T")[0];
}

function deriveStatus(
  amountPaid: number,
  balanceDue: number,
  previousStatus: string,
): string {
  if (balanceDue <= 0.009) return "PAID";
  if (amountPaid > 0.009) return "PARTIAL";
  if (String(previousStatus).toUpperCase() === "PARTIAL" && amountPaid <= 0)
    return "OPEN";
  return "OPEN";
}

/** Rent amount for a due date when lease rent changed prospectively. */
export function rentAmountForDueDate(args: {
  dueDate: string;
  newRent: number;
  priorRent?: number | null;
  rentEffectiveDate?: string | null;
}): number {
  const due = toDateOnly(args.dueDate);
  const effective = args.rentEffectiveDate
    ? toDateOnly(args.rentEffectiveDate)
    : null;
  if (effective && due < effective) {
    return round2(Number(args.priorRent ?? args.newRent) || 0);
  }
  return round2(Number(args.newRent) || 0);
}

export function invoiceEligibleForRentChange(
  inv: InvoiceForRentChange,
  effectiveDate: string,
): boolean {
  const status = String(inv.status || "").toUpperCase();
  if (status === "PAID" || status === "VOID") return false;
  if (status !== "OPEN" && status !== "PARTIAL") return false;
  const due = toDateOnly(inv.due_date);
  return due >= toDateOnly(effectiveDate);
}

/**
 * Suggested effective dates: today (business date) and next billing period start.
 */
export function getProspectiveEffectiveDateOptions(args: {
  businessDate: string;
  leaseStartDate: string;
  rentCadence: string;
  rentDueDay?: number | null;
}): string[] {
  const business = toDateOnly(args.businessDate);
  const start = toDateOnly(args.leaseStartDate);
  const cadence = String(args.rentCadence || "monthly").toLowerCase();
  const rentDueDay = args.rentDueDay || 1;
  const options = new Set<string>([business]);

  if (cadence === "weekly") {
    const cursor = new Date(start + "T00:00:00");
    const end = new Date(business + "T00:00:00");
    end.setDate(end.getDate() + 366);
    while (cursor <= end) {
      const due = cursor.toISOString().split("T")[0];
      if (due > business) {
        options.add(due);
        break;
      }
      cursor.setDate(cursor.getDate() + 7);
    }
  } else if (cadence === "biweekly") {
    const cursor = new Date(start + "T00:00:00");
    const end = new Date(business + "T00:00:00");
    end.setDate(end.getDate() + 366);
    while (cursor <= end) {
      const due = cursor.toISOString().split("T")[0];
      if (due > business) {
        options.add(due);
        break;
      }
      cursor.setDate(cursor.getDate() + 14);
    }
  } else {
    const cursor = new Date(business + "T00:00:00");
    for (let i = 0; i < 3; i++) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const dueDay = Math.min(rentDueDay, daysInMonth);
      const due = `${year}-${String(month + 1).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`;
      if (due > business) {
        options.add(due);
        break;
      }
      cursor.setMonth(cursor.getMonth() + 1);
      cursor.setDate(1);
    }
  }

  return Array.from(options).sort();
}

/**
 * Build a read-only preview of prospective rent updates for existing invoices.
 */
export function buildRentChangePreview(args: {
  invoices: InvoiceForRentChange[];
  oldRent: number;
  newRent: number;
  effectiveDate: string;
  businessDate: string;
}): RentChangePreview {
  const newRent = round2(Number(args.newRent) || 0);
  const oldRent = round2(Number(args.oldRent) || 0);
  const effectiveDate = toDateOnly(args.effectiveDate);
  const businessDate = toDateOnly(args.businessDate);

  let skippedPaid = 0;
  let skippedVoid = 0;
  let skippedPast = 0;

  for (const inv of args.invoices) {
    const s = String(inv.status || "").toUpperCase();
    const due = toDateOnly(inv.due_date);
    if (s === "PAID") skippedPaid++;
    else if (s === "VOID") skippedVoid++;
    else if (
      (s === "OPEN" || s === "PARTIAL") &&
      due < effectiveDate
    ) {
      skippedPast++;
    }
  }

  const patches: RentChangeInvoicePatch[] = [];

  for (const inv of args.invoices) {
    if (!invoiceEligibleForRentChange(inv, effectiveDate)) {
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
      due_date: toDateOnly(inv.due_date),
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
    oldRent,
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
    skippedPast,
    skippedPaid,
    skippedVoid,
  };
}
