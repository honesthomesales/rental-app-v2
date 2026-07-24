/**
 * Authoritative newest-eligible-invoice-first payment allocation.
 * Used by Manual Payment Entry and all future provider settlement paths.
 * Historical payments posted before this change are not rewritten.
 */

export type AllocatableInvoice = {
  id: string;
  dueDate: string;
  /** Optional period/sequence for deterministic ordering within the same due date */
  sequence?: number | string | null;
  balanceDue: number;
  status?: string | null;
};

export type AllocationSplit = {
  invoiceId: string;
  amount: number;
  dueDate: string;
};

export type AllocationPlan = {
  splits: AllocationSplit[];
  allocatedAmount: number;
  unallocatedAmount: number;
};

function toDateOnly(iso: string | null | undefined): string {
  return String(iso || "").split("T")[0];
}

function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isCancelledOrVoid(status: string | null | undefined): boolean {
  const s = String(status || "").toUpperCase();
  return s === "VOID" || s === "CANCELLED" || s === "CANCELED";
}

/**
 * Eligible invoices: unpaid balance, not void/cancelled, due on or before
 * the payment effective date (America/New_York business date already applied
 * by the caller via paymentDate / asOfDate).
 */
export function selectEligibleInvoicesForAllocation(
  invoices: AllocatableInvoice[],
  paymentEffectiveDate: string,
): AllocatableInvoice[] {
  const asOf = toDateOnly(paymentEffectiveDate);
  return invoices.filter((inv) => {
    if (isCancelledOrVoid(inv.status)) return false;
    const due = toDateOnly(inv.dueDate);
    if (!due || due > asOf) return false;
    return money(inv.balanceDue) > 0.009;
  });
}

/**
 * Order: due date DESC, sequence DESC, id ASC (stable tie-breaker).
 */
export function orderInvoicesNewestFirst(
  invoices: AllocatableInvoice[],
): AllocatableInvoice[] {
  return [...invoices].sort((a, b) => {
    const dueCmp = toDateOnly(b.dueDate).localeCompare(toDateOnly(a.dueDate));
    if (dueCmp !== 0) return dueCmp;
    const seqA = a.sequence == null ? "" : String(a.sequence);
    const seqB = b.sequence == null ? "" : String(b.sequence);
    if (seqA !== seqB) return seqB.localeCompare(seqA);
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Allocate paymentAmount newest-eligible-invoice-first.
 * Does not mutate inputs. Deterministic for the same invoice set + amount.
 */
export function allocateNewestEligibleFirst(args: {
  paymentAmount: number;
  paymentEffectiveDate: string;
  invoices: AllocatableInvoice[];
}): AllocationPlan {
  const amount = money(args.paymentAmount);
  if (amount <= 0) {
    return { splits: [], allocatedAmount: 0, unallocatedAmount: 0 };
  }

  const eligible = orderInvoicesNewestFirst(
    selectEligibleInvoicesForAllocation(
      args.invoices,
      args.paymentEffectiveDate,
    ),
  );

  const splits: AllocationSplit[] = [];
  let remaining = amount;

  for (const inv of eligible) {
    if (remaining <= 0.009) break;
    const due = money(inv.balanceDue);
    if (due <= 0.009) continue;
    const apply = money(Math.min(remaining, due));
    if (apply <= 0.009) continue;
    splits.push({
      invoiceId: inv.id,
      amount: apply,
      dueDate: toDateOnly(inv.dueDate),
    });
    remaining = money(remaining - apply);
  }

  const allocatedAmount = money(amount - remaining);
  return {
    splits,
    allocatedAmount,
    unallocatedAmount: money(remaining),
  };
}
