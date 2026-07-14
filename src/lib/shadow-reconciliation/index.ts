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
