import type { SmsProvider } from "./providers/types";
import { normalizeToE164 } from "./phone";
import type {
  CommunicationPreference,
  CommunicationRow,
  SmsConsentStatus,
  TemplateKey,
} from "./types";

export type SendMessageInput = {
  tenantId: string;
  propertyId?: string | null;
  leaseId?: string | null;
  phone: string;
  body: string;
  templateKey?: TemplateKey | null;
  idempotencyKey: string;
  sentByAuthUserId: string;
  /** Explicit confirmation that consent is recorded / authorized override */
  confirmConsentOverride?: boolean;
};

export type SendMessageResult =
  | { ok: true; communication: CommunicationRow; duplicate?: boolean }
  | {
      ok: false;
      code: string;
      error: string;
      status: number;
      communication?: CommunicationRow;
    };

export type CommunicationsStore = {
  findByIdempotencyKey(
    key: string,
  ): Promise<CommunicationRow | null>;
  getPreference(
    tenantId: string,
    phoneE164: string,
  ): Promise<CommunicationPreference | null>;
  insertPending(row: {
    tenant_id: string;
    property_id: string | null;
    lease_id: string | null;
    body: string;
    template_key: string | null;
    to_number: string;
    from_number: string | null;
    sent_by_auth_user_id: string;
    idempotency_key: string;
    provider: string;
  }): Promise<CommunicationRow>;
  updateAfterSend(
    id: string,
    patch: {
      status: "sent" | "failed";
      provider_message_id?: string | null;
      error_code?: string | null;
      error_message?: string | null;
      sent_at?: string | null;
      failed_at?: string | null;
    },
  ): Promise<CommunicationRow>;
};

function trimBody(body: string): string {
  return String(body || "").trim();
}

export async function sendTenantSms(args: {
  input: SendMessageInput;
  provider: SmsProvider;
  store: CommunicationsStore;
  allowSendWithoutProvider?: boolean;
}): Promise<SendMessageResult> {
  const { input, provider, store } = args;

  if (!provider.isConfigured() && !args.allowSendWithoutProvider) {
    return {
      ok: false,
      code: "PROVIDER_NOT_CONFIGURED",
      error: "SMS provider not configured",
      status: 503,
    };
  }

  const body = trimBody(input.body);
  if (!body) {
    return {
      ok: false,
      code: "EMPTY_MESSAGE",
      error: "Message body is required",
      status: 400,
    };
  }

  if (!input.tenantId) {
    return {
      ok: false,
      code: "MISSING_TENANT",
      error: "tenantId is required",
      status: 400,
    };
  }

  if (!input.idempotencyKey || !String(input.idempotencyKey).trim()) {
    return {
      ok: false,
      code: "MISSING_IDEMPOTENCY_KEY",
      error: "idempotencyKey is required",
      status: 400,
    };
  }

  const to = normalizeToE164(input.phone);
  if (!to) {
    return {
      ok: false,
      code: "INVALID_PHONE",
      error: "Invalid phone number",
      status: 400,
    };
  }

  const existing = await store.findByIdempotencyKey(
    String(input.idempotencyKey).trim(),
  );
  if (existing) {
    return { ok: true, communication: existing, duplicate: true };
  }

  const pref = await store.getPreference(input.tenantId, to);
  const consent: SmsConsentStatus = pref?.sms_consent_status || "unknown";

  if (consent === "opted_out") {
    return {
      ok: false,
      code: "OPTED_OUT",
      error: "Tenant has opted out of SMS",
      status: 403,
    };
  }

  if (consent === "unknown" && !input.confirmConsentOverride) {
    return {
      ok: false,
      code: "CONSENT_REQUIRED",
      error:
        "SMS consent is not recorded. Confirm authorized consent override to send.",
      status: 403,
    };
  }

  const pending = await store.insertPending({
    tenant_id: input.tenantId,
    property_id: input.propertyId || null,
    lease_id: input.leaseId || null,
    body,
    template_key: input.templateKey || null,
    to_number: to,
    from_number: null,
    sent_by_auth_user_id: input.sentByAuthUserId,
    idempotency_key: String(input.idempotencyKey).trim(),
    provider: provider.name,
  });

  const result = await provider.send({
    to,
    body,
    idempotencyKey: input.idempotencyKey,
  });

  const now = new Date().toISOString();
  if (result.success) {
    const updated = await store.updateAfterSend(pending.id, {
      status: "sent",
      provider_message_id: result.providerMessageId || null,
      sent_at: now,
      error_code: null,
      error_message: null,
    });
    return { ok: true, communication: updated };
  }

  const failed = await store.updateAfterSend(pending.id, {
    status: "failed",
    error_code: result.errorCode || "SEND_FAILED",
    error_message: result.errorMessage || "Send failed",
    failed_at: now,
  });
  return {
    ok: false,
    code: result.errorCode || "SEND_FAILED",
    error: result.errorMessage || "Send failed",
    status: 502,
    communication: failed,
  };
}

/** Pure chronological sort (oldest first) for conversation threads. */
export function sortCommunicationsChronologically<
  T extends { created_at: string },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    String(a.created_at).localeCompare(String(b.created_at)),
  );
}
