import { NextResponse } from "next/server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { supabaseServer } from "@/lib/supabase-server";
import {
  communicationsDisabledResponse,
  communicationsNotConfiguredResponse,
  isTenantCommunicationsEnabled,
} from "@/lib/communications/feature-flag";
import { areCommunicationTablesReady } from "@/lib/communications/schema";
import { sortCommunicationsChronologically } from "@/lib/communications/send-service";
import { MESSAGE_TEMPLATES } from "@/lib/communications/templates";
import {
  smsProviderStatus,
} from "@/lib/communications/providers";
import { normalizeToE164 } from "@/lib/communications/phone";
import { getPhoneSuppression } from "@/lib/communications/suppression";

function canSendWithProvider(): {
  allowed: boolean;
  providerName: string;
  message: string | null;
} {
  const status = smsProviderStatus();
  return {
    allowed: status.configured,
    providerName: status.providerName,
    message: status.message,
  };
}

/**
 * GET /api/communications?tenantId=...
 * List communication history + preference + templates (read for all roles).
 */
export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (isAuthError(auth)) return auth;

  try {
    if (!isTenantCommunicationsEnabled()) {
      return NextResponse.json({
        ...communicationsDisabledResponse(),
        templates: MESSAGE_TEMPLATES,
        canSend: false,
        comingSoon: true,
      });
    }

    const ready = await areCommunicationTablesReady();
    if (!ready) {
      return NextResponse.json({
        ...communicationsNotConfiguredResponse(),
        templates: MESSAGE_TEMPLATES,
        canSend: false,
      });
    }

    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json(
        { error: "tenantId is required" },
        { status: 400 },
      );
    }

    const { data: tenant, error: tenantError } = await supabaseServer
      .from("RENT_tenants")
      .select("id, first_name, last_name, full_name, phone")
      .eq("id", tenantId)
      .maybeSingle();

    if (tenantError || !tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const phoneE164 = normalizeToE164(tenant.phone);

    const [{ data: directMessages, error: directError }, { data: links, error: linkError }] =
      await Promise.all([
        supabaseServer
          .from("RENT_communications")
          .select("*")
          .eq("tenant_id", tenantId),
        supabaseServer
          .from("RENT_communication_tenant_links")
          .select("communication_id")
          .eq("tenant_id", tenantId),
      ]);

    if (directError || linkError) {
      return NextResponse.json(
        { error: "Failed to load communications" },
        { status: 500 },
      );
    }
    const linkedIds = (links || []).map((link) => link.communication_id);
    const { data: linkedMessages, error: linkedError } = linkedIds.length
      ? await supabaseServer
          .from("RENT_communications")
          .select("*")
          .in("id", linkedIds)
      : { data: [], error: null };
    if (linkedError) {
      return NextResponse.json(
        { error: "Failed to load communications" },
        { status: 500 },
      );
    }
    const messageById = new Map(
      [...(directMessages || []), ...(linkedMessages || [])].map((message) => [
        message.id,
        message,
      ]),
    );

    let preference = null;
    let phoneSuppression = null;
    if (phoneE164) {
      const [{ data: pref }, suppression] = await Promise.all([
        supabaseServer
          .from("RENT_communication_preferences")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("phone_number", phoneE164)
          .maybeSingle(),
        getPhoneSuppression(phoneE164),
      ]);
      preference = pref || null;
      phoneSuppression = suppression;
    }

    const provider = canSendWithProvider();
    return NextResponse.json({
      featureEnabled: true,
      schemaReady: true,
      canDraft: auth.role === "owner",
      canSend: false,
      role: auth.role,
      provider: {
        configured: provider.allowed,
        name: provider.providerName,
        message: provider.message,
      },
      tenant: {
        id: tenant.id,
        name:
          tenant.full_name ||
          [tenant.first_name, tenant.last_name].filter(Boolean).join(" "),
        phone: tenant.phone || null,
        phoneE164,
      },
      preference,
      phoneSuppression,
      templates: MESSAGE_TEMPLATES,
      messages: sortCommunicationsChronologically([...messageById.values()]),
    });
  } catch (error) {
    console.error("GET /api/communications error:", error);
    return NextResponse.json(
      { error: "Failed to load communications" },
      { status: 500 },
    );
  }
}
