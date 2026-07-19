import { NextResponse } from "next/server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";

/**
 * Direct sends are permanently retired. The composer creates approval drafts
 * through /api/communications/approvals; only the owner-only approval action
 * may submit to a provider after server-side revalidation.
 */
export async function POST(request: Request) {
  const auth = await requireApiAuth(request, { ownerOnly: true });
  if (isAuthError(auth)) return auth;
  void auth;
  return NextResponse.json(
    {
      error: "Direct SMS sending is disabled; add the message to approvals",
      code: "APPROVAL_REQUIRED",
      sent: false,
    },
    { status: 410 },
  );
}
