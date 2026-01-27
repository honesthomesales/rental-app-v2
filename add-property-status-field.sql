-- Add status field to RENT_properties table to support retiring sold properties
-- Run this in your Supabase SQL editor

ALTER TABLE "RENT_properties" 
ADD COLUMN IF NOT EXISTS "status" VARCHAR(20) DEFAULT 'active';

-- Set all existing properties to 'active' if they don't have a status
UPDATE "RENT_properties" 
SET "status" = 'active' 
WHERE "status" IS NULL;

-- Add a check constraint to ensure status is either 'active' or 'retired'
ALTER TABLE "RENT_properties"
ADD CONSTRAINT "check_property_status" CHECK ("status" IN ('active', 'retired'));

-- Add an index for faster filtering
CREATE INDEX IF NOT EXISTS "idx_properties_status" ON "RENT_properties"("status");

-- Add a comment to describe the column
COMMENT ON COLUMN "RENT_properties"."status" IS 'Property status: active (included in current calculations) or retired (sold, excluded from current calculations but history preserved)';
