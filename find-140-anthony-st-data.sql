-- ============================================
-- STEP-BY-STEP DIAGNOSTIC: Find 140 Anthony St Data
-- Run each query separately to see what exists
-- ============================================

-- STEP 1: Find the property
SELECT 
  '=== STEP 1: FIND PROPERTY ===' AS step,
  id AS property_id,
  name AS property_name,
  address AS property_address
FROM "RENT_properties"
WHERE address ILIKE '%140 Anthony%'
   OR name ILIKE '%140 Anthony%'
   OR address ILIKE '%Anthony%';

-- STEP 2: Find leases for this property (run after STEP 1, use property_id from results)
-- Replace 'YOUR_PROPERTY_ID_HERE' with the property_id from STEP 1
SELECT 
  '=== STEP 2: FIND LEASES ===' AS step,
  l.id AS lease_id,
  l.property_id,
  l.lease_start_date,
  l.lease_end_date,
  l.status AS lease_status,
  l.rent,
  l.rent_cadence,
  t.id AS tenant_id,
  t.full_name AS tenant_name
FROM "RENT_leases" l
LEFT JOIN "RENT_tenants" t ON t.id = l.tenant_id
WHERE l.property_id = '401180e3-2cef-41e7-aefe-28f582545276'  -- Replace with property_id from STEP 1
   OR l.id = '0eea0850-4945-4a13-a609-a1f132758bfa';  -- Or use lease_id directly

-- STEP 3: Find ALL invoices for this property/lease (run after STEP 2)
-- Replace 'YOUR_LEASE_ID_HERE' with the lease_id from STEP 2
SELECT 
  '=== STEP 3: FIND ALL INVOICES ===' AS step,
  i.id AS invoice_id,
  i.invoice_no,
  i.lease_id,
  i.property_id,
  i.due_date,
  i.period_start,
  i.period_end,
  i.amount_rent,
  i.amount_late,
  i.amount_other,
  i.amount_total,
  i.amount_paid,
  i.balance_due,
  i.status,
  CASE 
    WHEN i.due_date < CURRENT_DATE THEN 'PAST DUE'
    WHEN i.due_date = CURRENT_DATE THEN 'DUE TODAY'
    WHEN i.due_date > CURRENT_DATE THEN 'FUTURE'
  END AS due_status,
  -- Check if this invoice would be included in payments page
  CASE 
    WHEN i.status = 'OPEN' AND i.balance_due::numeric > 0 THEN '✅ Has balance'
    WHEN i.status != 'OPEN' THEN '❌ Status: ' || i.status
    WHEN i.balance_due::numeric <= 0 THEN '❌ balance_due: ' || i.balance_due
    ELSE '❓ Unknown'
  END AS payment_page_status
FROM "RENT_invoices" i
WHERE i.lease_id = '0eea0850-4945-4a13-a609-a1f132758bfa'  -- Replace with lease_id from STEP 2
   OR i.property_id = '401180e3-2cef-41e7-aefe-28f582545276'  -- Or use property_id
ORDER BY i.due_date DESC;

-- STEP 4: Check specific invoice for Jan 1, 2026
SELECT 
  '=== STEP 4: CHECK JAN 1, 2026 INVOICE ===' AS step,
  i.id AS invoice_id,
  i.due_date,
  i.status,
  i.amount_total,
  i.amount_paid,
  i.balance_due,
  i.amount_rent,
  i.amount_late,
  i.amount_other,
  -- Verify balance calculation
  (i.amount_total::numeric - i.amount_paid::numeric) AS calculated_balance,
  CASE 
    WHEN ABS((i.amount_total::numeric - i.amount_paid::numeric) - i.balance_due::numeric) > 0.01
    THEN '⚠️ MISMATCH: balance_due should be ' || (i.amount_total::numeric - i.amount_paid::numeric)::text
    ELSE '✅ balance_due correct'
  END AS balance_check,
  -- Check if would be included
  CASE 
    WHEN i.due_date >= '2025-12-15'::date 
     AND i.due_date <= '2026-01-19'::date
     AND i.status = 'OPEN'
     AND i.balance_due::numeric > 0
    THEN '✅ SHOULD BE INCLUDED in payments page'
    ELSE '❌ NOT INCLUDED - Reason: ' ||
      CASE 
        WHEN i.due_date < '2025-12-15'::date THEN 'due_date before lease_start'
        WHEN i.due_date > '2026-01-19'::date THEN 'due_date in future'
        WHEN i.status != 'OPEN' THEN 'status is ' || i.status
        WHEN i.balance_due::numeric <= 0 THEN 'balance_due is ' || i.balance_due
        ELSE 'unknown'
      END
  END AS inclusion_status
FROM "RENT_invoices" i
WHERE i.lease_id = '0eea0850-4945-4a13-a609-a1f132758bfa'
  AND i.due_date = '2026-01-01'::date;  -- Specific invoice date

-- STEP 5: Check payments for this invoice
SELECT 
  '=== STEP 5: CHECK PAYMENTS ===' AS step,
  p.id AS payment_id,
  p.invoice_id,
  p.lease_id,
  p.amount,
  p.payment_date,
  p.payment_method,
  p.payment_type,
  p.status AS payment_status,
  i.due_date AS invoice_due_date,
  i.balance_due AS invoice_balance_due
FROM "RENT_payments" p
LEFT JOIN "RENT_invoices" i ON i.id = p.invoice_id
WHERE p.lease_id = '0eea0850-4945-4a13-a609-a1f132758bfa'
   OR p.invoice_id IN (
     SELECT id FROM "RENT_invoices" 
     WHERE lease_id = '0eea0850-4945-4a13-a609-a1f132758bfa'
   )
ORDER BY p.payment_date DESC;

-- ============================================
-- ALTERNATIVE: Single comprehensive query
-- ============================================
SELECT 
  '=== COMPREHENSIVE CHECK ===' AS section,
  p.id AS property_id,
  p.address AS property_address,
  l.id AS lease_id,
  l.lease_start_date,
  l.status AS lease_status,
  t.full_name AS tenant_name,
  i.id AS invoice_id,
  i.due_date,
  i.status AS invoice_status,
  i.amount_total,
  i.amount_paid,
  i.balance_due,
  CASE 
    WHEN i.due_date >= l.lease_start_date 
     AND i.due_date <= CURRENT_DATE
     AND i.status = 'OPEN'
     AND i.balance_due::numeric > 0
    THEN '✅ INCLUDED'
    ELSE '❌ EXCLUDED'
  END AS payments_page_status,
  COUNT(pay.id) AS payment_count,
  COALESCE(SUM(pay.amount::numeric), 0) AS total_payments
FROM "RENT_properties" p
LEFT JOIN "RENT_leases" l ON l.property_id = p.id
LEFT JOIN "RENT_tenants" t ON t.id = l.tenant_id
LEFT JOIN "RENT_invoices" i ON i.lease_id = l.id OR i.property_id = p.id
LEFT JOIN "RENT_payments" pay ON pay.invoice_id = i.id
WHERE p.address ILIKE '%140 Anthony%'
   OR p.address ILIKE '%Anthony%'
   OR l.id = '0eea0850-4945-4a13-a609-a1f132758bfa'
GROUP BY p.id, p.address, l.id, l.lease_start_date, l.status, t.full_name, 
         i.id, i.due_date, i.status, i.amount_total, i.amount_paid, i.balance_due
ORDER BY i.due_date DESC NULLS LAST;
