-- Fix only the due_date field to match rent_due_day from leases
-- This is the most important fix - the due_date should determine when payment is due

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
  i.due_date,
  i.period_start,
  i.period_end,
  i.invoice_no
FROM "RENT_invoices" i
JOIN "RENT_leases" l ON i.lease_id = l.id
JOIN "RENT_properties" p ON l.property_id = p.id
WHERE l.rent_cadence = 'monthly'
  AND (p.address ILIKE '%holland%' OR p.address ILIKE '%hosch%')
ORDER BY p.address, i.due_date;
