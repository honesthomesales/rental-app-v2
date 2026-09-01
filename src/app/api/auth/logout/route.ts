import { NextRequest, NextResponse } from "next/server";
import {
  createRouteHandlerSupabase,
  jsonWithSupabaseCookies,
} from "@/lib/auth/route-handler-client";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { supabase, cookieResponse } = createRouteHandlerSupabase(request);
    const { error } = await supabase.auth.signOut();
    if (error) {
      return jsonWithSupabaseCookies(
        { error: error.message },
        cookieResponse(),
        { status: 500 },
      );
    }
    return jsonWithSupabaseCookies({ ok: true }, cookieResponse());
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Sign out failed",
      },
      { status: 500 },
    );
  }
}
