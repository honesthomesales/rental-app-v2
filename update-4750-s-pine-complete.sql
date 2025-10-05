-- Complete update for 4750 S Pine to $325 per week
-- This will update existing invoices and create missing ones

-- First, update all existing invoices from September onwards to $325
UPDATE "RENT_invoices" 
SET 
  amount_rent = 325.00,
  amount_total = 325.00 + COALESCE(amount_late, 0) + COALESCE(amount_other, 0),
  balance_due = (325.00 + COALESCE(amount_late, 0) + COALESCE(amount_other, 0)) - COALESCE(amount_paid, 0)
FROM "RENT_leases" l
JOIN "RENT_properties" p ON l.property_id = p.id
WHERE "RENT_invoices".lease_id = l.id
  AND p.address ILIKE '%4750%s%pine%'
  AND "RENT_invoices".due_date >= '2025-09-01';

-- Create missing weekly invoices from September onwards
-- This will generate weekly invoices for the remaining months of 2025
DO $$
DECLARE
    lease_record RECORD;
    week_date DATE;
    invoice_id UUID;
    invoice_no TEXT;
    period_start DATE;
    period_end DATE;
    due_date DATE;
BEGIN
    -- Get the lease for 4750 S Pine
    SELECT l.*, p.address
    INTO lease_record
    FROM "RENT_leases" l
    JOIN "RENT_properties" p ON l.property_id = p.id
    WHERE p.address ILIKE '%4750%s%pine%'
    LIMIT 1;
    
    IF lease_record.id IS NOT NULL THEN
        -- Generate weekly invoices from September 1, 2025 onwards
        week_date := '2025-09-01';
        
        WHILE week_date <= '2025-12-31' LOOP
            -- Check if invoice already exists for this week
            IF NOT EXISTS (
                SELECT 1 FROM "RENT_invoices" 
                WHERE lease_id = lease_record.id 
                AND due_date = week_date
            ) THEN
                -- Generate new invoice
                invoice_id := gen_random_uuid();
                invoice_no := 'INV-' || invoice_id || '-' || to_char(week_date, 'YYYYMMDD');
                period_start := week_date;
                period_end := week_date + INTERVAL '6 days'; -- Friday to Thursday
                due_date := week_date;
                
                -- Insert the weekly invoice
                INSERT INTO "RENT_invoices" (
                    id,
                    invoice_no,
                    lease_id,
                    property_id,
                    tenant_id,
                    period_start,
                    period_end,
                    due_date,
                    amount_rent,
                    amount_late,
                    amount_other,
                    amount_total,
                    amount_paid,
                    balance_due,
                    status,
                    created_at,
                    updated_at
                ) VALUES (
                    invoice_id,
                    invoice_no,
                    lease_record.id,
                    lease_record.property_id,
                    lease_record.tenant_id,
                    period_start,
                    period_end,
                    due_date,
                    325.00,
                    0.00,
                    0.00,
                    325.00,
                    0.00,
                    325.00,
                    'OPEN',
                    NOW(),
                    NOW()
                );
                
                RAISE NOTICE 'Created invoice for week starting %', week_date;
            END IF;
            
            -- Move to next week
            week_date := week_date + INTERVAL '7 days';
        END LOOP;
    END IF;
END $$;

-- Verify all changes
SELECT 
  p.address,
  l.rent_cadence,
  l.rent as lease_rent,
  i.period_start,
  i.period_end,
  i.due_date,
  i.amount_rent,
  i.amount_total,
  i.amount_paid,
  i.balance_due,
  i.status,
  i.invoice_no
FROM "RENT_invoices" i
JOIN "RENT_leases" l ON i.lease_id = l.id
JOIN "RENT_properties" p ON l.property_id = p.id
WHERE p.address ILIKE '%4750%s%pine%'
  AND i.due_date >= '2025-09-01'
ORDER BY i.due_date;
