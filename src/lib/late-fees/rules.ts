/**
 * Authoritative late-fee defaults and lease overrides.
 * Weekly $10 / biweekly $25 / monthly $45.
 * Positive lease.late_fee_amount overrides the cadence default.
 */

import { normalizeCadence, type Cadence } from "@/lib/rent/cadence";

export const LATE_FEE_DEFAULTS: Record<Cadence, number> = {
  weekly: 10,
  biweekly: 25,
  monthly: 45,
};

export function roundMoney(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function defaultLateFeeForCadence(cadence: string | null | undefined): number {
  const c = normalizeCadence(cadence || "monthly") || "monthly";
  return LATE_FEE_DEFAULTS[c];
}

/** Lease-specific positive late_fee_amount overrides cadence default. */
export function resolveLateFeeAmount(args: {
  cadence?: string | null;
  leaseLateFeeAmount?: number | null;
}): number {
  const override = Number(args.leaseLateFeeAmount);
  if (Number.isFinite(override) && override > 0) {
    return roundMoney(override);
  }
  return roundMoney(defaultLateFeeForCadence(args.cadence));
}

/** Five full calendar days after due date are always grace days. */
export const LATE_FEE_GRACE_DAYS = 5;

export function resolveGraceDays(_graceDays?: number | null): number {
  return LATE_FEE_GRACE_DAYS;
}

/** First calendar date after which a late fee may be assessed (due + grace). */
export function lateFeeEligibleOnOrAfter(
  dueDate: string,
  graceDays: number,
): string {
  const due = String(dueDate).split("T")[0];
  const d = new Date(due + "T12:00:00");
  d.setDate(d.getDate() + Math.max(0, graceDays));
  // Eligible after grace ends: business date must be > due+grace
  // i.e. first assessable business date is the day after due+grace.
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function isPastGrace(args: {
  dueDate: string;
  graceDays: number;
  businessDate: string;
}): boolean {
  const firstEligible = lateFeeEligibleOnOrAfter(args.dueDate, args.graceDays);
  return String(args.businessDate).split("T")[0] >= firstEligible;
}
