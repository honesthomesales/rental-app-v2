-- Modify existing rent_expenses table to match the requested columns
-- This will add the new columns and keep the existing ones

-- Add the new columns you requested
ALTER TABLE "RENT_expenses" 
ADD COLUMN IF NOT EXISTS address VARCHAR(255),
ADD COLUMN IF NOT EXISTS amount_owed DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_paid_date DATE,
ADD COLUMN IF NOT EXISTS mail_info TEXT,
ADD COLUMN IF NOT EXISTS loan_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS phone_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS balance DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS interest_rate DECIMAL(5,4) DEFAULT 0;

-- Create indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_expenses_address ON "RENT_expenses"(address);
CREATE INDEX IF NOT EXISTS idx_expenses_loan_number ON "RENT_expenses"(loan_number);
CREATE INDEX IF NOT EXISTS idx_expenses_balance ON "RENT_expenses"(balance);

-- Add some sample data with the new structure
INSERT INTO "RENT_expenses" (
    property_id, 
    category, 
    amount, 
    expense_date, 
    memo,
    address, 
    amount_owed, 
    last_paid_date, 
    mail_info, 
    loan_number, 
    phone_number, 
    balance, 
    interest_rate
) VALUES
-- Sample property tax expense
((SELECT id FROM RENT_properties LIMIT 1), 'Property Tax', 1500.00, '2024-01-15', 'Annual property tax payment', '123 Main St, Anderson, SC 29621', 1500.00, '2024-01-15', 'Property tax payment', 'TAX-2024-001', '864-555-0101', 1500.00, 0.0000),

-- Sample insurance expense  
((SELECT id FROM RENT_properties LIMIT 1 OFFSET 1), 'Insurance', 2500.00, '2024-02-01', 'Annual insurance premium', '456 Oak Ave, Greenville, SC 29601', 2500.00, '2024-02-01', 'Insurance premium', 'INS-2024-002', '864-555-0102', 2500.00, 0.0000),

-- Sample mortgage expense
((SELECT id FROM RENT_properties LIMIT 1 OFFSET 2), 'Mortgage', 50000.00, '2024-01-30', 'Monthly mortgage payment', '789 Pine St, Spartanburg, SC 29301', 50000.00, '2024-01-30', 'Mortgage payment', 'MORT-2024-003', '864-555-0103', 48500.00, 0.0525),

-- Sample HOA expense
((SELECT id FROM RENT_properties LIMIT 1 OFFSET 3), 'HOA', 1200.00, '2024-02-15', 'Monthly HOA fees', '321 Elm St, Columbia, SC 29201', 1200.00, '2024-02-15', 'HOA fees', 'HOA-2024-004', '864-555-0104', 1200.00, 0.0000),

-- Sample loan expense
((SELECT id FROM RENT_properties LIMIT 1 OFFSET 4), 'Property Loan', 35000.00, '2024-01-20', 'Property improvement loan', '654 Maple Dr, Charleston, SC 29401', 35000.00, '2024-01-20', 'Property loan', 'LOAN-2024-005', '864-555-0105', 34000.00, 0.0625);

-- Verify the changes
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'RENT_expenses'
ORDER BY ordinal_position;
