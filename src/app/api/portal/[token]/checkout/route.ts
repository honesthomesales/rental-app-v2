import { NextRequest, NextResponse } from "next/server";
import {
  isTenantAchEnabled,
  isTenantCardEnabled,
  isTenantCashAppPayEnabled,
  isTenantExistingCashAppEnabled,
  isTenantPaymentPortalEnabled,
  isTenantZelleEnabled,
  methodDisabledResponse,
  portalDisabledResponse,
} from "@/lib/payments/feature-flags";
import { resolvePortalAccess } from "@/lib/payments/portal-access";
import { resolveFeeForMethod } from "@/lib/payments/fee-engine";
import { assertPositiveCents } from "@/lib/payments/money";
import { generateIdempotencyKey } from "@/lib/payments/tokens";
import { createStripeCheckoutSession } from "@/lib/payments/stripe-provider";
import { supabaseServer } from "@/lib/supabase-server";
import { getBusinessDate } from "@/lib/business-date";
import { buildPortalAccountSummary } from "@/lib/payments/portal-account";
import type { PortalPaymentMethod } from "@/lib/payments/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function methodAllowed(method: PortalPaymentMethod): boolean {
  if (method === "ach") return isTenantAchEnabled();
  if (method === "card") return isTenantCardEnabled();
  if (method === "cash_app_pay") return isTenantCashAppPayEnabled();
  if (method === "existing_cash_app") return isTenantExistingCashAppEnabled();
  if (method === "zelle") return isTenantZelleEnabled();
  return false;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  if (!isTenantPaymentPortalEnabled()) {
    return NextResponse.json(portalDisabledResponse(), { status: 503 });
  }

  const { token } = await context.params;
  const access = await resolvePortalAccess(token);
  if (!access) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    method?: PortalPaymentMethod;
    rentAmountCents?: number;
    choice?: "full" | "past_due" | "custom";
  };

  const method = body.method;
  if (!method || !methodAllowed(method)) {
    return NextResponse.json(methodDisabledResponse(String(method || "unknown")), {
      status: 503,
    });
  }

  try {
    const summary = await buildPortalAccountSummary({
      tenantId: access.tenantId,
      leaseId: access.leaseId,
      propertyId: access.propertyId,
    });

    let rentCents = 0;
    if (body.choice === "past_due") rentCents = summary.pastDueCents;
    else if (body.choice === "custom") rentCents = Number(body.rentAmountCents || 0);
    else rentCents = summary.settledBalanceCents;

    // Server authority: never allow overpay beyond settled balance unless env allows.
    const allowPartial = process.env.TENANT_PORTAL_ALLOW_PARTIAL === "true";
    const allowOverpay = process.env.TENANT_PORTAL_ALLOW_OVERPAY === "true";
    if (body.choice === "custom" && !allowPartial) {
      return NextResponse.json({ error: "Partial payments not approved" }, { status: 400 });
    }
    if (!allowOverpay && rentCents > summary.settledBalanceCents) {
      return NextResponse.json({ error: "Amount exceeds balance" }, { status: 400 });
    }
    assertPositiveCents(rentCents);

    const fee = await resolveFeeForMethod({
      method,
      rentCents,
      cardFunding: method === "card" ? "unknown" : undefined,
    });

    const idempotencyKey = generateIdempotencyKey(`portal_${access.tenantId}`);
    const { data: attempt, error: attemptErr } = await supabaseServer
      .from("RENT_v3_payment_attempts")
      .insert({
        tenant_id: access.tenantId,
        lease_id: access.leaseId,
        property_id: access.propertyId,
        portal_token_id: access.tokenId,
        method,
        channel:
          method === "existing_cash_app"
            ? "manual_existing_cash_app"
            : method === "zelle"
              ? "manual_zelle"
              : "stripe",
        status:
          method === "existing_cash_app" || method === "zelle"
            ? "awaiting_verification"
            : "created",
        rent_amount_cents: rentCents,
        fee_amount_cents: fee.feeCents,
        total_charged_cents: fee.totalChargedCents,
        fee_policy_id: fee.policyId,
        fee_policy_version: fee.policyVersion,
        idempotency_key: idempotencyKey,
        as_of_date: getBusinessDate(),
        tenant_reference_code: summary.paymentReference,
        provider: method === "existing_cash_app" || method === "zelle" ? null : "stripe",
      })
      .select("*")
      .single();

    if (attemptErr || !attempt) {
      return NextResponse.json(
        { error: attemptErr?.message || "Failed to create payment attempt" },
        { status: 500 },
      );
    }

    await supabaseServer.from("RENT_v3_payment_attempt_events").insert({
      attempt_id: attempt.id,
      from_status: null,
      to_status: attempt.status,
      source: "portal_checkout",
      detail: { method, choice: body.choice || "full" },
    });

    if (method === "existing_cash_app" || method === "zelle") {
      return NextResponse.json({
        mode: "awaiting_verification",
        attemptId: attempt.id,
        rentAmountCents: rentCents,
        feeAmountCents: fee.feeCents,
        totalChargedCents: fee.totalChargedCents,
        paymentReference: summary.paymentReference,
        disclosureText: fee.disclosureText,
        destination:
          method === "existing_cash_app"
            ? process.env.EXISTING_CASH_APP_DESTINATION || null
            : process.env.EXISTING_ZELLE_DESTINATION || null,
        message:
          "Payment reported. Settled balance will update only after verification.",
      });
    }

    const origin = new URL(request.url).origin;
    const session = await createStripeCheckoutSession({
      attemptId: attempt.id,
      amountCents: fee.totalChargedCents,
      successUrl: `${origin}/pay/${token}?result=success&attempt=${attempt.id}`,
      cancelUrl: `${origin}/pay/${token}?result=canceled&attempt=${attempt.id}`,
      method,
      metadata: {
        attempt_id: attempt.id,
        tenant_id: access.tenantId,
        lease_id: access.leaseId,
        property_id: access.propertyId || "",
        rent_amount_cents: String(rentCents),
        fee_amount_cents: String(fee.feeCents),
        as_of_date: getBusinessDate(),
      },
      idempotencyKey,
    });

    await supabaseServer
      .from("RENT_v3_payment_attempts")
      .update({
        status: "awaiting_customer",
        provider_session_id: session.sessionId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", attempt.id);

    await supabaseServer.from("RENT_v3_payment_attempt_events").insert({
      attempt_id: attempt.id,
      from_status: "created",
      to_status: "awaiting_customer",
      source: "stripe_checkout_create",
      detail: { sessionId: session.sessionId },
    });

    return NextResponse.json({
      mode: "stripe_checkout",
      attemptId: attempt.id,
      checkoutUrl: session.url,
      rentAmountCents: rentCents,
      feeAmountCents: fee.feeCents,
      totalChargedCents: fee.totalChargedCents,
      disclosureText: fee.disclosureText,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checkout failed";
    const status =
      message.includes("DISABLED") || message.includes("NOT_CONFIGURED")
        ? 503
        : message.includes("AMOUNT") || message.includes("exceeds")
          ? 400
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
