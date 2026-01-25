-- Diagnostic query to find duplicate invoices or data issues
-- Run this to check for the "5667 N Main St" property

-- 1. Find the property ID for "5667 N Main St"
SELECT id, address, property_type
FROM RENT_properties
WHERE LOWER(address) LIKE '%5667%' OR LOWER(address) LIKE '%main%';

-- 2. Find all active leases for this property
SELECT l.id as lease_id, l.property_id, l.tenant_id, l.status, l.lease_start_date, l.lease_end_date,
       p.address as property_address
FROM RENT_leases l
JOIN RENT_properties p ON l.property_id = p.id
WHERE (LOWER(p.address) LIKE '%5667%' OR LOWER(p.address) LIKE '%main%')
  AND l.status = 'active';

-- 3. Find all invoices for these leases (up to today)
-- This matches the late tenants API query: .lte('due_date', today)
WITH property_leases AS (
  SELECT l.id as lease_id
  FROM RENT_leases l
  JOIN RENT_properties p ON l.property_id = p.id
  WHERE (LOWER(p.address) LIKE '%5667%' OR LOWER(p.address) LIKE '%main%')
    AND l.status = 'active'
)
SELECT 
  i.id as invoice_id,
  i.lease_id,
  i.due_date,
  i.status,
  i.amount_total,
  i.balance_due,
  i.amount_paid,
  -- Check for duplicate invoice IDs
  COUNT(*) OVER (PARTITION BY i.id) as duplicate_count,
  -- Calculate actual paid from payments
  COALESCE(SUM(p.amount) FILTER (WHERE p.invoice_id = i.id), 0) as actual_paid_from_payments,
  -- Recalculated balance
  i.amount_total - COALESCE(SUM(p.amount) FILTER (WHERE p.invoice_id = i.id), 0) as recalculated_balance_due
FROM RENT_invoices i
JOIN property_leases pl ON i.lease_id = pl.lease_id
LEFT JOIN RENT_payments p ON p.invoice_id = i.id
WHERE i.due_date <= CURRENT_DATE
GROUP BY i.id, i.lease_id, i.due_date, i.status, i.amount_total, i.balance_due, i.amount_paid
ORDER BY i.due_date DESC;

-- 4. Check for duplicate invoice IDs in the database
SELECT 
  id as invoice_id,
  COUNT(*) as occurrence_count,
  STRING_AGG(DISTINCT lease_id::text, ', ') as lease_ids,
  STRING_AGG(DISTINCT due_date::text, ', ') as due_dates
FROM RENT_invoices
WHERE id IN (
  SELECT i.id
  FROM RENT_invoices i
  JOIN RENT_leases l ON i.lease_id = l.id
  JOIN RENT_properties p ON l.property_id = p.id
  WHERE (LOWER(p.address) LIKE '%5667%' OR LOWER(p.address) LIKE '%main%')
    AND l.status = 'active'
    AND i.due_date <= CURRENT_DATE
)
GROUP BY id
HAVING COUNT(*) > 1;

-- 5. Find unpaid invoices (status='OPEN' AND recalculated balance_due > 0)
-- This matches the late tenants API filtering logic
WITH property_leases AS (
  SELECT l.id as lease_id, l.lease_start_date
  FROM RENT_leases l
  JOIN RENT_properties p ON l.property_id = p.id
  WHERE (LOWER(p.address) LIKE '%5667%' OR LOWER(p.address) LIKE '%main%')
    AND l.status = 'active'
),
invoices_with_payments AS (
  SELECT 
    i.id as invoice_id,
    i.lease_id,
    i.due_date,
    i.status,
    i.amount_total,
    i.balance_due as original_balance_due,
    COALESCE(SUM(p.amount), 0) as actual_paid_from_payments,
    i.amount_total - COALESCE(SUM(p.amount), 0) as recalculated_balance_due,
    pl.lease_start_date
  FROM RENT_invoices i
  JOIN property_leases pl ON i.lease_id = pl.lease_id
  LEFT JOIN RENT_payments p ON p.invoice_id = i.id
  WHERE i.due_date <= CURRENT_DATE
    AND (pl.lease_start_date IS NULL OR i.due_date >= pl.lease_start_date)
  GROUP BY i.id, i.lease_id, i.due_date, i.status, i.amount_total, i.balance_due, pl.lease_start_date
)
SELECT 
  invoice_id,
  lease_id,
  due_date,
  status,
  amount_total,
  original_balance_due,
  actual_paid_from_payments,
  recalculated_balance_due,
  CASE 
    WHEN status = 'OPEN' AND recalculated_balance_due > 0 THEN 'UNPAID'
    ELSE 'PAID or EXCLUDED'
  END as classification
FROM invoices_with_payments
WHERE status = 'OPEN' AND recalculated_balance_due > 0
ORDER BY due_date DESC;

-- 6. Count unpaid invoices per lease
WITH property_leases AS (
  SELECT l.id as lease_id, l.lease_start_date, p.address
  FROM RENT_leases l
  JOIN RENT_properties p ON l.property_id = p.id
  WHERE (LOWER(p.address) LIKE '%5667%' OR LOWER(p.address) LIKE '%main%')
    AND l.status = 'active'
),
invoices_with_payments AS (
  SELECT 
    i.id as invoice_id,
    i.lease_id,
    i.due_date,
    i.status,
    i.amount_total,
    COALESCE(SUM(p.amount), 0) as actual_paid_from_payments,
    i.amount_total - COALESCE(SUM(p.amount), 0) as recalculated_balance_due,
    pl.lease_start_date,
    pl.address
  FROM RENT_invoices i
  JOIN property_leases pl ON i.lease_id = pl.lease_id
  LEFT JOIN RENT_payments p ON p.invoice_id = i.id
  WHERE i.due_date <= CURRENT_DATE
    AND (pl.lease_start_date IS NULL OR i.due_date >= pl.lease_start_date)
  GROUP BY i.id, i.lease_id, i.due_date, i.status, i.amount_total, pl.lease_start_date, pl.address
)
SELECT 
  lease_id,
  address,
  COUNT(*) as unpaid_invoice_count,
  SUM(recalculated_balance_due) as total_owed,
  STRING_AGG(invoice_id::text, ', ' ORDER BY due_date DESC) as invoice_ids
FROM invoices_with_payments
WHERE status = 'OPEN' AND recalculated_balance_due > 0
GROUP BY lease_id, address;
