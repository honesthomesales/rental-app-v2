/**
 * As-of payment eligibility for shadow reconciliation.
 * Future-dated completed payments are excluded from every as-of calculation;
 * records are never deleted or modified.
 */

import type { ShadowPayment } from "./types";

export const FUTURE_DATED_COMPLETED_PAYMENT_EXCLUDED =
  "future_dated_completed_payment_excluded" as const;

export type FutureDatedPaymentExclusion = {
  payment: ShadowPayment;
  exclusionClass: typeof FUTURE_DATED_COMPLETED_PAYMENT_EXCLUDED;
  exclusionReason: string;
};

function toDateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return String(iso).split("T")[0];
}

function money(n: number | string | null | undefined): number {
  const v = parseFloat(String(n ?? 0));
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

/**
 * Split payments into as-of-eligible vs future-dated excluded.
 * A payment with payment_date > asOfDate is never eligible for:
 * invoice allocation, balances, Late Tenants, last-payment, profit through
 * as-of, historical excess through as-of, or credit.
 */
export function partitionPaymentsByAsOf(
  payments: ShadowPayment[],
  asOfDate: string,
): {
  eligible: ShadowPayment[];
  excludedFuture: FutureDatedPaymentExclusion[];
  excludedCount: number;
  excludedAmount: number;
} {
  const asOf = toDateOnly(asOfDate) || asOfDate;
  const eligible: ShadowPayment[] = [];
  const excludedFuture: FutureDatedPaymentExclusion[] = [];

  for (const p of payments) {
    const d = toDateOnly(p.payment_date);
    if (d && d > asOf) {
      excludedFuture.push({
        payment: p,
        exclusionClass: FUTURE_DATED_COMPLETED_PAYMENT_EXCLUDED,
        exclusionReason: `payment_date ${d} > as-of ${asOf}`,
      });
    } else {
      eligible.push(p);
    }
  }

  const excludedAmount = Math.round(
    excludedFuture.reduce((s, x) => s + money(x.payment.amount), 0) * 100,
  ) / 100;

  return {
    eligible,
    excludedFuture,
    excludedCount: excludedFuture.length,
    excludedAmount,
  };
}

/** True when payment_date is on or before as-of (or undated → treat as ineligible for safety). */
export function isPaymentEligibleAsOf(
  payment: ShadowPayment,
  asOfDate: string,
): boolean {
  const asOf = toDateOnly(asOfDate) || asOfDate;
  const d = toDateOnly(payment.payment_date);
  if (!d) return false;
  return d <= asOf;
}

/**
 * Invariants for future-dated payments (asserted in tests / audits).
 */
export function assertFuturePaymentInvariants(args: {
  asOfDate: string;
  eligiblePayments: ShadowPayment[];
  excludedFuture: FutureDatedPaymentExclusion[];
}): void {
  const asOf = toDateOnly(args.asOfDate) || args.asOfDate;
  for (const p of args.eligiblePayments) {
    const d = toDateOnly(p.payment_date);
    if (d && d > asOf) {
      throw new Error(
        `Invariant1 violated: future payment ${p.id} (${d}) in eligible set for as-of ${asOf}`,
      );
    }
  }
  for (const x of args.excludedFuture) {
    const d = toDateOnly(x.payment.payment_date);
    if (!d || d <= asOf) {
      throw new Error(
        `Future exclusion misclassified: ${x.payment.id} date=${d} asOf=${asOf}`,
      );
    }
    if (x.exclusionClass !== FUTURE_DATED_COMPLETED_PAYMENT_EXCLUDED) {
      throw new Error(`Wrong exclusion class for ${x.payment.id}`);
    }
  }
}
