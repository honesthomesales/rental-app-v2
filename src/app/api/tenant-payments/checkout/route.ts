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
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      amountCents?: number;
      successUrl?: string;
      cancelUrl?: string;
    };

    if (!body.token || !body.amountCents || body.amountCents <= 0) {
      return NextResponse.json(
        { error: "token and positive amountCents are required" },
        { status: 400 },
      );
    }

    const origin = new URL(request.url).origin;
    const provider = getPaymentProvider();
    const session = await provider.createCheckoutSession({
      token: body.token,
      amountCents: body.amountCents,
      successUrl: body.successUrl || `${origin}/pay/${body.token}?paid=1`,
      cancelUrl: body.cancelUrl || `${origin}/pay/${body.token}?canceled=1`,
    });

    return NextResponse.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checkout failed";
    const status =
      message === "STRIPE_CHECKOUT_NOT_CONFIGURED" ||
      message === "TENANT_PAYMENTS_LIVE_MONEY_DISABLED" ||
      message === "TENANT_PAYMENTS_DISABLED"
        ? 503
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
