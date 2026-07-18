/**
 * V3 app-user authorization against RENT_v3_app_users.
 * Does not alter Supabase schema. Service-role used only after auth succeeds.
 */

import { createServerClient } from "@supabase/ssr";
import { createClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export type AppRole = "owner" | "staff" | "readonly";

export type AppUserRecord = {
  id: string;
  auth_user_id: string;
  email: string | null;
  role: AppRole;
  is_active: boolean;
};

export type AuthorizedRequest = {
  user: User;
  appUser: AppUserRecord;
  role: AppRole;
};

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export function createAnonServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Cookie-based server client for RSC / route handlers */
export async function createSupabaseServerAuthClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            /* ignore in Server Components */
          }
        },
      },
    },
  );
}

export async function loadActiveAppUser(
  authUserId: string,
): Promise<AppUserRecord | null> {
  const { data, error } = await supabaseServer
    .from("RENT_v3_app_users")
    .select("id, auth_user_id, email, role, is_active")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error || !data) return null;
  if (!data.is_active) return null;
  const role = String(data.role || "").toLowerCase() as AppRole;
  if (role !== "owner" && role !== "staff" && role !== "readonly") {
    return null;
  }
  return {
    id: data.id,
    auth_user_id: data.auth_user_id,
    email: data.email ?? null,
    role,
    is_active: !!data.is_active,
  };
}

/**
 * Authenticate via Authorization Bearer or session cookie, then require
 * an active RENT_v3_app_users row. Returns 401/403 NextResponse on failure.
 */
export async function requireApiAuth(
  request: Request,
  options: {
    write?: boolean;
    ownerOnly?: boolean;
  } = {},
): Promise<AuthorizedRequest | NextResponse> {
  let user: User | null = null;

  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];

  if (bearer) {
    const anon = createAnonServerClient();
    const { data, error } = await anon.auth.getUser(bearer);
    if (!error && data.user) user = data.user;
  }

  if (!user) {
    try {
      const supabase = await createSupabaseServerAuthClient();
      const { data, error } = await supabase.auth.getUser();
      if (!error && data.user) user = data.user;
    } catch {
      /* no cookies */
    }
  }

  if (!user) {
    return jsonError(401, "Unauthorized");
  }

  const appUser = await loadActiveAppUser(user.id);
  if (!appUser) {
    return jsonError(403, "Forbidden");
  }

  if (options.ownerOnly && appUser.role !== "owner") {
    return jsonError(403, "Forbidden");
  }

  if (options.write && appUser.role === "readonly") {
    return jsonError(403, "Forbidden");
  }

  return { user, appUser, role: appUser.role };
}

export function isAuthError(
  result: AuthorizedRequest | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse;
}

/** After authorization succeeds, callers may use the service-role client. */
export function getAuthorizedServiceClient(_authorized: AuthorizedRequest) {
  void _authorized;
  return supabaseServer;
}
