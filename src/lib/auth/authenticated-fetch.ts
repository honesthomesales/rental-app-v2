import { createBrowserSupabaseClient } from "@/lib/auth/browser-client";

const GET_TOKEN_TIMEOUT_MS = 3_000;

async function readAccessToken(): Promise<string | null> {
  try {
    const supabase = createBrowserSupabaseClient();
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<never>((_, reject) => {
        window.setTimeout(
          () => reject(new Error("getSession timed out")),
          GET_TOKEN_TIMEOUT_MS,
        );
      }),
    ]);
    return result.data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Same-origin API fetch with session cookies and optional Bearer fallback. */
export async function fetchAuthenticated(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
    headers.set("Pragma", "no-cache");
  }

  const token = await readAccessToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(input, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
}
