import { MockSmsProvider } from "./mock";
import { TwilioSmsProvider } from "./twilio";
import type { SmsProvider } from "./types";

export type { SmsProvider, SmsSendRequest, SmsSendResult } from "./types";
export { MockSmsProvider } from "./mock";
export { TwilioSmsProvider } from "./twilio";

/** Prefer Twilio when configured; otherwise mock for local/dev (never crashes). */
export function getSmsProvider(
  env: NodeJS.ProcessEnv = process.env,
  options?: { forceMock?: boolean },
): SmsProvider {
  if (options?.forceMock || env.SMS_PROVIDER === "mock") {
    return new MockSmsProvider();
  }
  const twilio = new TwilioSmsProvider(env);
  if (twilio.isConfigured()) return twilio;
  return new MockSmsProvider();
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
  const twilio = new TwilioSmsProvider(env);
  if (twilio.isConfigured()) {
    return {
      configured: true,
      providerName: "twilio",
      message: null,
    };
  }
  if (env.SMS_PROVIDER === "mock" || process.env.NODE_ENV !== "production") {
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
