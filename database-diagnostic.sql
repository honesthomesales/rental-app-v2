-- Database diagnostic queries to understand the actual schema
-- Run these one by one to understand what exists

-- 1. Check what invoice tables/views exist
SELECT table_name, table_type 
FROM information_schema.tables 
WHERE table_name LIKE '%invoice%' 
ORDER BY table_name;

-- 2. Check columns in RENT_invoices table (if it exists)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'RENT_invoices'
ORDER BY ordinal_position;

-- 3. Check columns in RENT_invoice_status_v view (if it exists)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'RENT_invoice_status_v'
ORDER BY ordinal_position;

-- 4. Check what lease tables exist
SELECT table_name, table_type 
FROM information_schema.tables 
WHERE table_name LIKE '%lease%' 
ORDER BY table_name;

-- 5. Check columns in RENT_leases table
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'RENT_leases'
ORDER BY ordinal_position;
