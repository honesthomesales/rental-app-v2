import type {
  AllocatableInvoice,
  AllocationPlan,
  AllocationSplit,
} from "@/lib/payments/allocate-newest-first";

function toDateOnly(iso: string | null | undefined): string {
  return String(iso || "").split("T")[0];
}

function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isCancelledOrVoid(status: string | null | undefined): boolean {
  const normalized = String(status || "").toUpperCase();
  return (
    normalized === "VOID" ||
    normalized === "CANCELLED" ||
    normalized === "CANCELED"
  );
}

/**
 * Chronological invoice order: due date ASC, sequence ASC, id ASC.
 */
export function orderInvoicesOldestFirst(
  invoices: AllocatableInvoice[],
): AllocatableInvoice[] {
  return [...invoices].sort((a, b) => {
    const dueCmp = toDateOnly(a.dueDate).localeCompare(toDateOnly(b.dueDate));
    if (dueCmp !== 0) return dueCmp;
    const seqA = a.sequence == null ? "" : String(a.sequence);
    const seqB = b.sequence == null ? "" : String(b.sequence);
    if (seqA !== seqB) return seqA.localeCompare(seqB);
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Apply to the explicitly selected invoice first, then carry any remainder
 * forward to later invoices for the same lease in chronological due-date order.
 * Earlier invoices are intentionally not considered. Later invoices may be
 * prepaid even when their due date is after the payment effective date.
 */
export function allocateSelectedInvoiceForward(args: {
  paymentAmount: number;
  selectedInvoiceId: string;
  invoices: AllocatableInvoice[];
}): AllocationPlan {
  const amount = money(args.paymentAmount);
  if (amount <= 0) {
    return { splits: [], allocatedAmount: 0, unallocatedAmount: 0 };
  }

  const ordered = orderInvoicesOldestFirst(args.invoices);
  const selectedIndex = ordered.findIndex(
    (invoice) => String(invoice.id) === String(args.selectedInvoiceId),
  );

  if (selectedIndex < 0) {
    return { splits: [], allocatedAmount: 0, unallocatedAmount: amount };
  }

  const selected = ordered[selectedIndex];
  const laterInvoices = ordered
    .slice(selectedIndex + 1)
    .filter(
      (invoice) => toDateOnly(invoice.dueDate) > toDateOnly(selected.dueDate),
    );
  const candidates = [selected, ...laterInvoices];

  const splits: AllocationSplit[] = [];
  let remaining = amount;

  for (const invoice of candidates) {
    if (remaining <= 0.009) break;
    if (isCancelledOrVoid(invoice.status)) continue;
    const balanceDue = money(invoice.balanceDue);
    if (balanceDue <= 0.009) continue;
    const applied = money(Math.min(remaining, balanceDue));
    if (applied <= 0.009) continue;
    splits.push({
      invoiceId: invoice.id,
      amount: applied,
      dueDate: toDateOnly(invoice.dueDate),
    });
    remaining = money(remaining - applied);
  }

  return {
    splits,
    allocatedAmount: money(amount - remaining),
    unallocatedAmount: money(remaining),
  };
}
