import { NextRequest, NextResponse } from "next/server";
import {
  isTenantPaymentsEnabled,
  isTenantPaymentsLiveMoneyEnabled,
  tenantPaymentsDisabledResponse,
  tenantPaymentsLiveMoneyDisabledResponse,
} from "@/lib/payments/feature-flags";
import { getPaymentProvider } from "@/lib/payments/provider";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest) {
  if (!isTenantPaymentsEnabled()) {
    return NextResponse.json(tenantPaymentsDisabledResponse(), { status: 503 });
  }

  if (!isTenantPaymentsLiveMoneyEnabled()) {
    return NextResponse.json(tenantPaymentsLiveMoneyDisabledResponse(), {
      status: 503,
    });
  }

  try {
    const rawBody = await request.text();
    const signature = request.headers.get("stripe-signature");
    const provider = getPaymentProvider();
    const event = await provider.constructWebhookEvent(rawBody, signature);

    // Structure ready: handle settled / failed / returned events when live.
    return NextResponse.json({
      received: true,
      eventId: event.id,
      type: event.type,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Webhook handling failed";
    const status =
      message === "STRIPE_WEBHOOK_NOT_CONFIGURED" ||
      message === "TENANT_PAYMENTS_LIVE_MONEY_DISABLED" ||
      message === "TENANT_PAYMENTS_DISABLED"
        ? 503
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
