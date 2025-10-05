-- Simple database setup for batched period-invoice mapping system
-- This is a fallback version that uses existing invoice data

-- 1. Create a simple RPC function that works with existing data
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
  invoice_data AS (
    SELECT 
      i.id as invoice_id,
      i.lease_id,
      i.due_date,
      i.amount as billed_total,
      i.amount_paid,
      i.balance_due,
      COALESCE(SUM(pa.rent), 0) as paid_to_rent,
      COALESCE(SUM(pa.late_fee), 0) as paid_to_late
    FROM "RENT_invoices" i
    -- RENT_payment_allocations not used
    WHERE i.lease_id = ANY(lease_ids)
      AND i.due_date >= from_date 
      AND i.due_date <= to_date
    GROUP BY i.id, i.lease_id, i.due_date, i.amount, i.amount_paid, i.balance_due
  )
  SELECT 
    ld.lease_id,
    ld.property_id,
    ld.tenant_id,
    ld.cadence,
    id.due_date - INTERVAL '1 month' as period_start,  -- Approximate
    id.due_date as period_end,
    id.due_date,
    id.invoice_id,
    id.billed_total,
    id.paid_to_rent,
    id.paid_to_late,
    id.balance_due,
    false as is_missing_invoice
  FROM lease_data ld
  LEFT JOIN invoice_data id ON id.lease_id = ld.lease_id
  ORDER BY ld.lease_id, id.due_date;
END;
$$;

-- 2. Grant execute permissions
GRANT EXECUTE ON FUNCTION "RENT_period_invoice_map_many"(uuid[], date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION "RENT_period_invoice_map_many"(uuid[], date, date) TO service_role;

-- 3. Test the function
-- SELECT * FROM "RENT_period_invoice_map_many"(
--   ARRAY['4d1e925a-e708-476d-904e-67feb469d298'::uuid],
--   '2025-06-29'::date,
--   '2025-10-26'::date
-- );
