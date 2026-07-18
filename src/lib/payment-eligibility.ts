/**
 * Shared payment eligibility for visible V3 (Payments, Late Tenants, Profit, etc.).
 * Future-dated completed payments are excluded from calculations until their date.
 * Records are never deleted or modified.
 */

export const FUTURE_DATED_COMPLETED_PAYMENT_EXCLUDED =
  "future_dated_completed_payment_excluded" as const;

export type PaymentDateFields = {
  id?: string | null;
  payment_date?: string | null;
  amount?: number | string | null;
  status?: string | null;
  [key: string]: unknown;
};

export type FutureDatedPaymentExclusion<T extends PaymentDateFields = PaymentDateFields> =
  {
    payment: T;
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
 * A payment is eligible when payment_date <= businessDate.
 * Undated payments are treated as ineligible for safety.
 */
export function isPaymentEligibleAsOf(
  payment: PaymentDateFields,
  businessDate: string,
): boolean {
  const asOf = toDateOnly(businessDate) || businessDate;
  const d = toDateOnly(payment.payment_date);
  if (!d) return false;
  return d <= asOf;
}

/**
 * Split payments into business-date-eligible vs future-dated excluded.
 */
export function partitionPaymentsByAsOf<T extends PaymentDateFields>(
  payments: T[],
  businessDate: string,
): {
  eligible: T[];
  excludedFuture: FutureDatedPaymentExclusion<T>[];
  excludedCount: number;
  excludedAmount: number;
} {
  const asOf = toDateOnly(businessDate) || businessDate;
  const eligible: T[] = [];
  const excludedFuture: FutureDatedPaymentExclusion<T>[] = [];

  for (const p of payments) {
    const d = toDateOnly(p.payment_date);
    if (d && d > asOf) {
      excludedFuture.push({
        payment: p,
        exclusionClass: FUTURE_DATED_COMPLETED_PAYMENT_EXCLUDED,
        exclusionReason: `payment_date ${d} > business date ${asOf}`,
      });
    } else {
      eligible.push(p);
    }
  }

  const excludedAmount =
    Math.round(
      excludedFuture.reduce((s, x) => s + money(x.payment.amount), 0) * 100,
    ) / 100;

  return {
    eligible,
    excludedFuture,
    excludedCount: excludedFuture.length,
    excludedAmount,
  };
}

export function assertFuturePaymentInvariants(args: {
  asOfDate: string;
  eligiblePayments: PaymentDateFields[];
  excludedFuture: FutureDatedPaymentExclusion[];
}): void {
  const asOf = toDateOnly(args.asOfDate) || args.asOfDate;
  for (const p of args.eligiblePayments) {
    const d = toDateOnly(p.payment_date);
    if (d && d > asOf) {
      throw new Error(
        `Invariant violated: future payment ${p.id} (${d}) in eligible set for ${asOf}`,
      );
    }
  }
  for (const x of args.excludedFuture) {
    const d = toDateOnly(x.payment.payment_date);
    if (d && d <= asOf) {
      throw new Error(
        `Future exclusion misclassified: ${x.payment.id} date=${d} asOf=${asOf}`,
      );
    }
    if (x.exclusionClass !== FUTURE_DATED_COMPLETED_PAYMENT_EXCLUDED) {
      throw new Error(`Wrong exclusion class for ${x.payment.id}`);
    }
  }
}

/**
 * Most recent payment_date among business-date-eligible completed payments.
 * Future-dated completed payments never become Last Paid / Most Recent.
 */
export function getMostRecentEligiblePaymentDate(
  payments: PaymentDateFields[],
  businessDate: string,
): string | null {
  const { eligible } = partitionPaymentsByAsOf(payments, businessDate);
  let best: string | null = null;
  for (const p of eligible) {
    const d = toDateOnly(p.payment_date);
    if (!d) continue;
    const amt = money(p.amount);
    if (amt <= 0) continue;
    if (!best || d > best) best = d;
  }
  return best;
}

/** True when a completed payment may be allocated (payment_date <= business date). */
export function canAllocatePaymentAsOf(
  payment: PaymentDateFields,
  businessDate: string,
): boolean {
  return isPaymentEligibleAsOf(payment, businessDate);
}
