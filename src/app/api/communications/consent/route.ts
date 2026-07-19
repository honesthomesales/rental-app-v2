import { NextResponse } from "next/server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { supabaseServer } from "@/lib/supabase-server";
import {
  getTenantPreference,
  listConsentEvents,
  recordTenantConsent,
} from "@/lib/communications/consent";
import {
  communicationsDisabledResponse,
  communicationsNotConfiguredResponse,
  isTenantCommunicationsEnabled,
} from "@/lib/communications/feature-flag";
import { areCommunicationTablesReady } from "@/lib/communications/schema";
import type { SmsConsentStatus } from "@/lib/communications/types";

const OWNER_SOURCES = new Set([
  "owner_recorded",
  "verbal",
  "signed_form",
  "lease_document",
  "imported",
  "corrected",
]);

async function tenantPhone(tenantId: string) {
  const { data, error } = await supabaseServer
    .from("RENT_tenants")
    .select("id, phone")
    .eq("id", tenantId)
    .maybeSingle();
  if (error || !data) return null;
  return data.phone ? String(data.phone) : null;
}

export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (isAuthError(auth)) return auth;
  if (!isTenantCommunicationsEnabled()) {
    return NextResponse.json(communicationsDisabledResponse(), { status: 403 });
  }
  if (!(await areCommunicationTablesReady())) {
    return NextResponse.json(communicationsNotConfiguredResponse(), {
      status: 503,
    });
  }

  try {
    const tenantId = new URL(request.url).searchParams.get("tenantId") || "";
    if (!tenantId) {
      return NextResponse.json(
        { error: "tenantId is required" },
        { status: 400 },
      );
    }
    const phone = await tenantPhone(tenantId);
    const [preference, events] = await Promise.all([
      phone ? getTenantPreference(tenantId, phone) : Promise.resolve(null),
      listConsentEvents(tenantId),
    ]);
    return NextResponse.json({
      role: auth.role,
      canEdit: auth.role === "owner",
      phone,
      preference,
      events,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to load consent record" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireApiAuth(request, { ownerOnly: true });
  if (isAuthError(auth)) return auth;
  if (!isTenantCommunicationsEnabled()) {
    return NextResponse.json(communicationsDisabledResponse(), { status: 403 });
  }
  if (!(await areCommunicationTablesReady())) {
    return NextResponse.json(communicationsNotConfiguredResponse(), {
      status: 503,
    });
  }

  try {
    const body = await request.json();
    const tenantId = String(body.tenantId || "");
    const status = String(body.status || "") as SmsConsentStatus;
    const source = String(body.source || "owner_recorded");
    if (!tenantId || !["unknown", "opted_in", "opted_out"].includes(status)) {
      return NextResponse.json(
        { error: "Valid tenantId and consent status are required" },
        { status: 400 },
      );
    }
    if (!OWNER_SOURCES.has(source)) {
      return NextResponse.json(
        { error: "Invalid consent source" },
        { status: 400 },
      );
    }
    const phone = await tenantPhone(tenantId);
    if (!phone) {
      return NextResponse.json(
        { error: "Tenant has no phone number" },
        { status: 409 },
      );
    }
    const preference = await recordTenantConsent({
      tenantId,
      phone,
      status,
      source,
      notes: body.notes ? String(body.notes).slice(0, 2000) : null,
      recordedByAuthUserId: auth.user.id,
      supportingDocumentReference: body.supportingDocumentReference
        ? String(body.supportingDocumentReference).slice(0, 1000)
        : null,
      tenantTimezone: body.tenantTimezone
        ? String(body.tenantTimezone).slice(0, 100)
        : "America/New_York",
    });
    return NextResponse.json({ ok: true, preference });
  } catch {
    return NextResponse.json(
      { error: "Failed to update consent record" },
      { status: 500 },
    );
  }
}

