import { supabaseServer } from "@/lib/supabase-server";

/** Detect missing communication tables without crashing the app. */
export async function areCommunicationTablesReady(): Promise<boolean> {
  try {
    for (const table of [
      "RENT_communications",
      "RENT_communication_preferences",
      "RENT_communication_consent_events",
      "RENT_sms_phone_suppressions",
      "RENT_sms_phone_suppression_events",
      "RENT_communication_tenant_links",
      "RENT_communication_approvals",
    ]) {
      const { error } = await supabaseServer.from(table).select("id").limit(1);
      if (!error) continue;
      const msg = String(error.message || error.code || "").toLowerCase();
      if (
        msg.includes("does not exist") ||
        msg.includes("schema cache") ||
        error.code === "42P01" ||
        error.code === "PGRST205"
      ) {
        return false;
      }
    }
    // Other errors (such as temporary permission failures) are surfaced later.
    return true;
  } catch {
    return false;
  }
}

export function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { message?: string; code?: string };
  const msg = String(e.message || "").toLowerCase();
  return (
    e.code === "42P01" ||
    e.code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}
