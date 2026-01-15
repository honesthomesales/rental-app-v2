-- Fix tax columns to be nullable (in case they were created with DEFAULT 0)
-- Run this if you're getting errors updating tax_paid_amount_current or tax_paid_amount_previous

-- First, check current column definitions
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'RENT_properties' 
AND column_name IN ('tax_paid_amount_current', 'tax_paid_amount_previous');

-- Make tax_paid_amount_current nullable (remove DEFAULT if exists)
ALTER TABLE "RENT_properties" 
ALTER COLUMN "tax_paid_amount_current" DROP DEFAULT,
ALTER COLUMN "tax_paid_amount_current" TYPE DECIMAL(10,2),
ALTER COLUMN "tax_paid_amount_current" SET DEFAULT NULL;

-- Make tax_paid_amount_previous nullable (remove DEFAULT if exists)
ALTER TABLE "RENT_properties" 
ALTER COLUMN "tax_paid_amount_previous" DROP DEFAULT,
ALTER COLUMN "tax_paid_amount_previous" TYPE DECIMAL(10,2),
ALTER COLUMN "tax_paid_amount_previous" SET DEFAULT NULL;

-- Verify the changes
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'RENT_properties' 
AND column_name IN ('tax_paid_amount_current', 'tax_paid_amount_previous');