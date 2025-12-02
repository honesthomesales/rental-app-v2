-- Diagnostic query to identify rent collected discrepancy
-- This will help find payments missing property_id or with incorrect assignments

-- First, let's find the Macedonia property ID
SELECT 
    id,
    name,
    address
FROM RENT_properties
WHERE name ILIKE '%macedonia%' OR address ILIKE '%macedonia%';

-- Then, let's check payments for the current month (or specify a month)
-- Replace '2025-11' with the month you're investigating (format: YYYY-MM)
WITH month_range AS (
    SELECT 
        '2025-11-01'::date AS start_date,
        (DATE_TRUNC('month', '2025-11-01'::date) + INTERVAL '1 month - 1 day')::date AS end_date
)
SELECT 
    '=== PAYMENTS SUMMARY FOR MONTH ===' AS section,
    NULL::text AS property_id,
    NULL::text AS property_name,
    COUNT(*) AS payment_count,
    SUM(amount) AS total_amount,
    NULL::date AS payment_date
FROM RENT_payments, month_range
WHERE payment_date >= month_range.start_date 
  AND payment_date <= month_range.end_date

UNION ALL

SELECT 
    '=== PAYMENTS WITH NULL PROPERTY_ID ===' AS section,
    NULL::text AS property_id,
    NULL::text AS property_name,
    COUNT(*) AS payment_count,
    SUM(amount) AS total_amount,
    NULL::date AS payment_date
FROM RENT_payments, month_range
WHERE payment_date >= month_range.start_date 
  AND payment_date <= month_range.end_date
  AND property_id IS NULL

UNION ALL

SELECT 
    '=== PAYMENTS BY PROPERTY ===' AS section,
    COALESCE(p.property_id::text, 'NULL') AS property_id,
    COALESCE(prop.name, 'NO PROPERTY ASSIGNED') AS property_name,
    COUNT(*) AS payment_count,
    SUM(p.amount) AS total_amount,
    NULL::date AS payment_date
FROM RENT_payments p
LEFT JOIN RENT_properties prop ON p.property_id = prop.id
CROSS JOIN month_range
WHERE p.payment_date >= month_range.start_date 
  AND p.payment_date <= month_range.end_date
GROUP BY p.property_id, prop.name
ORDER BY total_amount DESC;

-- Detailed breakdown: Show all payments for Macedonia property
-- Replace 'YOUR_MACEDONIA_PROPERTY_ID' with the actual ID from the first query
SELECT 
    '=== MACEDONIA PROPERTY PAYMENTS (DETAILED) ===' AS section,
    p.id AS payment_id,
    p.payment_date,
    p.amount,
    p.payment_type,
    p.notes,
    p.property_id,
    p.lease_id,
    p.tenant_id,
    prop.name AS property_name
FROM RENT_payments p
LEFT JOIN RENT_properties prop ON p.property_id = prop.id
CROSS JOIN (SELECT '2025-11-01'::date AS start_date, (DATE_TRUNC('month', '2025-11-01'::date) + INTERVAL '1 month - 1 day')::date AS end_date) month_range
WHERE p.payment_date >= month_range.start_date 
  AND p.payment_date <= month_range.end_date
  AND (p.property_id = 'YOUR_MACEDONIA_PROPERTY_ID' OR prop.name ILIKE '%macedonia%')
ORDER BY p.payment_date DESC;

-- Find payments that might be incorrectly assigned
-- Payments with lease_id but no property_id (should have property_id from lease)
SELECT 
    '=== PAYMENTS WITH LEASE BUT NO PROPERTY_ID ===' AS section,
    p.id AS payment_id,
    p.payment_date,
    p.amount,
    p.lease_id,
    l.property_id AS lease_property_id,
    prop.name AS lease_property_name
FROM RENT_payments p
INNER JOIN RENT_leases l ON p.lease_id = l.id
LEFT JOIN RENT_properties prop ON l.property_id = prop.id
CROSS JOIN (SELECT '2025-11-01'::date AS start_date, (DATE_TRUNC('month', '2025-11-01'::date) + INTERVAL '1 month - 1 day')::date AS end_date) month_range
WHERE p.payment_date >= month_range.start_date 
  AND p.payment_date <= month_range.end_date
  AND p.property_id IS NULL
  AND l.property_id IS NOT NULL
ORDER BY p.amount DESC;

-- Summary: Compare what profit page sees vs what should be assigned
SELECT 
    '=== COMPARISON: TOTAL VS PROPERTY-SPECIFIC ===' AS section,
    (SELECT SUM(amount) 
     FROM RENT_payments 
     WHERE payment_date >= '2025-11-01'::date 
       AND payment_date <= (DATE_TRUNC('month', '2025-11-01'::date) + INTERVAL '1 month - 1 day')::date
    ) AS total_all_payments,
    (SELECT SUM(amount) 
     FROM RENT_payments 
     WHERE payment_date >= '2025-11-01'::date 
       AND payment_date <= (DATE_TRUNC('month', '2025-11-01'::date) + INTERVAL '1 month - 1 day')::date
       AND property_id IS NOT NULL
    ) AS total_with_property_id,
    (SELECT SUM(amount) 
     FROM RENT_payments 
     WHERE payment_date >= '2025-11-01'::date 
       AND payment_date <= (DATE_TRUNC('month', '2025-11-01'::date) + INTERVAL '1 month - 1 day')::date
       AND property_id IS NULL
    ) AS total_without_property_id,
    (SELECT SUM(amount) 
     FROM RENT_payments p
     LEFT JOIN RENT_properties prop ON p.property_id = prop.id
     WHERE p.payment_date >= '2025-11-01'::date 
       AND p.payment_date <= (DATE_TRUNC('month', '2025-11-01'::date) + INTERVAL '1 month - 1 day')::date
       AND (p.property_id = 'YOUR_MACEDONIA_PROPERTY_ID' OR prop.name ILIKE '%macedonia%')
    ) AS macedonia_total;

