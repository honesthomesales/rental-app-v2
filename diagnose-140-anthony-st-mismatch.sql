-- ============================================
-- DIAGNOSTIC QUERIES: 140 Anthony St / Maria Mateo
-- Issue: Invoice modal shows unpaid invoice ($1,250) but payments page shows $0.00
-- ============================================

-- 1. FIND THE PROPERTY, LEASE, AND TENANT IDs
-- This identifies the exact records we're working with
SELECT 
    '=== PROPERTY, LEASE, AND TENANT INFO ===' AS section,
    p.id AS property_id,
    p.name AS property_name,
    p.address AS property_address,
    l.id AS lease_id,
    l.lease_start_date,
    l.lease_end_date,
    l.status AS lease_status,
    l.rent,
    l.rent_cadence,
    t.id AS tenant_id,
    t.full_name AS tenant_name,
    t.first_name,
    t.last_name
FROM "RENT_properties" p
LEFT JOIN "RENT_leases" l ON l.property_id = p.id AND l.status = 'active'
LEFT JOIN "RENT_tenants" t ON t.id = l.tenant_id
WHERE p.address ILIKE '%140 Anthony%'
   OR p.name ILIKE '%140 Anthony%'
ORDER BY l.lease_start_date DESC;

-- 2. CHECK ALL INVOICES FOR THIS PROPERTY/LEASE
-- This shows what invoices exist and their status
SELECT 
    '=== ALL INVOICES FOR THIS LEASE ===' AS section,
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
    CASE 
        WHEN i.status = 'OPEN' AND i.balance_due > 0 THEN 'UNPAID'
        WHEN i.status = 'OPEN' AND i.balance_due <= 0 THEN 'PAID (OPEN STATUS)'
        WHEN i.status = 'PAID' THEN 'PAID'
        ELSE 'OTHER'
    END AS payment_status,
    CURRENT_DATE AS today_date,
    -- Check if invoice would be included in payments page query
    CASE 
        WHEN i.due_date >= '2025-12-15'::date  -- lease_start_date
         AND i.due_date <= CURRENT_DATE
         AND i.status = 'OPEN'
         AND i.balance_due > 0
        THEN 'YES - WOULD BE COUNTED'
        ELSE 'NO - NOT COUNTED'
    END AS would_be_included_in_payments_page
FROM "RENT_invoices" i
WHERE i.lease_id = '0eea0850-4945-4a13-a609-a1f132758bfa'
   OR i.property_id = '401180e3-2cef-41e7-aefe-28f582545276'
ORDER BY i.due_date DESC;

-- 3. SPECIFIC CHECK: INVOICE WITH DUE DATE JAN 1, 2026
-- This checks the exact invoice shown in the modal
SELECT 
    '=== INVOICE DUE JAN 1, 2026 (FROM MODAL) ===' AS section,
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
    -- Why this invoice might NOT be counted on payments page:
    CASE 
        WHEN i.due_date > CURRENT_DATE THEN 'FUTURE DATE - Payments page filters: to=' || CURRENT_DATE || ' (excludes future)'
        WHEN i.status != 'OPEN' THEN 'STATUS IS NOT OPEN - Payments page filters: status=''OPEN'''
        WHEN i.balance_due <= 0 THEN 'BALANCE_DUE IS 0 OR NEGATIVE - Payments page filters: balance_due > 0'
        WHEN i.due_date < '2025-12-15'::date 
        THEN 'DUE_DATE BEFORE LEASE START (2025-12-15) - Payments page filters: from=lease_start_date'
        ELSE 'SHOULD BE COUNTED'
    END AS why_not_counted,
    CURRENT_DATE AS today_date,
    '2025-12-15'::date AS lease_start_date
FROM "RENT_invoices" i
WHERE i.due_date = '2026-01-01'
  AND i.property_id = '401180e3-2cef-41e7-aefe-28f582545276'
ORDER BY i.due_date DESC;

-- 4. CHECK PAYMENTS LINKED TO THE JAN 1, 2026 INVOICE
-- This verifies if payments exist that might affect balance_due
SELECT 
    '=== PAYMENTS FOR JAN 1, 2026 INVOICE ===' AS section,
    p.id AS payment_id,
    p.invoice_id,
    p.lease_id,
    p.property_id,
    p.payment_date,
    p.amount,
    p.payment_type,
    p.payment_method,
    p.status AS payment_status,
    p.notes,
    i.balance_due AS invoice_balance_due,
    i.amount_paid AS invoice_amount_paid,
    i.amount_total AS invoice_amount_total
FROM "RENT_payments" p
INNER JOIN "RENT_invoices" i ON i.id = p.invoice_id
WHERE i.due_date = '2026-01-01'
  AND i.property_id = '401180e3-2cef-41e7-aefe-28f582545276'
ORDER BY p.payment_date DESC;

