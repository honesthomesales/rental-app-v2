import { MockSmsProvider } from "./mock";
import { TwilioSmsProvider } from "./twilio";
import type { SmsProvider } from "./types";
import {
  isCommunicationsProviderEnabled,
  mayUseMockSmsProvider,
} from "../feature-flag";

export type { SmsProvider, SmsSendRequest, SmsSendResult } from "./types";
export { MockSmsProvider } from "./mock";
export { TwilioSmsProvider } from "./twilio";

/** Provider submission is separately feature-gated and never auto-falls back. */
export function getSmsProvider(
  env: NodeJS.ProcessEnv = process.env,
  options?: { forceMock?: boolean },
): SmsProvider {
  if (
    isCommunicationsProviderEnabled() &&
    (options?.forceMock || env.SMS_PROVIDER === "mock") &&
    mayUseMockSmsProvider(env)
  ) {
    return new MockSmsProvider();
  }
  // An unconfigured Twilio provider fails closed. Never silently substitute
  // mock in production or while the provider feature flag is disabled.
  return new TwilioSmsProvider(env);
}

export function isProductionSmsConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return new TwilioSmsProvider(env).isConfigured();
}

export function smsProviderStatus(env: NodeJS.ProcessEnv = process.env): {
  configured: boolean;
  providerName: string;
  message: string | null;
} {
  if (!isCommunicationsProviderEnabled()) {
    return {
      configured: false,
      providerName: "disabled",
      message: "SMS provider submission is disabled",
    };
  }
  const twilio = new TwilioSmsProvider(env);
  if (twilio.isConfigured()) {
    return {
      configured: true,
      providerName: "twilio",
      message: null,
    };
  }
  if (mayUseMockSmsProvider(env)) {
    return {
      configured: true,
      providerName: "mock",
      message: null,
    };
  }
  return {
    configured: false,
    providerName: "none",
    message: "SMS provider not configured",
  };
}
