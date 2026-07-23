-- Tenant Payment Portal, fee engine, bank reconciliation scaffolding, contact history
-- Additive only. DO NOT apply to production without backup verification and owner approval.
-- Does NOT alter existing RENT_payments / RENT_invoices formulas.
-- Does NOT alter legacy RENT_v3_payment_receipts / RENT_v3_payment_receipt_items.
-- Portal receipts use: RENT_v3_portal_payment_receipts / RENT_v3_portal_payment_receipt_items

-- ---------------------------------------------------------------------------
-- Helpers: fail if a portal table exists with an incompatible schema
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rent_v3_portal_assert_table_ready(
  p_table text,
  p_required_columns text[]
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  missing text;
BEGIN
  IF to_regclass(format('public.%I', p_table)) IS NULL THEN
    RETURN; -- absent: caller will CREATE
  END IF;

  SELECT string_agg(req, ', ')
  INTO missing
  FROM unnest(p_required_columns) AS req
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = p_table
      AND c.column_name = req
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Incompatible existing table public.% (missing columns: %). Refusing to continue.',
      p_table, missing;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Preflight: report legacy receipt tables without changing them
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  legacy_receipts boolean;
  legacy_items boolean;
BEGIN
  SELECT to_regclass('public."RENT_v3_payment_receipts"') IS NOT NULL INTO legacy_receipts;
  SELECT to_regclass('public."RENT_v3_payment_receipt_items"') IS NOT NULL INTO legacy_items;
  RAISE NOTICE 'LEGACY_RECEIPTS_PRESENT=% LEGACY_RECEIPT_ITEMS_PRESENT=% (untouched by this migration)',
    legacy_receipts, legacy_items;
END $$;

-- ---------------------------------------------------------------------------
-- Portal access tokens (store hash only; raw token never persisted)
-- ---------------------------------------------------------------------------
SELECT public.rent_v3_portal_assert_table_ready(
  'RENT_v3_portal_access_tokens',
  ARRAY['id','tenant_id','lease_id','token_hash']
);
CREATE TABLE IF NOT EXISTS public."RENT_v3_portal_access_tokens" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public."RENT_tenants"(id) ON DELETE RESTRICT,
  lease_id uuid NOT NULL REFERENCES public."RENT_leases"(id) ON DELETE RESTRICT,
  property_id uuid NULL REFERENCES public."RENT_properties"(id) ON DELETE SET NULL,
  token_hash text NOT NULL,
  label text NULL,
  expires_at timestamptz NULL,
  revoked_at timestamptz NULL,
  revoked_reason text NULL,
  last_used_at timestamptz NULL,
  created_by_auth_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_v3_portal_tokens_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_rent_v3_portal_tokens_tenant
  ON public."RENT_v3_portal_access_tokens" (tenant_id, lease_id);

-- ---------------------------------------------------------------------------
-- Stable payment reference (e.g. HHS-1047)
-- ---------------------------------------------------------------------------
SELECT public.rent_v3_portal_assert_table_ready(
  'RENT_v3_tenant_payment_references',
  ARRAY['id','tenant_id','reference_code','active']
);
CREATE TABLE IF NOT EXISTS public."RENT_v3_tenant_payment_references" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public."RENT_tenants"(id) ON DELETE RESTRICT,
  lease_id uuid NULL REFERENCES public."RENT_leases"(id) ON DELETE SET NULL,
  reference_code text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_v3_payment_ref_code_unique UNIQUE (reference_code),
  CONSTRAINT rent_v3_payment_ref_tenant_unique UNIQUE (tenant_id)
);

