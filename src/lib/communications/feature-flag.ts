/**
 * Server-side feature flag for V3 Tenant Communication Center.
 * Default: disabled. Never expose secrets via NEXT_PUBLIC_*.
 */

export function isTenantCommunicationsEnabled(): boolean {
  return process.env.V3_TENANT_COMMUNICATIONS_ENABLED === "true";
}

export function communicationsDisabledResponse() {
  return {
    error: "Tenant Communication Center is disabled",
    code: "COMMUNICATIONS_DISABLED",
    featureEnabled: false,
  };
}

export function communicationsNotConfiguredResponse() {
  return {
    error: "Communication Center not configured",
    code: "COMMUNICATIONS_NOT_CONFIGURED",
    featureEnabled: true,
    schemaReady: false,
  };
}
