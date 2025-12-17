-- ============================================
-- CHECK rent_on_payment_update FUNCTION
-- ============================================
-- This function is called by the trigger when a payment is updated
-- ============================================

-- Get the function definition
SELECT 
    p.proname as function_name,
    pg_get_functiondef(p.oid) as function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'rent_on_payment_update';

-- Alternative: Check if function exists and what it references
SELECT 
    routine_name,
    routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'rent_on_payment_update';

