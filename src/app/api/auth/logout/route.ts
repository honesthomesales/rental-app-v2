import { NextResponse } from "next/server";
import { createSupabaseServerAuthClient } from "@/lib/auth/api-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const supabase = await createSupabaseServerAuthClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Sign out failed",
      },
      { status: 500 },
    );
  }
}
