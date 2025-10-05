-- Update 4750 S Pine lease to weekly cadence and fix invoices
-- This will change the lease from monthly to weekly and update/create weekly invoices

-- Step 1: Update the lease cadence to weekly
UPDATE "RENT_leases" 
SET rent_cadence = 'weekly'
FROM "RENT_properties" p
WHERE "RENT_leases".property_id = p.id
  AND p.address ILIKE '%4750%s%pine%';

-- Step 2: Delete existing monthly invoices from September onwards
DELETE FROM "RENT_invoices" 
WHERE lease_id IN (
  SELECT l.id 
  FROM "RENT_leases" l
  JOIN "RENT_properties" p ON l.property_id = p.id
  WHERE p.address ILIKE '%4750%s%pine%'
)
AND due_date >= '2025-09-01';

-- Step 3: Create weekly invoices from September 1, 2025 onwards
DO $$
DECLARE
    lease_record RECORD;
    week_date DATE;
    invoice_id UUID;
    invoice_no TEXT;
    period_start DATE;
    period_end DATE;
    due_date DATE;
    week_count INTEGER := 0;
BEGIN
    -- Get the lease for 4750 S Pine
    SELECT l.*, p.address
    INTO lease_record
    FROM "RENT_leases" l
    JOIN "RENT_properties" p ON l.property_id = p.id
    WHERE p.address ILIKE '%4750%s%pine%'
    LIMIT 1;
    
    IF lease_record.id IS NOT NULL THEN
        -- Start from September 1, 2025 (first Monday of September)
        week_date := '2025-09-01';
        
        -- Find the first Monday of September
        WHILE EXTRACT(DOW FROM week_date) != 1 LOOP
            week_date := week_date + INTERVAL '1 day';
        END LOOP;
        
        -- Generate weekly invoices for the rest of 2025
        WHILE week_date <= '2025-12-31' LOOP
            week_count := week_count + 1;
            
            -- Generate new invoice
            invoice_id := gen_random_uuid();
            invoice_no := 'INV-' || invoice_id || '-' || to_char(week_date, 'YYYYMMDD');
            period_start := week_date;
            period_end := week_date + INTERVAL '6 days'; -- Monday to Sunday
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
                325.00,
                0.00,
                0.00,
                325.00,
                0.00,
                325.00,
                'OPEN',
                NOW()
            );
            
            RAISE NOTICE 'Created weekly invoice % for week starting %', week_count, week_date;
            
            -- Move to next week (Monday)
            week_date := week_date + INTERVAL '7 days';
        END LOOP;
        
        RAISE NOTICE 'Created % weekly invoices for 4750 S Pine', week_count;
    END IF;
END $$;

-- Step 4: Verify the changes
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
ORDER BY i.due_date;
