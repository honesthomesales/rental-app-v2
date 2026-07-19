import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { validateTwilioSignature } from "@/lib/communications/webhook-signature";
import { classifyInboundKeyword } from "@/lib/communications/opt-out";
import { normalizeToE164 } from "@/lib/communications/phone";
import { isTenantCommunicationsEnabled } from "@/lib/communications/feature-flag";
import { areCommunicationTablesReady } from "@/lib/communications/schema";
import { recordPhoneSuppression } from "@/lib/communications/suppression";
import type { InboundKeyword } from "@/lib/communications/opt-out";

async function parseFormBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await request.text();
    const params = new URLSearchParams(text);
    const out: Record<string, string> = {};
    params.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  try {
    const json = await request.json();
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(json || {})) {
      out[k] = String(v ?? "");
    }
    return out;
  } catch {
    return {};
  }
}

async function linkInboundTenants(
  communicationId: string,
  tenantIds: string[],
) {
  if (tenantIds.length === 0) return;
  const { error } = await supabaseServer
    .from("RENT_communication_tenant_links")
    .upsert(
      tenantIds.map((tenantId) => ({
        communication_id: communicationId,
        tenant_id: tenantId,
        match_type: tenantIds.length === 1 ? "exact_e164" : "owner_review",
      })),
      { onConflict: "communication_id,tenant_id" },
    );
  if (error) throw new Error("Failed to link inbound message");
}

async function applyInboundKeyword(
  keyword: InboundKeyword,
  phoneE164: string,
  providerMessageId: string | null,
) {
  if (keyword === "opt_out") {
    await recordPhoneSuppression({
      phoneE164,
      suppress: true,
      reason: "inbound_stop",
      provider: "twilio",
      sourceMessageId: providerMessageId,
    });
  } else if (keyword === "opt_in") {
    await recordPhoneSuppression({
      phoneE164,
      suppress: false,
      reason: "inbound_start",
      provider: "twilio",
      sourceMessageId: providerMessageId,
    });
  }
}

/**
 * POST /api/communications/twilio/inbound
 * Twilio inbound SMS webhook. Validates signature. Does not trust tenant IDs.
 */
export async function POST(request: Request) {
  try {
    if (!isTenantCommunicationsEnabled()) {
      return new NextResponse("<Response></Response>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }

    const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
    const params = await parseFormBody(request);
    const signature = request.headers.get("x-twilio-signature");

    // Reconstruct public URL for signature validation
    const url = new URL(request.url);
    const publicBase =
      process.env.TWILIO_WEBHOOK_BASE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      `${url.protocol}//${url.host}`;
    const webhookUrl = `${publicBase.replace(/\/$/, "")}/api/communications/twilio/inbound`;

    if (
      !authToken ||
      !validateTwilioSignature({
        authToken,
        signature,
        url: webhookUrl,
        params,
      })
    ) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    const ready = await areCommunicationTablesReady();
    if (!ready) {
      return new NextResponse("<Response></Response>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }

    const fromRaw = params.From || "";
    const toRaw = params.To || "";
    const body = params.Body || "";
    const providerMessageId = params.MessageSid || params.SmsSid || null;
    const fromE164 = normalizeToE164(fromRaw);

    if (!fromE164) {
      return new NextResponse("<Response></Response>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }
    const keyword = classifyInboundKeyword(body);

    // Collect every exact E.164 match. Shared numbers are linked to all tenants
    // and never assigned arbitrarily to the first match.
    const tenantIds = new Set<string>();
    const { data: prefMatches, error: prefError } = await supabaseServer
      .from("RENT_communication_preferences")
      .select("tenant_id")
      .eq("phone_number", fromE164);
    if (prefError) throw new Error("Failed to match inbound phone");
    for (const preference of prefMatches || []) {
      tenantIds.add(String(preference.tenant_id));
    }

    let from = 0;
    const pageSize = 1000;
    for (;;) {
      const { data: tenants, error: tenantsError } = await supabaseServer
        .from("RENT_tenants")
        .select("id, phone")
        .not("phone", "is", null)
        .range(from, from + pageSize - 1);
      if (tenantsError) throw new Error("Failed to match inbound phone");
      for (const tenant of tenants || []) {
        if (normalizeToE164(tenant.phone) === fromE164) {
          tenantIds.add(String(tenant.id));
        }
      }
      if ((tenants || []).length < pageSize) break;
      from += pageSize;
    }

    const matchedTenantIds = [...tenantIds];

    // Idempotent retries repair links and re-run the idempotent suppression RPC
    // before acknowledging, so a partial first attempt can never lose STOP.
    if (providerMessageId) {
      const { data: existing } = await supabaseServer
        .from("RENT_communications")
        .select("id")
        .eq("provider_message_id", providerMessageId)
        .maybeSingle();
      if (existing) {
        await linkInboundTenants(existing.id, matchedTenantIds);
        await applyInboundKeyword(keyword, fromE164, providerMessageId);
        return new NextResponse("<Response></Response>", {
          status: 200,
          headers: { "Content-Type": "text/xml" },
        });
      }
    }

    const { data: communication, error: insertError } = await supabaseServer
      .from("RENT_communications")
      .insert({
        tenant_id:
          matchedTenantIds.length === 1 ? matchedTenantIds[0] : null,
        channel: "sms",
        direction: "inbound",
        body,
        status: "received",
        provider: "twilio",
        provider_message_id: providerMessageId,
        phone_number_e164: fromE164,
        from_number: fromE164,
        to_number: normalizeToE164(toRaw),
        requires_owner_review: matchedTenantIds.length !== 1,
      })
      .select("id")
      .single();
    if (insertError) {
      // A duplicate provider message is already processed; acknowledge retry.
      if (insertError.code === "23505") {
        const { data: existing } = await supabaseServer
          .from("RENT_communications")
          .select("id")
          .eq("provider_message_id", providerMessageId)
          .single();
        if (!existing) throw new Error("Duplicate inbound message not found");
        await linkInboundTenants(existing.id, matchedTenantIds);
        await applyInboundKeyword(keyword, fromE164, providerMessageId);
        return new NextResponse("<Response></Response>", {
          status: 200,
          headers: { "Content-Type": "text/xml" },
        });
      }
      throw new Error("Failed to record verified inbound message");
    }

    await linkInboundTenants(communication.id, matchedTenantIds);
    await applyInboundKeyword(keyword, fromE164, providerMessageId);
    // HELP: stored as inbound only (already inserted)

    return new NextResponse("<Response></Response>", {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  } catch (error) {
    console.error("twilio inbound webhook error:", error);
    return NextResponse.json({ error: "Webhook failed" }, { status: 500 });
  }
}
