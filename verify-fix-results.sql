-- ============================================
-- VERIFICATION QUERIES - Run these to confirm the fix worked
-- ============================================

-- Query 1: Count invoices that still have the problem (should be 0)
-- Using LEFT JOIN approach for better compatibility
SELECT COUNT(DISTINCT i.id) as remaining_problematic_invoices
FROM "RENT_invoices" i
LEFT JOIN "RENT_payments" p1 ON p1.invoice_id = i.id
LEFT JOIN "RENT_payments" p2 ON p2.lease_id = i.lease_id 
  AND p2.payment_date >= i.period_start 
  AND p2.payment_date <= i.period_end
WHERE i.amount_paid > 0
  AND p1.id IS NULL
  AND p2.id IS NULL;

-- Query 2: Check the specific Sept 24 invoice
SELECT 
    i.id,
    i.invoice_no,
    i.due_date,
    i.amount_total,
    i.amount_paid,
    i.balance_due,
    i.status,
    (SELECT COUNT(*) FROM "RENT_payments" p WHERE p.invoice_id = i.id) as payment_count,
    (SELECT COALESCE(SUM(p.amount), 0) FROM "RENT_payments" p WHERE p.invoice_id = i.id) as payment_total
FROM "RENT_invoices" i
WHERE i.id = '0e89893d-32aa-4939-9509-4c687fb3b1b1';

-- Query 3: Show a sample of invoices that were fixed (limit to 10)
SELECT 
    id,
    invoice_no,
    due_date,
    amount_total,
    amount_paid,
    balance_due,
    status
FROM "RENT_invoices"
WHERE amount_paid = 0
  AND amount_total > 0
  AND status = 'OPEN'
ORDER BY due_date DESC
LIMIT 10;

