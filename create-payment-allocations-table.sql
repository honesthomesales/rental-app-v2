-- Create the RENT_payment_allocations table that triggers/constraints are expecting
-- This will fix the "relation does not exist" error when updating payments

CREATE TABLE IF NOT EXISTS "RENT_payment_allocations" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES "RENT_payments"(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES "RENT_invoices"(id) ON DELETE CASCADE,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure no duplicate allocations
  UNIQUE(payment_id, invoice_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment 
  ON "RENT_payment_allocations"(payment_id);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice 
  ON "RENT_payment_allocations"(invoice_id);

-- Add helpful comment
COMMENT ON TABLE "RENT_payment_allocations" IS 
  'Tracks which payments are allocated to which invoices - created to fix FK constraint issues';

