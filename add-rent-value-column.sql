-- Add rent_value column to RENT_properties table
-- Run this in your Supabase SQL editor

ALTER TABLE "RENT_properties" 
ADD COLUMN IF NOT EXISTS "rent_value" DECIMAL(10,2) DEFAULT 0;

-- Add a comment to describe the column
COMMENT ON COLUMN "RENT_properties"."rent_value" IS 'Monthly rent value for potential income calculation';

-- Update existing properties with some sample rent values (optional)
-- You can uncomment and modify these as needed
/*
UPDATE "RENT_properties" 
SET "rent_value" = 1000.00 
WHERE "property_type" = 'house' AND "rent_value" = 0;

UPDATE "RENT_properties" 
SET "rent_value" = 800.00 
WHERE "property_type" = 'doublewide' AND "rent_value" = 0;

UPDATE "RENT_properties" 
SET "rent_value" = 600.00 
WHERE "property_type" = 'singlewide' AND "rent_value" = 0;
*/

-- Verify the column was added
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'RENT_properties' 
AND column_name = 'rent_value';
