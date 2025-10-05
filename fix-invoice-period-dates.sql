-- Fix invoice period dates to use rent_due_day from leases
-- This will update all monthly invoices to have correct period_start, period_end, and due_date

-- Update monthly invoices to use rent_due_day for all date fields
UPDATE "RENT_invoices" 
SET 
  period_start = (
    DATE_TRUNC('month', due_date) - INTERVAL '1 month' + 
    (COALESCE(l.rent_due_day, 1) - 1) * INTERVAL '1 day'
  ),
  period_end = (
    DATE_TRUNC('month', due_date) - INTERVAL '1 day' + 
    (COALESCE(l.rent_due_day, 1) - 1) * INTERVAL '1 day'
  ),
  due_date = (
    DATE_TRUNC('month', due_date) + 
    (COALESCE(l.rent_due_day, 1) - 1) * INTERVAL '1 day'
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
  i.invoice_no
FROM "RENT_invoices" i
JOIN "RENT_leases" l ON i.lease_id = l.id
JOIN "RENT_properties" p ON l.property_id = p.id
WHERE l.rent_cadence = 'monthly'
ORDER BY p.address, i.due_date
LIMIT 10;
