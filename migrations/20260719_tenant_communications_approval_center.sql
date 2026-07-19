-- Tenant Communications Approval Center
-- Additive only. DO NOT apply to production without separate owner approval.
-- This migration does not write RENT_invoices, RENT_payments, or financial data.

CREATE TABLE IF NOT EXISTS public."RENT_communications" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL REFERENCES public."RENT_tenants"(id) ON DELETE RESTRICT,
  property_id uuid NULL REFERENCES public."RENT_properties"(id) ON DELETE SET NULL,
  lease_id uuid NULL REFERENCES public."RENT_leases"(id) ON DELETE SET NULL,
  channel text NOT NULL DEFAULT 'sms',
  direction text NOT NULL,
  body text NOT NULL,
  template_key text NULL,
  status text NOT NULL,
  provider text NULL,
  provider_message_id text NULL,
  phone_number_e164 text NULL,
  from_number text NULL,
  to_number text NULL,
  requires_owner_review boolean NOT NULL DEFAULT false,
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
    CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'received')),
  CONSTRAINT rent_communications_sms_phone_check
    CHECK (
      channel <> 'sms'
      OR phone_number_e164 ~ '^\+[1-9][0-9]{7,14}$'
    ),
  CONSTRAINT rent_communications_from_e164_check
    CHECK (from_number IS NULL OR from_number ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT rent_communications_to_e164_check
    CHECK (to_number IS NULL OR to_number ~ '^\+[1-9][0-9]{7,14}$')
);

