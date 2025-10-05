-- Create the RPC function that the batch API expects
-- This should work with the existing RENT_invoice_status_v view

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
  SELECT 
    i.lease_id,
    i.property_id,
    i.tenant_id,
    'Monthly'::text as cadence,  -- Default cadence
    i.period_start,
    i.period_end,
    i.due_date,
    i.id as invoice_id,
    i.amount_total as billed_total,
    i.amount_paid as paid_to_rent,
    0::numeric as paid_to_late,  -- Assuming late fees are separate
    i.balance_due,
    false as is_missing_invoice  -- Since we're selecting from existing invoices
  FROM "RENT_invoice_status_v" i
  WHERE i.lease_id = ANY(lease_ids)
    AND i.due_date >= from_date 
    AND i.due_date <= to_date
  ORDER BY i.lease_id, i.due_date;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION "RENT_period_invoice_map_many"(uuid[], date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION "RENT_period_invoice_map_many"(uuid[], date, date) TO service_role;
