-- Cadence-safe invoice creation, overlap-safe late fees, and transactional waiver.
-- Installation performs no invoice, payment, waiver, VOID, or late-fee backfill writes.

ALTER TABLE "RENT_leases"
  ADD COLUMN IF NOT EXISTS cadence_effective_date date;

ALTER TABLE "RENT_leases"
  ADD COLUMN IF NOT EXISTS prior_rent_cadence varchar(20);

ALTER TABLE "RENT_invoices"
  ADD COLUMN IF NOT EXISTS rent_cadence varchar(20);

COMMENT ON COLUMN "RENT_leases".cadence_effective_date IS
  'First due date generated under the current rent_cadence';
COMMENT ON COLUMN "RENT_leases".prior_rent_cadence IS
  'Cadence immediately preceding the current rent_cadence';
COMMENT ON COLUMN "RENT_invoices".rent_cadence IS
  'Cadence snapshot for this invoice period; legacy rows may be inferred from period length';

CREATE OR REPLACE FUNCTION public.rent_create_invoice_if_period_available(
  p_lease_id uuid,
  p_due_date date,
  p_period_start date,
  p_period_end date,
  p_rent_cadence text,
  p_amount_rent numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease "RENT_leases"%ROWTYPE;
  v_invoice_id uuid;
  v_conflicts uuid[];
  v_cadence text;
  v_expected_days int;
BEGIN
  IF p_lease_id IS NULL OR p_due_date IS NULL
     OR p_period_start IS NULL OR p_period_end IS NULL THEN
    RAISE EXCEPTION 'lease, due date, and period dates are required';
  END IF;
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'period end must be on or after period start';
  END IF;
  IF p_amount_rent IS NULL OR p_amount_rent < 0 THEN
    RAISE EXCEPTION 'rent must be a non-negative amount';
  END IF;

  v_cadence := CASE
    WHEN lower(coalesce(p_rent_cadence, '')) LIKE '%bi%week%' THEN 'biweekly'
    WHEN lower(coalesce(p_rent_cadence, '')) LIKE '%week%' THEN 'weekly'
    ELSE 'monthly'
  END;
  v_expected_days := CASE
    WHEN v_cadence = 'weekly' THEN 7
    WHEN v_cadence = 'biweekly' THEN 14
    ELSE NULL
  END;
  IF v_expected_days IS NOT NULL
     AND (p_period_end - p_period_start + 1) <> v_expected_days THEN
    RAISE EXCEPTION '% period must be % days', v_cadence, v_expected_days;
  END IF;
  IF v_cadence = 'monthly'
     AND (
       extract(day from p_period_start) <> 1
       OR p_period_end <> (date_trunc('month', p_period_start)::date
                            + interval '1 month - 1 day')::date
     ) THEN
    RAISE EXCEPTION 'monthly period must span one calendar month';
  END IF;

  SELECT *
    INTO v_lease
  FROM "RENT_leases" l
  WHERE l.id = p_lease_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lease % not found', p_lease_id;
  END IF;
  IF lower(coalesce(v_lease.status, '')) NOT IN ('occupied', 'eviction') THEN
    RAISE EXCEPTION 'lease % is not active for billing', p_lease_id;
  END IF;
  IF p_due_date < p_period_start OR p_due_date > p_period_end THEN
    RAISE EXCEPTION 'due date must be inside the invoice period';
  END IF;

  SELECT i.id
    INTO v_invoice_id
  FROM "RENT_invoices" i
  WHERE i.lease_id = p_lease_id
    AND upper(coalesce(i.status, '')) <> 'VOID'
    AND (
      i.due_date = p_due_date
      OR (
        i.period_start = p_period_start
        AND i.period_end = p_period_end
      )
    )
  ORDER BY i.due_date, i.id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'created', false,
      'reason', 'already_exists',
      'invoiceId', v_invoice_id,
      'dueDate', p_due_date,
      'periodStart', p_period_start,
      'periodEnd', p_period_end
    );
  END IF;

  SELECT array_agg(i.id ORDER BY i.due_date, i.id)
    INTO v_conflicts
  FROM "RENT_invoices" i
  WHERE i.lease_id = p_lease_id
    AND upper(coalesce(i.status, '')) <> 'VOID'
    AND i.period_start IS NOT NULL
    AND i.period_end IS NOT NULL
    AND i.period_start <= p_period_end
    AND p_period_start <= i.period_end;

  IF coalesce(array_length(v_conflicts, 1), 0) > 0 THEN
    RETURN jsonb_build_object(
      'created', false,
      'reason', 'period_overlap',
      'conflictingInvoiceIds', to_jsonb(v_conflicts),
      'dueDate', p_due_date,
      'periodStart', p_period_start,
      'periodEnd', p_period_end
    );
  END IF;

  INSERT INTO "RENT_invoices" (
    lease_id,
    property_id,
    tenant_id,
    due_date,
    period_start,
    period_end,
    rent_cadence,
    amount_rent,
    amount_late,
    amount_other,
    amount_total,
    amount_paid,
    balance_due,
    status
  )
  VALUES (
    v_lease.id,
    v_lease.property_id,
    v_lease.tenant_id,
    p_due_date,
    p_period_start,
    p_period_end,
    v_cadence,
    round(p_amount_rent, 2),
    0,
    0,
    round(p_amount_rent, 2),
    0,
    round(p_amount_rent, 2),
    'OPEN'
  )
  RETURNING id INTO v_invoice_id;

  RETURN jsonb_build_object(
    'created', true,
    'invoiceId', v_invoice_id,
    'dueDate', p_due_date,
    'periodStart', p_period_start,
    'periodEnd', p_period_end,
    'cadence', v_cadence
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rent_waive_late_fee(
  p_invoice_id uuid,
  p_business_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_paid numeric(12,2);
  v_total numeric(12,2);
  v_balance numeric(12,2);
  v_status text;
BEGIN
  IF p_invoice_id IS NULL OR p_business_date IS NULL THEN
    RAISE EXCEPTION 'invoice id and business date are required';
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
    round(coalesce(i.balance_due, 0)::numeric, 2) AS balance_due,
    coalesce(i.late_fee_waived, false) AS late_fee_waived
  INTO r
  FROM "RENT_invoices" i
  WHERE i.id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice % not found', p_invoice_id;
  END IF;
  IF r.status NOT IN ('OPEN', 'PARTIAL') THEN
    RAISE EXCEPTION 'PAID and VOID invoices are read-only';
  END IF;
  IF r.amount_late <= 0.009 THEN
    RAISE EXCEPTION 'invoice has no late fee to waive';
  END IF;

  SELECT round(coalesce(sum(p.amount), 0)::numeric, 2)
    INTO v_paid
  FROM "RENT_payments" p
  WHERE p.invoice_id = p_invoice_id
    AND lower(coalesce(p.status, 'completed')) = 'completed'
    AND p.payment_date IS NOT NULL
    AND p.payment_date::date <= p_business_date;

  v_total := round(r.amount_rent + r.amount_other, 2);
  v_balance := round(greatest(0, v_total - v_paid), 2);
  v_status := CASE
    WHEN v_balance <= 0.009 THEN 'PAID'
    WHEN v_paid > 0.009 THEN 'PARTIAL'
    ELSE 'OPEN'
  END;

  UPDATE "RENT_invoices" i
  SET
    amount_late = 0,
    late_fee_waived = true,
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
    RAISE EXCEPTION 'invoice changed concurrently and was not waived';
  END IF;

  RETURN jsonb_build_object(
    'invoiceId', r.id,
    'leaseId', r.lease_id,
    'businessDate', p_business_date,
    'eligiblePaidAmount', v_paid,
    'before', jsonb_build_object(
      'amountRent', r.amount_rent,
      'amountLate', r.amount_late,
      'amountOther', r.amount_other,
      'amountTotal', r.amount_total,
      'amountPaid', r.amount_paid,
      'balanceDue', r.balance_due,
      'status', r.status,
      'lateFeeWaived', r.late_fee_waived
    ),
    'after', jsonb_build_object(
      'amountRent', r.amount_rent,
      'amountLate', 0,
      'amountOther', r.amount_other,
      'amountTotal', v_total,
      'amountPaid', r.amount_paid,
      'balanceDue', v_balance,
      'status', v_status,
      'lateFeeWaived', true
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
      i.period_start,
      i.period_end,
      upper(coalesce(i.status, 'OPEN')) AS status,
      round(coalesce(i.amount_rent, 0)::numeric, 2) AS amount_rent,
      round(coalesce(i.amount_late, 0)::numeric, 2) AS amount_late,
      round(coalesce(i.amount_other, 0)::numeric, 2) AS amount_other,
      coalesce(i.late_fee_waived, false) AS late_fee_waived,
      lower(coalesce(l.status, '')) AS lease_status,
      coalesce(
        nullif(lower(i.rent_cadence), ''),
        CASE
          WHEN i.period_start IS NOT NULL AND i.period_end IS NOT NULL
               AND (i.period_end - i.period_start + 1) = 7 THEN 'weekly'
          WHEN i.period_start IS NOT NULL AND i.period_end IS NOT NULL
               AND (i.period_end - i.period_start + 1) = 14 THEN 'biweekly'
          ELSE lower(coalesce(l.rent_cadence, 'monthly'))
        END
      ) AS invoice_cadence,
      l.late_fee_amount,
      l.property_id,
      l.tenant_id,
      (
      EXISTS (
        SELECT 1
        FROM "RENT_invoices" x
        WHERE x.lease_id = i.lease_id
          AND x.id <> i.id
          AND upper(coalesce(x.status, '')) <> 'VOID'
          AND (
            x.due_date = i.due_date
            OR (
              i.period_start IS NOT NULL
              AND i.period_end IS NOT NULL
              AND x.period_start IS NOT NULL
              AND x.period_end IS NOT NULL
              AND x.period_start <= i.period_end
              AND i.period_start <= x.period_end
            )
          )
      )
      OR (
        i.due_date >= coalesce(l.cadence_effective_date, '-infinity'::date)
        AND CASE
          WHEN lower(coalesce(l.rent_cadence, 'monthly')) LIKE '%bi%week%'
            THEN coalesce(i.period_end - i.period_start + 1, 0) <> 14
          WHEN lower(coalesce(l.rent_cadence, 'monthly')) LIKE '%week%'
            THEN coalesce(i.period_end - i.period_start + 1, 0) <> 7
          ELSE NOT (
            i.period_start IS NOT NULL
            AND i.period_end IS NOT NULL
            AND extract(day from i.period_start) = 1
            AND i.period_end = (
              date_trunc('month', i.period_start)::date
              + interval '1 month - 1 day'
            )::date
          )
        END
      )
      ) AS cadence_exception
    FROM "RENT_invoices" i
    JOIN "RENT_leases" l ON l.id = i.lease_id
    WHERE (p_invoice_ids IS NULL OR i.id = ANY (p_invoice_ids))
      AND lower(coalesce(l.status, '')) IN ('occupied', 'eviction')
      AND i.due_date <= p_business_date
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
    ELSIF r.cadence_exception THEN
      v_reason := 'cadence_exception';
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
    ELSIF r.invoice_cadence LIKE '%bi%week%' THEN
      v_fee := 25;
    ELSIF r.invoice_cadence LIKE '%week%' THEN
      v_fee := 10;
    ELSE
      v_fee := 45;
    END IF;

    v_new_total := round(r.amount_rent + v_fee + r.amount_other, 2);
    v_new_balance := round(greatest(0, v_new_total - v_paid), 2);
    v_new_status := CASE
      WHEN v_new_balance <= 0.009 THEN 'PAID'
      WHEN v_paid > 0.009 THEN 'PARTIAL'
      ELSE 'OPEN'
    END;

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
        AND upper(coalesce(i.status, '')) IN ('OPEN', 'PARTIAL')
        AND NOT EXISTS (
          SELECT 1
          FROM "RENT_invoices" x
          WHERE x.lease_id = i.lease_id
            AND x.id <> i.id
            AND upper(coalesce(x.status, '')) <> 'VOID'
            AND (
              x.due_date = i.due_date
              OR (
                i.period_start IS NOT NULL
                AND i.period_end IS NOT NULL
                AND x.period_start IS NOT NULL
                AND x.period_end IS NOT NULL
                AND x.period_start <= i.period_end
                AND i.period_start <= x.period_end
              )
            )
        )
        AND EXISTS (
          SELECT 1
          FROM "RENT_leases" cadence_lease
          WHERE cadence_lease.id = i.lease_id
            AND (
              i.due_date < coalesce(
                cadence_lease.cadence_effective_date,
                '-infinity'::date
              )
              OR CASE
                WHEN lower(coalesce(cadence_lease.rent_cadence, 'monthly'))
                     LIKE '%bi%week%'
                  THEN coalesce(i.period_end - i.period_start + 1, 0) = 14
                WHEN lower(coalesce(cadence_lease.rent_cadence, 'monthly'))
                     LIKE '%week%'
                  THEN coalesce(i.period_end - i.period_start + 1, 0) = 7
                ELSE (
                  i.period_start IS NOT NULL
                  AND i.period_end IS NOT NULL
                  AND extract(day from i.period_start) = 1
                  AND i.period_end = (
                    date_trunc('month', i.period_start)::date
                    + interval '1 month - 1 day'
                  )::date
                )
              END
            )
        );

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
        'cadence', r.invoice_cadence,
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

REVOKE ALL ON FUNCTION public.rent_create_invoice_if_period_available(
  uuid, date, date, date, text, numeric
) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.rent_create_invoice_if_period_available(
  uuid, date, date, date, text, numeric
) TO service_role;

REVOKE ALL ON FUNCTION public.rent_waive_late_fee(uuid, date)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.rent_waive_late_fee(uuid, date)
  TO service_role;

REVOKE ALL ON FUNCTION public.rent_reconcile_late_fees(date, uuid[], boolean)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.rent_reconcile_late_fees(date, uuid[], boolean)
  TO service_role;

COMMENT ON FUNCTION public.rent_create_invoice_if_period_available(
  uuid, date, date, date, text, numeric
) IS
  'Creates at most one non-overlapping invoice period under a lease row lock.';
COMMENT ON FUNCTION public.rent_waive_late_fee(uuid, date) IS
  'Transactionally waives one OPEN/PARTIAL invoice late fee and preserves payments and identity.';
COMMENT ON FUNCTION public.rent_reconcile_late_fees(date, uuid[], boolean) IS
  'Transactional idempotent late-fee preview/apply; skips every duplicate or overlapping invoice.';
