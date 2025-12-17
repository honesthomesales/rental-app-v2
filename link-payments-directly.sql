-- ============================================
-- LINK PAYMENTS DIRECTLY TO INVOICES
-- ============================================
-- Alternative approach: Link payments to invoices based on date/lease matching
-- ============================================

-- STEP 1: Check what the FIFO RPC actually does
-- Run this to see if there are any allocations or if it updates payments
SELECT 
    'Checking if RPC function exists' as step,
    COUNT(*) as result
FROM pg_proc 
WHERE proname = 'rent_apply_payment_fifo';

-- STEP 2: Link payments to invoices based on payment date matching invoice period
-- This directly sets invoice_id on payments
UPDATE "RENT_payments" p
SET invoice_id = (
    SELECT i.id
    FROM "RENT_invoices" i
    WHERE i.lease_id = p.lease_id
      AND p.payment_date >= i.period_start
      AND p.payment_date <= i.period_end
      AND i.amount_total > 0
    ORDER BY i.due_date ASC
    LIMIT 1
)
WHERE p.invoice_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM "RENT_invoices" i
    WHERE i.lease_id = p.lease_id
      AND p.payment_date >= i.period_start
      AND p.payment_date <= i.period_end
  );

-- STEP 3: For payments that still don't match (outside period), link to nearest invoice
-- Link to the invoice with the closest due_date
UPDATE "RENT_payments" p
SET invoice_id = (
    SELECT i.id
    FROM "RENT_invoices" i
    WHERE i.lease_id = p.lease_id
      AND i.amount_total > 0
    ORDER BY ABS((i.due_date::date - p.payment_date::date))
    LIMIT 1
)
WHERE p.invoice_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM "RENT_invoices" i
    WHERE i.lease_id = p.lease_id
  );

-- STEP 4: Verify linking results
SELECT 
    'Unlinked payments remaining' as status,
    COUNT(*) as count,
    COALESCE(SUM(amount), 0) as total_amount
FROM "RENT_payments"
WHERE invoice_id IS NULL

UNION ALL

SELECT 
    'Linked payments' as status,
    COUNT(*) as count,
    COALESCE(SUM(amount), 0) as total_amount
FROM "RENT_payments"
WHERE invoice_id IS NOT NULL;

-- STEP 5: Recalculate invoice balances after linking
-- This ensures amount_paid matches the sum of linked payments
UPDATE "RENT_invoices" i
SET 
    amount_paid = COALESCE((
        SELECT SUM(p.amount)
        FROM "RENT_payments" p
        WHERE p.invoice_id = i.id
    ), 0),
    balance_due = i.amount_total - COALESCE((
        SELECT SUM(p.amount)
        FROM "RENT_payments" p
        WHERE p.invoice_id = i.id
    ), 0),
    status = CASE
        WHEN i.amount_total - COALESCE((
            SELECT SUM(p.amount)
            FROM "RENT_payments" p
            WHERE p.invoice_id = i.id
        ), 0) <= 0 THEN 'PAID'
        ELSE 'OPEN'
    END,
    paid_in_full_at = CASE
        WHEN i.amount_total - COALESCE((
            SELECT SUM(p.amount)
            FROM "RENT_payments" p
            WHERE p.invoice_id = i.id
        ), 0) <= 0 THEN NOW()
        ELSE NULL
    END
WHERE EXISTS (
    SELECT 1
    FROM "RENT_payments" p
    WHERE p.invoice_id = i.id
);

-- STEP 6: Final verification
SELECT 
    'Invoices with linked payments' as check_type,
    COUNT(DISTINCT invoice_id) as count
FROM "RENT_payments"
WHERE invoice_id IS NOT NULL

UNION ALL

SELECT 
    'Invoices where amount_paid matches payment total' as check_type,
    COUNT(*) as count
FROM "RENT_invoices" i
WHERE i.amount_paid = (
    SELECT COALESCE(SUM(p.amount), 0)
    FROM "RENT_payments" p
    WHERE p.invoice_id = i.id
)
AND i.amount_paid > 0;

