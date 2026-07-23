/**
 * Server-enforced tenant payment / bank / contact flags.
 * Default OFF. Never expose secrets via NEXT_PUBLIC_*.
 */

import {
  hasCashAppDestination,
  hasZelleDestination,
} from "@/lib/payments/destinations";

function envTrue(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[name];
  if (raw == null) return false;
  return raw.trim().replace(/^["']|["']$/g, "").toLowerCase() === "true";
}

export function isTenantPaymentPortalEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envTrue("TENANT_PAYMENT_PORTAL_ENABLED", env);
}

export function isTenantAchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envTrue("TENANT_ACH_ENABLED", env);
}

export function isTenantCardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envTrue("TENANT_CARD_ENABLED", env);
}

export function isTenantCashAppPayEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envTrue("TENANT_CASH_APP_PAY_ENABLED", env);
}

export function isTenantExistingCashAppEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envTrue("TENANT_EXISTING_CASH_APP_ENABLED", env);
}

export function isTenantZelleEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envTrue("TENANT_ZELLE_ENABLED", env);
}

export function isPaymentFeeEngineEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envTrue("PAYMENT_FEE_ENGINE_ENABLED", env);
}

export function isBankReconciliationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envTrue("BANK_RECONCILIATION_ENABLED", env);
}

export function isBankAutoMatchEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envTrue("BANK_AUTO_MATCH_ENABLED", env);
}

export function isBankAutoPostEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envTrue("BANK_AUTO_POST_ENABLED", env);
}

export function isTenantContactSelfServiceEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envTrue("TENANT_CONTACT_SELF_SERVICE_ENABLED", env);
}

/** Stripe live money requires portal + at least one Stripe method flag. */
export function isAnyStripeMethodEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isTenantAchEnabled(env) ||
    isTenantCardEnabled(env) ||
    isTenantCashAppPayEnabled(env)
  );
}

export function portalDisabledResponse() {
  return {
    error: "Tenant payment portal is not activated yet.",
    code: "TENANT_PAYMENT_PORTAL_DISABLED",
    featureEnabled: false,
  };
}

export function methodDisabledResponse(method: string) {
  return {
    error: `${method} payments are not activated yet.`,
    code: "PAYMENT_METHOD_DISABLED",
    method,
  };
}

/** Safe booleans for staff/portal UI (no secrets). Methods require destinations. */
export function getPaymentPublicFeatureFlags(
  env: NodeJS.ProcessEnv = process.env,
) {
  return {
    portalEnabled: isTenantPaymentPortalEnabled(env),
    achEnabled: isTenantAchEnabled(env),
    cardEnabled: isTenantCardEnabled(env),
    cashAppPayEnabled: isTenantCashAppPayEnabled(env),
    existingCashAppEnabled:
      isTenantExistingCashAppEnabled(env) && hasCashAppDestination(env),
    zelleEnabled: isTenantZelleEnabled(env) && hasZelleDestination(env),
    feeEngineEnabled: isPaymentFeeEngineEnabled(env),
    bankReconciliationEnabled: isBankReconciliationEnabled(env),
    bankAutoMatchEnabled: isBankAutoMatchEnabled(env),
    bankAutoPostEnabled: isBankAutoPostEnabled(env),
    contactSelfServiceEnabled: isTenantContactSelfServiceEnabled(env),
  };
}
