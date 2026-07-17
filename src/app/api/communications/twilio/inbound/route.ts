import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { validateTwilioSignature } from "@/lib/communications/webhook-signature";
import { classifyInboundKeyword } from "@/lib/communications/opt-out";
import { normalizeToE164 } from "@/lib/communications/phone";
import { isTenantCommunicationsEnabled } from "@/lib/communications/feature-flag";
import { areCommunicationTablesReady } from "@/lib/communications/schema";

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

    // Match tenant by phone preference or tenant.phone — never trust webhook tenant IDs
    let tenantId: string | null = null;

    const { data: prefMatch } = await supabaseServer
      .from("RENT_communication_preferences")
      .select("tenant_id")
      .eq("phone_number", fromE164)
      .limit(1)
      .maybeSingle();

    if (prefMatch?.tenant_id) {
      tenantId = prefMatch.tenant_id;
    } else {
      // Best-effort match on tenant phone digits
      const digits = fromE164.replace(/\D/g, "");
      const last10 = digits.slice(-10);
      const { data: tenants } = await supabaseServer
        .from("RENT_tenants")
        .select("id, phone")
        .not("phone", "is", null)
        .limit(500);
      const match = (tenants || []).find((t) => {
        const n = normalizeToE164(t.phone);
        return n === fromE164 || (n && n.replace(/\D/g, "").endsWith(last10));
      });
      if (match) tenantId = match.id;
    }

    if (!tenantId) {
      // Unknown number — acknowledge without storing against a tenant
      return new NextResponse("<Response></Response>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }

    // Idempotent insert by provider_message_id
    if (providerMessageId) {
      const { data: existing } = await supabaseServer
        .from("RENT_communications")
        .select("id")
        .eq("provider_message_id", providerMessageId)
        .maybeSingle();
      if (existing) {
        return new NextResponse("<Response></Response>", {
          status: 200,
          headers: { "Content-Type": "text/xml" },
        });
      }
    }

    await supabaseServer.from("RENT_communications").insert({
      tenant_id: tenantId,
      channel: "sms",
      direction: "inbound",
      body,
      status: "received",
      provider: "twilio",
      provider_message_id: providerMessageId,
      from_number: fromE164,
      to_number: normalizeToE164(toRaw),
    });

    const keyword = classifyInboundKeyword(body);
    const now = new Date().toISOString();

    if (keyword === "opt_out") {
      await supabaseServer.from("RENT_communication_preferences").upsert(
        {
          tenant_id: tenantId,
          phone_number: fromE164,
          sms_consent_status: "opted_out",
          opted_out_at: now,
          consent_source: "inbound_stop",
          updated_at: now,
        },
        { onConflict: "tenant_id,phone_number" },
      );
    } else if (keyword === "opt_in") {
      await supabaseServer.from("RENT_communication_preferences").upsert(
        {
          tenant_id: tenantId,
          phone_number: fromE164,
          sms_consent_status: "opted_in",
          opted_in_at: now,
          consent_source: "inbound_start",
          consent_recorded_at: now,
          updated_at: now,
        },
        { onConflict: "tenant_id,phone_number" },
      );
    }
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
