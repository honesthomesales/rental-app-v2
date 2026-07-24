import { NextRequest, NextResponse } from "next/server";
import {
  getPaymentPublicFeatureFlags,
  isTenantPaymentPortalEnabled,
  portalDisabledResponse,
} from "@/lib/payments/feature-flags";
import { resolvePortalAccess } from "@/lib/payments/portal-access";
import { buildPortalAccountSummary } from "@/lib/payments/portal-account";
import { listActiveContacts } from "@/lib/payments/contacts";
import { ensureStaffRecordedContactsFromTenant } from "@/lib/payments/ensure-staff-contacts";
import { supabaseServer } from "@/lib/supabase-server";

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
    const { data: tenantRow } = await supabaseServer
      .from("RENT_tenants")
      .select("id, phone, email")
      .eq("id", access.tenantId)
      .maybeSingle();

    if (tenantRow) {
      await ensureStaffRecordedContactsFromTenant({
        tenantId: access.tenantId,
        phone: tenantRow.phone,
        email: tenantRow.email,
        actor: "portal_staff_mirror",
      }).catch(() => undefined);
    }

    const [summary, contacts] = await Promise.all([
      buildPortalAccountSummary({
        tenantId: access.tenantId,
        leaseId: access.leaseId,
        propertyId: access.propertyId,
      }),
      listActiveContacts(access.tenantId).catch(() => []),
    ]);

    const flags = getPaymentPublicFeatureFlags();

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
      flags: {
        portalEnabled: flags.portalEnabled,
        contactSelfServiceEnabled: flags.contactSelfServiceEnabled,
        achEnabled: false,
        cardEnabled: false,
        cashAppPayEnabled: false,
        existingCashAppEnabled: false,
        zelleEnabled: false,
        feeEngineEnabled: false,
      },
    });
  } catch {
    return NextResponse.json(
      {
        error: "Failed to load portal account",
      },
      { status: 500 },
    );
  }
}
