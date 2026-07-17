/**
 * Apply Billy missing-obligation decisions onto an analysis result.
 * Pure / in-memory — never writes invoices or lease terms.
 */

export type BillyMissingObligationDecision = {
  action: "reject_all_proposed" | "approve_listed" | "retain_payments";
  approvedMissingAmount?: number;
  retainPaymentsBalance?: boolean;
  rejectedDueDates?: string[];
  approvedDueDates?: string[];
  confirmedRentAmount?: number;
  confirmedCadence?: string;
  dataFlags?: string[];
  billyDecision?: string;
  billyNotes?: string;
};

export type AppliedMissingObligationDecision = {
  approvedMissingAmount: number;
  approvedRows: Array<{ dueDate: string; amount: number }>;
  rejectedRows: Array<{ dueDate: string; amount: number; reason: string }>;
  retainPaymentsBalance: boolean;
  dataFlags: string[];
  resolved: boolean;
  billyDecision: string;
  billyNotes: string;
  confirmedRentAmount: number | null;
  confirmedCadence: string | null;
};

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Apply a Billy decision to proposed missing rows.
 * reject_all_proposed → approvedMissingAmount = 0, all rows rejected.
 */
export function applyBillyMissingObligationDecision(args: {
  proposedMissing: Array<{ dueDate: string; rentAmount: number }>;
  decision: BillyMissingObligationDecision | null | undefined;
}): AppliedMissingObligationDecision {
  const proposed = args.proposedMissing || [];
  const d = args.decision;

  if (!d) {
    const total = round2(proposed.reduce((s, r) => s + r.rentAmount, 0));
    return {
      approvedMissingAmount: total,
      approvedRows: proposed.map((r) => ({
        dueDate: r.dueDate,
        amount: r.rentAmount,
      })),
      rejectedRows: [],
      retainPaymentsBalance: false,
      dataFlags: [],
      resolved: false,
      billyDecision: "",
      billyNotes: "",
      confirmedRentAmount: null,
      confirmedCadence: null,
    };
  }

  if (d.action === "reject_all_proposed" || d.action === "retain_payments") {
    const rejectedDue = new Set(d.rejectedDueDates || proposed.map((r) => r.dueDate));
    return {
      approvedMissingAmount: 0,
      approvedRows: [],
      rejectedRows: proposed
        .filter((r) => rejectedDue.has(r.dueDate) || !d.rejectedDueDates?.length)
        .map((r) => ({
          dueDate: r.dueDate,
          amount: r.rentAmount,
          reason: "Billy rejected proposed missing obligation",
        })),
      retainPaymentsBalance: d.retainPaymentsBalance !== false,
      dataFlags: [...(d.dataFlags || [])],
      resolved: true,
      billyDecision: d.billyDecision || "Reject proposed missing obligations; retain Payments.",
      billyNotes: d.billyNotes || "",
      confirmedRentAmount:
        d.confirmedRentAmount != null ? Number(d.confirmedRentAmount) : null,
      confirmedCadence: d.confirmedCadence || null,
    };
  }

  if (d.action === "approve_listed") {
    const approve = new Set(d.approvedDueDates || []);
    const approvedRows = proposed
      .filter((r) => approve.has(r.dueDate))
      .map((r) => ({ dueDate: r.dueDate, amount: r.rentAmount }));
    const rejectedRows = proposed
      .filter((r) => !approve.has(r.dueDate))
      .map((r) => ({
        dueDate: r.dueDate,
        amount: r.rentAmount,
        reason: "Not in Billy approved due-date list",
      }));
    const approvedMissingAmount =
      d.approvedMissingAmount != null
        ? round2(d.approvedMissingAmount)
        : round2(approvedRows.reduce((s, r) => s + r.amount, 0));
    return {
      approvedMissingAmount,
      approvedRows,
      rejectedRows,
      retainPaymentsBalance: !!d.retainPaymentsBalance,
      dataFlags: [...(d.dataFlags || [])],
      resolved: true,
      billyDecision: d.billyDecision || "Approve listed missing obligations.",
      billyNotes: d.billyNotes || "",
      confirmedRentAmount:
        d.confirmedRentAmount != null ? Number(d.confirmedRentAmount) : null,
      confirmedCadence: d.confirmedCadence || null,
    };
  }

  return {
    approvedMissingAmount: 0,
    approvedRows: [],
    rejectedRows: [],
    retainPaymentsBalance: true,
    dataFlags: [],
    resolved: true,
    billyDecision: d.billyDecision || "",
    billyNotes: d.billyNotes || "",
    confirmedRentAmount: null,
    confirmedCadence: null,
  };
}
