/**
 * Thin payment-provider adapter.
 * Prefer fetch-based Stripe calls later; do not require the `stripe` npm package yet.
 */

import {
  isTenantPaymentsEnabled,
  isTenantPaymentsLiveMoneyEnabled,
} from "@/lib/payments/feature-flags";

export type CreateCheckoutSessionInput = {
  token: string;
  amountCents: number;
  currency?: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
};

export type CreateCheckoutSessionResult = {
  sessionId: string;
  url: string;
  attemptState: "awaiting_payment";
};

export type WebhookEvent = {
  id: string;
  type: string;
  data: unknown;
};

export interface PaymentProviderAdapter {
  createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CreateCheckoutSessionResult>;
  constructWebhookEvent(
    rawBody: string,
    signatureHeader: string | null,
  ): Promise<WebhookEvent>;
}

class DisabledStripeAdapter implements PaymentProviderAdapter {
  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CreateCheckoutSessionResult> {
    void input;
    if (!isTenantPaymentsEnabled()) {
      throw new Error("TENANT_PAYMENTS_DISABLED");
    }
    if (!isTenantPaymentsLiveMoneyEnabled()) {
      throw new Error("TENANT_PAYMENTS_LIVE_MONEY_DISABLED");
    }
    // Live money on: real Stripe Checkout via fetch would go here.
    // Intentionally not implemented without explicit Stripe secrets + package decision.
    throw new Error("STRIPE_CHECKOUT_NOT_CONFIGURED");
  }

  async constructWebhookEvent(
    rawBody: string,
    signatureHeader: string | null,
  ): Promise<WebhookEvent> {
    void rawBody;
    void signatureHeader;
    if (!isTenantPaymentsEnabled()) {
      throw new Error("TENANT_PAYMENTS_DISABLED");
    }
    if (!isTenantPaymentsLiveMoneyEnabled()) {
      throw new Error("TENANT_PAYMENTS_LIVE_MONEY_DISABLED");
    }
    throw new Error("STRIPE_WEBHOOK_NOT_CONFIGURED");
  }
}

/** Default adapter: Stripe stub (fetch-based wiring deferred). */
export function getPaymentProvider(): PaymentProviderAdapter {
  return new DisabledStripeAdapter();
}
