-- Fix invoice due dates to use rent_due_day from leases instead of end of period
-- This will update all monthly invoices to have due dates on the correct day of the month

-- Update monthly invoices to use rent_due_day
UPDATE "RENT_invoices" 
SET due_date = (
  DATE_TRUNC('month', period_start) + INTERVAL '1 month' + 
  (COALESCE(l.rent_due_day, 1) - 1) * INTERVAL '1 day'
)
FROM "RENT_leases" l
WHERE "RENT_invoices".lease_id = l.id
AND l.rent_cadence = 'monthly';

-- Verify the changes
SELECT 
  p.address,
  l.rent_due_day,
  i.invoice_no,
  i.period_start,
  i.period_end,
  i.due_date,
  i.amount_rent
FROM "RENT_invoices" i
JOIN "RENT_leases" l ON i.lease_id = l.id
JOIN "RENT_properties" p ON l.property_id = p.id
WHERE l.rent_cadence = 'monthly'
ORDER BY p.address, i.due_date
LIMIT 10;
