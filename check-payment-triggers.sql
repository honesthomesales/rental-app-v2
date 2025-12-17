-- ============================================
-- CHECK PAYMENT TRIGGERS
-- ============================================
-- This will show what triggers exist on RENT_payments table
-- ============================================

-- Check all triggers on RENT_payments table
SELECT 
    trigger_name,
    event_manipulation,
    action_statement,
    action_timing
FROM information_schema.triggers
WHERE event_object_table = 'RENT_payments'
ORDER BY trigger_name;

-- Check trigger functions that might reference RENT_payment_allocations
SELECT 
    p.proname as function_name,
    pg_get_functiondef(p.oid) as function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND pg_get_functiondef(p.oid) LIKE '%RENT_payment_allocations%';

