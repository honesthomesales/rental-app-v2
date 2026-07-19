-- Fix rent_record_and_apply_payment_fifo for the live schema.
--
-- Root cause: the previous function called public.rent_apply_payment_fifo(uuid, timestamptz),
-- which does not exist. Production allocates via RENT_payments.invoice_id and DB triggers
-- that recalculate RENT_invoices.amount_paid / balance_due.
--
-- This replacement:
--   1. Inserts the payment
--   2. Uses the supplied invoice_id when present
--   3. Otherwise links to the oldest OPEN/PARTIAL invoice with balance_due > 0 (FIFO)
--   4. Relies on existing payment triggers to update invoice totals
--   5. Does not reference RENT_payment_allocations or V_periods_outstanding
--
-- No late-fee backfill. No overlap cleanup. No invoice void/delete.

CREATE OR REPLACE FUNCTION public.rent_record_and_apply_payment_fifo(
  p_tenant_id uuid,
  p_lease_id uuid,
  p_property_id uuid,
  p_payment_date timestamptz,
  p_amount numeric,
  p_payment_type text DEFAULT 'Rent',
  p_payment_method text DEFAULT 'Manual Entry',
  p_notes text DEFAULT '',
  p_invoice_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment "RENT_payments"%ROWTYPE;
  v_invoice_id uuid := p_invoice_id;
  v_allocations jsonb := '[]'::jsonb;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "RENT_leases" l
    WHERE l.id = p_lease_id
      AND l.tenant_id = p_tenant_id
      AND l.property_id = p_property_id
  ) THEN
    RAISE EXCEPTION 'Lease, tenant, and property do not match';
  END IF;

  IF v_invoice_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "RENT_invoices" i
    WHERE i.id = v_invoice_id
      AND i.lease_id = p_lease_id
      AND i.tenant_id = p_tenant_id
      AND i.property_id = p_property_id
  ) THEN
    RAISE EXCEPTION 'Invoice does not belong to the supplied lease';
  END IF;

  -- FIFO fallback when the client does not target a specific invoice.
  IF v_invoice_id IS NULL THEN
    SELECT i.id
      INTO v_invoice_id
    FROM "RENT_invoices" i
    WHERE i.lease_id = p_lease_id
      AND upper(coalesce(i.status, '')) IN ('OPEN', 'PARTIAL')
      AND coalesce(i.balance_due, 0) > 0
    ORDER BY i.due_date ASC NULLS LAST, i.created_at ASC NULLS LAST, i.id ASC
    LIMIT 1;
  END IF;

  INSERT INTO "RENT_payments" (
    tenant_id,
    lease_id,
    property_id,
    invoice_id,
    payment_date,
    amount,
    payment_type,
    payment_method,
    status,
    notes
  )
  VALUES (
    p_tenant_id,
    p_lease_id,
    p_property_id,
    v_invoice_id,
    p_payment_date,
    round(p_amount, 2),
    coalesce(nullif(p_payment_type, ''), 'Rent'),
    coalesce(nullif(p_payment_method, ''), 'Manual Entry'),
    'completed',
    coalesce(p_notes, '')
  )
  RETURNING * INTO v_payment;

  IF v_invoice_id IS NOT NULL THEN
    v_allocations := jsonb_build_array(
      jsonb_build_object(
        'payment_id', v_payment.id,
        'invoice_id', v_invoice_id,
        'amount', round(p_amount, 2)
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'payment', to_jsonb(v_payment),
    'allocations', v_allocations
  );
END;
$$;

COMMENT ON FUNCTION public.rent_record_and_apply_payment_fifo(
  uuid, uuid, uuid, timestamptz, numeric, text, text, text, uuid
) IS
  'Inserts one completed payment linked to a target or oldest unpaid invoice; invoice totals are updated by existing payment triggers.';

REVOKE ALL ON FUNCTION public.rent_record_and_apply_payment_fifo(
  uuid, uuid, uuid, timestamptz, numeric, text, text, text, uuid
) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.rent_record_and_apply_payment_fifo(
  uuid, uuid, uuid, timestamptz, numeric, text, text, text, uuid
) TO service_role;
