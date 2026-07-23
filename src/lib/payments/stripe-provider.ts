import { createHmac, timingSafeEqual } from "crypto";
import {
  isAnyStripeMethodEnabled,
  isTenantPaymentPortalEnabled,
} from "@/lib/payments/feature-flags";
import type { PortalPaymentMethod } from "@/lib/payments/types";

export type CreateCheckoutSessionInput = {
  attemptId: string;
  amountCents: number;
  currency?: string;
  successUrl: string;
  cancelUrl: string;
  method: PortalPaymentMethod;
  customerEmail?: string | null;
  metadata: Record<string, string>;
  idempotencyKey: string;
};

export type CreateCheckoutSessionResult = {
  sessionId: string;
  url: string;
};

export type StripeWebhookEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

function stripeSecret(): string {
  return String(process.env.STRIPE_SECRET_KEY || "").trim();
}

function stripeWebhookSecret(): string {
  return String(process.env.STRIPE_WEBHOOK_SIGNING_SECRET || "").trim();
}

function paymentMethodTypes(method: PortalPaymentMethod): string[] {
  if (method === "ach") return ["us_bank_account"];
  if (method === "cash_app_pay") return ["cashapp"];
  if (method === "card") return ["card"];
  return ["card"];
}

export function isStripeConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(String(env.STRIPE_SECRET_KEY || "").trim());
}

export async function createStripeCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<CreateCheckoutSessionResult> {
  if (!isTenantPaymentPortalEnabled()) {
    throw new Error("TENANT_PAYMENT_PORTAL_DISABLED");
  }
  if (!isAnyStripeMethodEnabled()) {
    throw new Error("PAYMENT_METHOD_DISABLED");
  }
  const secret = stripeSecret();
  if (!secret) throw new Error("STRIPE_CHECKOUT_NOT_CONFIGURED");

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", input.successUrl);
  params.set("cancel_url", input.cancelUrl);
  params.set("client_reference_id", input.attemptId);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", input.currency || "usd");
  params.set(
    "line_items[0][price_data][unit_amount]",
    String(input.amountCents),
  );
  params.set(
    "line_items[0][price_data][product_data][name]",
    "Rent payment",
  );
  paymentMethodTypes(input.method).forEach((m, i) => {
    params.set(`payment_method_types[${i}]`, m);
  });
  if (input.customerEmail) params.set("customer_email", input.customerEmail);
  Object.entries(input.metadata).forEach(([k, v]) => {
    params.set(`metadata[${k}]`, v);
  });
  params.set("payment_intent_data[metadata][attempt_id]", input.attemptId);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: params.toString(),
  });

  const json = (await res.json()) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };
  if (!res.ok || !json.id || !json.url) {
    throw new Error(json.error?.message || "STRIPE_CHECKOUT_FAILED");
  }
  return { sessionId: json.id, url: json.url };
}

/**
 * Verify Stripe-Signature header (v1) against raw body.
 */
export function constructStripeWebhookEvent(
  rawBody: string,
  signatureHeader: string | null,
): StripeWebhookEvent {
  const secret = stripeWebhookSecret();
  if (!secret) throw new Error("STRIPE_WEBHOOK_NOT_CONFIGURED");
  if (!signatureHeader) throw new Error("STRIPE_SIGNATURE_MISSING");

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k.trim(), v];
    }),
  );
  const timestamp = parts.t;
  const signatures = signatureHeader
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));

  if (!timestamp || signatures.length === 0) {
    throw new Error("STRIPE_SIGNATURE_INVALID");
  }

  const ageSec = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSec) || ageSec > 300) {
    throw new Error("STRIPE_SIGNATURE_TIMESTAMP");
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  const ok = signatures.some((sig) => {
    try {
      const a = Buffer.from(expected);
      const b = Buffer.from(sig);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
  if (!ok) throw new Error("STRIPE_SIGNATURE_INVALID");

  const parsed = JSON.parse(rawBody) as StripeWebhookEvent;
  if (!parsed?.id || !parsed?.type) throw new Error("STRIPE_EVENT_INVALID");
  return parsed;
}
