-- Add 341 S High Street with monthly invoices through end of 2026
-- $1000 per month, due on the 25th, without affecting existing invoices

-- First, check if the property and lease exist
SELECT 
  p.address,
  l.rent_cadence,
  l.rent,
  l.rent_due_day,
  l.lease_start_date,
  l.lease_end_date
FROM "RENT_leases" l
JOIN "RENT_properties" p ON l.property_id = p.id
WHERE p.address ILIKE '%341%s%high%street%';

-- Create monthly invoices for 341 S High Street from January 2025 through December 2026
DO $$
DECLARE
    lease_record RECORD;
    month_date DATE;
    invoice_id UUID;
    invoice_no TEXT;
    period_start DATE;
    period_end DATE;
    due_date DATE;
    month_count INTEGER := 0;
BEGIN
    -- Get the lease for 341 S High Street
    SELECT l.*, p.address
    INTO lease_record
    FROM "RENT_leases" l
    JOIN "RENT_properties" p ON l.property_id = p.id
    WHERE p.address ILIKE '%341%s%high%street%'
    LIMIT 1;
    
    IF lease_record.id IS NOT NULL THEN
        -- Start from January 2025
        month_date := '2025-01-01';
        
        -- Generate monthly invoices through December 2026
        WHILE month_date <= '2026-12-31' LOOP
            month_count := month_count + 1;
            
            -- Calculate period dates
            period_start := month_date; -- 1st of the month
            period_end := (month_date + INTERVAL '1 month' - INTERVAL '1 day')::DATE; -- Last day of month
            due_date := (month_date + INTERVAL '24 days')::DATE; -- 25th of the month
            
            -- Check if invoice already exists for this month
            IF NOT EXISTS (
                SELECT 1 FROM "RENT_invoices" 
                WHERE lease_id = lease_record.id 
                AND due_date = due_date
            ) THEN
                -- Generate new invoice
                invoice_id := gen_random_uuid();
                invoice_no := 'INV-' || invoice_id || '-' || to_char(month_date, 'YYYYMM');
                
                -- Insert the monthly invoice
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
                    created_at
                ) VALUES (
                    invoice_id,
                    invoice_no,
                    lease_record.id,
                    lease_record.property_id,
                    lease_record.tenant_id,
                    period_start,
                    period_end,
                    due_date,
                    1000.00,
                    0.00,
                    0.00,
                    1000.00,
                    0.00,
                    1000.00,
                    'OPEN',
                    NOW()
                );
                
                RAISE NOTICE 'Created invoice for % - Due: %', to_char(month_date, 'YYYY-MM'), due_date;
            ELSE
                RAISE NOTICE 'Invoice already exists for % - Due: %', to_char(month_date, 'YYYY-MM'), due_date;
            END IF;
            
            -- Move to next month
            month_date := month_date + INTERVAL '1 month';
        END LOOP;
        
        RAISE NOTICE 'Processed % months for 341 S High Street', month_count;
    ELSE
        RAISE NOTICE 'No lease found for 341 S High Street';
    END IF;
END $$;

-- Verify the created invoices
SELECT 
  p.address,
  l.rent_cadence,
  l.rent as lease_rent,
  l.rent_due_day,
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
WHERE p.address ILIKE '%341%s%high%street%'
ORDER BY i.due_date;
