import { NextRequest, NextResponse } from "next/server";
import {
  createRouteHandlerSupabase,
  jsonWithSupabaseCookies,
} from "@/lib/auth/route-handler-client";

export const dynamic = "force-dynamic";

/** Write Supabase session cookies after client sign-in (required on Android/PWA). */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      access_token?: string;
      refresh_token?: string;
    };
    const access_token = body.access_token?.trim();
    const refresh_token = body.refresh_token?.trim();
    if (!access_token || !refresh_token) {
      return NextResponse.json({ error: "Missing session tokens" }, { status: 400 });
    }

    const { supabase, cookieResponse } = createRouteHandlerSupabase(request);
    const { error } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });
    if (error) {
      return jsonWithSupabaseCookies(
        { error: error.message },
        cookieResponse(),
        { status: 400 },
      );
    }

    return jsonWithSupabaseCookies({ ok: true }, cookieResponse());
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Could not establish session",
      },
      { status: 500 },
    );
  }
}
