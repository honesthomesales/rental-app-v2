export const PAYMENT_ATTEMPT_STATES = [
  "created",
  "awaiting_customer",
  "submitted",
  "awaiting_verification",
  "processing",
  "pending",
  "settled",
  "failed",
  "returned",
  "refunded",
  "disputed",
  "canceled",
  "expired",
  "rejected_match",
  "manual_review",
] as const;

export type PaymentAttemptState = (typeof PAYMENT_ATTEMPT_STATES)[number];

export type PortalPaymentMethod =
  | "ach"
  | "card"
  | "cash_app_pay"
  | "existing_cash_app"
  | "zelle";

export const TERMINAL_ATTEMPT_STATES: readonly PaymentAttemptState[] = [
  "settled",
  "failed",
  "returned",
  "refunded",
  "disputed",
  "canceled",
  "expired",
  "rejected_match",
] as const;

export function isTerminalAttemptState(status: string): boolean {
  return (TERMINAL_ATTEMPT_STATES as readonly string[]).includes(status);
}

/** Allowed transitions (defensive; unknown transitions rejected). */
const ALLOWED: Record<PaymentAttemptState, PaymentAttemptState[]> = {
  created: ["awaiting_customer", "submitted", "awaiting_verification", "canceled"],
  awaiting_customer: ["submitted", "processing", "pending", "expired", "canceled", "failed"],
  submitted: ["processing", "pending", "awaiting_verification", "settled", "failed", "canceled"],
  awaiting_verification: ["manual_review", "settled", "rejected_match", "canceled", "expired"],
  processing: ["pending", "settled", "failed", "returned"],
  pending: ["settled", "failed", "returned", "processing"],
  settled: ["returned", "refunded", "disputed"],
  failed: [],
  returned: [],
  refunded: [],
  disputed: ["refunded", "settled"],
  canceled: [],
  expired: [],
  rejected_match: [],
  manual_review: ["settled", "rejected_match", "canceled"],
};

export function canTransition(
  from: PaymentAttemptState,
  to: PaymentAttemptState,
): boolean {
  if (from === to) return true;
  return ALLOWED[from]?.includes(to) ?? false;
}
