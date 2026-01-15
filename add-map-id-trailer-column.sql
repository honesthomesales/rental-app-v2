-- Add map_id_trailer column to RENT_properties table
-- Run this in your Supabase SQL editor

ALTER TABLE "RENT_properties" 
ADD COLUMN IF NOT EXISTS "map_id_trailer" VARCHAR(255);

-- Add a comment to describe the column
COMMENT ON COLUMN "RENT_properties"."map_id_trailer" IS 'Trailer number associated with Map ID';

-- Verify the column was added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'RENT_properties' 
AND column_name = 'map_id_trailer';
