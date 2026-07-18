-- Corrected idempotent late-fee reconciliation.
-- Installation performs no reconciliation and no invoice writes.
-- Fixed grace rule: business_date >= due_date + 6 days.
-- Defaults: weekly $10, biweekly $25, monthly $45.

ALTER TABLE "RENT_invoices"
  ADD COLUMN IF NOT EXISTS late_fee_waived boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.rent_reconcile_late_fees(
  p_business_date date,
  p_invoice_ids uuid[] DEFAULT NULL,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_examined int := 0;
  v_applied int := 0;
  v_skipped int := 0;
  v_fee_total numeric(12,2) := 0;
  r record;
  v_fee numeric(10,2);
  v_cadence text;
  v_paid numeric(12,2);
  v_total numeric(12,2);
  v_balance numeric(12,2);
  v_new_total numeric(12,2);
  v_new_balance numeric(12,2);
  v_new_status text;
  v_rows jsonb := '[]'::jsonb;
  v_reason text;
BEGIN
  IF p_business_date IS NULL THEN
    RAISE EXCEPTION 'business date required';
  END IF;

  FOR r IN
    SELECT
      i.id AS invoice_id,
      i.lease_id,
      i.due_date,
      upper(coalesce(i.status, 'OPEN')) AS status,
      round(coalesce(i.amount_rent, 0)::numeric, 2) AS amount_rent,
      round(coalesce(i.amount_late, 0)::numeric, 2) AS amount_late,
      round(coalesce(i.amount_other, 0)::numeric, 2) AS amount_other,
      coalesce(i.late_fee_waived, false) AS late_fee_waived,
      lower(coalesce(l.status, '')) AS lease_status,
      lower(coalesce(l.rent_cadence, 'monthly')) AS rent_cadence,
      l.late_fee_amount,
      l.property_id,
      l.tenant_id
    FROM "RENT_invoices" i
    JOIN "RENT_leases" l ON l.id = i.lease_id
    WHERE (p_invoice_ids IS NULL OR i.id = ANY (p_invoice_ids))
      AND lower(coalesce(l.status, '')) IN ('occupied', 'eviction')
    ORDER BY i.due_date, i.id
    FOR UPDATE OF i
  LOOP
    v_examined := v_examined + 1;
    v_reason := NULL;

    IF r.status = 'VOID' THEN
      v_reason := 'void';
    ELSIF r.status = 'PAID' THEN
      v_reason := 'paid_status';
    ELSIF r.status NOT IN ('OPEN', 'PARTIAL') THEN
      v_reason := 'status_not_eligible';
    ELSIF r.late_fee_waived THEN
      v_reason := 'waived';
    ELSIF r.amount_late > 0.009 THEN
      v_reason := 'already_billed';
    ELSIF p_business_date < (r.due_date + 6) THEN
      v_reason := 'within_grace';
    END IF;

    IF v_reason IS NULL THEN
      SELECT round(coalesce(sum(p.amount), 0)::numeric, 2)
        INTO v_paid
      FROM "RENT_payments" p
      WHERE p.invoice_id = r.invoice_id
        AND lower(coalesce(p.status, 'completed')) = 'completed'
        AND p.payment_date IS NOT NULL
        AND p.payment_date::date <= p_business_date;

      v_total := round(r.amount_rent + r.amount_late + r.amount_other, 2);
      v_balance := round(greatest(0, v_total - v_paid), 2);

      IF v_balance <= 0.009 THEN
        v_reason := 'fully_paid_as_of_business_date';
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      v_rows := v_rows || jsonb_build_array(
        jsonb_build_object(
          'invoiceId', r.invoice_id,
          'leaseId', r.lease_id,
          'dueDate', r.due_date,
          'status', r.status,
          'eligible', false,
          'reasonSkipped', v_reason,
          'existingLateFee', r.amount_late,
          'waived', r.late_fee_waived
        )
      );
      CONTINUE;
    END IF;

    IF r.late_fee_amount IS NOT NULL AND r.late_fee_amount > 0 THEN
      v_fee := round(r.late_fee_amount::numeric, 2);
    ELSE
      v_cadence := r.rent_cadence;
      IF v_cadence LIKE '%week%' AND v_cadence LIKE '%bi%' THEN
        v_fee := 25;
      ELSIF v_cadence LIKE '%week%' THEN
        v_fee := 10;
      ELSE
        v_fee := 45;
      END IF;
    END IF;

    v_new_total := round(r.amount_rent + v_fee + r.amount_other, 2);
    v_new_balance := round(greatest(0, v_new_total - v_paid), 2);
    IF v_new_balance <= 0.009 THEN
      v_new_status := 'PAID';
    ELSIF v_paid > 0.009 THEN
      v_new_status := 'PARTIAL';
    ELSE
      v_new_status := 'OPEN';
    END IF;

    IF NOT p_dry_run THEN
      UPDATE "RENT_invoices" i
      SET
        amount_late = v_fee,
        amount_total = v_new_total,
        balance_due = v_new_balance,
        status = v_new_status,
        paid_in_full_at = CASE
          WHEN v_new_status = 'PAID' THEN coalesce(i.paid_in_full_at, now())
          ELSE NULL
        END
      WHERE i.id = r.invoice_id
        AND i.lease_id = r.lease_id
        AND p_business_date >= (i.due_date + 6)
        AND coalesce(i.late_fee_waived, false) = false
        AND round(coalesce(i.amount_late, 0)::numeric, 2) <= 0.009
        AND upper(coalesce(i.status, '')) IN ('OPEN', 'PARTIAL');

      IF NOT FOUND THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
    END IF;

    v_applied := v_applied + 1;
    v_fee_total := v_fee_total + v_fee;
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object(
        'invoiceId', r.invoice_id,
        'leaseId', r.lease_id,
        'propertyId', r.property_id,
        'tenantId', r.tenant_id,
        'dueDate', r.due_date,
        'status', r.status,
        'eligible', true,
        'proposedLateFee', v_fee,
        'existingLateFee', r.amount_late,
        'currentTotal', v_total,
        'resultingTotal', v_new_total,
        'eligiblePaidAmount', v_paid,
        'previousBalance', v_balance,
        'resultingBalance', v_new_balance,
        'applied', NOT p_dry_run
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'businessDate', p_business_date,
    'dryRun', p_dry_run,
    'examined', v_examined,
    'applied', v_applied,
    'skipped', v_skipped,
    'feeTotal', round(v_fee_total, 2),
    'rows', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rent_reconcile_late_fees(date, uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rent_reconcile_late_fees(date, uuid[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rent_reconcile_late_fees(date, uuid[], boolean) TO service_role;

COMMENT ON FUNCTION public.rent_reconcile_late_fees(date, uuid[], boolean) IS
  'Transactional idempotent late-fee preview/apply. Five full grace days; eligible on due+6. Installation does not invoke the function.';
