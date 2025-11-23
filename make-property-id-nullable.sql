-- Make property_id nullable in RENT_expenses table to support one-time expenses without properties
-- This allows expenses to be created without requiring a property association

ALTER TABLE "RENT_expenses" 
ALTER COLUMN "property_id" DROP NOT NULL;

-- Add a comment to document this change
COMMENT ON COLUMN "RENT_expenses"."property_id" IS 'Optional property association. NULL for one-time expenses that are not property-specific.';

