export type CommunicationChannel = "sms" | "call_log";
export type CommunicationDirection = "outbound" | "inbound";
export type CommunicationStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "failed"
  | "received";

export type SmsConsentStatus = "unknown" | "opted_in" | "opted_out";

export type CommunicationRow = {
  id: string;
  tenant_id: string;
  property_id: string | null;
  lease_id: string | null;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  body: string;
  template_key: string | null;
  status: CommunicationStatus;
  provider: string | null;
  provider_message_id: string | null;
  from_number: string | null;
  to_number: string | null;
  sent_by_auth_user_id: string | null;
  idempotency_key?: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
};

export type CommunicationPreference = {
  id: string;
  tenant_id: string;
  phone_number: string;
  sms_consent_status: SmsConsentStatus;
  consent_recorded_at: string | null;
  consent_source: string | null;
  opted_out_at: string | null;
  opted_in_at: string | null;
  updated_at: string;
};

export type TemplateKey =
  | "rent_due_reminder"
  | "late_payment_reminder"
  | "payment_received"
  | "promise_to_pay"
  | "eviction_process_notice"
  | "custom";

export type TemplateContext = {
  tenant_name?: string;
  property_address?: string;
  amount_due?: string;
  due_date?: string;
  payment_amount?: string;
  promise_date?: string;
  payment_link?: string;
};
