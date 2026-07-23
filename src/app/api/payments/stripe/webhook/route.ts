import { NextRequest, NextResponse } from "next/server";
import { isTenantPaymentPortalEnabled } from "@/lib/payments/feature-flags";
import { constructStripeWebhookEvent } from "@/lib/payments/stripe-provider";
import { supabaseServer } from "@/lib/supabase-server";
import {
  postSettledRentOnce,
  transitionAttempt,
} from "@/lib/payments/attempt-lifecycle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Stripe webhook. Browser success redirect is never treated as settlement proof.
 */
export async function POST(request: NextRequest) {
  // Always verify signature when configured; reject otherwise.
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  let event;
  try {
    event = constructStripeWebhookEvent(rawBody, signature);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Deduplicate
  const { data: existing } = await supabaseServer
    .from("RENT_v3_provider_events")
    .select("id, processing_status")
    .eq("provider", "stripe")
    .eq("provider_event_id", event.id)
    .maybeSingle();

  if (existing?.processing_status === "processed") {
    return NextResponse.json({ received: true, duplicate: true });
  }

  if (!existing) {
    await supabaseServer.from("RENT_v3_provider_events").insert({
      provider: "stripe",
      provider_event_id: event.id,
      event_type: event.type,
      payload: event as unknown as Record<string, unknown>,
      processing_status: "received",
    });
  }

  if (!isTenantPaymentPortalEnabled()) {
    await supabaseServer
      .from("RENT_v3_provider_events")
      .update({ processing_status: "ignored", processed_at: new Date().toISOString() })
      .eq("provider", "stripe")
      .eq("provider_event_id", event.id);
    return NextResponse.json({ received: true, ignored: true });
  }

  try {
    const obj = event.data?.object || {};
    const meta = (obj.metadata || {}) as Record<string, string>;
    const attemptId =
      meta.attempt_id ||
      String(obj.client_reference_id || "") ||
      null;

    if (attemptId) {
      await supabaseServer
        .from("RENT_v3_provider_events")
        .update({ attempt_id: attemptId })
        .eq("provider_event_id", event.id);
    }

    const type = event.type;

    if (
      type === "checkout.session.completed" ||
      type === "checkout.session.async_payment_succeeded" ||
      type === "payment_intent.succeeded"
    ) {
      const paymentStatus = String(obj.payment_status || obj.status || "");
      const isAsyncPending =
        type === "checkout.session.completed" &&
        paymentStatus === "unpaid";

      if (attemptId && isAsyncPending) {
        await transitionAttempt({
          attemptId,
          toStatus: "pending",
          source: `stripe:${type}`,
          detail: { paymentStatus },
        });
        // ACH: do not post yet
      } else if (attemptId) {
        const providerPaymentId = String(
          obj.payment_intent || obj.id || "",
        );
        await supabaseServer
          .from("RENT_v3_payment_attempts")
          .update({
            provider_payment_id: providerPaymentId || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", attemptId);

        await transitionAttempt({
          attemptId,
          toStatus: "settled",
          source: `stripe:${type}`,
        });
        await postSettledRentOnce(attemptId);
      }
    } else if (
      type === "checkout.session.async_payment_failed" ||
      type === "payment_intent.payment_failed"
    ) {
      if (attemptId) {
        await transitionAttempt({
          attemptId,
          toStatus: "failed",
          source: `stripe:${type}`,
        });
      }
    } else if (type === "checkout.session.expired") {
      if (attemptId) {
        await transitionAttempt({
          attemptId,
          toStatus: "expired",
          source: `stripe:${type}`,
        });
      }
    } else if (type === "charge.refunded" || type === "refund.created") {
      if (attemptId) {
        await transitionAttempt({
          attemptId,
          toStatus: "refunded",
          source: `stripe:${type}`,
        });
        await supabaseServer.from("RENT_v3_staff_exceptions").insert({
          kind: "refund_requires_review",
          severity: "high",
          attempt_id: attemptId,
          detail: { eventType: type, eventId: event.id },
        });
      }
    } else if (
      type === "charge.dispute.created" ||
      type === "charge.dispute.funds_withdrawn"
    ) {
      if (attemptId) {
        await transitionAttempt({
          attemptId,
          toStatus: "disputed",
          source: `stripe:${type}`,
        });
        await supabaseServer.from("RENT_v3_staff_exceptions").insert({
          kind: "dispute_requires_review",
          severity: "high",
          attempt_id: attemptId,
          detail: { eventType: type, eventId: event.id },
        });
      }
    }

    await supabaseServer
      .from("RENT_v3_provider_events")
      .update({
        processing_status: "processed",
        processed_at: new Date().toISOString(),
      })
      .eq("provider", "stripe")
      .eq("provider_event_id", event.id);

    return NextResponse.json({ received: true, type });
  } catch (error) {
    const message = error instanceof Error ? error.message : "processing_failed";
    await supabaseServer
      .from("RENT_v3_provider_events")
      .update({
        processing_status: "failed",
        error_message: message,
      })
      .eq("provider", "stripe")
      .eq("provider_event_id", event.id);

    await supabaseServer.from("RENT_v3_staff_exceptions").insert({
      kind: "webhook_processing_failed",
      severity: "high",
      detail: { eventId: event.id, message },
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
