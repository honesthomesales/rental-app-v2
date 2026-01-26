-- Check all tax-related columns in RENT_properties table
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default,
    character_maximum_length,
    numeric_precision,
    numeric_scale
FROM information_schema.columns 
WHERE table_name = 'RENT_properties' 
AND (
    column_name LIKE '%tax%' 
    OR column_name LIKE '%Tax%'
    OR column_name LIKE '%TAX%'
)
ORDER BY column_name;

-- Also check all columns to see naming patterns
SELECT 
    column_name, 
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'RENT_properties'
ORDER BY column_name;