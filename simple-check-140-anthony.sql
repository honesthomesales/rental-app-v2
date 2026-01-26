-- ============================================
-- SIMPLE CHECK: Does the invoice exist?
-- Run this to see if there are ANY invoices for this lease
-- ============================================

-- Check 1: Does the lease exist?
SELECT 
  'CHECK 1: Lease exists?' AS check_name,
  id AS lease_id,
  property_id,
  lease_start_date,
  lease_end_date,
  status,
  rent
FROM "RENT_leases"
WHERE id = '0eea0850-4945-4a13-a609-a1f132758bfa';

-- Check 2: Does the property exist?
SELECT 
  'CHECK 2: Property exists?' AS check_name,
  id AS property_id,
  name,
  address
FROM "RENT_properties"
WHERE id = '401180e3-2cef-41e7-aefe-28f582545276'
   OR address ILIKE '%140 Anthony%';

-- Check 3: Are there ANY invoices for this lease? (no filters)
SELECT 
  'CHECK 3: ANY invoices for lease?' AS check_name,
  COUNT(*) AS invoice_count,
  MIN(due_date) AS earliest_due_date,
  MAX(due_date) AS latest_due_date
FROM "RENT_invoices"
WHERE lease_id = '0eea0850-4945-4a13-a609-a1f132758bfa';

-- Check 4: Show ALL invoices for this lease (no filters)
SELECT 
  'CHECK 4: ALL invoices for lease' AS check_name,
  id AS invoice_id,
  invoice_no,
  due_date,
  status,
  amount_total,
  amount_paid,
  balance_due,
  amount_rent,
  amount_late,
  amount_other,
  period_start,
  period_end
FROM "RENT_invoices"
WHERE lease_id = '0eea0850-4945-4a13-a609-a1f132758bfa'
ORDER BY due_date DESC;

-- Check 5: Are there ANY invoices for this property? (in case lease_id is wrong)
SELECT 
  'CHECK 5: ANY invoices for property?' AS check_name,
  COUNT(*) AS invoice_count
FROM "RENT_invoices"
WHERE property_id = '401180e3-2cef-41e7-aefe-28f582545276';

-- Check 6: Show ALL invoices for this property
SELECT 
  'CHECK 6: ALL invoices for property' AS check_name,
  id AS invoice_id,
  invoice_no,
  lease_id,
  due_date,
  status,
  amount_total,
  amount_paid,
  balance_due
FROM "RENT_invoices"
WHERE property_id = '401180e3-2cef-41e7-aefe-28f582545276'
ORDER BY due_date DESC;

-- Check 7: Find invoice with due_date = 2026-01-01 (regardless of lease/property)
SELECT 
  'CHECK 7: Invoice due 2026-01-01?' AS check_name,
  id AS invoice_id,
  invoice_no,
  lease_id,
  property_id,
  due_date,
  status,
  amount_total,
  amount_paid,
  balance_due
FROM "RENT_invoices"
WHERE due_date = '2026-01-01'::date
ORDER BY due_date DESC;

-- Check 8: Find invoices with due_date around Jan 2026
SELECT 
  'CHECK 8: Invoices around Jan 2026' AS check_name,
  id AS invoice_id,
  invoice_no,
  lease_id,
  property_id,
  due_date,
  status,
  amount_total,
  amount_paid,
  balance_due
FROM "RENT_invoices"
WHERE due_date >= '2025-12-01'::date
  AND due_date <= '2026-02-01'::date
ORDER BY due_date DESC;
