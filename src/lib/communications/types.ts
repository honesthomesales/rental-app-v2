export type CommunicationChannel = "sms" | "call_log";
export type CommunicationDirection = "outbound" | "inbound";
export type CommunicationStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "failed"
  | "received";

export type SmsConsentStatus = "unknown" | "opted_in" | "opted_out";

export type CommunicationApprovalStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "scheduled"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "rejected"
  | "cancelled"
  | "stale"
  | "blocked";

export type CommunicationTriggerType =
  | "manual"
  | "late_day_6"
  | "eviction_risk_day_15";

export type CommunicationRow = {
  id: string;
  tenant_id: string | null;
  property_id: string | null;
  lease_id: string | null;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  body: string;
  template_key: string | null;
  status: CommunicationStatus;
  provider: string | null;
  provider_message_id: string | null;
  phone_number_e164?: string | null;
  from_number: string | null;
  to_number: string | null;
  requires_owner_review?: boolean;
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
  consent_notes?: string | null;
  consent_recorded_by_auth_user_id?: string | null;
  supporting_document_reference?: string | null;
  tenant_timezone?: string | null;
  opted_out_at: string | null;
  opted_in_at: string | null;
  updated_at: string;
};

export type CommunicationApproval = {
  id: string;
  tenant_id: string;
  property_id: string | null;
  lease_id: string | null;
  trigger_type: CommunicationTriggerType;
  template_key: string | null;
  body: string;
  status: CommunicationApprovalStatus;
  generated_as_of_date: string;
  generated_ledger_version: string;
  balance_snapshot: number;
  days_late_snapshot: number | null;
  generation_reason: string;
  idempotency_key: string;
  phone_snapshot: string | null;
  not_before: string | null;
  created_by_auth_user_id: string | null;
  approved_by_auth_user_id: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  sent_communication_id: string | null;
  stale_reason: string | null;
  provider_error_code: string | null;
  provider_error_message: string | null;
  created_at: string;
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
