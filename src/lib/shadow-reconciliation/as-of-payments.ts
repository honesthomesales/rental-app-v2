/**
 * As-of payment eligibility for shadow reconciliation.
 * Re-exports the shared production helper so shadow and UI stay aligned.
 */

export {
  FUTURE_DATED_COMPLETED_PAYMENT_EXCLUDED,
  partitionPaymentsByAsOf,
  isPaymentEligibleAsOf,
  assertFuturePaymentInvariants,
  type FutureDatedPaymentExclusion,
} from "@/lib/payment-eligibility";
