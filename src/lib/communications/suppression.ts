import { supabaseServer } from "@/lib/supabase-server";
import { isExactE164, normalizeToE164 } from "./phone";

export type SmsPhoneSuppression = {
  phone_number_e164: string;
  is_suppressed: boolean;
  suppression_reason: string | null;
  suppressed_at: string | null;
  resumed_at: string | null;
  provider: string | null;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function getPhoneSuppression(
  phone: string,
): Promise<SmsPhoneSuppression | null> {
  const phoneE164 = normalizeToE164(phone);
  if (!phoneE164) return null;
  const { data, error } = await supabaseServer
    .from("RENT_sms_phone_suppressions")
    .select("*")
    .eq("phone_number_e164", phoneE164)
    .maybeSingle();
  if (error) throw new Error("Failed to check SMS phone suppression");
  return (data as SmsPhoneSuppression | null) || null;
}

export async function isPhoneGloballySuppressed(phone: string): Promise<boolean> {
  return Boolean((await getPhoneSuppression(phone))?.is_suppressed);
}

/**
 * Transactionally records a global STOP/START event. STOP updates every exact
 * preference for the E.164 number. START clears provider suppression and only
 * restores opted-in when prior audit evidence exists; otherwise it restores
 * unknown.
 */
export async function recordPhoneSuppression(args: {
  phoneE164: string;
  suppress: boolean;
  reason: string;
  provider: string;
  sourceMessageId?: string | null;
}): Promise<SmsPhoneSuppression> {
  if (!isExactE164(args.phoneE164)) {
    throw new Error("Phone must be exact E.164");
  }
  const { data, error } = await supabaseServer.rpc(
    "rent_record_sms_phone_suppression",
    {
      p_phone_number_e164: args.phoneE164,
      p_is_suppressed: args.suppress,
      p_suppression_reason: args.reason,
      p_provider: args.provider,
      p_source_message_id: args.sourceMessageId || null,
    },
  );
  if (error || !data) {
    if (error?.code === "23505" && args.sourceMessageId) {
      const existing = await getPhoneSuppression(args.phoneE164);
      if (existing) return existing;
    }
    throw new Error("Failed to record SMS phone suppression");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row as SmsPhoneSuppression;
}
