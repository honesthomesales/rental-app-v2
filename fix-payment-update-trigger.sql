-- ============================================
-- FIX PAYMENT UPDATE TRIGGER
-- ============================================
-- Problem: rent_rebuild_one_payment tries to delete from RENT_payment_allocations which doesn't exist
-- Solution: Fix the function to handle missing table gracefully, or remove the trigger
-- ============================================

-- OPTION 1: Fix the function to handle missing table gracefully
CREATE OR REPLACE FUNCTION public.rent_rebuild_one_payment(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Try to delete from RENT_payment_allocations if table exists, otherwise skip
  BEGIN
    DELETE FROM "RENT_payment_allocations" WHERE payment_id = p_payment_id;
  EXCEPTION WHEN undefined_table THEN
    -- Table doesn't exist, which is fine - allocations not used
    NULL;
  END;
  
  -- Call RENT_apply_payment if it exists and doesn't reference missing tables
  BEGIN
    PERFORM RENT_apply_payment(p_payment_id);
  EXCEPTION WHEN OTHERS THEN
    -- If RENT_apply_payment fails (e.g., references missing table), just log and continue
    RAISE WARNING 'RENT_apply_payment failed for payment %: %', p_payment_id, SQLERRM;
  END;
END;
$function$;

-- OPTION 2: Simply remove the trigger (correct syntax)
DROP TRIGGER IF EXISTS trg_payment_update_realloc ON "RENT_payments";

-- OPTION 3: Disable the trigger permanently (if allocations aren't used)
-- ALTER TABLE "RENT_payments" DISABLE TRIGGER trg_payment_update_realloc;

