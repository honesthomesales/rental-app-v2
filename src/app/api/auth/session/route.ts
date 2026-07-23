import { NextResponse } from "next/server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { getPublicCommunicationsFeatures } from "@/lib/communications/public-features";
import { getPaymentPublicFeatureFlags } from "@/lib/payments/feature-flags";

export const dynamic = "force-dynamic";

/** Confirm session + active app user after login. Exposes safe feature flags only. */
export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (isAuthError(auth)) return auth;
  return NextResponse.json({
    ok: true,
    role: auth.role,
    email: auth.appUser.email,
    features: {
      ...getPublicCommunicationsFeatures(),
      ...getPaymentPublicFeatureFlags(),
    },
  });
}
