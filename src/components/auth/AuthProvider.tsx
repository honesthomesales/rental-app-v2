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
import { createBrowserSupabaseClient } from "@/lib/auth/browser-client";
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

const AUTH_REFRESH_TIMEOUT_MS = 12_000;

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const refreshGeneration = useRef(0);
  const refreshInFlight = useRef<Promise<void> | null>(null);

  const applySession = useCallback(
    async (session: Session | null, generation: number) => {
      if (!session) {
        if (generation !== refreshGeneration.current) return;
        setStatus("unauthenticated");
        setEmail(null);
        setRole(null);
        return;
      }

      const expiresAtMs = session.expires_at
        ? session.expires_at * 1000
        : null;
      let activeSession = session;
      if (expiresAtMs && Date.now() >= expiresAtMs - 30_000) {
        const supabase = createBrowserSupabaseClient();
        const { data: refreshed, error: refreshError } = await withTimeout(
          supabase.auth.refreshSession(),
          AUTH_REFRESH_TIMEOUT_MS,
          "Session refresh",
        );
        if (generation !== refreshGeneration.current) return;
        if (refreshError || !refreshed.session) {
          setStatus("session_error");
          setEmail(null);
          setRole(null);
          return;
        }
        activeSession = refreshed.session;
      }

      const res = await withTimeout(
        fetch("/api/auth/session", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        }),
        AUTH_REFRESH_TIMEOUT_MS,
        "Session validation",
      );

      if (generation !== refreshGeneration.current) return;

      if (res.status === 401) {
        setStatus("unauthenticated");
        setEmail(null);
        setRole(null);
        return;
      }
      if (res.status === 403) {
        setStatus("session_error");
        setEmail(null);
        setRole(null);
        return;
      }
      if (!res.ok) {
        setStatus("session_error");
        setEmail(null);
        setRole(null);
        return;
      }

      const data = (await res.json()) as {
        email?: string | null;
        role?: string | null;
      };
      setEmail(data.email ?? activeSession.user.email ?? null);
      setRole(data.role ?? null);
      setStatus("authenticated");
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) {
      return refreshInFlight.current;
    }

    const generation = ++refreshGeneration.current;
    const run = (async () => {
      try {
        const supabase = createBrowserSupabaseClient();
        const {
          data: { session },
          error: sessionError,
        } = await withTimeout(
          supabase.auth.getSession(),
          AUTH_REFRESH_TIMEOUT_MS,
          "Session lookup",
        );

        if (generation !== refreshGeneration.current) return;

        if (sessionError) {
          setStatus("session_error");
          setEmail(null);
          setRole(null);
          return;
        }

        await applySession(session, generation);
      } catch {
        if (generation !== refreshGeneration.current) return;
        setStatus("session_error");
        setEmail(null);
        setRole(null);
      } finally {
        if (refreshInFlight.current === run) {
          refreshInFlight.current = null;
        }
      }
    })();

    refreshInFlight.current = run;
    return run;
  }, [applySession]);

  useEffect(() => {
    void refresh();
    const supabase = createBrowserSupabaseClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      const generation = ++refreshGeneration.current;
      void (async () => {
        try {
          if (event === "SIGNED_OUT" || !session) {
            setStatus("unauthenticated");
            setEmail(null);
            setRole(null);
            return;
          }
          await applySession(session, generation);
        } catch {
          if (generation !== refreshGeneration.current) return;
          setStatus("session_error");
          setEmail(null);
          setRole(null);
        }
      })();
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [applySession, refresh]);

  const signOut = useCallback(async () => {
    refreshGeneration.current += 1;
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
