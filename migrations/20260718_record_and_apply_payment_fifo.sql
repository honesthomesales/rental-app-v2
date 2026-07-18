-- Record a payment and run the existing FIFO allocator in one Postgres transaction.
-- Any allocator error rolls back the payment insert.

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

  IF p_invoice_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "RENT_invoices" i
    WHERE i.id = p_invoice_id
      AND i.lease_id = p_lease_id
      AND i.tenant_id = p_tenant_id
      AND i.property_id = p_property_id
  ) THEN
    RAISE EXCEPTION 'Invoice does not belong to the supplied lease';
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
    p_invoice_id,
    p_payment_date,
    round(p_amount, 2),
    coalesce(nullif(p_payment_type, ''), 'Rent'),
    coalesce(nullif(p_payment_method, ''), 'Manual Entry'),
    'completed',
    coalesce(p_notes, '')
  )
  RETURNING * INTO v_payment;

  -- Dynamic SQL accommodates the live allocator's table/JSON return shape while
  -- retaining transaction rollback semantics if allocation raises an error.
  EXECUTE
    'SELECT coalesce(jsonb_agg(to_jsonb(a)), ''[]''::jsonb)
       FROM public.rent_apply_payment_fifo($1, $2) AS a'
    INTO v_allocations
    USING v_payment.id, p_payment_date;

  IF jsonb_array_length(v_allocations) = 1
     AND jsonb_typeof(v_allocations -> 0) = 'array' THEN
    v_allocations := v_allocations -> 0;
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
  'Atomically inserts one completed payment and invokes the existing FIFO allocator; allocator failure rolls back the insert.';
