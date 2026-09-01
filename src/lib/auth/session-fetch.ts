/** Verify app access; Bearer works when SSR cookies are not synced yet (common on mobile). */
export function fetchAppSession(accessToken?: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
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
