import { supabaseServer } from "@/lib/supabase-server";
import { normalizeToE164 } from "./phone";
import type {
  CommunicationPreference,
  SmsConsentStatus,
} from "./types";

export type RecordConsentInput = {
  tenantId: string;
  phone: string;
  status: SmsConsentStatus;
  source: string;
  notes?: string | null;
  recordedByAuthUserId?: string | null;
  supportingDocumentReference?: string | null;
  tenantTimezone?: string | null;
  providerMessageId?: string | null;
};

export async function getTenantPreference(
  tenantId: string,
  phone: string,
): Promise<CommunicationPreference | null> {
  const phoneE164 = normalizeToE164(phone);
  if (!phoneE164) return null;
  const { data, error } = await supabaseServer
    .from("RENT_communication_preferences")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("phone_number", phoneE164)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CommunicationPreference | null) || null;
}

/**
 * Update current consent and append an immutable event. If event insertion
 * fails, restore the prior preference so no unaudited consent change remains.
 */
export async function recordTenantConsent(
  input: RecordConsentInput,
): Promise<CommunicationPreference> {
  const phoneE164 = normalizeToE164(input.phone);
  if (!phoneE164) throw new Error("Invalid phone number");
  if (!["unknown", "opted_in", "opted_out"].includes(input.status)) {
    throw new Error("Invalid consent status");
  }

  const prior = await getTenantPreference(input.tenantId, phoneE164);
  const { data, error } = await supabaseServer.rpc(
    "rent_record_communication_consent",
    {
      p_tenant_id: input.tenantId,
      p_phone_number: phoneE164,
      p_new_status: input.status,
      p_source: input.source,
      p_notes: input.notes || null,
      p_recorded_by_auth_user_id: input.recordedByAuthUserId || null,
      p_supporting_document_reference:
        input.supportingDocumentReference || null,
      p_tenant_timezone:
        input.tenantTimezone ||
        prior?.tenant_timezone ||
        "America/New_York",
      p_provider_message_id: input.providerMessageId || null,
    },
  );
  if (error || !data) {
    if (error?.code === "23505" && input.providerMessageId) {
      const existing = await getTenantPreference(input.tenantId, phoneE164);
      if (existing) return existing;
    }
    throw new Error(error?.message || "Failed to update consent");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row as CommunicationPreference;
}

export async function listConsentEvents(tenantId: string) {
  const { data, error } = await supabaseServer
    .from("RENT_communication_consent_events")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

