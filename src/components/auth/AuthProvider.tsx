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

/** Last-resort guard so auth never stays on loading forever. */
const AUTH_REFRESH_TIMEOUT_MS = 30_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) {
      return refreshInFlight.current;
    }

    const run = (async () => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            const supabase = createBrowserSupabaseClient();
            const {
              data: { session },
              error: sessionError,
            } = await supabase.auth.getSession();

            if (sessionError) {
              setStatus("session_error");
              setEmail(null);
              setRole(null);
              return;
            }

            if (!session) {
              setStatus("unauthenticated");
              setEmail(null);
              setRole(null);
              return;
            }

            let activeSession = session;
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

            const res = await fetch("/api/auth/session", {
              method: "GET",
              credentials: "include",
              cache: "no-store",
            });

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
          })(),
          new Promise<void>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error("Auth refresh timed out")),
              AUTH_REFRESH_TIMEOUT_MS,
            );
          }),
        ]);
      } catch {
        setStatus("session_error");
        setEmail(null);
        setRole(null);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (refreshInFlight.current === run) {
          refreshInFlight.current = null;
        }
      }
    })();

    refreshInFlight.current = run;
    return run;
  }, []);

  useEffect(() => {
    void refresh();
    const supabase = createBrowserSupabaseClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "INITIAL_SESSION") return;
      // Defer to avoid Supabase auth deadlocks when calling getSession inside this callback.
      window.setTimeout(() => {
        void refresh();
      }, 0);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [refresh]);

  const signOut = useCallback(async () => {
    refreshInFlight.current = null;
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
