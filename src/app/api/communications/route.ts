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
  isProductionSmsConfigured,
} from "@/lib/communications/providers";
import { normalizeToE164 } from "@/lib/communications/phone";

function canSendWithProvider(): {
  allowed: boolean;
  providerName: string;
  message: string | null;
} {
  if (isProductionSmsConfigured()) {
    return { allowed: true, providerName: "twilio", message: null };
  }
  if (process.env.SMS_PROVIDER === "mock") {
    return { allowed: true, providerName: "mock", message: null };
  }
  return {
    allowed: false,
    providerName: "none",
    message: "SMS provider not configured",
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

    const { data: messages, error: msgError } = await supabaseServer
      .from("RENT_communications")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });

    if (msgError) {
      return NextResponse.json(
        { error: "Failed to load communications", details: msgError.message },
        { status: 500 },
      );
    }

    let preference = null;
    if (phoneE164) {
      const { data: pref } = await supabaseServer
        .from("RENT_communication_preferences")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("phone_number", phoneE164)
        .maybeSingle();
      preference = pref || null;
    }

    const provider = canSendWithProvider();
    const sendAllowed = auth.role !== "readonly" && provider.allowed;

    return NextResponse.json({
      featureEnabled: true,
      schemaReady: true,
      canSend: sendAllowed,
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
      templates: MESSAGE_TEMPLATES,
      messages: sortCommunicationsChronologically(messages || []),
    });
  } catch (error) {
    console.error("GET /api/communications error:", error);
    return NextResponse.json(
      { error: "Failed to load communications" },
      { status: 500 },
    );
  }
}
