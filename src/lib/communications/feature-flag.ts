/**
 * Server-side feature flag for V3 Tenant Communication Center.
 * Default: disabled. Never expose secrets via NEXT_PUBLIC_*.
 */

export function isTenantCommunicationsEnabled(): boolean {
  return process.env.V3_TENANT_COMMUNICATIONS_ENABLED === "true";
}

export function isCommunicationsProviderEnabled(): boolean {
  return process.env.V3_TENANT_COMMUNICATIONS_PROVIDER_ENABLED === "true";
}

export function isCommunicationDraftGeneratorEnabled(): boolean {
  return (
    process.env.V3_TENANT_COMMUNICATION_DRAFT_GENERATOR_ENABLED === "true"
  );
}

export function isCommunicationScheduledSendsEnabled(): boolean {
  return (
    process.env.V3_TENANT_COMMUNICATION_SCHEDULED_SENDS_ENABLED === "true"
  );
}

/**
 * Mock sending is allowed only outside production and only when explicitly
 * requested. Production never silently falls back to mock.
 */
export function mayUseMockSmsProvider(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV !== "production" && env.SMS_PROVIDER === "mock";
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
