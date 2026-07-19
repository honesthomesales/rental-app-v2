import type {
  CommunicationApproval,
  CommunicationTriggerType,
  SmsConsentStatus,
  TemplateKey,
} from "./types";
import type { LedgerAccountSummary } from "@/lib/portfolio-ledger/service";

export const COMMUNICATION_TIMEZONE =
  process.env.TENANT_COMMUNICATION_TIMEZONE || "America/New_York";
export const SEND_WINDOW_START_HOUR = 8;
export const SEND_WINDOW_END_HOUR = 20;

export type DraftInput = {
  tenantId: string;
  propertyId?: string | null;
  leaseId?: string | null;
  triggerType: CommunicationTriggerType;
  templateKey?: TemplateKey | null;
  body: string;
  generatedAsOfDate: string;
  generatedLedgerVersion: string;
  balanceSnapshot: number;
  daysLateSnapshot?: number | null;
  generationReason: string;
  idempotencyKey: string;
  phoneSnapshot?: string | null;
  createdByAuthUserId?: string | null;
};

export type SendRevalidationFacts = {
  account: LedgerAccountSummary | null;
  consentStatus: SmsConsentStatus;
  normalizedPhone: string | null;
  phoneSuppressed: boolean;
  lastEligiblePaymentDate: string | null;
};

function localHour(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  }).format(now);
  return Number(hour);
}

export function isWithinCommunicationWindow(
  now: Date = new Date(),
  timeZone = COMMUNICATION_TIMEZONE,
): boolean {
  const hour = localHour(now, timeZone);
  return hour >= SEND_WINDOW_START_HOUR && hour < SEND_WINDOW_END_HOUR;
}

/** First 15-minute point inside the configured local send window. */
export function nextCommunicationWindow(
  now: Date = new Date(),
  timeZone = COMMUNICATION_TIMEZONE,
): string {
  if (isWithinCommunicationWindow(now, timeZone)) return now.toISOString();
  const candidate = new Date(now);
  candidate.setUTCSeconds(0, 0);
  const minutes = candidate.getUTCMinutes();
  candidate.setUTCMinutes(minutes + ((15 - (minutes % 15)) % 15));
  for (let i = 0; i < 192; i += 1) {
    if (isWithinCommunicationWindow(candidate, timeZone)) {
      return candidate.toISOString();
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 15);
  }
  throw new Error("Unable to determine next communication window");
}

export function approvalIdempotencyKey(args: {
  leaseId: string;
  oldestUnpaidDueDate: string;
  triggerType: "late_day_6" | "eviction_risk_day_15";
}): string {
  return [
    "delinquency",
    args.leaseId,
    args.oldestUnpaidDueDate,
    args.triggerType,
  ].join(":");
}

export function automaticDraftMilestone(
  account: LedgerAccountSummary,
): "late_day_6" | "eviction_risk_day_15" | null {
  if (
    account.collectionStatus !== "past_due" ||
    account.pastDueBalanceDue <= 0 ||
    account.pastDueInvoiceCount <= 0 ||
    account.daysLate == null ||
    account.exceptionFlags.includes("cadence_review_required")
  ) {
    return null;
  }
  if (account.daysLate === 6) return "late_day_6";
  if (account.daysLate === 15) return "eviction_risk_day_15";
  return null;
}

export function validateApprovalBeforeSend(
  draft: CommunicationApproval,
  facts: SendRevalidationFacts,
): { ok: true } | { ok: false; status: "stale" | "blocked"; reason: string } {
  if (facts.phoneSuppressed) {
    return {
      ok: false,
      status: "blocked",
      reason: "Phone number is globally suppressed",
    };
  }
  if (facts.consentStatus !== "opted_in") {
    return {
      ok: false,
      status: "blocked",
      reason:
        facts.consentStatus === "opted_out"
          ? "Tenant opted out"
          : "Tenant consent is unknown",
    };
  }
  if (!facts.normalizedPhone) {
    return { ok: false, status: "blocked", reason: "Tenant has no valid phone" };
  }
  if (facts.normalizedPhone !== draft.phone_snapshot) {
    return {
      ok: false,
      status: "stale",
      reason: "Tenant phone changed after draft generation",
    };
  }
  if (draft.lease_id && !facts.account) {
    return { ok: false, status: "stale", reason: "Lease is no longer active" };
  }
  if (
    draft.trigger_type !== "manual" &&
    draft.lease_id &&
    facts.account &&
    (facts.account.collectionStatus !== "past_due" ||
      facts.account.pastDueBalanceDue <= 0)
  ) {
    return {
      ok: false,
      status: "stale",
      reason: "Tenant is no longer past due",
    };
  }
  if (
    facts.account?.exceptionFlags.includes("cadence_review_required")
  ) {
    return {
      ok: false,
      status: "stale",
      reason: "Current ledger requires cadence review",
    };
  }
  if (
    facts.account &&
    draft.trigger_type === "late_day_6" &&
    (facts.account.daysLate == null || facts.account.daysLate < 6)
  ) {
    return {
      ok: false,
      status: "stale",
      reason: "Tenant is no longer late",
    };
  }
  if (
    facts.account &&
    draft.trigger_type === "eviction_risk_day_15" &&
    (facts.account.daysLate == null || facts.account.daysLate < 15)
  ) {
    return {
      ok: false,
      status: "stale",
      reason: "Tenant is below the day-15 eviction-risk threshold",
    };
  }
  if (
    facts.account &&
    draft.trigger_type !== "manual" &&
    facts.account.pastDueBalanceDue !== Number(draft.balance_snapshot)
  ) {
    return {
      ok: false,
      status: "stale",
      reason: "Ledger balance changed after draft generation",
    };
  }
  if (
    facts.lastEligiblePaymentDate &&
    facts.lastEligiblePaymentDate > draft.generated_as_of_date
  ) {
    return {
      ok: false,
      status: "stale",
      reason: "Tenant paid after draft generation",
    };
  }
  return { ok: true };
}

