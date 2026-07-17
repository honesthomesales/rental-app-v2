import { NextResponse } from "next/server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { supabaseServer } from "@/lib/supabase-server";
import {
  communicationsDisabledResponse,
  communicationsNotConfiguredResponse,
  isTenantCommunicationsEnabled,
} from "@/lib/communications/feature-flag";
import { areCommunicationTablesReady } from "@/lib/communications/schema";
import { sendTenantSms } from "@/lib/communications/send-service";
import { createSupabaseCommunicationsStore } from "@/lib/communications/store";
import {
  MockSmsProvider,
  TwilioSmsProvider,
  isProductionSmsConfigured,
} from "@/lib/communications/providers";
import type { TemplateKey } from "@/lib/communications/types";
import { isMissingRelationError } from "@/lib/communications/schema";

/**
 * POST /api/communications/send
 * Owner/staff only. Never sends when provider unset or feature disabled.
 */
export async function POST(request: Request) {
  const auth = await requireApiAuth(request, { write: true });
  if (isAuthError(auth)) return auth;

  try {
    if (!isTenantCommunicationsEnabled()) {
      return NextResponse.json(communicationsDisabledResponse(), {
        status: 403,
      });
    }

    const ready = await areCommunicationTablesReady();
    if (!ready) {
      return NextResponse.json(communicationsNotConfiguredResponse(), {
        status: 503,
      });
    }

    const body = await request.json();
    const {
      tenantId,
      propertyId,
      leaseId,
      phone,
      message,
      templateKey,
      idempotencyKey,
      confirmConsentOverride,
    } = body || {};

    if (!tenantId) {
      return NextResponse.json(
        { error: "tenantId is required" },
        { status: 400 },
      );
    }

    const { data: tenant, error: tenantError } = await supabaseServer
      .from("RENT_tenants")
      .select("id, phone")
      .eq("id", tenantId)
      .maybeSingle();

    if (tenantError || !tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const phoneToUse = phone || tenant.phone;
    let provider;
    if (isProductionSmsConfigured()) {
      provider = new TwilioSmsProvider();
    } else if (process.env.SMS_PROVIDER === "mock") {
      provider = new MockSmsProvider();
    } else {
      return NextResponse.json(
        {
          error: "SMS provider not configured",
          code: "PROVIDER_NOT_CONFIGURED",
        },
        { status: 503 },
      );
    }

    const store = createSupabaseCommunicationsStore();
    const result = await sendTenantSms({
      input: {
        tenantId,
        propertyId: propertyId || null,
        leaseId: leaseId || null,
        phone: phoneToUse,
        body: message,
        templateKey: (templateKey as TemplateKey) || null,
        idempotencyKey: String(idempotencyKey || ""),
        sentByAuthUserId: auth.user.id,
        confirmConsentOverride: Boolean(confirmConsentOverride),
      },
      provider,
      store,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          code: result.code,
          communication: result.communication || null,
        },
        { status: result.status },
      );
    }

    return NextResponse.json({
      ok: true,
      duplicate: Boolean(result.duplicate),
      communication: result.communication,
    });
  } catch (error) {
    console.error("POST /api/communications/send error:", error);
    if (isMissingRelationError(error)) {
      return NextResponse.json(communicationsNotConfiguredResponse(), {
        status: 503,
      });
    }
    return NextResponse.json(
      {
        error: "Failed to send message",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
