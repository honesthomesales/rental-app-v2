-- ============================================
-- DIAGNOSTIC QUERIES FOR SEPT 24 INVOICE PAYMENTS
-- ============================================
-- Invoice ID from modal: bde0ed30-ba73-4d93-8aaa-bbaeeab5f74e
-- Invoice No: INV-bde0ed30-ba73-4d93-8aaa-bbaeeab5f74e-20250924
-- Due Date: 2025-09-24
-- Period: Sep 24 - Oct 7
-- ============================================

-- 1. CHECK THE INVOICE RECORD ITSELF
-- This shows what's stored in the invoice table
SELECT 
    id,
    invoice_no,
    lease_id,
    property_id,
    due_date,
    period_start,
    period_end,
    amount_rent,
    amount_late,
    amount_other,
    amount_total,
    amount_paid,  -- This is what shows $600 in the first view
    balance_due,
    status,
    created_at
FROM "RENT_invoices"
WHERE id = 'bde0ed30-ba73-4d93-8aaa-bbaeeab5f74e'
   OR invoice_no LIKE '%20250924%'
ORDER BY due_date DESC;

-- 2. CHECK PAYMENTS DIRECTLY LINKED TO THIS INVOICE
-- This is what the API query looks for first (invoice_id = invoice.id)
SELECT 
    id,
    invoice_id,
    lease_id,
    property_id,
    tenant_id,
    payment_date,
    amount,
    payment_type,
    payment_method,
    status,
    notes,
    created_at
FROM "RENT_payments"
WHERE invoice_id = 'bde0ed30-ba73-4d93-8aaa-bbaeeab5f74e'
ORDER BY payment_date DESC;

-- 3. GET THE LEASE_ID FROM THE INVOICE TO FIND RELATED PAYMENTS
-- First, get the lease_id from the invoice
SELECT 
    i.id as invoice_id,
    i.invoice_no,
    i.lease_id,
    i.property_id,
    i.due_date,
    i.period_start,
    i.period_end,
    l.property_id as lease_property_id
FROM "RENT_invoices" i
LEFT JOIN "RENT_leases" l ON l.id = i.lease_id
WHERE i.id = 'bde0ed30-ba73-4d93-8aaa-bbaeeab5f74e';

-- 4. CHECK ALL PAYMENTS FOR THE LEASE IN THE INVOICE PERIOD
-- This matches what the API does for "period payments"
-- Replace 'LEASE_ID_HERE' with the lease_id from query #3
SELECT 
    id,
    invoice_id,
    lease_id,
    property_id,
    tenant_id,
    payment_date,
    amount,
    payment_type,
    payment_method,
    status,
    notes,
    CASE 
        WHEN invoice_id = 'bde0ed30-ba73-4d93-8aaa-bbaeeab5f74e' THEN 'LINKED TO INVOICE'
        WHEN invoice_id IS NULL THEN 'NO INVOICE_ID SET'
        ELSE 'LINKED TO DIFFERENT INVOICE: ' || invoice_id
    END as link_status
FROM "RENT_payments"
WHERE lease_id = (SELECT lease_id FROM "RENT_invoices" WHERE id = 'bde0ed30-ba73-4d93-8aaa-bbaeeab5f74e')
  AND payment_date >= '2025-09-24'  -- period_start
  AND payment_date <= '2025-10-07'  -- period_end
ORDER BY payment_date DESC;

-- 5. CHECK ALL PAYMENTS FOR THE LEASE (NO DATE FILTER)
-- This is the fallback query if period search finds nothing
-- Replace 'LEASE_ID_HERE' with the lease_id from query #3
SELECT 
    id,
    invoice_id,
    lease_id,
    property_id,
    tenant_id,
    payment_date,
    amount,
    payment_type,
    payment_method,
    status,
    notes,
    CASE 
        WHEN invoice_id = 'bde0ed30-ba73-4d93-8aaa-bbaeeab5f74e' THEN 'LINKED TO INVOICE'
        WHEN invoice_id IS NULL THEN 'NO INVOICE_ID SET'
        ELSE 'LINKED TO DIFFERENT INVOICE: ' || invoice_id
    END as link_status
FROM "RENT_payments"
WHERE lease_id = (SELECT lease_id FROM "RENT_invoices" WHERE id = 'bde0ed30-ba73-4d93-8aaa-bbaeeab5f74e')
ORDER BY payment_date DESC
LIMIT 20;

-- 6. CHECK PAYMENTS BY PROPERTY_ID (if lease_id doesn't match)
-- Sometimes payments are linked by property_id instead
SELECT 
    p.id,
    p.invoice_id,
    p.lease_id,
    p.property_id,
    p.tenant_id,
    p.payment_date,
    p.amount,
    p.payment_type,
    p.payment_method,
    p.status,
    p.notes,
    CASE 
        WHEN p.invoice_id = 'bde0ed30-ba73-4d93-8aaa-bbaeeab5f74e' THEN 'LINKED TO INVOICE'
        WHEN p.invoice_id IS NULL THEN 'NO INVOICE_ID SET'
        ELSE 'LINKED TO DIFFERENT INVOICE: ' || p.invoice_id
    END as link_status
FROM "RENT_payments" p
WHERE p.property_id = (SELECT property_id FROM "RENT_invoices" WHERE id = 'bde0ed30-ba73-4d93-8aaa-bbaeeab5f74e')
  AND p.payment_date >= '2025-09-24'
  AND p.payment_date <= '2025-10-07'
ORDER BY p.payment_date DESC;

-- 7. SUMMARY: TOTAL PAYMENTS THAT SHOULD SHOW $600
-- This calculates what payments exist that total $600
SELECT 
    'Total from invoice.amount_paid' as source,
    (SELECT amount_paid FROM "RENT_invoices" WHERE id = 'bde0ed30-ba73-4d93-8aaa-bbaeeab5f74e') as total_amount
UNION ALL
SELECT 
    'Total from linked payments' as source,
    COALESCE(SUM(amount), 0) as total_amount
FROM "RENT_payments"
WHERE invoice_id = 'bde0ed30-ba73-4d93-8aaa-bbaeeab5f74e'
UNION ALL
SELECT 
    'Total from period payments (Sep 24 - Oct 7)' as source,
    COALESCE(SUM(amount), 0) as total_amount
FROM "RENT_payments"
WHERE lease_id = (SELECT lease_id FROM "RENT_invoices" WHERE id = 'bde0ed30-ba73-4d93-8aaa-bbaeeab5f74e')
  AND payment_date >= '2025-09-24'
  AND payment_date <= '2025-10-07';

-- 8. FIND PAYMENTS THAT MIGHT BE THE $600 BUT NOT LINKED
-- Look for payments around Sept 24 that total $600
SELECT 
    payment_date,
    SUM(amount) as daily_total,
    COUNT(*) as payment_count,
    STRING_AGG(id::text, ', ') as payment_ids,
    STRING_AGG(COALESCE(invoice_id::text, 'NULL'), ', ') as invoice_ids
FROM "RENT_payments"
WHERE lease_id = (SELECT lease_id FROM "RENT_invoices" WHERE id = 'bde0ed30-ba73-4d93-8aaa-bbaeeab5f74e')
  AND payment_date >= '2025-09-01'
  AND payment_date <= '2025-10-31'
GROUP BY payment_date
HAVING SUM(amount) > 0
ORDER BY payment_date DESC;

