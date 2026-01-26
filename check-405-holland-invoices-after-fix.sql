-- ============================================
-- CHECK: 405 Holland Memorial After Fix
-- Run this to see what invoices exist and what should be generated
-- ============================================

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
ORDER BY l.created_at DESC
LIMIT 1;

-- STEP 2: Check ALL invoices for this lease (replace LEASE_ID_HERE)
SELECT 
  '=== ALL INVOICES (NO FILTER) ===' AS section,
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

-- STEP 3: Calculate what weekly invoices SHOULD exist
-- From 2026-01-01 to today (2026-01-19)
WITH weekly_periods AS (
  SELECT 
    generate_series(
      '2026-01-01'::date,
      '2026-01-19'::date,  -- Today
      '7 days'::interval
    )::date AS due_date
)
SELECT 
  '=== EXPECTED WEEKLY INVOICES (1/1 to 1/19) ===' AS section,
  due_date,
  due_date AS period_start,
  (due_date + INTERVAL '6 days')::date AS period_end,
  'Should be $210 each' AS note
FROM weekly_periods
ORDER BY due_date;

-- STEP 4: Check if invoices match expected periods
SELECT 
  '=== INVOICE VS EXPECTED COMPARISON ===' AS section,
  expected.due_date AS expected_due_date,
  CASE WHEN i.id IS NOT NULL THEN 'EXISTS' ELSE 'MISSING' END AS invoice_status,
  i.id AS invoice_id,
  i.amount_total,
  i.balance_due
FROM (
  SELECT generate_series('2026-01-01'::date, '2026-01-19'::date, '7 days'::interval)::date AS due_date
) expected
LEFT JOIN "RENT_invoices" i ON i.lease_id = 'LEASE_ID_HERE'  -- Replace with actual lease_id
  AND i.due_date = expected.due_date
ORDER BY expected.due_date;
