/**
 * Account continuity decision overlay for disabled shadow candidate.
 * Decisions are optional runtime input — never mutate DB or legacy leases.
 */

import { makeAccountKey } from "./account-grouping";
import type {
  AccountContinuityDecision,
  ContinuityDecisionType,
  CreditPolicyStatus,
  ShadowLease,
} from "./types";

export const CLOSED_DECISION_TYPES: ContinuityDecisionType[] = [
  "sold_closed",
  "moved_closed",
  "vacant_closed",
  "lease_never_effective",
  "expired_closed",
  "replaced_by_new_tenant",
];

export const CURRENT_DECISION_TYPES: ContinuityDecisionType[] = [
  "current",
  "current_new_tenant",
  "current_holdover",
];

export function isClosedDecision(t: ContinuityDecisionType | undefined): boolean {
  return !!t && CLOSED_DECISION_TYPES.includes(t);
}

export function isCurrentDecision(t: ContinuityDecisionType | undefined): boolean {
  return !!t && CURRENT_DECISION_TYPES.includes(t);
}

export function indexDecisions(
  decisions: AccountContinuityDecision[] | undefined,
): Map<string, AccountContinuityDecision> {
  const map = new Map<string, AccountContinuityDecision>();
  for (const d of decisions || []) {
    if (!d.tenantId || !d.propertyId) continue;
    map.set(makeAccountKey(d.tenantId, d.propertyId), d);
  }
  return map;
}

function toDateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return String(iso).split("T")[0];
}

/**
 * Resolve obligation cutoff / continuation start for an account.
 * Never extends or writes lease rows — in-memory guidance only.
 */
export function resolveContinuityRule(
  decision: AccountContinuityDecision | undefined,
  leases: ShadowLease[],
  asOf: string,
): {
  decisionType: ContinuityDecisionType | "unset";
  classification: "current" | "closed" | "unresolved" | "unset";
  obligationCutoffDate: string | null;
  obligationStartDate: string | null;
  allowExpectedObligations: boolean;
  allowHoldoverContinuation: boolean;
  ruleDescription: string;
  needsBillyReview: boolean;
} {
  const latest = [...leases].sort((a, b) =>
    (toDateOnly(a.lease_start_date) || "").localeCompare(
      toDateOnly(b.lease_start_date) || "",
    ),
  )[leases.length - 1];
  const leaseEnd = toDateOnly(latest?.lease_end_date);
  const leaseStart = toDateOnly(
    decision?.occupancyStartDate ||
      latest?.lease_start_date ||
      leases[0]?.lease_start_date,
  );

  if (!decision) {
    return {
      decisionType: "unset",
      classification: "unset",
      obligationCutoffDate: null,
      obligationStartDate: leaseStart,
      allowExpectedObligations: true,
      allowHoldoverContinuation: false,
      ruleDescription:
        "No Billy continuity decision. Candidate may still preview gaps using lease evidence; requires Billy review before any activation.",
      needsBillyReview: true,
    };
  }

  const type = decision.decisionType;
  const explicitCutoff = toDateOnly(decision.obligationCutoffDate) || null;

  switch (type) {
    case "sold_closed":
      return {
        decisionType: type,
        classification: "closed",
        obligationCutoffDate: explicitCutoff || leaseEnd,
        obligationStartDate: leaseStart,
        allowExpectedObligations: false,
        allowHoldoverContinuation: false,
        ruleDescription:
          "Sold/closed: stop candidate expected obligations at sale/closure boundary; retain historical invoices/payments.",
        needsBillyReview: false,
      };
    case "moved_closed":
    case "replaced_by_new_tenant":
    case "vacant_closed":
      return {
        decisionType: type,
        classification: "closed",
        obligationCutoffDate: explicitCutoff || leaseEnd,
        obligationStartDate: leaseStart,
        allowExpectedObligations: false,
        allowHoldoverContinuation: false,
        ruleDescription:
          "Closed occupancy: stop expected obligations at move-out/replacement/vacancy/lease-end; never merge into replacement tenant.",
        needsBillyReview: false,
      };
    case "lease_never_effective":
      return {
        decisionType: type,
        classification: "closed",
        obligationCutoffDate: null,
        obligationStartDate: null,
        allowExpectedObligations: false,
        allowHoldoverContinuation: false,
        ruleDescription:
          "Lease never effective: generate no expected obligations; retain historical records; flag cleanup if payments/invoices exist.",
        needsBillyReview: false,
      };
    case "expired_closed":
      return {
        decisionType: type,
        classification: "closed",
        obligationCutoffDate: explicitCutoff || leaseEnd,
        obligationStartDate: leaseStart,
        allowExpectedObligations: false,
        allowHoldoverContinuation: false,
        ruleDescription:
          "Expired closed: stop at lease end; do not infer holdover.",
        needsBillyReview: false,
      };
    case "current_new_tenant":
      return {
        decisionType: type,
        classification: "current",
        obligationCutoffDate: null,
        obligationStartDate: leaseStart,
        allowExpectedObligations: true,
        allowHoldoverContinuation: false,
        ruleDescription:
          "Current new tenant: expected obligations begin at this tenant's reliable occupancy/lease start only; no predecessor inheritance.",
        needsBillyReview: false,
      };
    case "current": {
      const expiredNeedsConfirm = !!(leaseEnd && leaseEnd < asOf);
      return {
        decisionType: type,
        classification: "current",
        obligationCutoffDate: null,
        obligationStartDate: leaseStart,
        allowExpectedObligations: true,
        allowHoldoverContinuation: false,
        ruleDescription: expiredNeedsConfirm
          ? "Current: include approved obligations; lease end is past as-of — flag continuity confirmation."
          : "Current: include approved obligations using current lease evidence.",
        needsBillyReview: expiredNeedsConfirm,
      };
    }
    case "current_holdover":
      return {
        decisionType: type,
        classification: "current",
        obligationCutoffDate: null,
        obligationStartDate: leaseStart,
        allowExpectedObligations: true,
        allowHoldoverContinuation: true,
        ruleDescription:
          "Current holdover: continue last reliable rent/cadence after lease end for same tenant+property only (in-memory; do not alter lease record).",
        needsBillyReview: false,
      };
    case "unresolved":
    default:
      return {
        decisionType: type === "unresolved" ? "unresolved" : "unset",
        classification: "unresolved",
        obligationCutoffDate: null,
        obligationStartDate: leaseStart,
        allowExpectedObligations: false,
        allowHoldoverContinuation: false,
        ruleDescription: "Unresolved mapping — Billy decision still required.",
        needsBillyReview: true,
      };
  }
}

export function creditPolicyStatusFor(
  creditEffectiveDate: string | null | undefined,
): CreditPolicyStatus {
  if (!creditEffectiveDate) {
    return "no_effective_date_historical_excess_not_carried";
  }
  return "forward_only_from_effective_date";
}
