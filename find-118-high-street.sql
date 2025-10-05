-- Find 118 High Street property and its invoices

-- First, find all properties with "high" and "118" in the address
SELECT 
  p.id as property_id,
  p.address,
  l.id as lease_id,
  l.rent,
  l.rent_cadence,
  l.lease_start_date,
  l.lease_end_date,
  l.status as lease_status
FROM "RENT_properties" p
LEFT JOIN "RENT_leases" l ON p.id = l.property_id
WHERE p.address ILIKE '%118%'
  AND p.address ILIKE '%high%'
ORDER BY p.address;

-- Check for invoices for this property
SELECT 
  p.address,
  l.rent as lease_rent,
  i.id as invoice_id,
  i.invoice_no,
  i.due_date,
  i.period_start,
  i.period_end,
  i.amount_rent,
  i.amount_late,
  i.amount_total,
  i.amount_paid,
  i.balance_due,
  i.status
FROM "RENT_properties" p
JOIN "RENT_leases" l ON p.id = l.property_id
LEFT JOIN "RENT_invoices" i ON l.id = i.lease_id
WHERE p.address ILIKE '%118%'
  AND p.address ILIKE '%high%'
  AND (i.due_date IS NULL OR i.due_date <= '2025-09-30')
ORDER BY p.address, i.due_date;

