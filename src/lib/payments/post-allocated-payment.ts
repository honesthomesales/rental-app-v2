import {
  allocateNewestEligibleFirst,
  type AllocatableInvoice,
  type AllocationPlan,
} from "@/lib/payments/allocate-newest-first";
import { allocateSelectedInvoiceForward } from "@/lib/payments/allocate-selected-forward";
import {
  buildCompletedPaidByInvoiceMap,
  computeInvoiceChargeTotal,
  computeRealAmountOwed,
  type PaymentAmountFields,
} from "@/lib/invoice-real-balance";

export type InvoiceRowForAllocation = {
  id: string;
  due_date: string;
  period_start?: string | null;
  period_end?: string | null;
  balance_due?: number | null;
  amount_total?: number | null;
  amount_paid?: number | null;
  amount_rent?: number | null;
  amount_late?: number | null;
  amount_other?: number | null;
  status?: string | null;
};

export type PaymentRowForAllocation = PaymentAmountFields;

/**
 * Map DB invoice rows into the shared allocator input shape.
 * Balance is charges minus actual completed payment rows — never stored
 * amount_paid / balance_due / PAID status.
 */
export function toAllocatableInvoices(
  rows: InvoiceRowForAllocation[],
  payments: PaymentRowForAllocation[] = [],
): AllocatableInvoice[] {
  const paidByInvoice = buildCompletedPaidByInvoiceMap(payments);
  return rows.map((row) => {
    const chargeTotal = computeInvoiceChargeTotal(row);
    const paidAmount = paidByInvoice.get(String(row.id)) || 0;
    return {
      id: String(row.id),
      dueDate: String(row.due_date || "").split("T")[0],
      sequence: row.period_end || row.period_start || null,
      balanceDue: computeRealAmountOwed(chargeTotal, paidAmount),
      status: row.status,
    };
  });
}

export function planNewestFirstAllocation(args: {
  paymentAmount: number;
  paymentEffectiveDate: string;
  invoices: InvoiceRowForAllocation[];
  payments?: PaymentRowForAllocation[];
}): AllocationPlan {
  return allocateNewestEligibleFirst({
    paymentAmount: args.paymentAmount,
    paymentEffectiveDate: args.paymentEffectiveDate,
    invoices: toAllocatableInvoices(args.invoices, args.payments || []),
  });
}

export function planSelectedInvoiceForwardAllocation(args: {
  paymentAmount: number;
  selectedInvoiceId: string;
  invoices: InvoiceRowForAllocation[];
  payments?: PaymentRowForAllocation[];
}): AllocationPlan {
  return allocateSelectedInvoiceForward({
    paymentAmount: args.paymentAmount,
    selectedInvoiceId: args.selectedInvoiceId,
    invoices: toAllocatableInvoices(args.invoices, args.payments || []),
  });
}

/** Shared note prefix so allocation legs can be grouped in history. */
export function allocationGroupNote(
  groupId: string,
  part: number,
  total: number,
  strategy: "newest_first" | "selected_forward" = "newest_first",
) {
  return `${strategy}_alloc:${groupId} ${part}/${total}`;
}

const DEFERRED_SELECTED_INVOICE_PREFIX = "deferred_selected_invoice:";

export function withDeferredSelectedInvoiceNote(
  note: string,
  invoiceId: string,
): string {
  return [note, `${DEFERRED_SELECTED_INVOICE_PREFIX}${invoiceId}`]
    .filter(Boolean)
    .join(" | ");
}

export function getDeferredSelectedInvoiceId(
  note: string | null | undefined,
): string | null {
  const segment = String(note || "")
    .split(" | ")
    .find((part) => part.startsWith(DEFERRED_SELECTED_INVOICE_PREFIX));
  return segment?.slice(DEFERRED_SELECTED_INVOICE_PREFIX.length) || null;
}

export function withoutDeferredSelectedInvoiceNote(
  note: string | null | undefined,
): string {
  return String(note || "")
    .split(" | ")
    .filter((part) => !part.startsWith(DEFERRED_SELECTED_INVOICE_PREFIX))
    .filter(Boolean)
    .join(" | ");
}
