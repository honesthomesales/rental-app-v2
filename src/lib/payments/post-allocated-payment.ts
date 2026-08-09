import {
  allocateNewestEligibleFirst,
  type AllocatableInvoice,
  type AllocationPlan,
} from "@/lib/payments/allocate-newest-first";
import { allocateSelectedInvoiceForward } from "@/lib/payments/allocate-selected-forward";

export type InvoiceRowForAllocation = {
  id: string;
  due_date: string;
  period_start?: string | null;
  period_end?: string | null;
  balance_due?: number | null;
  amount_total?: number | null;
  amount_paid?: number | null;
  status?: string | null;
};

/**
 * Map DB invoice rows into the shared allocator input shape.
 */
export function toAllocatableInvoices(
  rows: InvoiceRowForAllocation[],
): AllocatableInvoice[] {
  return rows.map((row) => {
    const total = Number(row.amount_total ?? 0);
    const paid = Number(row.amount_paid ?? 0);
    const balance =
      row.balance_due != null && Number.isFinite(Number(row.balance_due))
        ? Number(row.balance_due)
        : total - paid;
    return {
      id: String(row.id),
      dueDate: String(row.due_date || "").split("T")[0],
      sequence: row.period_end || row.period_start || null,
      balanceDue: balance,
      status: row.status,
    };
  });
}

export function planNewestFirstAllocation(args: {
  paymentAmount: number;
  paymentEffectiveDate: string;
  invoices: InvoiceRowForAllocation[];
}): AllocationPlan {
  return allocateNewestEligibleFirst({
    paymentAmount: args.paymentAmount,
    paymentEffectiveDate: args.paymentEffectiveDate,
    invoices: toAllocatableInvoices(args.invoices),
  });
}

export function planSelectedInvoiceForwardAllocation(args: {
  paymentAmount: number;
  selectedInvoiceId: string;
  invoices: InvoiceRowForAllocation[];
}): AllocationPlan {
  return allocateSelectedInvoiceForward({
    paymentAmount: args.paymentAmount,
    selectedInvoiceId: args.selectedInvoiceId,
    invoices: toAllocatableInvoices(args.invoices),
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
