-- ============================================
-- Add Unique Constraint to Prevent Duplicate Invoices
-- This ensures one invoice per lease per due_date
-- ============================================

-- First, check for any existing duplicates
SELECT 
    lease_id,
    due_date,
    COUNT(*) as duplicate_count
FROM "RENT_invoices"
GROUP BY lease_id, due_date
HAVING COUNT(*) > 1;

-- If duplicates exist, you'll need to resolve them first before adding the constraint
-- You can delete duplicates keeping only the most recent one:
-- DELETE FROM "RENT_invoices" 
-- WHERE id NOT IN (
--     SELECT DISTINCT ON (lease_id, due_date) id
--     FROM "RENT_invoices"
--     ORDER BY lease_id, due_date, created_at DESC
-- );

-- Add unique constraint to prevent duplicate invoices
-- This will prevent creating two invoices with the same lease_id and due_date
ALTER TABLE "RENT_invoices"
ADD CONSTRAINT unique_lease_due_date UNIQUE (lease_id, due_date);

-- Verify constraint was added
SELECT 
    conname AS constraint_name,
    contype AS constraint_type,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'RENT_invoices'::regclass
  AND conname = 'unique_lease_due_date';
