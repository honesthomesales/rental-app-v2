-- ============================================
-- FIX PAYMENTS FOR 296 SHELTER BAY PROSPERITY
-- ============================================
-- Step 1: Find the property and lease IDs
-- Step 2: Show unlinked payments to be removed
-- Step 3: Show invoices Jan-Jun 2025 that need payments
-- Step 4: Delete unlinked payments
-- Step 5: Create payments for invoices
-- ============================================

-- STEP 1: Find property and lease information
SELECT 
    "RENT_properties".id as property_id,
    "RENT_properties".name as property_name,
    "RENT_properties".address,
    "RENT_leases".id as lease_id,
    "RENT_leases".tenant_id,
    "RENT_tenants".full_name as tenant_name
FROM "RENT_properties"
INNER JOIN "RENT_leases" ON "RENT_leases".property_id = "RENT_properties".id
INNER JOIN "RENT_tenants" ON "RENT_tenants".id = "RENT_leases".tenant_id
WHERE "RENT_properties".address ILIKE '%296%Shelter%Bay%' 
   OR "RENT_properties".address ILIKE '%296 Shelter Bay%'
   OR "RENT_properties".name ILIKE '%296%Shelter%Bay%';

-- STEP 2: Show unlinked payments for this property/lease (to be deleted)
SELECT 
    "RENT_payments".id,
    "RENT_payments".payment_date,
    "RENT_payments".amount,
    "RENT_payments".payment_type,
    "RENT_payments".notes,
    'Will be deleted' as action
FROM "RENT_payments"
INNER JOIN "RENT_leases" ON "RENT_leases".id = "RENT_payments".lease_id
INNER JOIN "RENT_properties" ON "RENT_properties".id = "RENT_leases".property_id
WHERE "RENT_payments".invoice_id IS NULL
  AND ("RENT_properties".address ILIKE '%296%Shelter%Bay%' 
       OR "RENT_properties".address ILIKE '%296 Shelter Bay%'
       OR "RENT_properties".name ILIKE '%296%Shelter%Bay%')
ORDER BY "RENT_payments".payment_date ASC;

-- STEP 3: Show invoices Jan-Jun 2025 that need payments
SELECT 
    "RENT_invoices".id as invoice_id,
    "RENT_invoices".invoice_no,
    "RENT_invoices".due_date,
    "RENT_invoices".period_start,
    "RENT_invoices".period_end,
    "RENT_invoices".amount_total,
    "RENT_invoices".amount_paid,
    "RENT_invoices".balance_due,
    "RENT_invoices".status,
    (SELECT COUNT(*) FROM "RENT_payments" WHERE "RENT_payments".invoice_id = "RENT_invoices".id) as linked_payment_count,
    CASE 
        WHEN (SELECT COUNT(*) FROM "RENT_payments" WHERE "RENT_payments".invoice_id = "RENT_invoices".id) = 0 
        THEN 'Needs payment' 
        ELSE 'Has payment' 
    END as payment_status
FROM "RENT_invoices"
INNER JOIN "RENT_leases" ON "RENT_leases".id = "RENT_invoices".lease_id
INNER JOIN "RENT_properties" ON "RENT_properties".id = "RENT_leases".property_id
WHERE ("RENT_properties".address ILIKE '%296%Shelter%Bay%' 
       OR "RENT_properties".address ILIKE '%296 Shelter Bay%'
       OR "RENT_properties".name ILIKE '%296%Shelter%Bay%')
  AND "RENT_invoices".due_date >= '2025-01-01'
  AND "RENT_invoices".due_date <= '2025-06-30'
ORDER BY "RENT_invoices".due_date ASC;

-- STEP 4: DELETE unlinked payments
-- Review Step 2 results first, then run this
-- Replace 'LEASE_ID_HERE' with the actual lease_id from Step 1
/*
DELETE FROM "RENT_payments" p
WHERE p.invoice_id IS NULL
  AND p.lease_id = 'LEASE_ID_HERE'
  AND p.id IN (
    SELECT p2.id
    FROM "RENT_payments" p2
    INNER JOIN "RENT_leases" l ON l.id = p2.lease_id
    INNER JOIN "RENT_properties" prop ON prop.id = l.property_id
    WHERE p2.invoice_id IS NULL
      AND (prop.address ILIKE '%296%Shelter%Bay%' 
           OR prop.address ILIKE '%296 Shelter Bay%'
           OR prop.name ILIKE '%296%Shelter%Bay%')
  );
*/

-- STEP 5: CREATE payments for invoices Jan-Jun 2025
-- This will create a payment equal to the invoice amount_total for each invoice
-- Replace 'LEASE_ID_HERE' and 'TENANT_ID_HERE' and 'PROPERTY_ID_HERE' with actual IDs from Step 1
/*
INSERT INTO "RENT_payments" (
    lease_id,
    property_id,
    tenant_id,
    invoice_id,
    payment_date,
    amount,
    payment_type,
    payment_method,
    status,
    notes
)
SELECT 
    i.lease_id,
    l.property_id,
    l.tenant_id,
    i.id as invoice_id,
    i.due_date as payment_date,  -- Use due_date as payment date
    i.amount_total as amount,    -- Payment equals invoice total
    'Rent' as payment_type,
    'Manual Entry' as payment_method,
    'completed' as status,
    'Payment for ' || i.invoice_no as notes
FROM "RENT_invoices" i
INNER JOIN "RENT_leases" l ON l.id = i.lease_id
INNER JOIN "RENT_properties" prop ON prop.id = l.property_id
WHERE (prop.address ILIKE '%296%Shelter%Bay%' 
       OR prop.address ILIKE '%296 Shelter Bay%'
       OR prop.name ILIKE '%296%Shelter%Bay%')
  AND i.due_date >= '2025-01-01'
  AND i.due_date <= '2025-06-30'
  AND NOT EXISTS (
    -- Only create payment if invoice doesn't already have a linked payment
    SELECT 1 
    FROM "RENT_payments" p 
    WHERE p.invoice_id = i.id
  );
*/

-- STEP 6: After creating payments, recalculate invoice balances
-- Replace 'LEASE_ID_HERE' with the actual lease_id from Step 1
/*
UPDATE "RENT_invoices" i
SET 
    amount_paid = COALESCE((
        SELECT SUM(p.amount)
        FROM "RENT_payments" p
        WHERE p.invoice_id = i.id
    ), 0),
    balance_due = i.amount_total - COALESCE((
        SELECT SUM(p.amount)
        FROM "RENT_payments" p
        WHERE p.invoice_id = i.id
    ), 0),
    status = CASE
        WHEN i.amount_total - COALESCE((
            SELECT SUM(p.amount)
            FROM "RENT_payments" p
            WHERE p.invoice_id = i.id
        ), 0) <= 0 THEN 'PAID'
        ELSE 'OPEN'
    END,
    paid_in_full_at = CASE
        WHEN i.amount_total - COALESCE((
            SELECT SUM(p.amount)
            FROM "RENT_payments" p
            WHERE p.invoice_id = i.id
        ), 0) <= 0 THEN NOW()
        ELSE NULL
    END
WHERE i.lease_id = 'LEASE_ID_HERE'
  AND i.due_date >= '2025-01-01'
  AND i.due_date <= '2025-06-30';
*/

