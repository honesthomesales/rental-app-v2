import { supabaseServer } from "@/lib/supabase-server";

/** Detect missing communication tables without crashing the app. */
export async function areCommunicationTablesReady(): Promise<boolean> {
  try {
    const { error } = await supabaseServer
      .from("RENT_communications")
      .select("id")
      .limit(1);
    if (!error) return true;
    const msg = String(error.message || error.code || "").toLowerCase();
    if (
      msg.includes("does not exist") ||
      msg.includes("schema cache") ||
      error.code === "42P01" ||
      error.code === "PGRST205"
    ) {
      return false;
    }
    // Other errors (RLS, etc.) — treat as present but may fail later
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
