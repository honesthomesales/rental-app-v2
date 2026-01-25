-- Compare invoices counted by payments page vs late tenants API
-- This will help identify why late tenants shows 14 invoices but payments shows 7

-- First, find the lease for "5667 N Main St"
WITH property_lease AS (
  SELECT l.id as lease_id, l.lease_start_date, l.property_id, p.address
  FROM RENT_leases l
  JOIN RENT_properties p ON l.property_id = p.id
  WHERE (LOWER(p.address) LIKE '%5667%' OR LOWER(p.address) LIKE '%main%')
    AND l.status = 'active'
  LIMIT 1
),
-- Get all invoices for this lease (up to today, matching both APIs)
all_invoices AS (
  SELECT 
    i.id as invoice_id,
    i.lease_id,
    i.due_date,
    i.status,
    i.amount_total,
    i.balance_due as original_balance_due,
    i.amount_paid as original_amount_paid,
    pl.lease_start_date,
    pl.address
  FROM RENT_invoices i
  JOIN property_lease pl ON i.lease_id = pl.lease_id
  WHERE i.due_date <= CURRENT_DATE
),
-- Calculate actual paid from payments (matching both APIs)
invoices_with_actual_payments AS (
  SELECT 
    ai.*,
    COALESCE(SUM(p.amount), 0) as actual_paid_from_payments,
    ai.amount_total - COALESCE(SUM(p.amount), 0) as recalculated_balance_due
  FROM all_invoices ai
  LEFT JOIN RENT_payments p ON p.invoice_id = ai.invoice_id
  GROUP BY ai.invoice_id, ai.lease_id, ai.due_date, ai.status, ai.amount_total, 
           ai.original_balance_due, ai.original_amount_paid, ai.lease_start_date, ai.address
),
-- Filter by lease_start_date (matching both APIs)
valid_invoices AS (
  SELECT *
  FROM invoices_with_actual_payments
  WHERE lease_start_date IS NULL OR due_date >= lease_start_date
),
-- Unpaid invoices (status='OPEN' AND recalculated_balance_due > 0) - matching both APIs
unpaid_invoices AS (
  SELECT *
  FROM valid_invoices
  WHERE status = 'OPEN' AND recalculated_balance_due > 0
)
-- Show detailed breakdown
SELECT 
  'All Invoices (up to today)' as category,
  COUNT(*) as count,
  STRING_AGG(invoice_id::text, ', ' ORDER BY due_date DESC) as invoice_ids
FROM all_invoices

UNION ALL

SELECT 
  'Valid Invoices (after lease_start_date filter)' as category,
  COUNT(*) as count,
  STRING_AGG(invoice_id::text, ', ' ORDER BY due_date DESC) as invoice_ids
FROM valid_invoices

UNION ALL

SELECT 
  'Unpaid Invoices (status=OPEN AND recalculated_balance_due>0)' as category,
  COUNT(*) as count,
  STRING_AGG(invoice_id::text, ', ' ORDER BY due_date DESC) as invoice_ids
FROM unpaid_invoices

UNION ALL

-- Show invoices that are EXCLUDED and why
SELECT 
  'EXCLUDED: Status not OPEN' as category,
  COUNT(*) as count,
  STRING_AGG(invoice_id::text, ', ' ORDER BY due_date DESC) as invoice_ids
FROM valid_invoices
WHERE status != 'OPEN'

UNION ALL

SELECT 
  'EXCLUDED: Recalculated balance_due <= 0' as category,
  COUNT(*) as count,
  STRING_AGG(invoice_id::text, ', ' ORDER BY due_date DESC) as invoice_ids
FROM valid_invoices
WHERE status = 'OPEN' AND recalculated_balance_due <= 0

UNION ALL

SELECT 
  'EXCLUDED: Before lease_start_date' as category,
  COUNT(*) as count,
  STRING_AGG(invoice_id::text, ', ' ORDER BY due_date DESC) as invoice_ids
FROM all_invoices
WHERE lease_start_date IS NOT NULL AND due_date < lease_start_date

ORDER BY category;

-- Detailed view of unpaid invoices
SELECT 
  invoice_id,
  due_date,
  status,
  amount_total,
  original_balance_due,
  original_amount_paid,
  actual_paid_from_payments,
  recalculated_balance_due,
  CASE 
    WHEN status != 'OPEN' THEN 'Status not OPEN'
    WHEN recalculated_balance_due <= 0 THEN 'Balance <= 0'
    ELSE 'UNPAID'
  END as reason
FROM valid_invoices
ORDER BY due_date DESC;
