import { supabaseServer } from "@/lib/supabase-server";
import { monthBounds } from "@/lib/date-month";
import {
  buildCollectedMonthCollectionFacts,
  type LedgerPayment,
} from "@/lib/portfolio-ledger/service";

const INVOICE_CHUNK = 150;
const PAGE_SIZE = 1000;

export type ProfitPaymentRow = LedgerPayment & {
  property_id?: string | null;
  tenant_id?: string | null;
};

function normalizePaymentRow(row: {
  id: string | number;
  property_id?: string | null;
  lease_id?: string | null;
  tenant_id?: string | null;
  invoice_id?: string | null;
  amount?: string | number | null;
  payment_date?: string | null;
  status?: string | null;
}): ProfitPaymentRow {
  return {
    id: String(row.id),
    property_id: row.property_id ? String(row.property_id) : null,
    lease_id: String(row.lease_id || ""),
    tenant_id: row.tenant_id ? String(row.tenant_id) : null,
    invoice_id: row.invoice_id ? String(row.invoice_id) : null,
    amount: Number(row.amount) || 0,
    payment_date: String(row.payment_date || ""),
    status: row.status,
  };
}

/** Paginated payments whose payment_date falls in [start, end]. */
export async function fetchPaymentsByPaymentDateRange(
  rangeStart: string,
  rangeEnd: string,
): Promise<ProfitPaymentRow[]> {
  const rows: ProfitPaymentRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabaseServer
      .from("RENT_payments")
      .select(
        "id, property_id, lease_id, tenant_id, invoice_id, amount, payment_date, status",
      )
      .gte("payment_date", rangeStart)
      .lte("payment_date", rangeEnd)
      .order("payment_date", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const chunk = data || [];
    rows.push(...chunk.map(normalizePaymentRow));
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

/** All payments linked to the given invoice ids (any payment_date). */
export async function fetchPaymentsForInvoiceIds(
  invoiceIds: string[],
): Promise<ProfitPaymentRow[]> {
  if (invoiceIds.length === 0) return [];

  const rows: ProfitPaymentRow[] = [];
  for (let i = 0; i < invoiceIds.length; i += INVOICE_CHUNK) {
    const chunk = invoiceIds.slice(i, i + INVOICE_CHUNK);
    const { data, error } = await supabaseServer
      .from("RENT_payments")
      .select(
        "id, property_id, lease_id, tenant_id, invoice_id, amount, payment_date, status",
      )
      .in("invoice_id", chunk);

    if (error) throw error;
    rows.push(...(data || []).map(normalizePaymentRow));
  }
  return rows;
}

/** Dedupe by payment id — first occurrence wins. */
export function mergeProfitPayments(
  ...groups: ProfitPaymentRow[][]
): ProfitPaymentRow[] {
  const byId = new Map<string, ProfitPaymentRow>();
  for (const group of groups) {
    for (const payment of group) {
      if (!byId.has(payment.id)) {
        byId.set(payment.id, payment);
      }
    }
  }
  return [...byId.values()];
}

/**
 * Rent collected for a profit month:
 * - Invoiced payments → invoice due month (early pay for next month counts there).
 * - Non-invoiced payments → payment_date month (orphan / misc posts).
 */
export async function fetchProfitMonthPayments(
  monthStart: string,
  monthEnd: string,
): Promise<ProfitPaymentRow[]> {
  const invoiceDueDateById = await fetchInvoiceMetaInRange(
    monthStart,
    monthEnd,
  );
  const invoiceIds = [...invoiceDueDateById.keys()];
  const [byInvoiceDue, byPaymentDate] = await Promise.all([
    fetchPaymentsForInvoiceIds(invoiceIds),
    fetchPaymentsByPaymentDateRange(monthStart, monthEnd),
  ]);
  const orphanPayments = byPaymentDate.filter((payment) => !payment.invoice_id);
  return mergeProfitPayments(byInvoiceDue, orphanPayments);
}

export function buildProfitMonthCollectionFacts(args: {
  payments: ProfitPaymentRow[];
  leasePropertyById: Map<string, string>;
  monthStart: string;
  monthEnd: string;
}) {
  return buildCollectedMonthCollectionFacts({
    payments: args.payments,
    leasePropertyById: args.leasePropertyById,
    monthStart: args.monthStart,
    monthEnd: args.monthEnd,
    asOfDate: args.monthEnd,
  });
}

export async function fetchProfitMonthRentCollected(args: {
  monthStart: string;
  monthEnd: string;
  leasePropertyById: Map<string, string>;
}): Promise<ReturnType<typeof buildCollectedMonthCollectionFacts>> {
  const payments = await fetchProfitMonthPayments(
    args.monthStart,
    args.monthEnd,
  );
  return buildProfitMonthCollectionFacts({
    payments,
    leasePropertyById: args.leasePropertyById,
    monthStart: args.monthStart,
    monthEnd: args.monthEnd,
  });
}

/** Pick payments that belong to a profit month (invoice due or orphan payment_date). */
export function selectProfitPaymentsForMonth(
  payments: ProfitPaymentRow[],
  invoiceDueDateById: Map<string, string>,
  monthStart: string,
  monthEnd: string,
): ProfitPaymentRow[] {
  const selected = new Map<string, ProfitPaymentRow>();
  for (const payment of payments) {
    const invoiceDue = payment.invoice_id
      ? invoiceDueDateById.get(payment.invoice_id)
      : null;

    if (payment.invoice_id && invoiceDue) {
      if (invoiceDue >= monthStart && invoiceDue <= monthEnd) {
        selected.set(payment.id, payment);
      }
      continue;
    }

    if (!payment.invoice_id) {
      const paymentDate = String(payment.payment_date || "");
      if (paymentDate >= monthStart && paymentDate <= monthEnd) {
        selected.set(payment.id, payment);
      }
    }
  }
  return [...selected.values()];
}

export type ProfitInvoiceMeta = {
  due_date: string;
  property_id: string | null;
};

export async function fetchInvoiceMetaInRange(
  rangeStart: string,
  rangeEnd: string,
): Promise<Map<string, ProfitInvoiceMeta>> {
  const map = new Map<string, ProfitInvoiceMeta>();
  let from = 0;
  for (;;) {
    const { data, error } = await supabaseServer
      .from("RENT_invoices")
      .select("id, due_date, property_id")
      .gte("due_date", rangeStart)
      .lte("due_date", rangeEnd)
      .order("due_date", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const chunk = data || [];
    for (const row of chunk) {
      if (row.id && row.due_date) {
        map.set(String(row.id), {
          due_date: String(row.due_date),
          property_id: row.property_id ? String(row.property_id) : null,
        });
      }
    }
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return map;
}

export async function fetchInvoiceDueDatesInRange(
  rangeStart: string,
  rangeEnd: string,
): Promise<Map<string, string>> {
  const meta = await fetchInvoiceMetaInRange(rangeStart, rangeEnd);
  const map = new Map<string, string>();
  for (const [id, row] of meta) {
    map.set(id, row.due_date);
  }
  return map;
}

export function resolveProfitPaymentPropertyId(
  payment: ProfitPaymentRow,
  leasePropertyById: Map<string, string>,
  invoiceMetaById: Map<string, ProfitInvoiceMeta>,
): string | null {
  if (payment.property_id) return String(payment.property_id);
  if (payment.lease_id) {
    const fromLease = leasePropertyById.get(payment.lease_id);
    if (fromLease) return fromLease;
  }
  if (payment.invoice_id) {
    const fromInvoice = invoiceMetaById.get(payment.invoice_id)?.property_id;
    if (fromInvoice) return fromInvoice;
  }
  return null;
}

export function filterEligiblePaymentsForProperty(
  payments: ProfitPaymentRow[],
  propertyId: string,
  leasePropertyById: Map<string, string>,
  invoiceMetaById: Map<string, ProfitInvoiceMeta>,
): ProfitPaymentRow[] {
  return payments.filter(
    (payment) =>
      resolveProfitPaymentPropertyId(
        payment,
        leasePropertyById,
        invoiceMetaById,
      ) === propertyId,
  );
}

export async function fetchProfitRentCollectedByMonthKeys(args: {
  monthKeys: string[];
  leasePropertyById: Map<string, string>;
}): Promise<Map<string, number>> {
  if (args.monthKeys.length === 0) return new Map();

  const rangeStart = `${args.monthKeys[0]}-01`;
  const lastKey = args.monthKeys[args.monthKeys.length - 1];
  const rangeEnd = monthBounds(lastKey).end;

  const invoiceDueDateById = await fetchInvoiceDueDatesInRange(
    rangeStart,
    rangeEnd,
  );
  const invoiceIds = [...invoiceDueDateById.keys()];
  const [byInvoiceDue, byPaymentDate] = await Promise.all([
    fetchPaymentsForInvoiceIds(invoiceIds),
    fetchPaymentsByPaymentDateRange(rangeStart, rangeEnd),
  ]);
  const orphanPayments = byPaymentDate.filter((payment) => !payment.invoice_id);
  const allPayments = mergeProfitPayments(byInvoiceDue, orphanPayments);

  const rentByMonth = new Map<string, number>();
  for (const monthKey of args.monthKeys) {
    const { start, end } = monthBounds(monthKey);
    const monthPayments = selectProfitPaymentsForMonth(
      allPayments,
      invoiceDueDateById,
      start,
      end,
    );
    const facts = buildProfitMonthCollectionFacts({
      payments: monthPayments,
      leasePropertyById: args.leasePropertyById,
      monthStart: start,
      monthEnd: end,
    });
    rentByMonth.set(monthKey, facts.totalCollected);
  }
  return rentByMonth;
}
