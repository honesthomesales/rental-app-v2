-- Update invoice due_dates to use rent_due_day that falls within the invoice period
-- For each invoice, find the rent_due_day that falls within the period_start to period_end range

UPDATE "RENT_invoices" 
SET due_date = (
  -- Find the rent_due_day that falls within the invoice period
  CASE 
    WHEN l.rent_due_day IS NOT NULL THEN
      -- Get the year and month from period_start
      DATE_TRUNC('month', period_start) + 
      (l.rent_due_day - 1) * INTERVAL '1 day'
    ELSE
      -- Default to 1st of the month if no rent_due_day
      DATE_TRUNC('month', period_start)
  END
)
FROM "RENT_leases" l
WHERE "RENT_invoices".lease_id = l.id
AND l.rent_cadence = 'monthly';

-- Verify the changes
SELECT 
  p.address,
  l.rent_due_day,
  i.period_start,
  i.period_end,
  i.due_date,
  i.invoice_no,
  -- Show if the new due_date falls within the period
  CASE 
    WHEN i.due_date >= i.period_start AND i.due_date <= i.period_end THEN '✓ WITHIN PERIOD'
    ELSE '✗ OUTSIDE PERIOD'
  END as due_date_check
FROM "RENT_invoices" i
JOIN "RENT_leases" l ON i.lease_id = l.id
JOIN "RENT_properties" p ON l.property_id = p.id
WHERE l.rent_cadence = 'monthly'
ORDER BY p.address, i.due_date
LIMIT 20;
