-- Add due_date column to RENT_expenses table

ALTER TABLE "RENT_expenses" 
ADD COLUMN IF NOT EXISTS "due_date" DATE;

-- Add comment to the column
COMMENT ON COLUMN "RENT_expenses"."due_date" IS 'The date when the expense payment is due';

