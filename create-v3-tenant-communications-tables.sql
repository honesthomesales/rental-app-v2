-- =============================================================================
-- V3 Tenant Communication Center tables
-- Reviewed migration — DO NOT apply to production until Billy approves.
-- Feature branch: feature/v3-tenant-communications
-- Feature flag: V3_TENANT_COMMUNICATIONS_ENABLED (default false)
--
-- Does not alter RENT_payments, RENT_invoices, RENT_leases, or RENT_tenants.
-- Existing entity IDs are UUID (see database-setup.sql / TypeScript string IDs).
-- =============================================================================

-- Outbound / inbound message log (append-only from the application UI)
CREATE TABLE IF NOT EXISTS public."RENT_communications" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public."RENT_tenants"(id) ON DELETE RESTRICT,
  property_id uuid NULL REFERENCES public."RENT_properties"(id) ON DELETE SET NULL,
  lease_id uuid NULL REFERENCES public."RENT_leases"(id) ON DELETE SET NULL,
  channel text NOT NULL DEFAULT 'sms',
  direction text NOT NULL,
  body text NOT NULL,
  template_key text NULL,
  status text NOT NULL,
  provider text NULL,
  provider_message_id text NULL,
  from_number text NULL,
  to_number text NULL,
  sent_by_auth_user_id uuid NULL,
  idempotency_key text NULL,
  error_code text NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NULL,
  delivered_at timestamptz NULL,
  failed_at timestamptz NULL,
  CONSTRAINT rent_communications_channel_check
    CHECK (channel IN ('sms', 'call_log')),
  CONSTRAINT rent_communications_direction_check
    CHECK (direction IN ('outbound', 'inbound')),
  CONSTRAINT rent_communications_status_check
    CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'received'))
);

CREATE INDEX IF NOT EXISTS idx_rent_communications_tenant_created
  ON public."RENT_communications" (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rent_communications_lease_created
  ON public."RENT_communications" (lease_id, created_at DESC)
  WHERE lease_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rent_communications_provider_message_id
  ON public."RENT_communications" (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rent_communications_idempotency_key
  ON public."RENT_communications" (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON TABLE public."RENT_communications" IS
  'V3 tenant SMS/call communication history. Append-only from UI; no cascade-delete of history.';

-- Per-tenant / phone SMS consent and opt-out preferences
CREATE TABLE IF NOT EXISTS public."RENT_communication_preferences" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public."RENT_tenants"(id) ON DELETE RESTRICT,
  phone_number text NOT NULL,
  sms_consent_status text NOT NULL DEFAULT 'unknown',
  consent_recorded_at timestamptz NULL,
  consent_source text NULL,
  opted_out_at timestamptz NULL,
  opted_in_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_communication_preferences_status_check
    CHECK (sms_consent_status IN ('unknown', 'opted_in', 'opted_out')),
  CONSTRAINT rent_communication_preferences_tenant_phone_unique
    UNIQUE (tenant_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_rent_communication_preferences_phone
  ON public."RENT_communication_preferences" (phone_number);

COMMENT ON TABLE public."RENT_communication_preferences" IS
  'V3 SMS consent/opt-out per tenant phone. Opt-out blocks outbound sends.';
