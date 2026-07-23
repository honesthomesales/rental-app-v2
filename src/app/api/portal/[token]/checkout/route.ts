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
import {
  getCashAppDestination,
  getZelleDestination,
  hasCashAppDestination,
  hasZelleDestination,
} from "@/lib/payments/destinations";
import {
  isPortalCheckoutBlocked,
  recordPortalCheckout,
} from "@/lib/payments/portal-rate-limit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function methodAllowed(method: PortalPaymentMethod): boolean {
  if (method === "ach") return isTenantAchEnabled();
  if (method === "card") return isTenantCardEnabled();
  if (method === "cash_app_pay") return isTenantCashAppPayEnabled();
  if (method === "existing_cash_app") {
    return isTenantExistingCashAppEnabled() && hasCashAppDestination();
  }
  if (method === "zelle") {
    return isTenantZelleEnabled() && hasZelleDestination();
  }
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

  const rateKey = `tenant:${access.tenantId}`;
  if (isPortalCheckoutBlocked(rateKey)) {
    return NextResponse.json(
      { error: "Too many payment submissions. Please wait and try again." },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    method?: PortalPaymentMethod;
    rentAmountCents?: number;
    choice?: "full" | "past_due" | "custom";
    senderName?: string;
    paymentNote?: string;
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

    // Prevent duplicate open manual submissions for same intended transfer.
    if (method === "existing_cash_app" || method === "zelle") {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: openDup } = await supabaseServer
        .from("RENT_v3_payment_attempts")
        .select("id")
        .eq("tenant_id", access.tenantId)
        .eq("lease_id", access.leaseId)
        .eq("method", method)
        .eq("rent_amount_cents", rentCents)
        .eq("status", "awaiting_verification")
        .gte("created_at", since)
        .limit(1)
        .maybeSingle();
      if (openDup) {
        return NextResponse.json(
          {
            error:
              "A matching payment is already awaiting verification. Please wait for staff review.",
            code: "DUPLICATE_SUBMISSION",
            attemptId: openDup.id,
          },
          { status: 409 },
        );
      }
    }

    const fee = await resolveFeeForMethod({
      method,
      rentCents,
      cardFunding: method === "card" ? "unknown" : undefined,
    });

    // Step 3: Cash App / Zelle fees must be $0 unless fee engine later approved.
    const feeCents =
      method === "existing_cash_app" || method === "zelle" ? 0 : fee.feeCents;
    const totalChargedCents = rentCents + feeCents;

    const senderName = (body.senderName || "").trim().slice(0, 120) || null;
    const paymentNote = (body.paymentNote || "").trim().slice(0, 240) || null;

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
        fee_amount_cents: feeCents,
        total_charged_cents: totalChargedCents,
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
        { error: "Failed to create payment attempt" },
        { status: 500 },
      );
    }

    await afterAttemptCreated(attempt, method, body.choice || "full", senderName, paymentNote);
    recordPortalCheckout(rateKey);

    return manualOrStripeResponse({
      request,
      token,
      method,
      attempt,
      rentCents,
      feeCents,
      totalChargedCents,
      fee,
      summary,
      access,
      idempotencyKey,
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

async function afterAttemptCreated(
  attempt: { id: string; status: string },
  method: PortalPaymentMethod,
  choice: string,
  senderName: string | null,
  paymentNote: string | null,
) {
  await supabaseServer.from("RENT_v3_payment_attempt_events").insert({
    attempt_id: attempt.id,
    from_status: null,
    to_status: attempt.status,
    source: "portal_checkout",
    detail: {
      method,
      choice,
      // Store sender metadata in audit event only (no new columns required).
      sender_name: senderName,
      payment_note: paymentNote,
    },
  });
}

async function manualOrStripeResponse(args: {
  request: NextRequest;
  token: string;
  method: PortalPaymentMethod;
  attempt: { id: string; status: string };
  rentCents: number;
  feeCents: number;
  totalChargedCents: number;
  fee: { disclosureText?: string };
  summary: { paymentReference: string };
  access: { tenantId: string; leaseId: string; propertyId: string | null };
  idempotencyKey: string;
}) {
  const {
    request,
    token,
    method,
    attempt,
    rentCents,
    feeCents,
    totalChargedCents,
    fee,
    summary,
    access,
    idempotencyKey,
  } = args;

  if (method === "existing_cash_app" || method === "zelle") {
    return NextResponse.json({
      mode: "awaiting_verification",
      attemptId: attempt.id,
      rentAmountCents: rentCents,
      feeAmountCents: feeCents,
      totalChargedCents,
      paymentReference: summary.paymentReference,
      disclosureText: fee.disclosureText,
      destination:
        method === "existing_cash_app"
          ? getCashAppDestination()
          : getZelleDestination(),
      message:
        "Payment reported as awaiting verification. Balance updates after confirmation.",
    });
  }

  const origin = new URL(request.url).origin;
  const session = await createStripeCheckoutSession({
    attemptId: attempt.id,
    amountCents: totalChargedCents,
    successUrl: `${origin}/pay/${token}?result=success&attempt=${attempt.id}`,
    cancelUrl: `${origin}/pay/${token}?result=canceled&attempt=${attempt.id}`,
    method,
    metadata: {
      attempt_id: attempt.id,
      tenant_id: access.tenantId,
      lease_id: access.leaseId,
      property_id: access.propertyId || "",
      rent_amount_cents: String(rentCents),
      fee_amount_cents: String(feeCents),
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
    feeAmountCents: feeCents,
    totalChargedCents,
    disclosureText: fee.disclosureText,
  });
}