-- 5. COMPARE: WHAT PAYMENTS PAGE QUERY WOULD RETURN
-- This simulates the exact query the payments page makes
SELECT 
    '=== SIMULATED PAYMENTS PAGE QUERY RESULTS ===' AS section,
    i.id AS invoice_id,
    i.invoice_no,
    i.due_date,
    i.status,
    i.balance_due,
    i.amount_total,
    i.amount_paid,
    -- Payments page filters:
    -- 1. from=lease_start_date (2025-12-15)
    -- 2. to=today (CURRENT_DATE)
    -- 3. status='OPEN'
    -- 4. balance_due > 0
    CASE 
        WHEN i.due_date >= '2025-12-15'::date  -- lease_start_date
         AND i.due_date <= CURRENT_DATE
         AND i.status = 'OPEN'
         AND i.balance_due > 0
        THEN 'INCLUDED IN TOTAL_OWED'
        ELSE 'EXCLUDED'
    END AS included_in_total_owed,
    -- Show why excluded
    CASE 
        WHEN i.due_date > CURRENT_DATE THEN 'Future date excluded (to=' || CURRENT_DATE || ')'
        WHEN i.status != 'OPEN' THEN 'Status is ' || i.status || ' (not OPEN)'
        WHEN i.balance_due <= 0 THEN 'balance_due is ' || i.balance_due || ' (not > 0)'
        WHEN i.due_date < '2025-12-15'::date THEN 'Due date before lease start (2025-12-15)'
        ELSE 'Should be included'
    END AS exclusion_reason
FROM "RENT_invoices" i
WHERE i.lease_id = '0eea0850-4945-4a13-a609-a1f132758bfa'
  AND i.due_date >= '2025-12-15'::date  -- lease_start_date
  AND i.due_date <= CURRENT_DATE
ORDER BY i.due_date DESC;

-- 6. CALCULATE WHAT TOTAL_OWED SHOULD BE
-- This shows the exact calculation the payments page does
SELECT 
    '=== EXPECTED TOTAL_OWED CALCULATION ===' AS section,
    COUNT(*) AS unpaid_invoices_count,
    SUM(i.balance_due) AS total_owed_calculation,
    -- Breakdown
    SUM(CASE WHEN i.due_date < CURRENT_DATE THEN i.balance_due ELSE 0 END) AS past_due_amount,
    SUM(CASE WHEN i.due_date = CURRENT_DATE THEN i.balance_due ELSE 0 END) AS due_today_amount,
    SUM(CASE WHEN i.due_date > CURRENT_DATE THEN i.balance_due ELSE 0 END) AS future_due_amount,
    -- Show each invoice contributing to total
    STRING_AGG(
        i.invoice_no || ' ($' || i.balance_due || ')', 
        ', ' 
        ORDER BY i.due_date
    ) AS contributing_invoices
FROM "RENT_invoices" i
WHERE i.lease_id = '0eea0850-4945-4a13-a609-a1f132758bfa'
  AND i.status = 'OPEN'
  AND i.balance_due > 0
  AND i.due_date >= '2025-12-15'::date  -- lease_start_date
  AND i.due_date <= CURRENT_DATE;

-- 7. CHECK IF INVOICE STATUS OR BALANCE_DUE WAS RECENTLY CHANGED
-- This helps identify if there was a recent update that might explain the mismatch
SELECT 
    '=== RECENT INVOICE UPDATES (LAST 7 DAYS) ===' AS section,
    i.id AS invoice_id,
    i.invoice_no,
    i.due_date,
    i.status,
    i.balance_due,
    i.amount_paid,
    i.updated_at,
    AGE(NOW(), i.updated_at) AS time_since_update
FROM "RENT_invoices" i
WHERE i.property_id = '401180e3-2cef-41e7-aefe-28f582545276'
  AND i.updated_at >= NOW() - INTERVAL '7 days'
ORDER BY i.updated_at DESC;

-- 8. CHECK FOR PAYMENTS THAT MIGHT HAVE BEEN RECENTLY ADDED/REMOVED
-- This checks if payments were recently modified
SELECT 
    '=== RECENT PAYMENT CHANGES (LAST 7 DAYS) ===' AS section,
    p.id AS payment_id,
    p.invoice_id,
    p.payment_date,
    p.amount,
    p.status,
    p.updated_at,
    i.due_date AS invoice_due_date,
    i.balance_due AS current_invoice_balance,
    AGE(NOW(), p.updated_at) AS time_since_update
FROM "RENT_payments" p
INNER JOIN "RENT_invoices" i ON i.id = p.invoice_id
WHERE i.property_id = '401180e3-2cef-41e7-aefe-28f582545276'
  AND p.updated_at >= NOW() - INTERVAL '7 days'
ORDER BY p.updated_at DESC;

-- ============================================
-- SUMMARY: KEY FINDINGS TO CHECK
-- ============================================
-- 1. Is the invoice due_date (2026-01-01) AFTER today's date?
--    If yes: Payments page filters exclude future invoices (to=today)
-- 2. Is the invoice status = 'OPEN'?
--    If no: Payments page only counts OPEN invoices
-- 3. Is balance_due > 0?
--    If no: Payments page only counts invoices with balance_due > 0
-- 4. Is the invoice due_date >= lease_start_date?
--    If no: Payments page filters exclude invoices before lease start
-- 5. Are there payments linked to this invoice that reduce balance_due?
--    If yes: balance_due might be 0 even if invoice shows unpaid
-- ============================================
