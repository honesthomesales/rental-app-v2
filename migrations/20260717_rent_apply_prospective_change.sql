-- =====================================================
-- Prospective rent change — atomic lease + invoice apply
-- =====================================================
-- Updates RENT_leases.rent and eligible OPEN/PARTIAL invoices
-- with due_date >= effective_date in ONE transaction.
-- Never touches PAID/VOID or historical (due_date < effective) invoices.
-- Never deletes invoices or payments.
-- Eligible paid amount = sum of completed RENT_payments linked by
-- invoice_id with payment_date <= business_date.
-- =====================================================

-- Optional persistence for schedule fill after a rent change
ALTER TABLE "RENT_leases"
  ADD COLUMN IF NOT EXISTS rent_effective_date date;

ALTER TABLE "RENT_leases"
  ADD COLUMN IF NOT EXISTS prior_rent numeric(10,2);

COMMENT ON COLUMN "RENT_leases".rent_effective_date IS
  'NY calendar date when current lease.rent became effective for invoice billing';
COMMENT ON COLUMN "RENT_leases".prior_rent IS
  'Lease rent amount before the most recent prospective rent change';

CREATE OR REPLACE FUNCTION public.rent_apply_prospective_change(
  p_lease_id uuid,
  p_new_rent numeric,
  p_effective_date date,
  p_business_date date DEFAULT ((timezone('America/New_York', now()))::date)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_rent numeric(10,2);
  v_new_rent numeric(10,2);
  v_examined int := 0;
  v_updated int := 0;
  v_skipped_historical int := 0;
  v_skipped_paid int := 0;
  v_skipped_void int := 0;
  v_skipped_other int := 0;
  v_before_total numeric(12,2) := 0;
  v_after_total numeric(12,2) := 0;
  v_before_balance numeric(12,2) := 0;
  v_after_balance numeric(12,2) := 0;
  r record;
  v_paid numeric(12,2);
  v_late numeric(12,2);
  v_other numeric(12,2);
  v_new_total numeric(12,2);
  v_new_balance numeric(12,2);
  v_new_status text;
  v_patches jsonb := '[]'::jsonb;
BEGIN
  IF p_lease_id IS NULL THEN
    RAISE EXCEPTION 'lease id required';
  END IF;
  IF p_new_rent IS NULL OR p_new_rent < 0 THEN
    RAISE EXCEPTION 'new rent must be a non-negative number';
  END IF;
  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'effective date required';
  END IF;
  IF p_business_date IS NULL THEN
    RAISE EXCEPTION 'business date required';
  END IF;

  v_new_rent := round(p_new_rent::numeric, 2);

  SELECT round(l.rent::numeric, 2)
    INTO v_old_rent
  FROM "RENT_leases" l
  WHERE l.id = p_lease_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lease % not found', p_lease_id;
  END IF;

  -- Persist lease rent + effective metadata
  UPDATE "RENT_leases" l
  SET
    rent = v_new_rent,
    prior_rent = CASE
      WHEN v_old_rent IS DISTINCT FROM v_new_rent THEN v_old_rent
      ELSE l.prior_rent
    END,
    rent_effective_date = CASE
      WHEN v_old_rent IS DISTINCT FROM v_new_rent THEN p_effective_date
      ELSE COALESCE(l.rent_effective_date, p_effective_date)
    END,
    updated_at = now()
  WHERE l.id = p_lease_id;

  FOR r IN
    SELECT
      i.id,
      i.due_date,
      upper(coalesce(i.status, 'OPEN')) AS status,
      round(coalesce(i.amount_rent, 0)::numeric, 2) AS amount_rent,
      round(coalesce(i.amount_late, 0)::numeric, 2) AS amount_late,
      round(coalesce(i.amount_other, 0)::numeric, 2) AS amount_other,
      round(coalesce(i.amount_total, 0)::numeric, 2) AS amount_total,
      round(coalesce(i.amount_paid, 0)::numeric, 2) AS amount_paid_stored,
      round(coalesce(i.balance_due, 0)::numeric, 2) AS balance_due
    FROM "RENT_invoices" i
    WHERE i.lease_id = p_lease_id
    ORDER BY i.due_date
    FOR UPDATE OF i
  LOOP
    v_examined := v_examined + 1;

    IF r.status = 'PAID' THEN
      v_skipped_paid := v_skipped_paid + 1;
      CONTINUE;
    ELSIF r.status = 'VOID' THEN
      v_skipped_void := v_skipped_void + 1;
      CONTINUE;
    ELSIF r.status NOT IN ('OPEN', 'PARTIAL') THEN
      v_skipped_other := v_skipped_other + 1;
      CONTINUE;
    ELSIF r.due_date < p_effective_date THEN
      v_skipped_historical := v_skipped_historical + 1;
      CONTINUE;
    END IF;

    -- Eligible paid through business date (direct invoice_id links)
    SELECT round(coalesce(sum(p.amount), 0)::numeric, 2)
      INTO v_paid
    FROM "RENT_payments" p
    WHERE p.invoice_id = r.id
      AND lower(coalesce(p.status, 'completed')) = 'completed'
      AND p.payment_date IS NOT NULL
      AND p.payment_date::date <= p_business_date;

    v_late := r.amount_late;
    v_other := r.amount_other;
    v_new_total := round(v_new_rent + v_late + v_other, 2);
    v_new_balance := round(greatest(0, v_new_total - v_paid), 2);

    IF v_new_balance <= 0.009 THEN
      v_new_status := 'PAID';
    ELSIF v_paid > 0.009 THEN
      v_new_status := 'PARTIAL';
    ELSE
      v_new_status := 'OPEN';
    END IF;

    v_before_total := v_before_total + r.amount_total;
    v_after_total := v_after_total + v_new_total;
    v_before_balance := v_before_balance + r.balance_due;
    v_after_balance := v_after_balance + v_new_balance;

    UPDATE "RENT_invoices" i
    SET
      amount_rent = v_new_rent,
      amount_total = v_new_total,
      amount_paid = v_paid,
      balance_due = v_new_balance,
      status = v_new_status,
      paid_in_full_at = CASE
        WHEN v_new_status = 'PAID' THEN coalesce(i.paid_in_full_at, now())
        ELSE NULL
      END,
      updated_at = now()
    WHERE i.id = r.id
      AND upper(coalesce(i.status, '')) IN ('OPEN', 'PARTIAL');

    IF FOUND THEN
      v_updated := v_updated + 1;
      v_patches := v_patches || jsonb_build_array(
        jsonb_build_object(
          'id', r.id,
          'due_date', r.due_date,
          'previous_amount_rent', r.amount_rent,
          'new_amount_rent', v_new_rent,
          'previous_amount_total', r.amount_total,
          'new_amount_total', v_new_total,
          'previous_balance_due', r.balance_due,
          'new_balance_due', v_new_balance,
          'amount_paid', v_paid,
          'previous_status', r.status,
          'new_status', v_new_status
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'leaseId', p_lease_id,
    'oldRent', v_old_rent,
    'newRent', v_new_rent,
    'effectiveDate', p_effective_date,
    'businessDate', p_business_date,
    'invoicesExamined', v_examined,
    'invoicesUpdated', v_updated,
    'invoicesSkippedHistorical', v_skipped_historical,
    'invoicesSkippedPaid', v_skipped_paid,
    'invoicesSkippedVoid', v_skipped_void,
    'invoicesSkippedOther', v_skipped_other,
    'beforeInvoiceTotal', round(v_before_total, 2),
    'afterInvoiceTotal', round(v_after_total, 2),
    'beforeBalanceTotal', round(v_before_balance, 2),
    'afterBalanceTotal', round(v_after_balance, 2),
    'totalBalanceChange', round(v_after_balance - v_before_balance, 2),
    'patches', v_patches
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rent_apply_prospective_change(uuid, numeric, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rent_apply_prospective_change(uuid, numeric, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rent_apply_prospective_change(uuid, numeric, date, date) TO service_role;

COMMENT ON FUNCTION public.rent_apply_prospective_change(uuid, numeric, date, date) IS
  'Atomically apply prospective lease rent change and rewrite eligible OPEN/PARTIAL invoices due on/after effective date. Uses invoice_id-linked completed payments through business date for amount_paid.';
