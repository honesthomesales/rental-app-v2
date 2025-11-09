-- Fix the address for 243 Artemus Ward property
-- The address should be "243 Artemus Ward" not just "243 Artemas" or similar

-- Update the property address to include "Ward" in the street name
UPDATE "RENT_properties"
SET 
  address = '243 Artemus Ward',
  city = 'Spartanburg',
  state = 'SC',
  zip_code = '29307'
WHERE 
  address ILIKE '%243%Artem%'
  AND (address NOT ILIKE '%Ward%' OR address ILIKE '%243 Artem%' OR address = '243 Artemus');

-- Verify the update
SELECT id, name, address, city, state, zip_code
FROM "RENT_properties"
WHERE address ILIKE '%243%Artem%';

