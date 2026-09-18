/**
 * Canonical invoice balance from charges and actual payment rows.
 * Never trusts stored amount_paid, balance_due, or PAID/OPEN/PARTIAL status.
 */

export function roundInvoiceMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function isVoidOrCancelledStatus(
  status: string | null | undefined,
): boolean {
  const normalized = String(status || "").toUpperCase();
  return (
    normalized === "VOID" ||
    normalized === "CANCELLED" ||
    normalized === "CANCELED"
  );
}

export type InvoiceChargeFields = {
  amount_total?: number | string | null;
  amount_rent?: number | string | null;
  amount_late?: number | string | null;
  amount_other?: number | string | null;
};

/**
 * Prefer rent + late + other (ledger parity). Fall back to amount_total.
 */
export function computeInvoiceChargeTotal(invoice: InvoiceChargeFields): number {
  const hasComponent =
    invoice.amount_rent != null ||
    invoice.amount_late != null ||
    invoice.amount_other != null;
  if (hasComponent) {
    return roundInvoiceMoney(
      (Number(invoice.amount_rent) || 0) +
        (Number(invoice.amount_late) || 0) +
        (Number(invoice.amount_other) || 0),
    );
  }
  return roundInvoiceMoney(Number(invoice.amount_total) || 0);
}

export type PaymentAmountFields = {
  id?: string | null;
  invoice_id?: string | null;
  amount?: number | string | null;
  status?: string | null;
  payment_date?: string | null;
};

function isCompletedPositive(payment: PaymentAmountFields): boolean {
  if (String(payment.status || "completed").toLowerCase() !== "completed") {
    return false;
  }
  return (Number(payment.amount) || 0) > 0;
}

/**
 * Sum completed positive payments linked to an invoice.
 * By default includes future-dated completed rows (ledger / staff posting parity).
 * Pass asOfDate to count only payment_date <= asOf (eligible-as-of mode).
 */
export function sumCompletedPaymentsForInvoice(
  payments: PaymentAmountFields[],
  invoiceId: string,
  asOfDate?: string | null,
): number {
  const asOf = asOfDate ? String(asOfDate).split("T")[0] : null;
  let sum = 0;
  for (const payment of payments) {
    if (String(payment.invoice_id || "") !== String(invoiceId)) continue;
    if (!isCompletedPositive(payment)) continue;
    if (asOf) {
      const pd = String(payment.payment_date || "").split("T")[0];
      if (!pd || pd > asOf) continue;
    }
    sum = roundInvoiceMoney(sum + (Number(payment.amount) || 0));
  }
  return sum;
}

export function buildCompletedPaidByInvoiceMap(
  payments: PaymentAmountFields[],
  asOfDate?: string | null,
): Map<string, number> {
  const map = new Map<string, number>();
  const asOf = asOfDate ? String(asOfDate).split("T")[0] : null;
  for (const payment of payments) {
    const invoiceId = payment.invoice_id ? String(payment.invoice_id) : "";
    if (!invoiceId) continue;
    if (!isCompletedPositive(payment)) continue;
    if (asOf) {
      const pd = String(payment.payment_date || "").split("T")[0];
      if (!pd || pd > asOf) continue;
    }
    map.set(
      invoiceId,
      roundInvoiceMoney((map.get(invoiceId) || 0) + (Number(payment.amount) || 0)),
    );
  }
  return map;
}

/** Raw balance; may be negative when overpaid. */
export function computeRawInvoiceBalance(
  chargeTotal: number,
  paidAmount: number,
): number {
  return roundInvoiceMoney(chargeTotal - paidAmount);
}

/** Amount still owed for allocation / collectible totals; never negative. */
export function computeRealAmountOwed(
  chargeTotal: number,
  paidAmount: number,
): number {
  return Math.max(0, computeRawInvoiceBalance(chargeTotal, paidAmount));
}

/**
 * Canonical per-invoice owed from invoice charge fields + actual payment rows.
 * Ignores stored amount_paid, balance_due, and status (except callers may skip void).
 */
export function computeInvoiceRealAmountOwed(args: {
  invoice: InvoiceChargeFields & { id: string; status?: string | null };
  payments: PaymentAmountFields[];
  asOfDate?: string | null;
}): number {
  if (isVoidOrCancelledStatus(args.invoice.status)) return 0;
  const chargeTotal = computeInvoiceChargeTotal(args.invoice);
  const paidAmount = sumCompletedPaymentsForInvoice(
    args.payments,
    args.invoice.id,
    args.asOfDate,
  );
  return computeRealAmountOwed(chargeTotal, paidAmount);
}
