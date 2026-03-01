-- Add 'other' as a valid property_type value
-- Run this in your Supabase SQL editor

-- First, check if there's a CHECK constraint on property_type
-- If there is, we need to drop it and recreate it with 'other' included

-- Drop existing constraint if it exists (adjust constraint name if different)
DO $$
BEGIN
    -- Try to drop the constraint if it exists
    ALTER TABLE "RENT_properties" 
    DROP CONSTRAINT IF EXISTS "check_property_type";
EXCEPTION
    WHEN undefined_object THEN
        -- Constraint doesn't exist, which is fine
        NULL;
END $$;

-- Add new constraint that includes 'other'
ALTER TABLE "RENT_properties"
ADD CONSTRAINT "check_property_type" 
CHECK ("property_type" IN ('house', 'doublewide', 'singlewide', 'loan', 'other') OR "property_type" IS NULL);

-- Verify the constraint was added
SELECT 
    conname AS constraint_name,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'RENT_properties'::regclass
AND conname = 'check_property_type';
