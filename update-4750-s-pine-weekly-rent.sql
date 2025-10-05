-- Update RENT_invoices for 4750 S Pine to have $325 per week after August
-- This will update all invoices with due_date after August 31, 2025

UPDATE "RENT_invoices" 
SET 
  amount_rent = 325.00,
  amount_total = 325.00 + COALESCE(amount_late, 0) + COALESCE(amount_other, 0),
  balance_due = (325.00 + COALESCE(amount_late, 0) + COALESCE(amount_other, 0)) - COALESCE(amount_paid, 0)
FROM "RENT_leases" l
JOIN "RENT_properties" p ON l.property_id = p.id
WHERE "RENT_invoices".lease_id = l.id
  AND p.address ILIKE '%4750%s%pine%'
  AND "RENT_invoices".due_date > '2025-08-31';

-- Verify the changes
SELECT 
  p.address,
  l.rent_cadence,
  l.rent as lease_rent,
  i.period_start,
  i.period_end,
  i.due_date,
  i.amount_rent,
  i.amount_total,
  i.amount_paid,
  i.balance_due,
  i.status,
  i.invoice_no
FROM "RENT_invoices" i
JOIN "RENT_leases" l ON i.lease_id = l.id
JOIN "RENT_properties" p ON l.property_id = p.id
WHERE p.address ILIKE '%4750%s%pine%'
  AND i.due_date > '2025-08-31'
ORDER BY i.due_date;
