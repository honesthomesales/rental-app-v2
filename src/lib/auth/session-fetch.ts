import type { Session } from "@supabase/supabase-js";

/** Persist session in HTTP-only cookies so middleware + APIs work after redirect. */
export function establishAppSession(session: Session): Promise<Response> {
  return fetch("/api/auth/establish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }),
  });
}

/** Verify app access; Bearer works when SSR cookies are not synced yet (common on mobile). */
export function fetchAppSession(accessToken?: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return fetch("/api/auth/session", {
    method: "GET",
    headers,
    credentials: "include",
    cache: "no-store",
  });
}
