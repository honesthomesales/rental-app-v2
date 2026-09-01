"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  AUTH_INIT_SAFETY_MS,
  GET_SESSION_TIMEOUT_MS,
  pickEmail,
  resolveSessionApiResult,
  shouldTryClientSessionAfterCookieCheck,
} from "@/lib/auth/auth-init";
import { createBrowserSupabaseClient } from "@/lib/auth/browser-client";
import { fetchAppSession } from "@/lib/auth/session-fetch";
import {
  type AuthStatus,
  logoutRedirectPath,
} from "@/lib/auth/session-state";

type AuthContextValue = {
  status: AuthStatus;
  email: string | null;
  role: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<{ ok: boolean; error?: string }>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function readClientSessionWithTimeout(): Promise<Session | null> {
  const supabase = createBrowserSupabaseClient();
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<never>((_, reject) => {
        window.setTimeout(
          () => reject(new Error("getSession timed out")),
          GET_SESSION_TIMEOUT_MS,
        );
      }),
    ]);
    if (result.error) return null;
    return result.data.session;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const applyGeneration = useRef(0);

  const applyResolved = useCallback(
    (
      result: ReturnType<typeof resolveSessionApiResult>,
      session?: Session | null,
    ) => {
      if (result.kind === "authenticated") {
        setEmail(pickEmail(result.email, session));
        setRole(result.role);
        setStatus("authenticated");
        return;
      }
      if (result.kind === "session_error") {
        setEmail(null);
        setRole(null);
        setStatus("session_error");
        return;
      }
      setEmail(null);
      setRole(null);
      setStatus("unauthenticated");
    },
    [],
  );

  const verifyAccess = useCallback(
    async (
      generation: number,
      accessToken?: string | null,
      session?: Session | null,
    ) => {
      const res = await fetchAppSession(accessToken);
      if (generation !== applyGeneration.current) return;

      let data: { email?: string | null; role?: string | null } | undefined;
      if (res.ok) {
        data = (await res.json()) as {
          email?: string | null;
          role?: string | null;
        };
      }

      applyResolved(resolveSessionApiResult(res.status, data), session);
    },
    [applyResolved],
  );

  const applySession = useCallback(
    async (hint?: Session | null) => {
      const generation = ++applyGeneration.current;

      try {
        if (hint !== undefined) {
          if (!hint) {
            applyResolved({ kind: "unauthenticated" });
            return;
          }
          await verifyAccess(generation, hint.access_token, hint);
          return;
        }

        const cookieRes = await fetchAppSession(null);
        if (generation !== applyGeneration.current) return;

        if (cookieRes.ok) {
          const data = (await cookieRes.json()) as {
            email?: string | null;
            role?: string | null;
          };
          applyResolved(resolveSessionApiResult(cookieRes.status, data));
          return;
        }

        if (!shouldTryClientSessionAfterCookieCheck(cookieRes.status)) {
          applyResolved(resolveSessionApiResult(cookieRes.status));
          return;
        }

        const clientSession = await readClientSessionWithTimeout();
        if (generation !== applyGeneration.current) return;

        if (!clientSession) {
          applyResolved({ kind: "unauthenticated" });
          return;
        }

        await verifyAccess(generation, clientSession.access_token, clientSession);
      } catch {
        if (generation !== applyGeneration.current) return;
        applyResolved({ kind: "unauthenticated" });
      }
    },
    [applyResolved, verifyAccess],
  );

  const refresh = useCallback(async () => {
    await applySession();
  }, [applySession]);

  useEffect(() => {
    let resolved = false;
    const finish = () => {
      resolved = true;
    };

    const safetyTimer = window.setTimeout(() => {
      if (resolved) return;
      applyGeneration.current += 1;
      setStatus("unauthenticated");
      setEmail(null);
      setRole(null);
    }, AUTH_INIT_SAFETY_MS);

    const run = async () => {
      try {
        await applySession();
      } finally {
        finish();
        window.clearTimeout(safetyTimer);
      }
    };

    void run();

    const supabase = createBrowserSupabaseClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      window.setTimeout(() => {
        if (event === "SIGNED_OUT") {
          finish();
          window.clearTimeout(safetyTimer);
          setStatus("unauthenticated");
          setEmail(null);
          setRole(null);
          return;
        }
        if (
          event === "INITIAL_SESSION" ||
          event === "SIGNED_IN" ||
          event === "TOKEN_REFRESHED"
        ) {
          void applySession(session).finally(() => {
            finish();
            window.clearTimeout(safetyTimer);
          });
        }
      }, 0);
    });

    return () => {
      window.clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, [applySession]);

  const signOut = useCallback(async () => {
    applyGeneration.current += 1;
    try {
      const supabase = createBrowserSupabaseClient();
      const { error: clientError } = await supabase.auth.signOut();
      const res = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      setEmail(null);
      setRole(null);
      setStatus("unauthenticated");
      if (clientError && !res.ok) {
        return {
          ok: false,
          error: clientError.message || "Sign out failed",
        };
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return {
          ok: false,
          error:
            (body as { error?: string }).error ||
            `Sign out failed (${res.status})`,
        };
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Sign out failed",
      };
    }
  }, []);

  const value = useMemo(
    () => ({ status, email, role, refresh, signOut }),
    [status, email, role, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

export async function performLogoutAndRedirect(
  signOut: AuthContextValue["signOut"],
): Promise<void> {
  const result = await signOut();
  if (!result.ok) {
    window.alert(result.error || "Sign out failed");
    return;
  }
  window.location.href = logoutRedirectPath();
}
