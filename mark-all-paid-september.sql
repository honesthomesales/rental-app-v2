-- Mark all properties as paid through September 30, 2025
-- This will update all invoices to be fully paid with $0 late fees

UPDATE "RENT_invoices"
SET 
  amount_late = 0.00,
  amount_total = amount_rent,
  amount_paid = amount_rent,
  balance_due = 0.00,
  status = 'PAID',
  paid_in_full_at = due_date
WHERE due_date <= '2025-09-30'
AND amount_rent > 0;

-- Verify the updates
SELECT 
  p.address,
  i.invoice_no,
  i.due_date,
  i.amount_rent,
  i.amount_late,
  i.amount_total,
  i.amount_paid,
  i.balance_due,
  i.status,
  i.paid_in_full_at
FROM "RENT_invoices" i
JOIN "RENT_leases" l ON i.lease_id = l.id
JOIN "RENT_properties" p ON l.property_id = p.id
WHERE i.due_date <= '2025-09-30'
ORDER BY p.address, i.due_date;
