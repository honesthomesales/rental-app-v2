-- Transactional one-invoice correction.
-- Preserves invoice identity/dates, amount_paid, and all payment rows.

CREATE OR REPLACE FUNCTION public.rent_correct_single_invoice(
  p_invoice_id uuid,
  p_amount_rent numeric,
  p_amount_late numeric,
  p_amount_other numeric,
  p_business_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_rent numeric(12,2);
  v_late numeric(12,2);
  v_other numeric(12,2);
  v_eligible_paid numeric(12,2);
  v_total numeric(12,2);
  v_balance numeric(12,2);
  v_status text;
BEGIN
  IF p_invoice_id IS NULL OR p_business_date IS NULL THEN
    RAISE EXCEPTION 'invoice id and business date are required';
  END IF;
  IF p_amount_rent IS NULL OR p_amount_rent < 0
     OR p_amount_late IS NULL OR p_amount_late < 0
     OR p_amount_other IS NULL OR p_amount_other < 0 THEN
    RAISE EXCEPTION 'invoice amounts must be non-negative';
  END IF;

  SELECT
    i.id, i.lease_id, i.tenant_id, i.property_id,
    i.due_date, i.period_start, i.period_end,
    upper(coalesce(i.status, 'OPEN')) AS status,
    round(coalesce(i.amount_rent, 0)::numeric, 2) AS amount_rent,
    round(coalesce(i.amount_late, 0)::numeric, 2) AS amount_late,
    round(coalesce(i.amount_other, 0)::numeric, 2) AS amount_other,
    round(coalesce(i.amount_total, 0)::numeric, 2) AS amount_total,
    round(coalesce(i.amount_paid, 0)::numeric, 2) AS amount_paid,
    round(coalesce(i.balance_due, 0)::numeric, 2) AS balance_due
  INTO r
  FROM "RENT_invoices" i
  WHERE i.id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice % not found', p_invoice_id;
  END IF;
  IF r.status NOT IN ('OPEN', 'PARTIAL') THEN
    RAISE EXCEPTION 'only OPEN or PARTIAL invoices can be corrected';
  END IF;

  SELECT round(coalesce(sum(p.amount), 0)::numeric, 2)
    INTO v_eligible_paid
  FROM "RENT_payments" p
  WHERE p.invoice_id = p_invoice_id
    AND lower(coalesce(p.status, 'completed')) = 'completed'
    AND p.payment_date IS NOT NULL
    AND p.payment_date::date <= p_business_date;

  v_rent := round(p_amount_rent::numeric, 2);
  v_late := round(p_amount_late::numeric, 2);
  v_other := round(p_amount_other::numeric, 2);
  v_total := round(v_rent + v_late + v_other, 2);
  v_balance := round(greatest(0, v_total - v_eligible_paid), 2);
  v_status := CASE
    WHEN v_balance <= 0.009 THEN 'PAID'
    WHEN v_eligible_paid > 0.009 THEN 'PARTIAL'
    ELSE 'OPEN'
  END;

  UPDATE "RENT_invoices" i
  SET
    amount_rent = v_rent,
    amount_late = v_late,
    amount_other = v_other,
    amount_total = v_total,
    balance_due = v_balance,
    status = v_status,
    paid_in_full_at = CASE
      WHEN v_status = 'PAID' THEN coalesce(i.paid_in_full_at, now())
      ELSE NULL
    END
  WHERE i.id = p_invoice_id
    AND upper(coalesce(i.status, '')) IN ('OPEN', 'PARTIAL');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice changed concurrently and was not corrected';
  END IF;

  RETURN jsonb_build_object(
    'invoiceId', r.id,
    'leaseId', r.lease_id,
    'businessDate', p_business_date,
    'eligiblePaidAmount', v_eligible_paid,
    'before', jsonb_build_object(
      'amountRent', r.amount_rent,
      'amountLate', r.amount_late,
      'amountOther', r.amount_other,
      'amountTotal', r.amount_total,
      'amountPaid', r.amount_paid,
      'balanceDue', r.balance_due,
      'status', r.status
    ),
    'after', jsonb_build_object(
      'amountRent', v_rent,
      'amountLate', v_late,
      'amountOther', v_other,
      'amountTotal', v_total,
      'amountPaid', r.amount_paid,
      'balanceDue', v_balance,
      'status', v_status
    ),
    'preserved', jsonb_build_object(
      'invoiceId', r.id,
      'leaseId', r.lease_id,
      'tenantId', r.tenant_id,
      'propertyId', r.property_id,
      'dueDate', r.due_date,
      'periodStart', r.period_start,
      'periodEnd', r.period_end
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rent_correct_single_invoice(uuid, numeric, numeric, numeric, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rent_correct_single_invoice(uuid, numeric, numeric, numeric, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rent_correct_single_invoice(uuid, numeric, numeric, numeric, date) TO service_role;
