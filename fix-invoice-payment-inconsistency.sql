-- ============================================
-- FIX INVOICE PAYMENT INCONSISTENCY
-- ============================================
-- Problem: Some invoices have amount_paid > 0 but no payment records exist
-- Solution: Set amount_paid = 0 and recalculate balance_due for invoices with no payments
-- ============================================

-- ============================================
-- STEP 1: DIAGNOSTIC QUERY
-- ============================================
-- Run this FIRST to see what will be fixed
-- This finds all invoices with amount_paid > 0 but no payment records
-- ============================================

SELECT 
    i.id,
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
    i.amount_paid,  -- This is wrong - should be 0
    i.balance_due,
    i.status,
    -- Count actual payments
    (SELECT COUNT(*) FROM "RENT_payments" p WHERE p.invoice_id = i.id) as linked_payment_count,
    (SELECT COALESCE(SUM(p.amount), 0) FROM "RENT_payments" p WHERE p.invoice_id = i.id) as linked_payment_total,
    -- Check period payments
    (SELECT COUNT(*) 
     FROM "RENT_payments" p 
     WHERE p.lease_id = i.lease_id 
       AND p.payment_date >= i.period_start 
       AND p.payment_date <= i.period_end) as period_payment_count,
    (SELECT COALESCE(SUM(p.amount), 0) 
     FROM "RENT_payments" p 
     WHERE p.lease_id = i.lease_id 
       AND p.payment_date >= i.period_start 
       AND p.payment_date <= i.period_end) as period_payment_total
FROM "RENT_invoices" i
WHERE i.amount_paid > 0
  AND NOT EXISTS (
    -- No payments directly linked to this invoice
    SELECT 1 FROM "RENT_payments" p WHERE p.invoice_id = i.id
  )
  AND NOT EXISTS (
    -- No payments in the invoice period for this lease
    SELECT 1 
    FROM "RENT_payments" p 
    WHERE p.lease_id = i.lease_id 
      AND p.payment_date >= i.period_start 
      AND p.payment_date <= i.period_end
  )
ORDER BY i.due_date DESC;

-- ============================================
-- STEP 2: FIX QUERY (TRANSACTION)
-- ============================================
-- ONLY RUN THIS AFTER REVIEWING STEP 1 RESULTS!
-- This sets amount_paid = 0 and recalculates balance_due
-- Wrapped in transaction - use ROLLBACK to undo, COMMIT to save
-- ============================================

BEGIN;

UPDATE "RENT_invoices" i
SET 
    amount_paid = 0,
    balance_due = amount_total,  -- Recalculate: total - 0 = total
    status = CASE 
        WHEN amount_total > 0 THEN 'OPEN'
        ELSE 'PAID'
    END,
    paid_in_full_at = NULL
WHERE i.amount_paid > 0
  AND NOT EXISTS (
    -- No payments directly linked to this invoice
    SELECT 1 FROM "RENT_payments" p WHERE p.invoice_id = i.id
  )
  AND NOT EXISTS (
    -- No payments in the invoice period for this lease
    SELECT 1 
    FROM "RENT_payments" p 
    WHERE p.lease_id = i.lease_id 
      AND p.payment_date >= i.period_start 
      AND p.payment_date <= i.period_end
  );

-- Show what was updated
SELECT 
    id,
    invoice_no,
    due_date,
    amount_total,
    amount_paid as new_amount_paid,
    balance_due as new_balance_due,
    status as new_status
FROM "RENT_invoices"
WHERE id IN (
    SELECT i.id
    FROM "RENT_invoices" i
    WHERE i.amount_paid = 0  -- Just updated
      AND i.amount_total > 0
      AND i.status = 'OPEN'
    ORDER BY i.due_date DESC
    LIMIT 50
);

-- ROLLBACK;  -- Uncomment to undo changes
-- COMMIT;    -- Uncomment to save changes

-- ============================================
-- STEP 3: VERIFICATION QUERY
-- ============================================
-- Run this AFTER the fix to verify everything is correct
-- ============================================

SELECT 
    'Invoices with amount_paid > 0 but no payments' as check_type,
    COUNT(*) as count
FROM "RENT_invoices" i
WHERE i.amount_paid > 0
  AND NOT EXISTS (
    SELECT 1 FROM "RENT_payments" p WHERE p.invoice_id = i.id
  )
  AND NOT EXISTS (
    SELECT 1 
    FROM "RENT_payments" p 
    WHERE p.lease_id = i.lease_id 
      AND p.payment_date >= i.period_start 
      AND p.payment_date <= i.period_end
  )

UNION ALL

SELECT 
    'Total invoices with amount_paid > 0' as check_type,
    COUNT(*) as count
FROM "RENT_invoices"
WHERE amount_paid > 0

UNION ALL

SELECT 
    'Total invoices with payment records' as check_type,
    COUNT(DISTINCT invoice_id) as count
FROM "RENT_payments"
WHERE invoice_id IS NOT NULL;

-- ============================================
-- STEP 4: CHECK SPECIFIC INVOICE (Sept 24)
-- ============================================
-- Verify the fix worked for the specific invoice
-- ============================================
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

