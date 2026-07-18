import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Legacy late-fee move endpoint is retired.
 * Use Edit Invoice / Waive Fee transactional endpoints instead.
 */
export async function POST(request: NextRequest) {
  const auth = await requireApiAuth(request, { write: true, ownerOnly: true });
  if (isAuthError(auth)) return auth;

  return NextResponse.json(
    {
      error:
        "Late-fee move is disabled. Use Edit Invoice or Waive Fee instead.",
      writePerformed: false,
    },
    { status: 410 },
  );
}
