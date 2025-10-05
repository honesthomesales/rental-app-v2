-- Direct SQL update for payments to bypass trigger issues
-- Use this to update payment records when the API fails due to RENT_payment_allocations constraint

-- Example: Update a specific payment
-- Replace the values with your actual payment ID and new values

UPDATE "RENT_payments"
SET 
  payment_date = '2025-02-01',
  amount = 735.00,
  payment_type = 'Rent',
  notes = 'Updated payment'
WHERE id = 'b0e46190-aec7-4c3f-b0e9-5c8a73b8a250';

-- Then update the related invoice balance
UPDATE "RENT_invoices"
SET 
  amount_paid = (
    SELECT COALESCE(SUM(amount), 0)
    FROM "RENT_payments"
    WHERE invoice_id = "RENT_invoices".id
  ),
  balance_due = amount_total - (
    SELECT COALESCE(SUM(amount), 0)
    FROM "RENT_payments"
    WHERE invoice_id = "RENT_invoices".id
  ),
  status = CASE
    WHEN amount_total - (
      SELECT COALESCE(SUM(amount), 0)
      FROM "RENT_payments"
      WHERE invoice_id = "RENT_invoices".id
    ) <= 0 THEN 'PAID'
    ELSE 'OPEN'
  END,
  paid_in_full_at = CASE
    WHEN amount_total - (
      SELECT COALESCE(SUM(amount), 0)
      FROM "RENT_payments"
      WHERE invoice_id = "RENT_invoices".id
    ) <= 0 THEN NOW()
    ELSE NULL
  END
WHERE id IN (
  SELECT DISTINCT invoice_id 
  FROM "RENT_payments" 
  WHERE id = 'b0e46190-aec7-4c3f-b0e9-5c8a73b8a250'
);

