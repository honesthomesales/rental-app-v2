-- ============================================
-- DIAGNOSTIC: 405 Holland Memorial Invoice Issue
-- ============================================

-- Replace these with actual values:
-- property_address: 405 Holland Memorial (or similar)
-- new_lease_start_date: 2026-01-01

-- STEP 1: Find the lease
SELECT 
  '=== LEASE INFO ===' AS section,
  l.id AS lease_id,
  l.property_id,
  l.lease_start_date,
  l.lease_end_date,
  l.status AS lease_status,
  l.rent,
  l.rent_cadence,
  l.rent_due_day,
  l.due_weekday,
  p.name AS property_name,
  p.address AS property_address,
  t.full_name AS tenant_name
FROM "RENT_leases" l
LEFT JOIN "RENT_properties" p ON p.id = l.property_id
LEFT JOIN "RENT_tenants" t ON t.id = l.tenant_id
WHERE p.address ILIKE '%405%holland%'
   OR p.address ILIKE '%holland%memorial%'
ORDER BY l.created_at DESC
LIMIT 1;

-- STEP 2: Check ALL invoices for this lease (no date filter)
-- Replace 'LEASE_ID_HERE' with the lease_id from STEP 1
SELECT 
  '=== ALL INVOICES FOR THIS LEASE (NO FILTER) ===' AS section,
  i.id AS invoice_id,
  i.invoice_no,
  i.due_date,
  i.period_start,
  i.period_end,
  i.status,
  i.amount_total,
  i.amount_paid,
  i.balance_due,
  CASE 
    WHEN i.due_date < '2026-01-01'::date THEN 'OLD (before new lease start)'
    WHEN i.due_date >= '2026-01-01'::date THEN 'NEW (on/after new lease start)'
  END AS invoice_category
FROM "RENT_invoices" i
WHERE i.lease_id = 'LEASE_ID_HERE'  -- Replace with actual lease_id
ORDER BY i.due_date DESC;

-- STEP 3: Check invoices with API filter (due_date >= 2026-01-01)
-- This simulates what the API returns
SELECT 
  '=== INVOICES WITH API FILTER (due_date >= 2026-01-01) ===' AS section,
  i.id AS invoice_id,
  i.invoice_no,
  i.due_date,
  i.period_start,
  i.period_end,
  i.status,
  i.amount_total,
  i.amount_paid,
  i.balance_due
FROM "RENT_invoices" i
WHERE i.lease_id = 'LEASE_ID_HERE'  -- Replace with actual lease_id
  AND i.due_date >= '2026-01-01'::date  -- This is what the API filter does
ORDER BY i.due_date DESC;

-- STEP 4: Check for payments linked to invoices
SELECT 
  '=== PAYMENTS LINKED TO INVOICES ===' AS section,
  p.id AS payment_id,
  p.invoice_id,
  p.amount,
  p.payment_date,
  i.due_date AS invoice_due_date,
  i.invoice_no
FROM "RENT_payments" p
JOIN "RENT_invoices" i ON i.id = p.invoice_id
WHERE i.lease_id = 'LEASE_ID_HERE'  -- Replace with actual lease_id
ORDER BY p.payment_date DESC;

-- STEP 5: Count invoices by category
SELECT 
  '=== INVOICE COUNTS ===' AS section,
  COUNT(*) FILTER (WHERE i.due_date < '2026-01-01'::date) AS old_invoices_count,
  COUNT(*) FILTER (WHERE i.due_date >= '2026-01-01'::date) AS new_invoices_count,
  COUNT(*) AS total_invoices_count
FROM "RENT_invoices" i
WHERE i.lease_id = 'LEASE_ID_HERE';  -- Replace with actual lease_id
