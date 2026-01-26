-- ============================================
-- ADD PAYMENTS FOR 296 SHELTER BAY - JAN-JUN 2025
-- ============================================
-- This creates payments for invoices that don't have any linked payments
-- Payment amount = invoice amount_total
-- ============================================

-- STEP 1: Preview what will be created
SELECT 
    "RENT_invoices".id as invoice_id,
    "RENT_invoices".invoice_no,
    "RENT_invoices".due_date,
    "RENT_invoices".amount_total,
    "RENT_leases".id as lease_id,
    "RENT_leases".property_id,
    "RENT_leases".tenant_id,
    'Will create payment of $' || "RENT_invoices".amount_total as action
FROM "RENT_invoices"
INNER JOIN "RENT_leases" ON "RENT_leases".id = "RENT_invoices".lease_id
INNER JOIN "RENT_properties" ON "RENT_properties".id = "RENT_leases".property_id
WHERE ("RENT_properties".address ILIKE '%296%Shelter%Bay%' 
       OR "RENT_properties".address ILIKE '%296 Shelter Bay%'
       OR "RENT_properties".name ILIKE '%296%Shelter%Bay%')
  AND "RENT_invoices".due_date >= '2025-01-01'
  AND "RENT_invoices".due_date <= '2025-06-30'
  AND NOT EXISTS (
    -- Only create payment if invoice doesn't have any linked payments
    SELECT 1 
    FROM "RENT_payments" 
    WHERE "RENT_payments".invoice_id = "RENT_invoices".id
  )
ORDER BY "RENT_invoices".due_date ASC;

-- STEP 2: CREATE payments for invoices without payments
-- Review Step 1 first, then uncomment and run this
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
    "RENT_invoices".lease_id,
    "RENT_leases".property_id,
    "RENT_leases".tenant_id,
    "RENT_invoices".id as invoice_id,
    "RENT_invoices".due_date as payment_date,
    "RENT_invoices".amount_total as amount,
    'Rent' as payment_type,
    'Manual Entry' as payment_method,
    'completed' as status,
    'Payment for ' || "RENT_invoices".invoice_no as notes
FROM "RENT_invoices"
INNER JOIN "RENT_leases" ON "RENT_leases".id = "RENT_invoices".lease_id
INNER JOIN "RENT_properties" ON "RENT_properties".id = "RENT_leases".property_id
WHERE ("RENT_properties".address ILIKE '%296%Shelter%Bay%' 
       OR "RENT_properties".address ILIKE '%296 Shelter Bay%'
       OR "RENT_properties".name ILIKE '%296%Shelter%Bay%')
  AND "RENT_invoices".due_date >= '2025-01-01'
  AND "RENT_invoices".due_date <= '2025-06-30'
  AND NOT EXISTS (
    -- Only create payment if invoice doesn't have any linked payments
    SELECT 1 
    FROM "RENT_payments" 
    WHERE "RENT_payments".invoice_id = "RENT_invoices".id
  );
*/

-- STEP 3: Recalculate invoice balances after creating payments
-- Uncomment and run this after Step 2
/*
UPDATE "RENT_invoices"
SET 
    amount_paid = COALESCE((
        SELECT SUM("RENT_payments".amount)
        FROM "RENT_payments"
        WHERE "RENT_payments".invoice_id = "RENT_invoices".id
    ), 0),
    balance_due = "RENT_invoices".amount_total - COALESCE((
        SELECT SUM("RENT_payments".amount)
        FROM "RENT_payments"
        WHERE "RENT_payments".invoice_id = "RENT_invoices".id
    ), 0),
    status = CASE
        WHEN "RENT_invoices".amount_total - COALESCE((
            SELECT SUM("RENT_payments".amount)
            FROM "RENT_payments"
            WHERE "RENT_payments".invoice_id = "RENT_invoices".id
        ), 0) <= 0 THEN 'PAID'
        ELSE 'OPEN'
    END,
    paid_in_full_at = CASE
        WHEN "RENT_invoices".amount_total - COALESCE((
            SELECT SUM("RENT_payments".amount)
            FROM "RENT_payments"
            WHERE "RENT_payments".invoice_id = "RENT_invoices".id
        ), 0) <= 0 THEN NOW()
        ELSE NULL
    END
WHERE "RENT_invoices".id IN (
    SELECT "RENT_invoices".id
    FROM "RENT_invoices"
    INNER JOIN "RENT_leases" ON "RENT_leases".id = "RENT_invoices".lease_id
    INNER JOIN "RENT_properties" ON "RENT_properties".id = "RENT_leases".property_id
    WHERE ("RENT_properties".address ILIKE '%296%Shelter%Bay%' 
           OR "RENT_properties".address ILIKE '%296 Shelter Bay%'
           OR "RENT_properties".name ILIKE '%296%Shelter%Bay%')
      AND "RENT_invoices".due_date >= '2025-01-01'
      AND "RENT_invoices".due_date <= '2025-06-30'
);
*/




