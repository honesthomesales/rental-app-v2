-- ============================================
-- LINK UNLINKED PAYMENTS - STEP BY STEP
-- ============================================
-- Run each STEP separately in Supabase SQL Editor
-- ============================================

-- ============================================
-- STEP 1: DIAGNOSTIC - Check unlinked payments
-- ============================================
-- Copy and run this query first
SELECT 
    COUNT(*) as unlinked_payment_count,
    COALESCE(SUM(amount), 0) as unlinked_payment_total,
    COUNT(DISTINCT lease_id) as affected_leases
FROM "RENT_payments"
WHERE invoice_id IS NULL;

-- ============================================
-- STEP 2: See sample of unlinked payments
-- ============================================
-- Optional - run this to see what will be processed
SELECT 
    p.id,
    p.lease_id,
    p.amount,
    p.payment_date,
    p.payment_type,
    p.created_at
FROM "RENT_payments" p
WHERE p.invoice_id IS NULL
ORDER BY p.payment_date ASC, p.created_at ASC
LIMIT 20;

-- ============================================
-- STEP 3: FIX - Link all unlinked payments
-- ============================================
-- Copy and run THIS ENTIRE BLOCK (it's one query)
-- This will process all unlinked payments and link them to invoices
DO $$
DECLARE
    payment_record RECORD;
    success_count INTEGER := 0;
    error_count INTEGER := 0;
    total_payments INTEGER;
BEGIN
    -- Count total unlinked payments
    SELECT COUNT(*) INTO total_payments
    FROM "RENT_payments"
    WHERE invoice_id IS NULL;
    
    RAISE NOTICE 'Found % unlinked payments to process', total_payments;
    
    -- Process each unlinked payment in chronological order
    FOR payment_record IN 
        SELECT id, payment_date, lease_id, amount
        FROM "RENT_payments"
        WHERE invoice_id IS NULL
        ORDER BY payment_date ASC, created_at ASC
    LOOP
        BEGIN
            -- Call FIFO allocation RPC
            PERFORM rent_apply_payment_fifo(
                payment_record.id,
                payment_record.payment_date::timestamp
            );
            
            success_count := success_count + 1;
            
            -- Log progress every 10 payments
            IF success_count % 10 = 0 THEN
                RAISE NOTICE 'Processed % payments...', success_count;
            END IF;
            
        EXCEPTION WHEN OTHERS THEN
            error_count := error_count + 1;
            RAISE WARNING 'Failed to allocate payment % (lease: %, amount: %): %', 
                payment_record.id, 
                payment_record.lease_id,
                payment_record.amount,
                SQLERRM;
        END;
    END LOOP;
    
    RAISE NOTICE '=== ALLOCATION COMPLETE ===';
    RAISE NOTICE 'Successful: %', success_count;
    RAISE NOTICE 'Errors: %', error_count;
    RAISE NOTICE 'Total processed: %', success_count + error_count;
END $$;

-- ============================================
-- STEP 4: VERIFICATION - Check linking results
-- ============================================
-- Run this after Step 3 to see if linking worked
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
WHERE invoice_id IS NOT NULL

UNION ALL

SELECT 
    'Invoices with linked payments' as status,
    COUNT(DISTINCT invoice_id) as count,
    0 as total_amount
FROM "RENT_payments"
WHERE invoice_id IS NOT NULL;

-- ============================================
-- STEP 5: RECALCULATE INVOICE BALANCES
-- ============================================
-- Run THIS ENTIRE BLOCK after Step 3 completes successfully
-- This ensures invoice balances are correct
DO $$
DECLARE
    invoice_record RECORD;
    success_count INTEGER := 0;
    error_count INTEGER := 0;
BEGIN
    RAISE NOTICE 'Recalculating invoice balances...';
    
    -- Recalculate all invoices that have payments
    FOR invoice_record IN 
        SELECT DISTINCT invoice_id as id
        FROM "RENT_payments"
        WHERE invoice_id IS NOT NULL
    LOOP
        BEGIN
            PERFORM rent_invoice_recalc_one(invoice_record.id);
            success_count := success_count + 1;
            
            IF success_count % 50 = 0 THEN
                RAISE NOTICE 'Recalculated % invoices...', success_count;
            END IF;
            
        EXCEPTION WHEN OTHERS THEN
            error_count := error_count + 1;
            RAISE WARNING 'Failed to recalculate invoice %: %', invoice_record.id, SQLERRM;
        END;
    END LOOP;
    
    RAISE NOTICE '=== RECALCULATION COMPLETE ===';
    RAISE NOTICE 'Successful: %', success_count;
    RAISE NOTICE 'Errors: %', error_count;
END $$;

-- ============================================
-- STEP 6: FINAL VERIFICATION
-- ============================================
-- Run this after Step 5 to verify everything is correct
SELECT 
    'Invoices with amount_paid > 0' as check_type,
    COUNT(*) as count
FROM "RENT_invoices"
WHERE amount_paid > 0

UNION ALL

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




