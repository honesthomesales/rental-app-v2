import {
  isTenantPaymentsEnabled,
  isTenantPaymentsLiveMoneyEnabled,
} from "@/lib/payments/feature-flags";
import {
  PAYMENT_ATTEMPT_STATES,
  isPaymentAttemptState,
} from "@/lib/payments/types";

describe("tenant payment feature flags", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("defaults both flags off when env unset", () => {
    delete process.env.V3_TENANT_PAYMENTS_ENABLED;
    delete process.env.V3_TENANT_PAYMENTS_LIVE_MONEY_ENABLED;
    expect(isTenantPaymentsEnabled()).toBe(false);
    expect(isTenantPaymentsLiveMoneyEnabled()).toBe(false);
  });

  it("enables only when set to exact string true", () => {
    process.env.V3_TENANT_PAYMENTS_ENABLED = "true";
    process.env.V3_TENANT_PAYMENTS_LIVE_MONEY_ENABLED = "1";
    expect(isTenantPaymentsEnabled()).toBe(true);
    expect(isTenantPaymentsLiveMoneyEnabled()).toBe(false);
  });
});

describe("payment attempt states", () => {
  it("includes the required lifecycle states", () => {
    expect(PAYMENT_ATTEMPT_STATES).toEqual([
      "created",
      "awaiting_payment",
      "submitted",
      "processing",
      "pending",
      "settled",
      "failed",
      "returned",
      "refunded",
      "disputed",
      "canceled",
    ]);
  });

  it("validates attempt state membership", () => {
    expect(isPaymentAttemptState("settled")).toBe(true);
    expect(isPaymentAttemptState("unknown")).toBe(false);
    expect(isPaymentAttemptState(null)).toBe(false);
  });
});

describe("tenant payments webhook when disabled", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it("refuses with 503 when tenant payments flag is off", async () => {
    delete process.env.V3_TENANT_PAYMENTS_ENABLED;
    delete process.env.V3_TENANT_PAYMENTS_LIVE_MONEY_ENABLED;
    jest.resetModules();

    const { POST } = await import(
      "@/app/api/tenant-payments/webhook/route"
    );
    const res = await POST(
      new Request("https://example.test/api/tenant-payments/webhook", {
        method: "POST",
        body: "{}",
      }) as unknown as import("next/server").NextRequest,
    );
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.code).toBe("TENANT_PAYMENTS_DISABLED");
    expect(body.featureEnabled).toBe(false);
  });
});
