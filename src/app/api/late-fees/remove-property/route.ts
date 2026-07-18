import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Legacy property-scoped late-fee removal is retired.
 * Use authenticated per-invoice Waive Fee instead.
 */
export async function POST(request: NextRequest) {
  const auth = await requireApiAuth(request, { write: true, ownerOnly: true });
  if (isAuthError(auth)) return auth;

  return NextResponse.json(
    {
      error:
        "Property late-fee removal is disabled. Use Waive Fee per invoice.",
      writePerformed: false,
    },
    { status: 410 },
  );
}
