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

const GET_SESSION_TIMEOUT_MS = 8_000;

async function readBrowserSession(
  hint?: Session | null,
): Promise<Session | null> {
  if (hint !== undefined) return hint;

  const supabase = createBrowserSupabaseClient();
  const result = await Promise.race([
    supabase.auth.getSession(),
    new Promise<never>((_, reject) => {
      window.setTimeout(
        () => reject(new Error("getSession timed out")),
        GET_SESSION_TIMEOUT_MS,
      );
    }),
  ]);

  if (result.error) throw result.error;
  return result.data.session;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const applyGeneration = useRef(0);

  const applySession = useCallback(async (hint?: Session | null) => {
    const generation = ++applyGeneration.current;
    try {
      const session = await readBrowserSession(hint);

      if (generation !== applyGeneration.current) return;

      if (!session) {
        setStatus("unauthenticated");
        setEmail(null);
        setRole(null);
        return;
      }

      let activeSession = session;
      const supabase = createBrowserSupabaseClient();
      const expiresAtMs = session.expires_at
        ? session.expires_at * 1000
        : null;
      if (expiresAtMs && Date.now() >= expiresAtMs - 30_000) {
        const { data: refreshed, error: refreshError } =
          await supabase.auth.refreshSession();
        if (!refreshError && refreshed.session) {
          activeSession = refreshed.session;
        }
      }

      if (generation !== applyGeneration.current) return;

      const res = await fetchAppSession(activeSession.access_token);

      if (generation !== applyGeneration.current) return;

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
    } catch {
      if (generation !== applyGeneration.current) return;
      setStatus("unauthenticated");
      setEmail(null);
      setRole(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    await applySession();
  }, [applySession]);

  useEffect(() => {
    // iOS PWA often never fires INITIAL_SESSION — always resolve on mount too.
    void applySession();

    const supabase = createBrowserSupabaseClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      window.setTimeout(() => {
        if (event === "SIGNED_OUT") {
          setStatus("unauthenticated");
          setEmail(null);
          setRole(null);
          return;
        }
        void applySession(session);
      }, 0);
    });

    return () => {
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
