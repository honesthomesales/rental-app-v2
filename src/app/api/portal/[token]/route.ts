import { NextRequest, NextResponse } from "next/server";
import {
  getPaymentPublicFeatureFlags,
  isTenantPaymentPortalEnabled,
  portalDisabledResponse,
} from "@/lib/payments/feature-flags";
import { resolvePortalAccess } from "@/lib/payments/portal-access";
import { buildPortalAccountSummary } from "@/lib/payments/portal-account";
import { listActiveContacts } from "@/lib/payments/contacts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  if (!isTenantPaymentPortalEnabled()) {
    return NextResponse.json(portalDisabledResponse(), { status: 503 });
  }

  const { token } = await context.params;
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const access = await resolvePortalAccess(token, `ip:${ip}`);
  if (!access) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 401 });
  }

  try {
    const [summary, contacts] = await Promise.all([
      buildPortalAccountSummary({
        tenantId: access.tenantId,
        leaseId: access.leaseId,
        propertyId: access.propertyId,
      }),
      listActiveContacts(access.tenantId).catch(() => []),
    ]);

    return NextResponse.json({
      summary,
      contacts: contacts.map((c) => ({
        id: c.id,
        type: c.contact_type,
        value: c.original_value,
        label: c.label,
        isPrimary: c.is_primary,
        verificationStatus: c.verification_status,
      })),
      flags: getPaymentPublicFeatureFlags(),
      destinations: {
        cashApp: process.env.EXISTING_CASH_APP_DESTINATION || null,
        zelle: process.env.EXISTING_ZELLE_DESTINATION || null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load portal account",
        details: error instanceof Error ? error.message : "Unknown",
      },
      { status: 500 },
    );
  }
}
