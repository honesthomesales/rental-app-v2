-- Add tax_owed column to store manually entered owed amount
-- This allows users to set the owed amount directly, independent of property_tax

ALTER TABLE "RENT_properties" 
ADD COLUMN IF NOT EXISTS "tax_owed" DECIMAL(10,2);

COMMENT ON COLUMN "RENT_properties"."tax_owed" IS 'Manually set tax amount owed (overrides calculated value if set)';

-- Verify the column was added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'RENT_properties' 
AND column_name = 'tax_owed';