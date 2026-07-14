/**
 * Account continuity: tenant_id + property_id.
 * Holdover is labeled only — never saved / never converted to active lease.
 */

import type { ShadowLease, ShadowPayment, ShadowTenant } from "./types";

export type AccountBundle = {
  accountKey: string;
  tenantId: string;
  propertyId: string;
  leases: ShadowLease[];
  holdoverCandidate: boolean;
  dataProblems: Array<"holdover_candidate" | "payment_after_lease_end">;
};

function toDateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return String(iso).split("T")[0];
}

export function makeAccountKey(tenantId: string, propertyId: string): string {
  return `${tenantId}::${propertyId}`;
}

/**
 * Group leases by tenant+property. Chronological by lease_start_date.
 * Replacement tenants are separate accounts (different tenant_id).
 */
export function groupLeasesIntoAccounts(
  leases: ShadowLease[],
  tenants: ShadowTenant[] | undefined,
  payments: ShadowPayment[],
  asOfDate: string,
): AccountBundle[] {
  const asOf = toDateOnly(asOfDate) || asOfDate;
  const tenantById = new Map((tenants || []).map((t) => [t.id, t]));
  const byKey = new Map<string, ShadowLease[]>();

  for (const lease of leases) {
    if (!lease.tenant_id || !lease.property_id) continue;
    const key = makeAccountKey(lease.tenant_id, lease.property_id);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(lease);
  }

  const bundles: AccountBundle[] = [];

  for (const [accountKey, group] of byKey) {
    const leasesSorted = [...group].sort((a, b) => {
      const sa = toDateOnly(a.lease_start_date) || "";
      const sb = toDateOnly(b.lease_start_date) || "";
      return sa.localeCompare(sb);
    });

    const tenantId = leasesSorted[0].tenant_id!;
    const propertyId = leasesSorted[0].property_id!;

    // Conflicting replacement: another occupied lease on same property with different tenant
    const replacementConflict = leases.some(
      (other) =>
        other.property_id === propertyId &&
        other.tenant_id &&
        other.tenant_id !== tenantId &&
        String(other.status || "").toLowerCase() === "occupied",
    );

    const holdover = detectHoldoverCandidate({
      leases: leasesSorted,
      tenant: tenantById.get(tenantId),
      payments,
      asOf,
      replacementConflict,
    });

    const dataProblems: AccountBundle["dataProblems"] = [];
    if (holdover.holdoverCandidate) dataProblems.push("holdover_candidate");
    if (holdover.paymentAfterEnd) dataProblems.push("payment_after_lease_end");

    bundles.push({
      accountKey,
      tenantId,
      propertyId,
      leases: leasesSorted,
      holdoverCandidate: holdover.holdoverCandidate,
      dataProblems,
    });
  }

  return bundles;
}

function detectHoldoverCandidate(args: {
  leases: ShadowLease[];
  tenant?: ShadowTenant;
  payments: ShadowPayment[];
  asOf: string;
  replacementConflict: boolean;
}): { holdoverCandidate: boolean; paymentAfterEnd: boolean } {
  const { leases, tenant, payments, asOf, replacementConflict } = args;
  if (replacementConflict) {
    return { holdoverCandidate: false, paymentAfterEnd: false };
  }

  const latest = leases[leases.length - 1];
  const end = toDateOnly(latest.lease_end_date);
  if (!end || end >= asOf) {
    // Still within recorded term or open-ended — not a holdover label
    return { holdoverCandidate: false, paymentAfterEnd: false };
  }

  const sameTenantPropertyPayments = payments.filter((p) => {
    if (p.tenant_id && p.property_id) {
      return p.tenant_id === latest.tenant_id && p.property_id === latest.property_id;
    }
    if (p.lease_id && leases.some((l) => l.id === p.lease_id)) {
      const d = toDateOnly(p.payment_date);
      return !!d && d > end;
    }
    return false;
  });

  const paymentAfterEnd = sameTenantPropertyPayments.some((p) => {
    const d = toDateOnly(p.payment_date);
    return !!d && d > end;
  });

  const occupied = String(latest.status || "").toLowerCase() === "occupied";
  const tenantActive = tenant?.is_active === true;

  // Label only when recorded end passed AND continuity evidence exists
  const holdoverCandidate =
    !replacementConflict && (occupied || tenantActive || paymentAfterEnd);

  return { holdoverCandidate, paymentAfterEnd };
}
