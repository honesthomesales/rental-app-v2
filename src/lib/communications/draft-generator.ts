import type { LedgerAccountSummary } from "@/lib/portfolio-ledger/service";
import { automaticDraftMilestone, approvalIdempotencyKey } from "./approval";
import { createApprovalDraft } from "./approval-store";
import { loadCommunicationLedgerAccounts } from "./ledger-facts";
import { normalizeToE164 } from "./phone";
import { supabaseServer } from "@/lib/supabase-server";

export type AutomaticDraftCandidate = {
  account: LedgerAccountSummary;
  triggerType: "late_day_6" | "eviction_risk_day_15";
  phone: string;
  body: string;
  idempotencyKey: string;
};

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export function buildAutomaticDraftCandidate(args: {
  account: LedgerAccountSummary;
  phone: string | null;
  consentStatus: string;
  phoneSuppressed?: boolean;
}): AutomaticDraftCandidate | null {
  const triggerType = automaticDraftMilestone(args.account);
  if (
    !triggerType ||
    !args.phone ||
    args.phoneSuppressed ||
    args.consentStatus === "opted_out"
  ) {
    return null;
  }
  const oldest = args.account.oldestUnpaidDueDate;
  if (!oldest) return null;

  const body =
    triggerType === "late_day_6"
      ? `Hi ${args.account.tenantName}, our records show rent for ${args.account.propertyName} is past due. Amount due: ${money(args.account.pastDueBalanceDue)}. Please contact Honest Home Sales to arrange payment. Reply STOP to unsubscribe.`
      : `Your account remains past due and may be referred for eviction or other legal action. Please contact Honest Home Sales immediately to discuss payment. Reply STOP to unsubscribe.`;

  return {
    account: args.account,
    triggerType,
    phone: args.phone,
    body,
    idempotencyKey: approvalIdempotencyKey({
      leaseId: args.account.leaseId,
      oldestUnpaidDueDate: oldest,
      triggerType,
    }),
  };
}

export async function generateAutomaticCommunicationDrafts(
  businessDate: string,
): Promise<{ created: number; duplicates: number; eligible: number }> {
  const accounts = await loadCommunicationLedgerAccounts(businessDate);
  const tenantIds = [...new Set(accounts.map((account) => account.tenantId))];
  const [{ data: tenants, error }, { data: preferences, error: prefError }] =
    tenantIds.length
      ? await Promise.all([
          supabaseServer
            .from("RENT_tenants")
            .select("id, phone")
            .in("id", tenantIds),
          supabaseServer
            .from("RENT_communication_preferences")
            .select("tenant_id, phone_number, sms_consent_status")
            .in("tenant_id", tenantIds),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
        ];
  if (error || prefError) throw new Error("Failed to load tenant contacts");
  const phoneByTenant = new Map(
    (tenants || []).map((tenant) => [
      String(tenant.id),
      normalizeToE164(tenant.phone),
    ]),
  );
  const consentByTenantPhone = new Map(
    (preferences || []).map((preference) => [
      `${preference.tenant_id}:${preference.phone_number}`,
      String(preference.sms_consent_status || "unknown"),
    ]),
  );
  const normalizedPhones = [
    ...new Set([...phoneByTenant.values()].filter((phone): phone is string => Boolean(phone))),
  ];
  const { data: suppressions, error: suppressionError } =
    normalizedPhones.length
      ? await supabaseServer
          .from("RENT_sms_phone_suppressions")
          .select("phone_number_e164, is_suppressed")
          .in("phone_number_e164", normalizedPhones)
          .eq("is_suppressed", true)
      : { data: [], error: null };
  if (suppressionError) throw new Error("Failed to load phone suppressions");
  const suppressedPhones = new Set(
    (suppressions || []).map((row) => String(row.phone_number_e164)),
  );

  let created = 0;
  let duplicates = 0;
  let eligible = 0;
  for (const account of accounts) {
    const phone = phoneByTenant.get(account.tenantId) || null;
    const candidate = buildAutomaticDraftCandidate({
      account,
      phone,
      consentStatus: phone
        ? consentByTenantPhone.get(`${account.tenantId}:${phone}`) || "unknown"
        : "unknown",
      phoneSuppressed: phone ? suppressedPhones.has(phone) : false,
    });
    if (!candidate) continue;
    eligible += 1;
    const result = await createApprovalDraft({
      tenantId: account.tenantId,
      propertyId: account.propertyId,
      leaseId: account.leaseId,
      triggerType: candidate.triggerType,
      templateKey:
        candidate.triggerType === "late_day_6"
          ? "late_payment_reminder"
          : "eviction_process_notice",
      body: candidate.body,
      generatedAsOfDate: businessDate,
      generatedLedgerVersion: account.ledgerVersion,
      balanceSnapshot: account.pastDueBalanceDue,
      daysLateSnapshot: account.daysLate,
      generationReason:
        candidate.triggerType === "late_day_6"
          ? "Day 6 after due date/grace period"
          : "Day 15 eviction-risk warning milestone",
      idempotencyKey: candidate.idempotencyKey,
      phoneSnapshot: candidate.phone,
      createdByAuthUserId: null,
    });
    if (result.duplicate) duplicates += 1;
    else created += 1;
  }

  return { created, duplicates, eligible };
}

