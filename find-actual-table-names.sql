-- Find the exact table names in your database
SELECT 
    schemaname,
    tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND (tablename ILIKE '%payment%'
       OR tablename ILIKE '%lease%'
       OR tablename ILIKE '%property%'
       OR tablename ILIKE '%tenant%'
       OR tablename ILIKE '%invoice%')
ORDER BY tablename;

