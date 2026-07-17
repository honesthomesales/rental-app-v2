/**
 * Shadow account reconciliation (read-only).
 *
 * HARD GATE: Do NOT import these into Payments, Late Tenants, dashboard,
 * statements, notices, or profit screens. Candidate results are DISABLED_FOR_UI
 * until Billy approves a difference report.
 */

export type * from "./types";
export {
  computeBaselineLeaseTotals,
  rollupBaselineByAccount,
  isOccupiedLease,
} from "./baseline";
export { groupLeasesIntoAccounts, makeAccountKey } from "./account-grouping";
export { computeCandidateAccountSummaries } from "./candidate";
export {
  buildDifferenceReport,
  runShadowReconciliation,
} from "./difference-report";
export {
  assignPaymentsToAccounts,
  uniqueCompletedPayments,
  classifyHistoricalExcessReason,
  classifyExcessSupportClass,
} from "./payment-conservation";
export type { PaymentConservationAudit } from "./payment-conservation";
export {
  classifyAccountReview,
  labelPreOccupancyPayment,
  preOccupancyWouldChangeCurrentBalance,
  reviewMissingInvoicePayment,
  allocationMismatchImpact,
  buildImmediateDecisionQueue,
  leaseSegmentsForAccount,
  paymentsTransferToReplacement,
} from "./current-balance-review";
export type {
  ReviewClassification,
  ImmediateDecisionType,
  PreOccupancyLabel,
  ImmediateDecisionRow,
  MissingInvoicePaymentReview,
} from "./current-balance-review";
export {
  partitionPaymentsByAsOf,
  isPaymentEligibleAsOf,
  assertFuturePaymentInvariants,
  FUTURE_DATED_COMPLETED_PAYMENT_EXCLUDED,
} from "./as-of-payments";
export type { FutureDatedPaymentExclusion } from "./as-of-payments";
export { analyzeMissingObligations } from "./missing-obligation-detail";
export type {
  MissingObligationDetailRow,
  MissingObligationAnalysis,
} from "./missing-obligation-detail";
export { buildDollarBridge } from "./dollar-bridge";
export type { DollarBridge, DollarBridgeLine } from "./dollar-bridge";
export { applyBillyMissingObligationDecision } from "./billy-missing-decisions";
export type {
  BillyMissingObligationDecision,
  AppliedMissingObligationDecision,
} from "./billy-missing-decisions";
