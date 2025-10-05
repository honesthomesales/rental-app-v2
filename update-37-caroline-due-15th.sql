-- Update 134 Tranquility to be due on the 15th for all new invoices
-- This will update the lease rent_due_day and create missing invoices

-- Step 1: Update the lease to have rent_due_day = 15
UPDATE "RENT_leases" 
SET rent_due_day = 15
FROM "RENT_properties" p
WHERE "RENT_leases".property_id = p.id
  AND (p.address ILIKE '%134%tranquility%' 
       OR p.name ILIKE '%134%tranquility%'
       OR p.address ILIKE '%tranquility%'
       OR p.name ILIKE '%tranquility%');

-- Step 2: Update existing invoices to have due_date on the 15th
UPDATE "RENT_invoices" 
SET due_date = (
  DATE_TRUNC('month', period_start) + INTERVAL '14 days'
)
FROM "RENT_leases" l
JOIN "RENT_properties" p ON l.property_id = p.id
WHERE "RENT_invoices".lease_id = l.id
  AND (p.address ILIKE '%134%tranquility%' 
       OR p.name ILIKE '%134%tranquility%'
       OR p.address ILIKE '%tranquility%'
       OR p.name ILIKE '%tranquility%');

-- Step 3: Create missing monthly invoices from current date through end of 2026
DO $$
DECLARE
    lease_record RECORD;
    month_date DATE;
    invoice_id UUID;
    invoice_no TEXT;
    period_start DATE;
    period_end DATE;
    invoice_due_date DATE;
    month_count INTEGER := 0;
    current_date DATE := CURRENT_DATE;
BEGIN
    -- Get the lease for 134 Tranquility
    SELECT l.*, p.address, p.name
    INTO lease_record
    FROM "RENT_leases" l
    JOIN "RENT_properties" p ON l.property_id = p.id
    WHERE (p.address ILIKE '%134%tranquility%' 
           OR p.name ILIKE '%134%tranquility%'
           OR p.address ILIKE '%tranquility%'
           OR p.name ILIKE '%tranquility%')
    LIMIT 1;
    
    IF lease_record.id IS NOT NULL THEN
        -- Start from current month
        month_date := DATE_TRUNC('month', current_date);
        
        -- Generate monthly invoices through December 2026
        WHILE month_date <= '2026-12-31' LOOP
            month_count := month_count + 1;
            
            -- Calculate period dates
            period_start := month_date; -- 1st of the month
            period_end := (month_date + INTERVAL '1 month' - INTERVAL '1 day')::DATE; -- Last day of month
            invoice_due_date := (month_date + INTERVAL '14 days')::DATE; -- 15th of the month
            
            -- Check if invoice already exists for this month
            IF NOT EXISTS (
                SELECT 1 FROM "RENT_invoices" 
                WHERE lease_id = lease_record.id 
                AND due_date = invoice_due_date
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
                    invoice_due_date,
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
                    lease_record.rent,
                    0.00,
                    0.00,
                    lease_record.rent,
                    0.00,
                    lease_record.rent,
                    'OPEN',
                    NOW()
                );
                
                RAISE NOTICE 'Created invoice for % - Due: %', to_char(month_date, 'YYYY-MM'), invoice_due_date;
            ELSE
                RAISE NOTICE 'Invoice already exists for % - Due: %', to_char(month_date, 'YYYY-MM'), invoice_due_date;
            END IF;
            
            -- Move to next month
            month_date := month_date + INTERVAL '1 month';
        END LOOP;
        
        RAISE NOTICE 'Processed % months for 134 Tranquility', month_count;
    ELSE
        RAISE NOTICE 'No lease found for 134 Tranquility';
    END IF;
END $$;

-- Step 4: Verify the changes
SELECT 
  p.address,
  p.name,
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
WHERE (p.address ILIKE '%134%tranquility%' 
       OR p.name ILIKE '%134%tranquility%'
       OR p.address ILIKE '%tranquility%'
       OR p.name ILIKE '%tranquility%')
ORDER BY i.due_date;
