/**
 * BASELINE — exact Payments page account totals.
 * Do not "fix" or improve this logic. Extract only.
 */

import {
  calculateUnpaidInvoices,
  type Invoice,
  type Payment,
} from "@/lib/invoice-calculations";
import type {
  BaselineLeaseResult,
  ShadowDataset,
  ShadowInvoice,
  ShadowLease,
  ShadowPayment,
} from "./types";

function toDateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return String(iso).split("T")[0];
}

function accountKey(
  tenantId: string | null | undefined,
  propertyId: string | null | undefined,
): string | null {
  if (!tenantId || !propertyId) return null;
  return `${tenantId}::${propertyId}`;
}

function money(n: number | string | null | undefined): number {
  const v = parseFloat(String(n ?? 0));
  return Number.isFinite(v) ? v : 0;
}

/**
 * Reproduce Payments `fetchLeases` totals for every occupied lease.
 * Matching rules (intentionally unchanged):
 * - lease.status === 'occupied'
 * - invoices due_date >= lease_start_date and due_date <= asOfDate
 * - all payments counted by invoice_id (no status filter)
 * - unpaid = OPEN && balance_due > 0
 * - totalOwed = sum of recalculated balances
 */
export function computeBaselineLeaseTotals(
  dataset: ShadowDataset,
): BaselineLeaseResult[] {
  const asOf = toDateOnly(dataset.asOfDate) || dataset.asOfDate;
  const invoicesByLease = groupInvoices(dataset.invoices);
  const paymentsByLease = groupPayments(dataset.payments);

  const occupied = dataset.leases.filter(
    (l) => String(l.status || "").toLowerCase() === "occupied",
  );

  return occupied.map((lease) => {
    const invoices = invoicesByLease.get(lease.id) || [];
    const payments = paymentsByLease.get(lease.id) || [];

    const { unpaidInvoices, totalOwed, unpaidCount } = calculateUnpaidInvoices(
      invoices as Invoice[],
      payments as Payment[],
      lease.lease_start_date || undefined,
      asOf,
    );

    const oldestUnpaidDate =
      unpaidInvoices.length === 0
        ? null
        : unpaidInvoices
            .map((inv) => toDateOnly(inv.due_date)!)
            .sort()[0];

    const lastPaymentDate = latestPaymentDate(payments);

    return {
      leaseId: lease.id,
      tenantId: lease.tenant_id || null,
      propertyId: lease.property_id || null,
      accountKey: accountKey(lease.tenant_id, lease.property_id),
      totalOwed: round2(totalOwed),
      unpaidCount,
      oldestUnpaidDate,
      lastPaymentDate,
      lateOrCurrent: unpaidCount > 0 && totalOwed > 0 ? "late" : "current",
    };
  });
}

/** Roll baseline lease totals into tenant+property account keys for comparison. */
export function rollupBaselineByAccount(
  baseline: BaselineLeaseResult[],
): Map<string, { totalOwed: number; leaseIds: string[]; lateOrCurrent: "late" | "current" }> {
  const map = new Map<
    string,
    { totalOwed: number; leaseIds: string[]; lateOrCurrent: "late" | "current" }
  >();

  for (const row of baseline) {
    if (!row.accountKey) continue;
    const prev = map.get(row.accountKey) || {
      totalOwed: 0,
      leaseIds: [],
      lateOrCurrent: "current" as const,
    };
    prev.totalOwed = round2(prev.totalOwed + row.totalOwed);
    prev.leaseIds.push(row.leaseId);
    if (row.lateOrCurrent === "late") prev.lateOrCurrent = "late";
    map.set(row.accountKey, prev);
  }
  return map;
}

function groupInvoices(invoices: ShadowInvoice[]): Map<string, ShadowInvoice[]> {
  const m = new Map<string, ShadowInvoice[]>();
  for (const inv of invoices) {
    if (!m.has(inv.lease_id)) m.set(inv.lease_id, []);
    m.get(inv.lease_id)!.push(inv);
  }
  return m;
}

function groupPayments(payments: ShadowPayment[]): Map<string, ShadowPayment[]> {
  const m = new Map<string, ShadowPayment[]>();
  for (const p of payments) {
    if (!p.lease_id) continue;
    if (!m.has(p.lease_id)) m.set(p.lease_id, []);
    m.get(p.lease_id)!.push(p);
  }
  return m;
}

function latestPaymentDate(payments: ShadowPayment[]): string | null {
  const dates = payments
    .map((p) => toDateOnly(p.payment_date))
    .filter((d): d is string => !!d)
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Expose lease helper for tests asserting occupied filter. */
export function isOccupiedLease(lease: ShadowLease): boolean {
  return String(lease.status || "").toLowerCase() === "occupied";
}

export function baselineMoney(n: number | string | null | undefined): number {
  return money(n);
}
