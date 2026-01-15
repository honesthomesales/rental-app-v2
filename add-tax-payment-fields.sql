-- Add tax payment fields and county to RENT_properties table
-- Run this in your Supabase SQL editor

ALTER TABLE "RENT_properties" 
ADD COLUMN IF NOT EXISTS "tax_paid_amount_current" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "tax_paid_amount_previous" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "county" VARCHAR(255);

-- Add tax color state field to store user-selected color state (0-6)
ALTER TABLE "RENT_properties"
ADD COLUMN IF NOT EXISTS "tax_color_state" INTEGER DEFAULT 0;

-- Add comments to describe the columns
COMMENT ON COLUMN "RENT_properties"."tax_paid_amount_current" IS 'Current year tax amount paid';
COMMENT ON COLUMN "RENT_properties"."tax_paid_amount_previous" IS 'Previous year tax amount paid';
COMMENT ON COLUMN "RENT_properties"."county" IS 'County where property is located';
COMMENT ON COLUMN "RENT_properties"."tax_color_state" IS 'Tax overview color state: 0=default, 6=light red (unpaid), 1=yellow (customer owed), 2=light green (customer paid), 3=lime (paid), 4=med red (customer owed), 5=red (owed)';

-- Verify the columns were added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'RENT_properties' 
AND column_name IN ('tax_paid_amount_current', 'tax_paid_amount_previous', 'county', 'tax_color_state');
