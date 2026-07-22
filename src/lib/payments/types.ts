/**
 * Tenant payment attempt lifecycle states.
 */

export const PAYMENT_ATTEMPT_STATES = [
  "created",
  "awaiting_payment",
  "submitted",
  "processing",
  "pending",
  "settled",
  "failed",
  "returned",
  "refunded",
  "disputed",
  "canceled",
] as const;

export type PaymentAttemptState = (typeof PAYMENT_ATTEMPT_STATES)[number];

export function isPaymentAttemptState(
  value: string | null | undefined,
): value is PaymentAttemptState {
  return (
    !!value &&
    (PAYMENT_ATTEMPT_STATES as readonly string[]).includes(value)
  );
}
