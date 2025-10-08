-- Check the structure of the existing RENT_expenses table
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'RENT_expenses'
ORDER BY ordinal_position;

-- Check if there are any existing records
SELECT COUNT(*) as record_count FROM RENT_expenses;

-- Show sample data if any exists
SELECT * FROM RENT_expenses LIMIT 5;
