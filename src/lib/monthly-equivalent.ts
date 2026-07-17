/**
 * Monthly-equivalent rent from lease cadence.
 * weekly × 4, biweekly × 2, monthly as entered.
 */

import { normalizeCadence } from "@/lib/rent/cadence";

export function monthlyEquivalentRent(
  rent: number | null | undefined,
  cadence: string | null | undefined,
): number {
  const amount = Number(rent || 0);
  const c = normalizeCadence(cadence || "monthly") || "monthly";
  switch (c) {
    case "weekly":
      return amount * 4;
    case "biweekly":
      return amount * 2;
    case "monthly":
    default:
      return amount;
  }
}
