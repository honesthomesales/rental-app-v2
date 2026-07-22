/**
 * Server-side feature flags for V3 tenant online payments.
 * Default: disabled. Never expose secrets via NEXT_PUBLIC_*.
 */

export function isTenantPaymentsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.V3_TENANT_PAYMENTS_ENABLED === "true";
}

export function isTenantPaymentsLiveMoneyEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.V3_TENANT_PAYMENTS_LIVE_MONEY_ENABLED === "true";
}

export function tenantPaymentsDisabledResponse() {
  return {
    error: "Online payments are not activated yet.",
    code: "TENANT_PAYMENTS_DISABLED",
    featureEnabled: false,
    liveMoneyEnabled: false,
  };
}

export function tenantPaymentsLiveMoneyDisabledResponse() {
  return {
    error: "Live money collection is not enabled.",
    code: "TENANT_PAYMENTS_LIVE_MONEY_DISABLED",
    featureEnabled: true,
    liveMoneyEnabled: false,
  };
}
