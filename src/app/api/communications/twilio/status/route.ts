import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { validateTwilioSignature } from "@/lib/communications/webhook-signature";
import { isTenantCommunicationsEnabled } from "@/lib/communications/feature-flag";
import { areCommunicationTablesReady } from "@/lib/communications/schema";
import { mapTwilioDeliveryStatus } from "@/lib/communications/delivery-status";

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
 * POST /api/communications/twilio/status
 * Delivery status callback. Idempotent updates by provider_message_id.
 */
export async function POST(request: Request) {
  try {
    if (!isTenantCommunicationsEnabled()) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
    const params = await parseFormBody(request);
    const signature = request.headers.get("x-twilio-signature");

    const url = new URL(request.url);
    const publicBase =
      process.env.TWILIO_WEBHOOK_BASE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      `${url.protocol}//${url.host}`;
    const webhookUrl = `${publicBase.replace(/\/$/, "")}/api/communications/twilio/status`;

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
      return NextResponse.json({ ok: true, schemaReady: false });
    }

    const providerMessageId = params.MessageSid || params.SmsSid || "";
    if (!providerMessageId) {
      return NextResponse.json({ error: "Missing MessageSid" }, { status: 400 });
    }

    const mapped = mapTwilioDeliveryStatus(params.MessageStatus || "");
    if (!mapped) {
      return NextResponse.json({ ok: true, ignoredStatus: params.MessageStatus });
    }

    const { data: existing } = await supabaseServer
      .from("RENT_communications")
      .select("id, status, delivered_at, failed_at")
      .eq("provider_message_id", providerMessageId)
      .maybeSingle();

    if (!existing) {
      // Do not create rows from status alone — avoid trusting incomplete webhooks
      return NextResponse.json({ ok: true, matched: false });
    }

    // Idempotent: do not downgrade delivered → sent
    if (existing.status === "delivered" && mapped !== "failed") {
      return NextResponse.json({ ok: true, matched: true, unchanged: true });
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: mapped };
    if (mapped === "delivered") patch.delivered_at = existing.delivered_at || now;
    if (mapped === "failed") {
      patch.failed_at = existing.failed_at || now;
      patch.error_code = params.ErrorCode || null;
      patch.error_message = params.ErrorMessage || null;
    }

    await supabaseServer
      .from("RENT_communications")
      .update(patch)
      .eq("id", existing.id);

    return NextResponse.json({ ok: true, matched: true, status: mapped });
  } catch (error) {
    console.error("twilio status webhook error:", error);
    return NextResponse.json({ error: "Webhook failed" }, { status: 500 });
  }
}
