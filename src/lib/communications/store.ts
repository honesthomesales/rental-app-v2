import { supabaseServer } from "@/lib/supabase-server";
import type { CommunicationsStore } from "./send-service";
import type { CommunicationPreference, CommunicationRow } from "./types";

function mapRow(data: Record<string, unknown>): CommunicationRow {
  return {
    id: String(data.id),
    tenant_id: String(data.tenant_id),
    property_id: (data.property_id as string) || null,
    lease_id: (data.lease_id as string) || null,
    channel: (data.channel as CommunicationRow["channel"]) || "sms",
    direction: (data.direction as CommunicationRow["direction"]) || "outbound",
    body: String(data.body || ""),
    template_key: (data.template_key as string) || null,
    status: data.status as CommunicationRow["status"],
    provider: (data.provider as string) || null,
    provider_message_id: (data.provider_message_id as string) || null,
    from_number: (data.from_number as string) || null,
    to_number: (data.to_number as string) || null,
    sent_by_auth_user_id: (data.sent_by_auth_user_id as string) || null,
    idempotency_key: (data.idempotency_key as string) || null,
    error_code: (data.error_code as string) || null,
    error_message: (data.error_message as string) || null,
    created_at: String(data.created_at),
    sent_at: (data.sent_at as string) || null,
    delivered_at: (data.delivered_at as string) || null,
    failed_at: (data.failed_at as string) || null,
  };
}

export function createSupabaseCommunicationsStore(): CommunicationsStore {
  return {
    async findByIdempotencyKey(key) {
      const { data, error } = await supabaseServer
        .from("RENT_communications")
        .select("*")
        .eq("idempotency_key", key)
        .maybeSingle();
      if (error || !data) return null;
      return mapRow(data as Record<string, unknown>);
    },

    async getPreference(tenantId, phoneE164) {
      const { data, error } = await supabaseServer
        .from("RENT_communication_preferences")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("phone_number", phoneE164)
        .maybeSingle();
      if (error || !data) return null;
      return data as CommunicationPreference;
    },

    async insertPending(row) {
      const { data, error } = await supabaseServer
        .from("RENT_communications")
        .insert({
          ...row,
          channel: "sms",
          direction: "outbound",
          status: "pending",
        })
        .select("*")
        .single();
      if (error || !data) {
        throw new Error(error?.message || "Failed to insert communication");
      }
      return mapRow(data as Record<string, unknown>);
    },

    async updateAfterSend(id, patch) {
      const { data, error } = await supabaseServer
        .from("RENT_communications")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error || !data) {
        throw new Error(error?.message || "Failed to update communication");
      }
      return mapRow(data as Record<string, unknown>);
    },
  };
}
