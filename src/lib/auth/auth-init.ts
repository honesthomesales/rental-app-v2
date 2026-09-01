import type { Session } from "@supabase/supabase-js";

import type { AuthStatus } from "@/lib/auth/session-state";

export const AUTH_INIT_SAFETY_MS = 8_000;
export const GET_SESSION_TIMEOUT_MS = 4_000;
export const FETCH_SESSION_TIMEOUT_MS = 10_000;

export type SessionApiResult =
  | { kind: "authenticated"; email: string | null; role: string | null }
  | { kind: "unauthenticated" }
  | { kind: "session_error" }
  | { kind: "unable_to_load" };

export function resolveSessionApiResult(
  status: number,
  data?: { email?: string | null; role?: string | null },
): SessionApiResult {
  if (status === 401) return { kind: "unauthenticated" };
  if (status === 403) return { kind: "session_error" };
  if (status >= 400) return { kind: "unable_to_load" };
  return {
    kind: "authenticated",
    email: data?.email ?? null,
    role: data?.role ?? null,
  };
}

export function sessionApiResultToAuthStatus(result: SessionApiResult): AuthStatus {
  if (result.kind === "authenticated") return "authenticated";
  if (result.kind === "session_error") return "session_error";
  return "unauthenticated";
}

/** Cookie check runs before any client getSession call (Android can hang on getSession). */
export function shouldTryClientSessionAfterCookieCheck(
  cookieStatus: number,
): boolean {
  return cookieStatus === 401;
}

export function pickEmail(
  apiEmail: string | null,
  session?: Session | null,
): string | null {
  return apiEmail ?? session?.user.email ?? null;
}