-- ---------------------------------------------------------------------------
-- Fee policy versions
-- ---------------------------------------------------------------------------
SELECT public.rent_v3_portal_assert_table_ready(
  'RENT_v3_payment_fee_policies',
  ARRAY['id','method','enabled','flat_cents','percent_bps','version']
);
CREATE TABLE IF NOT EXISTS public."RENT_v3_payment_fee_policies" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  method text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  flat_cents integer NOT NULL DEFAULT 0,
  percent_bps integer NOT NULL DEFAULT 0,
  minimum_cents integer NOT NULL DEFAULT 0,
  maximum_cents integer NULL,
  payer text NOT NULL DEFAULT 'tenant',
  gross_up boolean NOT NULL DEFAULT false,
  disclosure_text text NULL,
  receipt_label text NULL,
  refund_treatment text NOT NULL DEFAULT 'refund_fee_if_full',
  jurisdiction text NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_v3_fee_method_check CHECK (method IN (
    'ach', 'card_credit', 'card_debit', 'card_generic',
    'cash_app_pay', 'existing_cash_app', 'zelle', 'other_bank'
  )),
  CONSTRAINT rent_v3_fee_payer_check CHECK (payer IN ('tenant', 'owner'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rent_v3_fee_policy_active
  ON public."RENT_v3_payment_fee_policies" (method, version);

-- ---------------------------------------------------------------------------
-- Payment attempts
-- ---------------------------------------------------------------------------
SELECT public.rent_v3_portal_assert_table_ready(
  'RENT_v3_payment_attempts',
  ARRAY['id','tenant_id','lease_id','method','status','rent_amount_cents','idempotency_key']
);
CREATE TABLE IF NOT EXISTS public."RENT_v3_payment_attempts" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public."RENT_tenants"(id) ON DELETE RESTRICT,
  lease_id uuid NOT NULL REFERENCES public."RENT_leases"(id) ON DELETE RESTRICT,
  property_id uuid NULL REFERENCES public."RENT_properties"(id) ON DELETE SET NULL,
  portal_token_id uuid NULL REFERENCES public."RENT_v3_portal_access_tokens"(id) ON DELETE SET NULL,
  method text NOT NULL,
  channel text NOT NULL DEFAULT 'stripe',
  status text NOT NULL DEFAULT 'created',
  rent_amount_cents integer NOT NULL,
  fee_amount_cents integer NOT NULL DEFAULT 0,
  total_charged_cents integer NOT NULL,
  amount_applied_to_rent_cents integer NOT NULL DEFAULT 0,
  unapplied_cents integer NOT NULL DEFAULT 0,
  provider text NULL,
  provider_payment_id text NULL,
  provider_session_id text NULL,
  institution_transaction_id text NULL,
  idempotency_key text NOT NULL,
  fee_policy_id uuid NULL REFERENCES public."RENT_v3_payment_fee_policies"(id) ON DELETE SET NULL,
  fee_policy_version integer NULL,
  as_of_date date NULL,
  account_policy_version text NULL,
  posted_payment_id uuid NULL,
  receipt_id uuid NULL,
  tenant_reference_code text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz NULL,
  pending_at timestamptz NULL,
  settled_at timestamptz NULL,
  failed_at timestamptz NULL,
  returned_at timestamptz NULL,
  refunded_at timestamptz NULL,
  disputed_at timestamptz NULL,
  canceled_at timestamptz NULL,
  expired_at timestamptz NULL,
  CONSTRAINT rent_v3_attempt_method_check CHECK (method IN (
    'ach', 'card', 'cash_app_pay', 'existing_cash_app', 'zelle'
  )),
  CONSTRAINT rent_v3_attempt_channel_check CHECK (channel IN (
    'stripe', 'manual_existing_cash_app', 'manual_zelle', 'bank_import'
  )),
  CONSTRAINT rent_v3_attempt_status_check CHECK (status IN (
    'created', 'awaiting_customer', 'submitted', 'awaiting_verification',
    'processing', 'pending', 'settled', 'failed', 'returned', 'refunded',
    'disputed', 'canceled', 'expired', 'rejected_match', 'manual_review'
  )),
  CONSTRAINT rent_v3_attempt_idempotency_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_rent_v3_attempts_tenant_created
  ON public."RENT_v3_payment_attempts" (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rent_v3_attempts_status
  ON public."RENT_v3_payment_attempts" (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rent_v3_attempts_provider_payment
  ON public."RENT_v3_payment_attempts" (provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

SELECT public.rent_v3_portal_assert_table_ready(
  'RENT_v3_payment_attempt_events',
  ARRAY['id','attempt_id','to_status','source']
);
CREATE TABLE IF NOT EXISTS public."RENT_v3_payment_attempt_events" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public."RENT_v3_payment_attempts"(id) ON DELETE CASCADE,
  from_status text NULL,
  to_status text NOT NULL,
  source text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rent_v3_attempt_events_attempt
  ON public."RENT_v3_payment_attempt_events" (attempt_id, created_at);

-- ---------------------------------------------------------------------------
-- Provider event dedupe
-- ---------------------------------------------------------------------------
SELECT public.rent_v3_portal_assert_table_ready(
  'RENT_v3_provider_events',
  ARRAY['id','provider','provider_event_id','event_type','processing_status']
);
CREATE TABLE IF NOT EXISTS public."RENT_v3_provider_events" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processing_status text NOT NULL DEFAULT 'received',
  error_message text NULL,
  attempt_id uuid NULL REFERENCES public."RENT_v3_payment_attempts"(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL,
  CONSTRAINT rent_v3_provider_events_unique UNIQUE (provider, provider_event_id),
  CONSTRAINT rent_v3_provider_events_status_check CHECK (processing_status IN (
    'received', 'processed', 'ignored', 'failed', 'dead_letter'
  ))
);

-- ---------------------------------------------------------------------------
-- Portal receipts (SEPARATE from legacy RENT_v3_payment_receipts)
-- ---------------------------------------------------------------------------
SELECT public.rent_v3_portal_assert_table_ready(
  'RENT_v3_portal_payment_receipts',
  ARRAY['id','receipt_number','attempt_id','tenant_id','lease_id','rent_amount_cents','total_charged_cents','method','status']
);
CREATE TABLE IF NOT EXISTS public."RENT_v3_portal_payment_receipts" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL,
  attempt_id uuid NOT NULL REFERENCES public."RENT_v3_payment_attempts"(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public."RENT_tenants"(id) ON DELETE RESTRICT,
  lease_id uuid NOT NULL REFERENCES public."RENT_leases"(id) ON DELETE RESTRICT,
  property_id uuid NULL REFERENCES public."RENT_properties"(id) ON DELETE SET NULL,
  rent_amount_cents integer NOT NULL,
  fee_amount_cents integer NOT NULL DEFAULT 0,
  total_charged_cents integer NOT NULL,
  amount_applied_cents integer NOT NULL DEFAULT 0,
  pending_amount_cents integer NOT NULL DEFAULT 0,
  remaining_settled_balance_cents integer NULL,
  method text NOT NULL,
  status text NOT NULL,
  provider_reference text NULL,
  submitted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_v3_portal_receipt_number_unique UNIQUE (receipt_number)
);

CREATE INDEX IF NOT EXISTS idx_portal_payment_receipts_attempt
  ON public."RENT_v3_portal_payment_receipts" (attempt_id);
CREATE INDEX IF NOT EXISTS idx_portal_payment_receipts_tenant_created
  ON public."RENT_v3_portal_payment_receipts" (tenant_id, created_at DESC);

SELECT public.rent_v3_portal_assert_table_ready(
  'RENT_v3_portal_payment_receipt_items',
  ARRAY['id','receipt_id','amount_applied_cents']
);
CREATE TABLE IF NOT EXISTS public."RENT_v3_portal_payment_receipt_items" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public."RENT_v3_portal_payment_receipts"(id) ON DELETE CASCADE,
  invoice_id uuid NULL REFERENCES public."RENT_invoices"(id) ON DELETE SET NULL,
  amount_applied_cents integer NOT NULL,
  amount_to_rent_cents integer NOT NULL DEFAULT 0,
  amount_to_late_fee_cents integer NOT NULL DEFAULT 0,
  amount_to_other_cents integer NOT NULL DEFAULT 0,
  allocation_order integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_payment_receipt_items_receipt
  ON public."RENT_v3_portal_payment_receipt_items" (receipt_id);

-- ---------------------------------------------------------------------------
-- Bank connections + imported transactions
-- ---------------------------------------------------------------------------
SELECT public.rent_v3_portal_assert_table_ready(
  'RENT_v3_bank_connections',
  ARRAY['id','provider','encrypted_access_token','status']
);
CREATE TABLE IF NOT EXISTS public."RENT_v3_bank_connections" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'plaid',
  institution_name text NULL,
  account_mask text NULL,
  account_name text NULL,
  encrypted_access_token text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  last_synced_at timestamptz NULL,
  created_by_auth_user_id uuid NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_v3_bank_conn_status_check CHECK (status IN (
    'active', 'error', 'revoked', 'needs_reauth'
  ))
);

SELECT public.rent_v3_portal_assert_table_ready(
  'RENT_v3_bank_transactions',
  ARRAY['id','connection_id','provider_transaction_id','amount_cents','classification']
);
CREATE TABLE IF NOT EXISTS public."RENT_v3_bank_transactions" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public."RENT_v3_bank_connections"(id) ON DELETE CASCADE,
  provider_transaction_id text NOT NULL,
  amount_cents integer NOT NULL,
  posted_date date NULL,
  pending_date date NULL,
  is_pending boolean NOT NULL DEFAULT false,
  removed boolean NOT NULL DEFAULT false,
  description text NULL,
  sender_name text NULL,
  classification text NOT NULL DEFAULT 'unknown_deposit',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_v3_bank_tx_unique UNIQUE (connection_id, provider_transaction_id),
  CONSTRAINT rent_v3_bank_tx_class_check CHECK (classification IN (
    'potential_cash_app', 'potential_zelle', 'other_bank_transfer',
    'unknown_deposit', 'confirmed_tenant_payment', 'rejected_match',
    'duplicate', 'reversed', 'needs_manual_review'
  ))
);

CREATE INDEX IF NOT EXISTS idx_rent_v3_bank_tx_class
  ON public."RENT_v3_bank_transactions" (classification, posted_date DESC);

SELECT public.rent_v3_portal_assert_table_ready(
  'RENT_v3_payment_match_candidates',
  ARRAY['id','bank_transaction_id','confidence_score','status']
);
CREATE TABLE IF NOT EXISTS public."RENT_v3_payment_match_candidates" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_transaction_id uuid NOT NULL REFERENCES public."RENT_v3_bank_transactions"(id) ON DELETE CASCADE,
  tenant_id uuid NULL REFERENCES public."RENT_tenants"(id) ON DELETE SET NULL,
  lease_id uuid NULL REFERENCES public."RENT_leases"(id) ON DELETE SET NULL,
  property_id uuid NULL REFERENCES public."RENT_properties"(id) ON DELETE SET NULL,
  confidence_score integer NOT NULL DEFAULT 0,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'needs_review',
  reviewed_by_auth_user_id uuid NULL,
  reviewed_at timestamptz NULL,
  posted_attempt_id uuid NULL REFERENCES public."RENT_v3_payment_attempts"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_v3_match_status_check CHECK (status IN (
    'needs_review', 'posted', 'rejected', 'duplicate', 'auto_posted'
  ))
);

SELECT public.rent_v3_portal_assert_table_ready(
  'RENT_v3_confirmed_sender_mappings',
  ARRAY['id','tenant_id','sender_name_normalized']
);
CREATE TABLE IF NOT EXISTS public."RENT_v3_confirmed_sender_mappings" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public."RENT_tenants"(id) ON DELETE RESTRICT,
  sender_name_normalized text NOT NULL,
  method text NULL,
  created_by_auth_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_v3_sender_map_unique UNIQUE (tenant_id, sender_name_normalized)
);

SELECT public.rent_v3_portal_assert_table_ready(
  'RENT_v3_staff_exceptions',
  ARRAY['id','kind','severity','detail']
);
CREATE TABLE IF NOT EXISTS public."RENT_v3_staff_exceptions" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  tenant_id uuid NULL REFERENCES public."RENT_tenants"(id) ON DELETE SET NULL,
  attempt_id uuid NULL REFERENCES public."RENT_v3_payment_attempts"(id) ON DELETE SET NULL,
  bank_transaction_id uuid NULL REFERENCES public."RENT_v3_bank_transactions"(id) ON DELETE SET NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Contact history (append-friendly; no hard deletes)
-- ---------------------------------------------------------------------------
SELECT public.rent_v3_portal_assert_table_ready(
  'RENT_v3_tenant_contact_points',
  ARRAY['id','tenant_id','contact_type','original_value','normalized_value','is_active']
);
CREATE TABLE IF NOT EXISTS public."RENT_v3_tenant_contact_points" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public."RENT_tenants"(id) ON DELETE RESTRICT,
  contact_type text NOT NULL,
  original_value text NOT NULL,
  normalized_value text NOT NULL,
  label text NOT NULL DEFAULT 'other',
  is_active boolean NOT NULL DEFAULT true,
  is_primary boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'unverified',
  verified_at timestamptz NULL,
  source text NOT NULL DEFAULT 'staff',
  effective_start timestamptz NOT NULL DEFAULT now(),
  inactive_at timestamptz NULL,
  inactive_reason text NULL,
  created_by text NULL,
  created_by_auth_user_id uuid NULL,
  updated_by_auth_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_v3_contact_type_check CHECK (contact_type IN ('phone', 'email')),
  CONSTRAINT rent_v3_contact_label_check CHECK (label IN (
    'mobile', 'home', 'work', 'personal', 'other'
  )),
  CONSTRAINT rent_v3_contact_verification_check CHECK (verification_status IN (
    'unverified', 'pending', 'verified', 'staff_verified', 'failed'
  )),
  CONSTRAINT rent_v3_contact_source_check CHECK (source IN (
    'tenant', 'staff', 'import', 'application'
  ))
);

