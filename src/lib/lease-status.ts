/**
 * Lease status helpers for V3 occupancy, income, and period-to-period rules.
 * Status is authoritative — do not infer occupancy from lease_end_date alone.
 */

export type LeaseStatus = "occupied" | "eviction" | "empty" | "sold";

export const LEASE_STATUS_OPTIONS: Array<{
  value: LeaseStatus;
  label: string;
}> = [
  { value: "occupied", label: "Has Tenants" },
  { value: "eviction", label: "Eviction Process" },
  { value: "empty", label: "Empty" },
  { value: "sold", label: "Sold" },
];

export function normalizeLeaseStatus(
  status: string | null | undefined,
): LeaseStatus {
  const s = String(status || "occupied").toLowerCase();
  if (s === "eviction") return "eviction";
  if (s === "empty") return "empty";
  if (s === "sold") return "sold";
  return "occupied";
}

/** Physically occupied property (Has Tenants or Eviction Process). */
export function isPhysicallyOccupied(
  status: string | null | undefined,
): boolean {
  const s = normalizeLeaseStatus(status);
  return s === "occupied" || s === "eviction";
}

/** Included in Payments, Late Tenants, invoices, notices. */
export function isActiveBillingLease(
  status: string | null | undefined,
): boolean {
  return isPhysicallyOccupied(status);
}

/** Counts toward current monthly income / current profit. */
export function countsTowardCurrentIncome(
  status: string | null | undefined,
): boolean {
  return normalizeLeaseStatus(status) === "occupied";
}

/** Counts toward eviction potential income. */
export function countsTowardEvictionPotential(
  status: string | null | undefined,
): boolean {
  return normalizeLeaseStatus(status) === "eviction";
}

export function leaseStatusLabel(status: string | null | undefined): string {
  const s = normalizeLeaseStatus(status);
  return LEASE_STATUS_OPTIONS.find((o) => o.value === s)?.label || s;
}

export function leaseStatusBadgeClass(
  status: string | null | undefined,
): string {
  switch (normalizeLeaseStatus(status)) {
    case "occupied":
      return "bg-green-100 text-green-800";
    case "eviction":
      return "bg-orange-100 text-orange-800";
    case "sold":
      return "bg-blue-100 text-blue-800";
    case "empty":
      return "bg-gray-100 text-gray-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

/**
 * Period-to-period: occupied/eviction with lease_end_date before business date.
 */
export function isPeriodToPeriod(args: {
  status: string | null | undefined;
  leaseEndDate: string | null | undefined;
  businessDate: string;
}): boolean {
  if (!isPhysicallyOccupied(args.status)) return false;
  if (!args.leaseEndDate) return false;
  const end = String(args.leaseEndDate).split("T")[0];
  return end < args.businessDate;
}

export function periodToPeriodSinceLabel(leaseEndDate: string): string {
  const [y, m, d] = leaseEndDate.split("T")[0].split("-").map(Number);
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `Period-to-Period since ${mm}/${dd}/${y}`;
}

/**
 * Invoice / missing-preview schedule end.
 * - empty/sold: stop at lease_end_date (or asOf if no end)
 * - occupied/eviction with future end: use lease_end_date
 * - occupied/eviction with past/null end: continue asOf + 3 months
 */
export function resolveInvoiceScheduleEnd(args: {
  status: string | null | undefined;
  leaseEndDate: string | null | undefined;
  asOfDate: string;
}): string {
  const asOf = args.asOfDate.split("T")[0];
  const end = args.leaseEndDate
    ? String(args.leaseEndDate).split("T")[0]
    : null;
  const status = normalizeLeaseStatus(args.status);

  if (status === "empty" || status === "sold") {
    return end || asOf;
  }

  // occupied / eviction — period-to-period continues after original end
  if (!end || end < asOf) {
    const d = new Date(asOf + "T00:00:00");
    d.setMonth(d.getMonth() + 3);
    return d.toISOString().split("T")[0];
  }
  return end;
}

/** Empty potential: residential, not retired/sold, no occupied/eviction lease, rent_value > 1 */
export function isEligibleEmptyPotentialProperty(args: {
  propertyType: string | null | undefined;
  propertyStatus: string | null | undefined;
  rentValue: number | null | undefined;
  hasPhysicallyOccupiedLease: boolean;
  hasSoldLease: boolean;
}): boolean {
  const type = String(args.propertyType || "").toLowerCase();
  if (!["house", "doublewide", "singlewide"].includes(type)) return false;
  if (String(args.propertyStatus || "").toLowerCase() === "retired")
    return false;
  if (args.hasSoldLease) return false;
  if (args.hasPhysicallyOccupiedLease) return false;
  return Number(args.rentValue || 0) > 1;
}
