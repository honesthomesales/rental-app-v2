/**
 * Batched Supabase loaders for portfolio ledger (no per-lease HTTP).
 */

import { supabaseServer } from "@/lib/supabase-server";
import type {
  LedgerInvoice,
  LedgerLease,
  LedgerPayment,
} from "@/lib/portfolio-ledger/service";

const PAGE = 1000;

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE - 1;
    const { data, error } = await build(from, to);
    if (error) throw new Error(error.message);
    const chunk = data || [];
    out.push(...chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

export async function loadBillingLeases(): Promise<LedgerLease[]> {
  const rows = await fetchAll<Record<string, unknown>>((from, to) =>
    supabaseServer
      .from("RENT_leases")
      .select(
        `
        id, property_id, tenant_id, status, rent, rent_cadence, rent_due_day,
        lease_start_date, lease_end_date, late_fee_amount,
        RENT_properties(id, name, address, property_type),
        RENT_tenants(id, full_name, first_name, last_name)
      `,
      )
      .in("status", ["occupied", "eviction"])
      .range(from, to),
  );

  return rows.map((r) => {
    const prop = (r.RENT_properties || {}) as Record<string, unknown>;
    const ten = (r.RENT_tenants || {}) as Record<string, unknown>;
    const tenantName =
      (ten.full_name as string) ||
      [ten.first_name, ten.last_name].filter(Boolean).join(" ") ||
      "";
    return {
      id: String(r.id),
      property_id: String(r.property_id),
      tenant_id: String(r.tenant_id),
      status: String(r.status || ""),
      rent: Number(r.rent) || 0,
      rent_cadence: (r.rent_cadence as string) || "monthly",
      rent_due_day: r.rent_due_day != null ? Number(r.rent_due_day) : null,
      lease_start_date: (r.lease_start_date as string) || null,
      lease_end_date: (r.lease_end_date as string) || null,
      rent_effective_date: null,
      prior_rent: null,
      property_name:
        (prop.name as string) || (prop.address as string) || "",
      tenant_name: tenantName,
      property: prop,
      tenant: ten,
    };
  });
}

export async function loadInvoicesForLeases(
  leaseIds: string[],
): Promise<Map<string, LedgerInvoice[]>> {
  const map = new Map<string, LedgerInvoice[]>();
  if (leaseIds.length === 0) return map;

  // Chunk .in() filters to avoid URL limits
  const CHUNK = 100;
  for (let i = 0; i < leaseIds.length; i += CHUNK) {
    const slice = leaseIds.slice(i, i + CHUNK);
    const rows = await fetchAll<Record<string, unknown>>((from, to) =>
      supabaseServer
        .from("RENT_invoices")
        .select(
          "id, lease_id, due_date, period_start, period_end, status, amount_rent, amount_late, amount_other, amount_total, amount_paid, balance_due",
        )
        .in("lease_id", slice)
        .range(from, to),
    );
    for (const r of rows) {
      const leaseId = String(r.lease_id);
      const list = map.get(leaseId) || [];
      list.push({
        id: String(r.id),
        lease_id: leaseId,
        due_date: String(r.due_date),
        period_start: (r.period_start as string) || null,
        period_end: (r.period_end as string) || null,
        status: String(r.status || "OPEN"),
        amount_rent: Number(r.amount_rent) || 0,
        amount_late: Number(r.amount_late) || 0,
        amount_other: Number(r.amount_other) || 0,
        amount_total: Number(r.amount_total) || 0,
        amount_paid: Number(r.amount_paid) || 0,
        balance_due: Number(r.balance_due) || 0,
      });
      map.set(leaseId, list);
    }
  }
  return map;
}

export async function loadPaymentsForLeases(
  leaseIds: string[],
): Promise<Map<string, LedgerPayment[]>> {
  const map = new Map<string, LedgerPayment[]>();
  if (leaseIds.length === 0) return map;

  const CHUNK = 100;
  for (let i = 0; i < leaseIds.length; i += CHUNK) {
    const slice = leaseIds.slice(i, i + CHUNK);
    const rows = await fetchAll<Record<string, unknown>>((from, to) =>
      supabaseServer
        .from("RENT_payments")
        .select(
          "id, lease_id, invoice_id, payment_date, amount, status, payment_method",
        )
        .in("lease_id", slice)
        .range(from, to),
    );
    for (const r of rows) {
      const leaseId = String(r.lease_id);
      const list = map.get(leaseId) || [];
      list.push({
        id: String(r.id),
        lease_id: leaseId,
        invoice_id: r.invoice_id ? String(r.invoice_id) : null,
        payment_date: String(r.payment_date || ""),
        amount: Number(r.amount) || 0,
        status: (r.status as string) || "completed",
        payment_method: (r.payment_method as string) || null,
      });
      map.set(leaseId, list);
    }
  }
  return map;
}
