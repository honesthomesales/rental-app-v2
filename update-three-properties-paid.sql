-- Update invoices for 159 Adams ($750/month), 31 Nutty ($765/month), 425 Ridge ($825/month), 122 Bowers ($640/month)
-- Add weekly payments for 296 Shelter Bay ($325/week) from lease start through 5/15/2025
-- Set all invoices through 9/30/2025 as fully paid with $0 late fees

-- Update 159 Adams invoices (rent = $750)
UPDATE "RENT_invoices"
SET 
  amount_late = 0.00,
  amount_total = amount_rent,
  amount_paid = amount_rent,
  balance_due = 0.00,
  status = 'PAID',
  paid_in_full_at = due_date
WHERE lease_id IN (
  SELECT l.id 
  FROM "RENT_leases" l
  JOIN "RENT_properties" p ON l.property_id = p.id
  WHERE p.address ILIKE '%159%adams%'
)
AND due_date <= '2025-09-30'
AND amount_rent = 750.00;

-- Update 31 Nutty invoices (rent = $765)
UPDATE "RENT_invoices"
SET 
  amount_late = 0.00,
  amount_total = amount_rent,
  amount_paid = amount_rent,
  balance_due = 0.00,
  status = 'PAID',
  paid_in_full_at = due_date
WHERE lease_id IN (
  SELECT l.id 
  FROM "RENT_leases" l
  JOIN "RENT_properties" p ON l.property_id = p.id
  WHERE p.address ILIKE '%31%nutty%'
)
AND due_date <= '2025-09-30'
AND amount_rent = 765.00;

-- Update 425 Ridge invoices (rent = $825)
UPDATE "RENT_invoices"
SET 
  amount_late = 0.00,
  amount_total = amount_rent,
  amount_paid = amount_rent,
  balance_due = 0.00,
  status = 'PAID',
  paid_in_full_at = due_date
WHERE lease_id IN (
  SELECT l.id 
  FROM "RENT_leases" l
  JOIN "RENT_properties" p ON l.property_id = p.id
  WHERE p.address ILIKE '%425%ridge%'
)
AND due_date <= '2025-09-30'
AND amount_rent = 825.00;

-- Update 122 Bowers invoices (rent = $640)
UPDATE "RENT_invoices"
SET 
  amount_late = 0.00,
  amount_total = amount_rent,
  amount_paid = amount_rent,
  balance_due = 0.00,
  status = 'PAID',
  paid_in_full_at = due_date
WHERE lease_id IN (
  SELECT l.id 
  FROM "RENT_leases" l
  JOIN "RENT_properties" p ON l.property_id = p.id
  WHERE p.address ILIKE '%122%bowers%'
)
AND due_date <= '2025-09-30'
AND amount_rent = 640.00;

-- Add monthly payments for 4 properties from lease start through end of September 2025
-- 307 Mooreshead ($325/month), 132 Branch ($1100/month), 303 Granite ($925/month), 124 Hall ($1245/month)

-- Update 307 Mooreshead invoices (rent = $325)
UPDATE "RENT_invoices"
SET 
  amount_late = 0.00,
  amount_total = amount_rent,
  amount_paid = amount_rent,
  balance_due = 0.00,
  status = 'PAID',
  paid_in_full_at = due_date
WHERE lease_id IN (
  SELECT l.id 
  FROM "RENT_leases" l
  JOIN "RENT_properties" p ON l.property_id = p.id
  WHERE p.address ILIKE '%307%mooreshead%'
)
AND due_date <= '2025-09-30'
AND amount_rent = 325.00;

-- Update 132 Branch invoices (rent = $1100)
UPDATE "RENT_invoices"
SET 
  amount_late = 0.00,
  amount_total = amount_rent,
  amount_paid = amount_rent,
  balance_due = 0.00,
  status = 'PAID',
  paid_in_full_at = due_date
WHERE lease_id IN (
  SELECT l.id 
  FROM "RENT_leases" l
  JOIN "RENT_properties" p ON l.property_id = p.id
  WHERE p.address ILIKE '%132%branch%'
)
AND due_date <= '2025-09-30'
AND amount_rent = 1100.00;

-- Update 303 Granite invoices (rent = $925)
UPDATE "RENT_invoices"
SET 
  amount_late = 0.00,
  amount_total = amount_rent,
  amount_paid = amount_rent,
  balance_due = 0.00,
  status = 'PAID',
  paid_in_full_at = due_date
WHERE lease_id IN (
  SELECT l.id 
  FROM "RENT_leases" l
  JOIN "RENT_properties" p ON l.property_id = p.id
  WHERE p.address ILIKE '%303%granite%'
)
AND due_date <= '2025-09-30'
AND amount_rent = 925.00;

-- Update 124 Hall invoices (rent = $1245)
UPDATE "RENT_invoices"
SET 
  amount_late = 0.00,
  amount_total = amount_rent,
  amount_paid = amount_rent,
  balance_due = 0.00,
  status = 'PAID',
  paid_in_full_at = due_date
WHERE lease_id IN (
  SELECT l.id 
  FROM "RENT_leases" l
  JOIN "RENT_properties" p ON l.property_id = p.id
  WHERE p.address ILIKE '%124%hall%'
)
AND due_date <= '2025-09-30'
AND amount_rent = 1245.00;

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
WHERE p.address ILIKE ANY(ARRAY['%159%adams%', '%31%nutty%', '%425%ridge%', '%122%bowers%', '%307%mooreshead%', '%132%branch%', '%303%granite%', '%124%hall%'])
AND i.due_date <= '2025-09-30'
ORDER BY p.address, i.due_date;

