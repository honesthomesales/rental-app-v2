-- Update monthly invoices for 100 Overbrook with $750 payments
-- Insert payments from lease start to today, paid on due date

-- Step 1: Find the property and lease info
-- Run this first to verify the IDs:
SELECT 
  p.id as property_id,
  p.name as property_name,
  l.id as lease_id,
  l.rent,
  l.rent_cadence,
  l.lease_start_date,
  t.full_name as tenant_name
FROM "RENT_properties" p
JOIN "RENT_leases" l ON l.property_id = p.id
JOIN "RENT_tenants" t ON t.id = l.tenant_id
WHERE p.name ILIKE '%100 Overbrook%'
  AND l.status = 'active';

-- Step 2: Delete any existing payments (if re-running)
DELETE FROM "RENT_payments"
WHERE invoice_id IN (
  SELECT i.id
  FROM "RENT_invoices" i
  JOIN "RENT_properties" p ON p.id = i.property_id
  WHERE p.name ILIKE '%100 Overbrook%'
    AND i.due_date >= (
      SELECT l.lease_start_date 
      FROM "RENT_leases" l
      JOIN "RENT_properties" p2 ON p2.id = l.property_id
      WHERE p2.name ILIKE '%100 Overbrook%' AND l.status = 'active'
      LIMIT 1
    )
    AND i.due_date <= CURRENT_DATE
)
AND notes ILIKE '%Bulk payment import%';

-- Step 3: Insert $750 payments for all monthly invoices from lease start to today
INSERT INTO "RENT_payments" (
  lease_id,
  property_id,
  tenant_id,
  invoice_id,
  payment_date,
  amount,
  payment_type,
  payment_method,
  status,
  notes
)
SELECT 
  i.lease_id,
  i.property_id,
  i.tenant_id,
  i.id as invoice_id,
  i.due_date as payment_date,
  750.00 as amount,
  'Rent' as payment_type,
  'Manual Entry' as payment_method,
  'completed' as status,
  'Bulk payment import - 100 Overbrook' as notes
FROM "RENT_invoices" i
JOIN "RENT_properties" p ON p.id = i.property_id
JOIN "RENT_leases" l ON l.id = i.lease_id
WHERE p.name ILIKE '%100 Overbrook%'
  AND i.due_date >= l.lease_start_date  -- From beginning of lease
  AND i.due_date <= CURRENT_DATE  -- Until today
  AND NOT EXISTS (
    -- Don't create duplicate payments
    SELECT 1 FROM "RENT_payments" pay
    WHERE pay.invoice_id = i.id
  );

-- Step 4: Update invoice balances
-- Set amount_paid = 750, balance_due = 0, status = PAID
UPDATE "RENT_invoices" i
SET 
  amount_paid = COALESCE((
    SELECT SUM(p.amount)
    FROM "RENT_payments" p
    WHERE p.invoice_id = i.id
  ), 0),
  amount_late = 0.00,
  amount_total = i.amount_rent,
  balance_due = i.amount_rent - COALESCE((
    SELECT SUM(p.amount)
    FROM "RENT_payments" p
    WHERE p.invoice_id = i.id
  ), 0),
  status = CASE 
    WHEN i.amount_rent - COALESCE((
      SELECT SUM(p.amount)
      FROM "RENT_payments" p
      WHERE p.invoice_id = i.id
    ), 0) <= 0 THEN 'PAID'
    ELSE 'OPEN'
  END,
  paid_in_full_at = CASE
    WHEN i.amount_rent - COALESCE((
      SELECT SUM(p.amount)
      FROM "RENT_payments" p
      WHERE p.invoice_id = i.id
    ), 0) <= 0 THEN NOW()
    ELSE NULL
  END
WHERE i.id IN (
  SELECT inv.id
  FROM "RENT_invoices" inv
  JOIN "RENT_properties" p ON p.id = inv.property_id
  JOIN "RENT_leases" l ON l.id = inv.lease_id
  WHERE p.name ILIKE '%100 Overbrook%'
    AND inv.due_date >= l.lease_start_date
    AND inv.due_date <= CURRENT_DATE
);

-- Step 5: Verify the results
SELECT 
  i.invoice_no,
  i.due_date,
  i.amount_rent,
  i.amount_late,
  i.amount_total,
  i.amount_paid,
  i.balance_due,
  i.status,
  i.paid_in_full_at,
  COUNT(p.id) as payment_count,
  COALESCE(SUM(p.amount), 0) as total_payments
FROM "RENT_invoices" i
JOIN "RENT_properties" prop ON prop.id = i.property_id
LEFT JOIN "RENT_payments" p ON p.invoice_id = i.id
WHERE prop.name ILIKE '%100 Overbrook%'
  AND i.due_date >= '2025-01-01'
  AND i.due_date <= '2025-12-31'
GROUP BY i.id, i.invoice_no, i.due_date, i.amount_rent, i.amount_late, i.amount_total, i.amount_paid, i.balance_due, i.status, i.paid_in_full_at
ORDER BY i.due_date;

