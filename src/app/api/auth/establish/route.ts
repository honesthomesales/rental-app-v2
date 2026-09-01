import { NextResponse } from "next/server";
import { createSupabaseServerAuthClient } from "@/lib/auth/api-auth";

export const dynamic = "force-dynamic";

/** Write Supabase session cookies after client sign-in (required on Android/PWA). */
export async function POST(request: Request) {
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

    const supabase = await createSupabaseServerAuthClient();
    const { error } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not establish session" },
      { status: 500 },
    );
  }
}
