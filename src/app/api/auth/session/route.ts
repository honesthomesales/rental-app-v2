import { NextResponse } from "next/server";
import {
  isAuthError,
  requireApiAuth,
} from "@/lib/auth/api-auth";

/** Confirm session + active app user after login. */
export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (isAuthError(auth)) return auth;
  return NextResponse.json({
    ok: true,
    role: auth.role,
    email: auth.appUser.email,
  });
}
