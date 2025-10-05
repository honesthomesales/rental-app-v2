-- Database setup for batched period-invoice mapping system
-- Run these commands in your Supabase SQL editor

-- 1. First, let's check what columns exist in the current view
-- SELECT column_name, data_type 
-- FROM information_schema.columns 
-- WHERE table_name = 'RENT_period_invoice_map_v' 
-- ORDER BY ordinal_position;

-- 2. Create or replace the RENT_period_invoice_map_many RPC function
CREATE OR REPLACE FUNCTION "RENT_period_invoice_map_many"(
  lease_ids uuid[],
  from_date date,
  to_date date
)
RETURNS TABLE (
  lease_id uuid,
  property_id uuid,
  tenant_id uuid,
  cadence text,
  period_start date,
  period_end date,
  due_date date,
  invoice_id uuid,
  billed_total numeric,
  paid_to_rent numeric,
  paid_to_late numeric,
  balance_due numeric,
  is_missing_invoice boolean
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH lease_data AS (
    SELECT 
      l.id as lease_id,
      l.property_id,
      l.tenant_id,
      l.rent_cadence as cadence,
      l.rent_due_day,
      l.grace_days,
      l.lease_start_date,
      l.lease_end_date
    FROM "RENT_leases" l
    WHERE l.id = ANY(lease_ids)
  ),
  period_data AS (
    SELECT 
      ld.*,
      p.period_start,
      p.period_end,
      p.due_date,
      p.is_active
    FROM lease_data ld
    CROSS JOIN LATERAL (
      SELECT 
        CASE 
          WHEN ld.cadence = 'Weekly' THEN 
            generate_series(
              GREATEST(ld.lease_start_date, from_date)::date,
              LEAST(COALESCE(ld.lease_end_date, to_date), to_date)::date,
              '1 week'::interval
            )::date
          WHEN ld.cadence = 'Biweekly' THEN 
            generate_series(
              GREATEST(ld.lease_start_date, from_date)::date,
              LEAST(COALESCE(ld.lease_end_date, to_date), to_date)::date,
              '2 weeks'::interval
            )::date
          WHEN ld.cadence = 'Monthly' THEN 
            generate_series(
              GREATEST(ld.lease_start_date, from_date)::date,
              LEAST(COALESCE(ld.lease_end_date, to_date), to_date)::date,
              '1 month'::interval
            )::date
        END as period_start,
        CASE 
          WHEN ld.cadence = 'Weekly' THEN 
            generate_series(
              GREATEST(ld.lease_start_date, from_date)::date,
              LEAST(COALESCE(ld.lease_end_date, to_date), to_date)::date,
              '1 week'::interval
            )::date + INTERVAL '6 days'
          WHEN ld.cadence = 'Biweekly' THEN 
            generate_series(
              GREATEST(ld.lease_start_date, from_date)::date,
              LEAST(COALESCE(ld.lease_end_date, to_date), to_date)::date,
              '2 weeks'::interval
            )::date + INTERVAL '13 days'
          WHEN ld.cadence = 'Monthly' THEN 
            generate_series(
              GREATEST(ld.lease_start_date, from_date)::date,
              LEAST(COALESCE(ld.lease_end_date, to_date), to_date)::date,
              '1 month'::interval
            )::date + INTERVAL '1 month' - INTERVAL '1 day'
        END::date as period_end,
        CASE 
          WHEN ld.cadence = 'Weekly' THEN 
            generate_series(
              GREATEST(ld.lease_start_date, from_date)::date,
              LEAST(COALESCE(ld.lease_end_date, to_date), to_date)::date,
              '1 week'::interval
            )::date + INTERVAL '6 days'
          WHEN ld.cadence = 'Biweekly' THEN 
            generate_series(
              GREATEST(ld.lease_start_date, from_date)::date,
              LEAST(COALESCE(ld.lease_end_date, to_date), to_date)::date,
              '2 weeks'::interval
            )::date + INTERVAL '13 days'
          WHEN ld.cadence = 'Monthly' THEN 
            generate_series(
              GREATEST(ld.lease_start_date, from_date)::date,
              LEAST(COALESCE(ld.lease_end_date, to_date), to_date)::date,
              '1 month'::interval
            )::date + INTERVAL '1 month' - INTERVAL '1 day'
        END::date as due_date,
        true as is_active
    ) p
  )
  SELECT 
    pd.lease_id,
    pd.property_id,
    pd.tenant_id,
    pd.cadence,
    pd.period_start,
    pd.period_end,
    pd.due_date,
    i.id as invoice_id,
    COALESCE(i.amount, 0) as billed_total,
    COALESCE(SUM(pa.rent), 0) as paid_to_rent,
    COALESCE(SUM(pa.late_fee), 0) as paid_to_late,
    COALESCE(i.amount, 0) - COALESCE(SUM(pa.rent + pa.late_fee), 0) as balance_due,
    (i.id IS NULL) as is_missing_invoice
  FROM period_data pd
  LEFT JOIN "RENT_invoices" i ON i.lease_id = pd.lease_id 
    AND i.due_date = pd.due_date
  -- RENT_payment_allocations not used
  GROUP BY 
    pd.lease_id, pd.property_id, pd.tenant_id, pd.cadence,
    pd.period_start, pd.period_end, pd.due_date, i.id, i.amount
  ORDER BY pd.lease_id, pd.due_date;
END;
$$;

-- 3. Grant execute permissions on the function
GRANT EXECUTE ON FUNCTION "RENT_period_invoice_map_many"(uuid[], date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION "RENT_period_invoice_map_many"(uuid[], date, date) TO service_role;

-- 4. Test the function with sample data
-- SELECT * FROM "RENT_period_invoice_map_many"(
--   ARRAY['4d1e925a-e708-476d-904e-67feb469d298'::uuid],
--   '2025-06-29'::date,
--   '2025-10-26'::date
-- );

-- 5. If you want to create the view as well (optional, for legacy support)
CREATE OR REPLACE VIEW "RENT_period_invoice_map_v" AS
SELECT 
  lease_id,
  property_id,
  tenant_id,
  cadence,
  period_start,
  period_end,
  due_date as period_due_date,  -- Note: using period_due_date for compatibility
  invoice_id,
  billed_total as period_amount,
  (paid_to_rent + paid_to_late) as amount_paid,
  balance_due,
  CASE 
    WHEN is_missing_invoice THEN 'OPEN'
    WHEN balance_due <= 0 THEN 'PAID'
    WHEN (paid_to_rent + paid_to_late) > 0 THEN 'PARTIAL'
    ELSE 'OPEN'
  END as status
FROM "RENT_period_invoice_map_many"(
  ARRAY[]::uuid[],  -- Empty array for view
  CURRENT_DATE - INTERVAL '1 year',
  CURRENT_DATE + INTERVAL '1 year'
);

-- 6. Grant permissions on the view
GRANT SELECT ON "RENT_period_invoice_map_v" TO authenticated;
GRANT SELECT ON "RENT_period_invoice_map_v" TO service_role;
