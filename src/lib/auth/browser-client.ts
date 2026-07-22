import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client that persists the session in cookies (SSR-compatible). */
export function createBrowserSupabaseClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  );
}
