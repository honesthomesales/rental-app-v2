import { normalizeCadence, type Cadence } from "@/lib/rent/cadence";

export type CadenceInvoice = {
  id: string;
  due_date: string;
  period_start?: string | null;
  period_end?: string | null;
  status?: string | null;
  amount_rent?: number | null;
  amount_paid?: number | null;
  created_at?: string | null;
};

export type CadenceExceptionReason =
  | "duplicate_due_date"
  | "identical_period"
  | "overlapping_period"
  | "weekly_and_biweekly_cover_same_days"
  | "period_inconsistent_with_current_cadence";

export type CadenceExceptionAction =
  | "keep_canonical"
  | "candidate_void_unpaid_duplicate_after_approval"
  | "manual_review_leave_untouched";

export type CadenceException = {
  invoiceId: string;
  relatedInvoiceIds: string[];
  reasons: CadenceExceptionReason[];
  inferredCadence: Cadence | null;
  matchesCurrentCadence: boolean;
  recommendedCanonicalInvoiceId: string;
  recommendedAction: CadenceExceptionAction;
};

function dateOnly(value: string | null | undefined): string {
  return String(value || "").split("T")[0];
}

function dayNumber(value: string | null | undefined): number {
  const [year, month, day] = dateOnly(value).split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return Number.NaN;
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

export function invoicePeriodDays(
  invoice: Pick<CadenceInvoice, "period_start" | "period_end">,
): number | null {
  const start = dayNumber(invoice.period_start);
  const end = dayNumber(invoice.period_end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  return end - start + 1;
}

export function inferInvoiceCadence(
  invoice: Pick<CadenceInvoice, "period_start" | "period_end">,
): Cadence | null {
  const days = invoicePeriodDays(invoice);
  if (days === 7) return "weekly";
  if (days === 14) return "biweekly";
  if (!invoice.period_start || !invoice.period_end) return null;

  const start = new Date(`${dateOnly(invoice.period_start)}T00:00:00Z`);
  const end = new Date(`${dateOnly(invoice.period_end)}T00:00:00Z`);
  const expectedLastDay = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
  );
  if (
    start.getUTCDate() === 1 &&
    end.getUTCFullYear() === start.getUTCFullYear() &&
    end.getUTCMonth() === start.getUTCMonth() &&
    end.getUTCDate() === expectedLastDay.getUTCDate()
  ) {
    return "monthly";
  }
  return null;
}

export function invoicePeriodsOverlap(
  a: Pick<CadenceInvoice, "period_start" | "period_end">,
  b: Pick<CadenceInvoice, "period_start" | "period_end">,
): boolean {
  const aStart = dayNumber(a.period_start);
  const aEnd = dayNumber(a.period_end);
  const bStart = dayNumber(b.period_start);
  const bEnd = dayNumber(b.period_end);
  if (![aStart, aEnd, bStart, bEnd].every(Number.isFinite)) return false;
  return aStart <= bEnd && bStart <= aEnd;
}

function statusPriority(status: string | null | undefined): number {
  switch (String(status || "").toUpperCase()) {
    case "PAID":
      return 4;
    case "PARTIAL":
      return 3;
    case "OPEN":
      return 2;
    case "VOID":
      return 0;
    default:
      return 1;
  }
}

export function analyzeLeaseCadence(args: {
  currentCadence: string | null | undefined;
  cadenceEffectiveDate?: string | null;
  invoices: CadenceInvoice[];
  paymentInvoiceIds?: Set<string>;
}): {
  exceptions: CadenceException[];
  excludedInvoiceIds: Set<string>;
} {
  const currentCadence = normalizeCadence(args.currentCadence || "monthly");
  const effectiveDate = args.cadenceEffectiveDate
    ? dateOnly(args.cadenceEffectiveDate)
    : null;
  const invoices = [...args.invoices].filter(
    (invoice) => String(invoice.status || "").toUpperCase() !== "VOID",
  );
  const reasonsById = new Map<string, Set<CadenceExceptionReason>>();
  const relatedById = new Map<string, Set<string>>();
  const add = (
    invoiceId: string,
    reason: CadenceExceptionReason,
    relatedId?: string,
  ) => {
    const reasons = reasonsById.get(invoiceId) || new Set();
    reasons.add(reason);
    reasonsById.set(invoiceId, reasons);
    if (relatedId) {
      const related = relatedById.get(invoiceId) || new Set();
      related.add(relatedId);
      relatedById.set(invoiceId, related);
    }
  };

  for (let index = 0; index < invoices.length; index += 1) {
    const invoice = invoices[index];
    const inferred = inferInvoiceCadence(invoice);
    const cadenceApplies =
      !effectiveDate || dateOnly(invoice.due_date) >= effectiveDate;
    if (cadenceApplies && inferred !== currentCadence) {
      add(invoice.id, "period_inconsistent_with_current_cadence");
    }

    for (let otherIndex = index + 1; otherIndex < invoices.length; otherIndex += 1) {
      const other = invoices[otherIndex];
      if (dateOnly(invoice.due_date) === dateOnly(other.due_date)) {
        add(invoice.id, "duplicate_due_date", other.id);
        add(other.id, "duplicate_due_date", invoice.id);
      }
      if (
        invoice.period_start &&
        invoice.period_end &&
        dateOnly(invoice.period_start) === dateOnly(other.period_start) &&
        dateOnly(invoice.period_end) === dateOnly(other.period_end)
      ) {
        add(invoice.id, "identical_period", other.id);
        add(other.id, "identical_period", invoice.id);
      }
      if (invoicePeriodsOverlap(invoice, other)) {
        add(invoice.id, "overlapping_period", other.id);
        add(other.id, "overlapping_period", invoice.id);
        const inferredPair = new Set([
          inferInvoiceCadence(invoice),
          inferInvoiceCadence(other),
        ]);
        if (inferredPair.has("weekly") && inferredPair.has("biweekly")) {
          add(invoice.id, "weekly_and_biweekly_cover_same_days", other.id);
          add(other.id, "weekly_and_biweekly_cover_same_days", invoice.id);
        }
      }
    }
  }

  const exceptions: CadenceException[] = [];
  for (const invoice of invoices) {
    const reasons = [...(reasonsById.get(invoice.id) || [])];
    if (reasons.length === 0) continue;
    const related = [...(relatedById.get(invoice.id) || [])]
      .map((id) => invoices.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is CadenceInvoice => Boolean(candidate));
    const candidates = [invoice, ...related];
    const ranked = [...candidates].sort((a, b) => {
      const aHasPayments = args.paymentInvoiceIds?.has(a.id) || false;
      const bHasPayments = args.paymentInvoiceIds?.has(b.id) || false;
      return (
        Number(bHasPayments) - Number(aHasPayments) ||
        statusPriority(b.status) - statusPriority(a.status) ||
        Number(inferInvoiceCadence(b) === currentCadence) -
          Number(inferInvoiceCadence(a) === currentCadence) ||
        dateOnly(a.created_at).localeCompare(dateOnly(b.created_at)) ||
        a.id.localeCompare(b.id)
      );
    });
    const canonical = ranked[0];
    const hasPayments = args.paymentInvoiceIds?.has(invoice.id) || false;
    const protectedCandidates = candidates.filter(
      (candidate) =>
        args.paymentInvoiceIds?.has(candidate.id) ||
        ["PAID", "PARTIAL"].includes(
          String(candidate.status || "").toUpperCase(),
        ),
    );
    const ambiguous = protectedCandidates.length > 1;
    const protectedInvoice =
      hasPayments ||
      ["PAID", "PARTIAL"].includes(
        String(invoice.status || "").toUpperCase(),
      );
    const recommendedAction: CadenceExceptionAction =
      ambiguous || protectedInvoice
        ? "manual_review_leave_untouched"
        : canonical.id === invoice.id
          ? "keep_canonical"
          : "candidate_void_unpaid_duplicate_after_approval";

    exceptions.push({
      invoiceId: invoice.id,
      relatedInvoiceIds: related.map((candidate) => candidate.id),
      reasons,
      inferredCadence: inferInvoiceCadence(invoice),
      matchesCurrentCadence: inferInvoiceCadence(invoice) === currentCadence,
      recommendedCanonicalInvoiceId: canonical.id,
      recommendedAction,
    });
  }

  return {
    exceptions,
    excludedInvoiceIds: new Set(exceptions.map((exception) => exception.invoiceId)),
  };
}
