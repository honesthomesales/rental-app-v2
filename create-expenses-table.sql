-- Create RENT_expenses table
CREATE TABLE IF NOT EXISTS RENT_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    address VARCHAR(255) NOT NULL,
    amount_owed DECIMAL(10,2) NOT NULL DEFAULT 0,
    last_paid_date DATE,
    mail_info TEXT,
    loan_number VARCHAR(100),
    phone_number VARCHAR(20),
    balance DECIMAL(10,2) NOT NULL DEFAULT 0,
    interest_rate DECIMAL(5,4) DEFAULT 0, -- e.g., 0.0525 for 5.25%
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_expenses_address ON RENT_expenses(address);
CREATE INDEX IF NOT EXISTS idx_expenses_loan_number ON RENT_expenses(loan_number);
CREATE INDEX IF NOT EXISTS idx_expenses_balance ON RENT_expenses(balance);

-- Add some sample data
INSERT INTO RENT_expenses (address, amount_owed, last_paid_date, mail_info, loan_number, phone_number, balance, interest_rate) VALUES
('123 Main St, Anderson, SC 29621', 1500.00, '2024-01-15', 'Property tax payment', 'TAX-2024-001', '864-555-0101', 1500.00, 0.0000),
('456 Oak Ave, Greenville, SC 29601', 2500.00, '2024-02-01', 'Insurance premium', 'INS-2024-002', '864-555-0102', 2500.00, 0.0000),
('789 Pine St, Spartanburg, SC 29301', 50000.00, '2024-01-30', 'Mortgage payment', 'MORT-2024-003', '864-555-0103', 48500.00, 0.0525),
('321 Elm St, Columbia, SC 29201', 1200.00, '2024-02-15', 'HOA fees', 'HOA-2024-004', '864-555-0104', 1200.00, 0.0000),
('654 Maple Dr, Charleston, SC 29401', 35000.00, '2024-01-20', 'Property loan', 'LOAN-2024-005', '864-555-0105', 34000.00, 0.0625);
