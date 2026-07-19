import { NextResponse } from "next/server";
import { createSupabaseServerAuthClient } from "@/lib/auth/api-auth";

export async function POST() {
  const supabase = await createSupabaseServerAuthClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
