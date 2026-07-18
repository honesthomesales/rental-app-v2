/**
 * Centralized server-side business date for V3 runtime.
 * Timezone: America/New_York. Tests/reports may inject an explicit as-of.
 */

export const BUSINESS_TIMEZONE = "America/New_York" as const;

/**
 * Calendar date (YYYY-MM-DD) in America/New_York for an instant.
 * Defaults to "now".
 */
export function getBusinessDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Resolve the effective as-of / business date for a calculation.
 * Explicit asOf wins (tests and read-only reports); otherwise NY calendar date.
 */
export function resolveBusinessDate(
  asOfDate?: string | null,
  now: Date = new Date(),
): string {
  if (asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(asOfDate.trim())) {
    return asOfDate.trim();
  }
  return getBusinessDate(now);
}

/** Whole days from businessDate until paymentDate becomes eligible (0 if already). */
export function daysUntilPaymentEligible(
  paymentDate: string,
  businessDate: string,
): number {
  const p = String(paymentDate).split("T")[0];
  const b = String(businessDate).split("T")[0];
  if (p <= b) return 0;
  const ms =
    Date.parse(p + "T00:00:00Z") - Date.parse(b + "T00:00:00Z");
  return Math.max(0, Math.round(ms / 86_400_000));
}
