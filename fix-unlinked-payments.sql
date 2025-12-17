-- ============================================
-- FIX UNLINKED PAYMENTS
-- ============================================
-- Problem: Payments exist but are not linked to invoices (invoice_id is NULL)
-- Solution: Run FIFO allocation RPC for all unlinked payments, then recalculate invoices
-- ============================================

-- STEP 1: Check how many unlinked payments exist
SELECT 
    COUNT(*) as unlinked_payment_count,
    COALESCE(SUM(amount), 0) as unlinked_payment_total
FROM "RENT_payments"
WHERE invoice_id IS NULL;

-- STEP 2: Get list of unlinked payments with lease info
SELECT 
    p.id,
    p.lease_id,
    p.amount,
    p.payment_date,
    p.payment_type,
    l.property_id,
    l.tenant_id
FROM "RENT_payments" p
LEFT JOIN "RENT_leases" l ON l.id = p.lease_id
WHERE p.invoice_id IS NULL
ORDER BY p.payment_date ASC, p.created_at ASC;

-- STEP 3: Run FIFO allocation for each unlinked payment
-- This will link payments to invoices and update invoice balances
-- Run this in a loop for each payment, or create a function to do it

-- Example for a single payment (replace with actual payment ID):
-- SELECT rent_apply_payment_fifo('payment-id-here', '2025-01-01T00:00:00Z'::timestamp);

-- STEP 4: After running FIFO allocation, verify linking worked
SELECT 
    COUNT(*) as linked_payment_count,
    COUNT(DISTINCT invoice_id) as invoices_with_payments,
    COALESCE(SUM(amount), 0) as linked_payment_total
FROM "RENT_payments"
WHERE invoice_id IS NOT NULL;

-- STEP 5: Recalculate all invoices for affected leases
-- This ensures invoice balances are correct after linking
SELECT 
    l.id as lease_id,
    COUNT(DISTINCT i.id) as invoice_count
FROM "RENT_leases" l
INNER JOIN "RENT_invoices" i ON i.lease_id = l.id
WHERE l.id IN (
    SELECT DISTINCT lease_id 
    FROM "RENT_payments" 
    WHERE invoice_id IS NULL
)
GROUP BY l.id;

-- For each lease, run:
-- SELECT rent_invoice_recalc_one('invoice-id-here');

-- ============================================
-- AUTOMATED FIX SCRIPT
-- ============================================
-- This script will attempt to link all unlinked payments
-- WARNING: Run in a transaction and review before committing
-- ============================================

BEGIN;

-- Create a temporary function to process all unlinked payments
DO $$
DECLARE
    payment_record RECORD;
    allocation_result RECORD;
    error_count INTEGER := 0;
    success_count INTEGER := 0;
BEGIN
    -- Loop through all unlinked payments in chronological order
    FOR payment_record IN 
        SELECT id, payment_date, lease_id
        FROM "RENT_payments"
        WHERE invoice_id IS NULL
        ORDER BY payment_date ASC, created_at ASC
    LOOP
        BEGIN
            -- Call FIFO allocation RPC
            SELECT * INTO allocation_result
            FROM rent_apply_payment_fifo(
                payment_record.id,
                payment_record.payment_date::timestamp
            );
            
            success_count := success_count + 1;
            RAISE NOTICE 'Successfully allocated payment %', payment_record.id;
        EXCEPTION WHEN OTHERS THEN
            error_count := error_count + 1;
            RAISE WARNING 'Failed to allocate payment %: %', payment_record.id, SQLERRM;
        END;
    END LOOP;
    
    RAISE NOTICE 'Allocation complete: % successful, % errors', success_count, error_count;
END $$;

-- Recalculate invoices for all affected leases
DO $$
DECLARE
    invoice_record RECORD;
    recalc_result RECORD;
    error_count INTEGER := 0;
    success_count INTEGER := 0;
BEGIN
    -- Get all invoices for leases that had unlinked payments
    FOR invoice_record IN 
        SELECT DISTINCT i.id
        FROM "RENT_invoices" i
        WHERE i.lease_id IN (
            SELECT DISTINCT lease_id 
            FROM "RENT_payments" 
            WHERE invoice_id IS NOT NULL
        )
    LOOP
        BEGIN
            -- Recalculate invoice
            SELECT * INTO recalc_result
            FROM rent_invoice_recalc_one(invoice_record.id);
            
            success_count := success_count + 1;
        EXCEPTION WHEN OTHERS THEN
            error_count := error_count + 1;
            RAISE WARNING 'Failed to recalculate invoice %: %', invoice_record.id, SQLERRM;
        END;
    END LOOP;
    
    RAISE NOTICE 'Invoice recalculation complete: % successful, % errors', success_count, error_count;
END $$;

-- Show final status
SELECT 
    'Unlinked payments remaining' as status,
    COUNT(*) as count
FROM "RENT_payments"
WHERE invoice_id IS NULL

UNION ALL

SELECT 
    'Linked payments' as status,
    COUNT(*) as count
FROM "RENT_payments"
WHERE invoice_id IS NOT NULL;

-- ROLLBACK;  -- Uncomment to undo changes
-- COMMIT;    -- Uncomment to save changes

