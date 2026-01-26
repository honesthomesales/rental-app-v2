-- ============================================
-- CHECK RENT_apply_payment FUNCTION
-- ============================================
-- This function is called by RENT_rebuild_one_payment
-- ============================================

-- Get the function definition
SELECT 
    p.proname as function_name,
    pg_get_functiondef(p.oid) as function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'rent_apply_payment';