CREATE INDEX IF NOT EXISTS idx_rent_v3_contacts_tenant
  ON public."RENT_v3_tenant_contact_points" (tenant_id, contact_type, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rent_v3_contacts_active_normalized
  ON public."RENT_v3_tenant_contact_points" (tenant_id, contact_type, normalized_value)
  WHERE is_active = true;

SELECT public.rent_v3_portal_assert_table_ready(
  'RENT_v3_contact_verification_attempts',
  ARRAY['id','contact_point_id','channel','status']
);
CREATE TABLE IF NOT EXISTS public."RENT_v3_contact_verification_attempts" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_point_id uuid NOT NULL REFERENCES public."RENT_v3_tenant_contact_points"(id) ON DELETE CASCADE,
  channel text NOT NULL,
  challenge_hash text NULL,
  expires_at timestamptz NULL,
  consumed_at timestamptz NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_v3_contact_verify_status_check CHECK (status IN (
    'pending', 'consumed', 'expired', 'failed'
  ))
);

SELECT public.rent_v3_portal_assert_table_ready(
  'RENT_v3_contact_audit_events',
  ARRAY['id','contact_point_id','tenant_id','action','actor']
);
CREATE TABLE IF NOT EXISTS public."RENT_v3_contact_audit_events" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_point_id uuid NOT NULL REFERENCES public."RENT_v3_tenant_contact_points"(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public."RENT_tenants"(id) ON DELETE RESTRICT,
  action text NOT NULL,
  actor text NOT NULL,
  actor_auth_user_id uuid NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- RLS + grants: EXPLICIT portal allowlist only (never legacy receipt tables)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  portal_tables text[] := ARRAY[
    'RENT_v3_portal_access_tokens',
    'RENT_v3_tenant_payment_references',
    'RENT_v3_payment_fee_policies',
    'RENT_v3_payment_attempts',
    'RENT_v3_payment_attempt_events',
    'RENT_v3_provider_events',
    'RENT_v3_portal_payment_receipts',
    'RENT_v3_portal_payment_receipt_items',
    'RENT_v3_bank_connections',
    'RENT_v3_bank_transactions',
    'RENT_v3_payment_match_candidates',
    'RENT_v3_confirmed_sender_mappings',
    'RENT_v3_staff_exceptions',
    'RENT_v3_tenant_contact_points',
    'RENT_v3_contact_verification_attempts',
    'RENT_v3_contact_audit_events'
  ];
BEGIN
  -- Guard: never touch legacy receipt tables
  IF 'RENT_v3_payment_receipts' = ANY(portal_tables)
     OR 'RENT_v3_payment_receipt_items' = ANY(portal_tables) THEN
    RAISE EXCEPTION 'Portal allowlist must not include legacy receipt tables';
  END IF;

  FOREACH t IN ARRAY portal_tables
  LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE EXCEPTION 'Expected portal table % missing before RLS/grants', t;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

-- Drop helper only if you prefer not to leave it; keep for re-apply safety.
-- (Left in place intentionally for future portal migrations.)
