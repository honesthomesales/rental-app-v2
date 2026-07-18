export type CorrectableInvoice = {
  id: string;
  lease_id: string;
  due_date: string;
  period_start: string | null;
  period_end: string | null;
  status: string;
  amount_rent: number;
  amount_late: number;
  amount_other: number;
  amount_paid: number;
  amount_total: number;
  balance_due: number;
};

export type InvoiceCorrectionPlan = {
  invoiceId: string;
  before: CorrectableInvoice;
  after: CorrectableInvoice;
};

function money(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function invoiceCanBeCorrected(status: string): boolean {
  const normalized = String(status || "").toUpperCase();
  return normalized === "OPEN" || normalized === "PARTIAL";
}

export function planInvoiceCorrection(args: {
  invoice: CorrectableInvoice;
  amountRent: number;
  amountLate: number;
  amountOther: number;
  eligiblePaidAmount: number;
}): InvoiceCorrectionPlan {
  if (!invoiceCanBeCorrected(args.invoice.status)) {
    throw new Error("Only OPEN or PARTIAL invoices can be corrected");
  }

  const amountRent = money(args.amountRent);
  const amountLate = money(args.amountLate);
  const amountOther = money(args.amountOther);
  const eligiblePaid = money(args.eligiblePaidAmount);
  for (const value of [amountRent, amountLate, amountOther]) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("Invoice amounts must be non-negative numbers");
    }
  }

  const amountTotal = money(amountRent + amountLate + amountOther);
  const balanceDue = money(Math.max(0, amountTotal - eligiblePaid));
  const status =
    balanceDue <= 0.009 ? "PAID" : eligiblePaid > 0.009 ? "PARTIAL" : "OPEN";

  return {
    invoiceId: args.invoice.id,
    before: { ...args.invoice },
    after: {
      ...args.invoice,
      amount_rent: amountRent,
      amount_late: amountLate,
      amount_other: amountOther,
      amount_total: amountTotal,
      balance_due: balanceDue,
      status,
    },
  };
}
