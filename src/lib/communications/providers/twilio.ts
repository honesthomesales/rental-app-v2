import type { SmsProvider, SmsSendRequest, SmsSendResult } from "./types";

/**
 * Twilio SMS via REST API (no SDK dependency).
 * Credentials are server-only env vars — never NEXT_PUBLIC_*.
 */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";

  private accountSid: string;
  private authToken: string;
  private messagingServiceSid: string;
  private fromNumber: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.accountSid = String(env.TWILIO_ACCOUNT_SID || "").trim();
    this.authToken = String(env.TWILIO_AUTH_TOKEN || "").trim();
    this.messagingServiceSid = String(
      env.TWILIO_MESSAGING_SERVICE_SID || "",
    ).trim();
    this.fromNumber = String(env.TWILIO_PHONE_NUMBER || "").trim();
  }

  isConfigured(): boolean {
    return Boolean(
      this.accountSid &&
        this.authToken &&
        (this.messagingServiceSid || this.fromNumber),
    );
  }

  async send(request: SmsSendRequest): Promise<SmsSendResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        provider: this.name,
        errorCode: "NOT_CONFIGURED",
        errorMessage: "SMS provider not configured",
      };
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`;
    const params = new URLSearchParams();
    params.set("To", request.to);
    params.set("Body", request.body);
    if (this.messagingServiceSid) {
      params.set("MessagingServiceSid", this.messagingServiceSid);
    } else if (this.fromNumber) {
      params.set("From", this.fromNumber);
    }

    const auth = Buffer.from(
      `${this.accountSid}:${this.authToken}`,
    ).toString("base64");

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      const data = (await res.json().catch(() => ({}))) as {
        sid?: string;
        message?: string;
        code?: number | string;
        error_message?: string;
      };

      if (!res.ok) {
        return {
          success: false,
          provider: this.name,
          errorCode: String(data.code || res.status),
          errorMessage:
            data.message || data.error_message || `Twilio HTTP ${res.status}`,
        };
      }

      return {
        success: true,
        provider: this.name,
        providerMessageId: data.sid,
      };
    } catch (err) {
      return {
        success: false,
        provider: this.name,
        errorCode: "NETWORK_ERROR",
        errorMessage:
          err instanceof Error ? err.message : "Twilio request failed",
      };
    }
  }
}