-- Compatibility with the original unapproved communications-table draft.
ALTER TABLE public."RENT_communications" ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE public."RENT_communications"
  ADD COLUMN IF NOT EXISTS phone_number_e164 text NULL,
  ADD COLUMN IF NOT EXISTS requires_owner_review boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_rent_communications_tenant_created
  ON public."RENT_communications" (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rent_communications_phone_created
  ON public."RENT_communications" (phone_number_e164, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rent_communications_provider_message_id
  ON public."RENT_communications" (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rent_communications_idempotency_key
  ON public."RENT_communications" (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public."RENT_communication_preferences" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public."RENT_tenants"(id) ON DELETE RESTRICT,
  phone_number text NOT NULL,
  sms_consent_status text NOT NULL DEFAULT 'unknown',
  consent_recorded_at timestamptz NULL,
  consent_source text NULL,
  consent_notes text NULL,
  consent_recorded_by_auth_user_id uuid NULL,
  supporting_document_reference text NULL,
  tenant_timezone text NOT NULL DEFAULT 'America/New_York',
  opted_out_at timestamptz NULL,
  opted_in_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_communication_preferences_status_check
    CHECK (sms_consent_status IN ('unknown', 'opted_in', 'opted_out')),
  CONSTRAINT rent_communication_preferences_phone_e164_check
    CHECK (phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT rent_communication_preferences_tenant_phone_unique
    UNIQUE (tenant_id, phone_number)
);

ALTER TABLE public."RENT_communication_preferences"
  ADD COLUMN IF NOT EXISTS consent_notes text NULL,
  ADD COLUMN IF NOT EXISTS consent_recorded_by_auth_user_id uuid NULL,
  ADD COLUMN IF NOT EXISTS supporting_document_reference text NULL,
  ADD COLUMN IF NOT EXISTS tenant_timezone text NOT NULL DEFAULT 'America/New_York',
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_rent_communication_preferences_phone
  ON public."RENT_communication_preferences" (phone_number);

CREATE TABLE IF NOT EXISTS public."RENT_communication_consent_events" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public."RENT_tenants"(id) ON DELETE RESTRICT,
  preference_id uuid NULL REFERENCES public."RENT_communication_preferences"(id) ON DELETE SET NULL,
  phone_number text NOT NULL,
  prior_status text NULL,
  new_status text NOT NULL,
  source text NOT NULL,
  notes text NULL,
  recorded_by_auth_user_id uuid NULL,
  supporting_document_reference text NULL,
  provider_message_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_consent_events_phone_e164_check
    CHECK (phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT rent_consent_events_prior_status_check
    CHECK (prior_status IS NULL OR prior_status IN ('unknown', 'opted_in', 'opted_out')),
  CONSTRAINT rent_consent_events_new_status_check
    CHECK (new_status IN ('unknown', 'opted_in', 'opted_out'))
);

CREATE INDEX IF NOT EXISTS idx_rent_consent_events_tenant_created
  ON public."RENT_communication_consent_events" (tenant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rent_consent_events_provider_tenant
  ON public."RENT_communication_consent_events"
    (provider_message_id, tenant_id, new_status)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public."RENT_sms_phone_suppressions" (
  phone_number_e164 text PRIMARY KEY,
  is_suppressed boolean NOT NULL DEFAULT true,
  suppression_reason text NULL,
  suppressed_at timestamptz NULL,
  resumed_at timestamptz NULL,
  provider text NULL,
  source_message_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_sms_suppressions_phone_e164_check
    CHECK (phone_number_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

CREATE TABLE IF NOT EXISTS public."RENT_sms_phone_suppression_events" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number_e164 text NOT NULL,
  event_type text NOT NULL,
  suppression_reason text NULL,
  provider text NULL,
  source_message_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_sms_suppression_events_phone_e164_check
    CHECK (phone_number_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT rent_sms_suppression_events_type_check
    CHECK (event_type IN ('suppressed', 'resumed'))
);

CREATE INDEX IF NOT EXISTS idx_rent_sms_suppression_events_phone_created
  ON public."RENT_sms_phone_suppression_events"
    (phone_number_e164, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rent_sms_suppression_events_provider_message
  ON public."RENT_sms_phone_suppression_events"
    (source_message_id, event_type)
  WHERE source_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public."RENT_communication_tenant_links" (
  communication_id uuid NOT NULL
    REFERENCES public."RENT_communications"(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL
    REFERENCES public."RENT_tenants"(id) ON DELETE RESTRICT,
  match_type text NOT NULL DEFAULT 'exact_e164',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (communication_id, tenant_id),
  CONSTRAINT rent_communication_tenant_links_match_check
    CHECK (match_type IN ('exact_e164', 'owner_review'))
);

CREATE INDEX IF NOT EXISTS idx_rent_communication_tenant_links_tenant
  ON public."RENT_communication_tenant_links" (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public."RENT_communication_approvals" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public."RENT_tenants"(id) ON DELETE RESTRICT,
  property_id uuid NULL REFERENCES public."RENT_properties"(id) ON DELETE SET NULL,
  lease_id uuid NULL REFERENCES public."RENT_leases"(id) ON DELETE SET NULL,
  trigger_type text NOT NULL,
  template_key text NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  generated_as_of_date date NOT NULL,
  generated_ledger_version text NOT NULL,
  balance_snapshot numeric(12,2) NOT NULL DEFAULT 0,
  days_late_snapshot integer NULL,
  generation_reason text NOT NULL,
  idempotency_key text NOT NULL,
  phone_snapshot text NULL,
  not_before timestamptz NULL,
  created_by_auth_user_id uuid NULL,
  approved_by_auth_user_id uuid NULL,
  approved_at timestamptz NULL,
  rejected_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  sent_communication_id uuid NULL
    REFERENCES public."RENT_communications"(id) ON DELETE SET NULL,
  stale_reason text NULL,
  provider_error_code text NULL,
  provider_error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_communication_approvals_status_check CHECK (
    status IN (
      'draft', 'pending_approval', 'approved', 'scheduled', 'sending',
      'sent', 'delivered', 'failed', 'rejected', 'cancelled', 'stale', 'blocked'
    )
  ),
  CONSTRAINT rent_communication_approvals_trigger_check CHECK (
    trigger_type IN ('manual', 'late_day_6', 'eviction_risk_day_15')
  ),
  CONSTRAINT rent_communication_approvals_body_not_blank
    CHECK (length(btrim(body)) > 0),
  CONSTRAINT rent_communication_approvals_phone_e164_check
    CHECK (
      phone_snapshot IS NULL
      OR phone_snapshot ~ '^\+[1-9][0-9]{7,14}$'
    ),
  CONSTRAINT rent_communication_approvals_idempotency_unique
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_rent_communication_approvals_status_created
  ON public."RENT_communication_approvals" (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rent_communication_approvals_tenant_created
  ON public."RENT_communication_approvals" (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rent_communication_approvals_lease_trigger
  ON public."RENT_communication_approvals"
    (lease_id, trigger_type, generated_as_of_date DESC)
  WHERE lease_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rent_communication_approvals_scheduled
  ON public."RENT_communication_approvals" (not_before)
  WHERE status IN ('approved', 'scheduled');

-- Append-only enforcement for consent and global suppression audit history.
CREATE OR REPLACE FUNCTION public.rent_prevent_communication_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Communication audit events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS rent_consent_events_append_only
  ON public."RENT_communication_consent_events";
CREATE TRIGGER rent_consent_events_append_only
BEFORE UPDATE OR DELETE ON public."RENT_communication_consent_events"
FOR EACH ROW EXECUTE FUNCTION public.rent_prevent_communication_audit_mutation();

DROP TRIGGER IF EXISTS rent_suppression_events_append_only
  ON public."RENT_sms_phone_suppression_events";
CREATE TRIGGER rent_suppression_events_append_only
BEFORE UPDATE OR DELETE ON public."RENT_sms_phone_suppression_events"
FOR EACH ROW EXECUTE FUNCTION public.rent_prevent_communication_audit_mutation();

-- Atomically update one tenant preference and append its audit event.
CREATE OR REPLACE FUNCTION public.rent_record_communication_consent(
  p_tenant_id uuid,
  p_phone_number text,
  p_new_status text,
  p_source text,
  p_notes text DEFAULT NULL,
  p_recorded_by_auth_user_id uuid DEFAULT NULL,
  p_supporting_document_reference text DEFAULT NULL,
  p_tenant_timezone text DEFAULT 'America/New_York',
  p_provider_message_id text DEFAULT NULL
)
RETURNS public."RENT_communication_preferences"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prior_status text;
  v_preference public."RENT_communication_preferences"%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF p_new_status NOT IN ('unknown', 'opted_in', 'opted_out') THEN
    RAISE EXCEPTION 'Invalid consent status';
  END IF;
  IF p_phone_number !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'Phone must be exact E.164';
  END IF;

  SELECT sms_consent_status INTO v_prior_status
  FROM public."RENT_communication_preferences"
  WHERE tenant_id = p_tenant_id AND phone_number = p_phone_number
  FOR UPDATE;

  INSERT INTO public."RENT_communication_preferences" (
    tenant_id, phone_number, sms_consent_status, consent_recorded_at,
    consent_source, consent_notes, consent_recorded_by_auth_user_id,
    supporting_document_reference, tenant_timezone, opted_out_at,
    opted_in_at, updated_at
  )
  VALUES (
    p_tenant_id, p_phone_number, p_new_status, v_now, p_source, p_notes,
    p_recorded_by_auth_user_id, p_supporting_document_reference,
    coalesce(nullif(p_tenant_timezone, ''), 'America/New_York'),
    CASE WHEN p_new_status = 'opted_out' THEN v_now ELSE NULL END,
    CASE WHEN p_new_status = 'opted_in' THEN v_now ELSE NULL END,
    v_now
  )
  ON CONFLICT (tenant_id, phone_number) DO UPDATE SET
    sms_consent_status = EXCLUDED.sms_consent_status,
    consent_recorded_at = EXCLUDED.consent_recorded_at,
    consent_source = EXCLUDED.consent_source,
    consent_notes = EXCLUDED.consent_notes,
    consent_recorded_by_auth_user_id =
      EXCLUDED.consent_recorded_by_auth_user_id,
    supporting_document_reference =
      EXCLUDED.supporting_document_reference,
    tenant_timezone = EXCLUDED.tenant_timezone,
    opted_out_at = CASE
      WHEN EXCLUDED.sms_consent_status = 'opted_out' THEN v_now
      ELSE public."RENT_communication_preferences".opted_out_at
    END,
    opted_in_at = CASE
      WHEN EXCLUDED.sms_consent_status = 'opted_in' THEN v_now
      ELSE public."RENT_communication_preferences".opted_in_at
    END,
    updated_at = v_now
  RETURNING * INTO v_preference;

  INSERT INTO public."RENT_communication_consent_events" (
    tenant_id, preference_id, phone_number, prior_status, new_status,
    source, notes, recorded_by_auth_user_id, supporting_document_reference,
    provider_message_id
  )
  VALUES (
    p_tenant_id, v_preference.id, p_phone_number, v_prior_status,
    p_new_status, p_source, p_notes, p_recorded_by_auth_user_id,
    p_supporting_document_reference, p_provider_message_id
  );

  RETURN v_preference;
END;
$$;

-- Atomically set/clear global phone suppression and update every exact
-- preference. START restores opted_in only when prior opt-in evidence exists.
CREATE OR REPLACE FUNCTION public.rent_record_sms_phone_suppression(
  p_phone_number_e164 text,
  p_is_suppressed boolean,
  p_suppression_reason text,
  p_provider text,
  p_source_message_id text DEFAULT NULL
)
RETURNS public."RENT_sms_phone_suppressions"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_suppression public."RENT_sms_phone_suppressions"%ROWTYPE;
  v_pref public."RENT_communication_preferences"%ROWTYPE;
  v_restored_status text;
BEGIN
  IF p_phone_number_e164 !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'Phone must be exact E.164';
  END IF;

  PERFORM 1
  FROM public."RENT_sms_phone_suppressions"
  WHERE phone_number_e164 = p_phone_number_e164
  FOR UPDATE;

  INSERT INTO public."RENT_sms_phone_suppressions" (
    phone_number_e164, is_suppressed, suppression_reason,
    suppressed_at, resumed_at, provider, source_message_id, updated_at
  )
  VALUES (
    p_phone_number_e164, p_is_suppressed, p_suppression_reason,
    CASE WHEN p_is_suppressed THEN v_now ELSE NULL END,
    CASE WHEN p_is_suppressed THEN NULL ELSE v_now END,
    p_provider, p_source_message_id, v_now
  )
  ON CONFLICT (phone_number_e164) DO UPDATE SET
    is_suppressed = EXCLUDED.is_suppressed,
    suppression_reason = EXCLUDED.suppression_reason,
    suppressed_at = CASE
      WHEN EXCLUDED.is_suppressed THEN v_now
      ELSE public."RENT_sms_phone_suppressions".suppressed_at
    END,
    resumed_at = CASE
      WHEN EXCLUDED.is_suppressed THEN NULL
      ELSE v_now
    END,
    provider = EXCLUDED.provider,
    source_message_id = EXCLUDED.source_message_id,
    updated_at = v_now
  RETURNING * INTO v_suppression;

  INSERT INTO public."RENT_sms_phone_suppression_events" (
    phone_number_e164, event_type, suppression_reason,
    provider, source_message_id
  )
  VALUES (
    p_phone_number_e164,
    CASE WHEN p_is_suppressed THEN 'suppressed' ELSE 'resumed' END,
    p_suppression_reason, p_provider, p_source_message_id
  );

  FOR v_pref IN
    SELECT *
    FROM public."RENT_communication_preferences"
    WHERE phone_number = p_phone_number_e164
    FOR UPDATE
  LOOP
    IF p_is_suppressed THEN
      v_restored_status := 'opted_out';
    ELSE
      SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM public."RENT_communication_consent_events" e
        WHERE e.tenant_id = v_pref.tenant_id
          AND e.phone_number = p_phone_number_e164
          AND e.new_status = 'opted_in'
      ) THEN 'opted_in' ELSE 'unknown' END
      INTO v_restored_status;
    END IF;

    INSERT INTO public."RENT_communication_consent_events" (
      tenant_id, preference_id, phone_number, prior_status, new_status,
      source, provider_message_id
    )
    VALUES (
      v_pref.tenant_id, v_pref.id, p_phone_number_e164,
      v_pref.sms_consent_status, v_restored_status,
      CASE WHEN p_is_suppressed THEN 'inbound_stop' ELSE 'inbound_start' END,
      p_source_message_id
    );

    UPDATE public."RENT_communication_preferences"
    SET
      sms_consent_status = v_restored_status,
      consent_source =
        CASE WHEN p_is_suppressed THEN 'inbound_stop' ELSE 'inbound_start' END,
      consent_recorded_at = v_now,
      opted_out_at =
        CASE WHEN p_is_suppressed THEN v_now ELSE opted_out_at END,
      opted_in_at =
        CASE WHEN NOT p_is_suppressed AND v_restored_status = 'opted_in'
          THEN v_now ELSE opted_in_at END,
      updated_at = v_now
    WHERE id = v_pref.id;
  END LOOP;

  RETURN v_suppression;
END;
$$;

COMMENT ON TABLE public."RENT_communication_approvals" IS
  'Owner approval queue. Draft and scheduled-send crons never approve messages.';
COMMENT ON TABLE public."RENT_sms_phone_suppressions" IS
  'Global exact-E.164 suppression checked before every SMS provider submission.';
COMMENT ON TABLE public."RENT_communication_consent_events" IS
  'Append-only tenant consent history, including shared-phone STOP/START.';

-- No browser role receives direct table access. Authenticated server routes
-- switch to service_role only after app-user authorization. Verified provider
-- webhooks are the sole public exception.
ALTER TABLE public."RENT_communications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RENT_communication_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RENT_communication_consent_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RENT_sms_phone_suppressions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RENT_sms_phone_suppression_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RENT_communication_tenant_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RENT_communication_approvals" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."RENT_communications" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."RENT_communication_preferences" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."RENT_communication_consent_events" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."RENT_sms_phone_suppressions" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."RENT_sms_phone_suppression_events" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."RENT_communication_tenant_links" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."RENT_communication_approvals" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."RENT_communications" TO service_role;
GRANT ALL ON TABLE public."RENT_communication_preferences" TO service_role;
GRANT ALL ON TABLE public."RENT_communication_consent_events" TO service_role;
GRANT ALL ON TABLE public."RENT_sms_phone_suppressions" TO service_role;
GRANT ALL ON TABLE public."RENT_sms_phone_suppression_events" TO service_role;
GRANT ALL ON TABLE public."RENT_communication_tenant_links" TO service_role;
GRANT ALL ON TABLE public."RENT_communication_approvals" TO service_role;

REVOKE ALL ON FUNCTION public.rent_record_communication_consent(
  uuid, text, text, text, text, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rent_record_communication_consent(
  uuid, text, text, text, text, uuid, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.rent_record_sms_phone_suppression(
  text, boolean, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rent_record_sms_phone_suppression(
  text, boolean, text, text, text
) TO service_role;

-- NON-PRODUCTION ROLLBACK (destructive; review before use):
-- DROP FUNCTION public.rent_record_sms_phone_suppression(text,boolean,text,text,text);
-- DROP FUNCTION public.rent_record_communication_consent(uuid,text,text,text,text,uuid,text,text,text);
-- DROP TABLE public."RENT_communication_tenant_links";
-- DROP TABLE public."RENT_communication_approvals";
-- DROP TABLE public."RENT_sms_phone_suppression_events";
-- DROP TABLE public."RENT_sms_phone_suppressions";
-- DROP TABLE public."RENT_communication_consent_events";
-- DROP TABLE public."RENT_communication_preferences";
-- DROP TABLE public."RENT_communications";
