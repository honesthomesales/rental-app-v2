-- Fix all invoice dates to be correct for different cadences
-- This script will update due_date, period_start, and period_end for all invoices

-- 1. Fix monthly invoices
UPDATE "RENT_invoices" 
SET 
  due_date = (
    DATE_TRUNC('month', period_start) + 
    (COALESCE(l.rent_due_day, 1) - 1) * INTERVAL '1 day'
  ),
  period_start = (
    DATE_TRUNC('month', period_start)
  ),
  period_end = (
    DATE_TRUNC('month', period_start) + INTERVAL '1 month' - INTERVAL '1 day'
  )
FROM "RENT_leases" l
WHERE "RENT_invoices".lease_id = l.id
AND l.rent_cadence = 'monthly';

-- 2. Fix weekly invoices (Friday to Thursday)
UPDATE "RENT_invoices" 
SET 
  due_date = (
    CASE EXTRACT(DOW FROM period_start)::int
      WHEN 0 THEN period_start + INTERVAL '6 days'  -- Sunday to Friday
      WHEN 1 THEN period_start + INTERVAL '5 days'  -- Monday to Friday
      WHEN 2 THEN period_start + INTERVAL '4 days'  -- Tuesday to Friday
      WHEN 3 THEN period_start + INTERVAL '3 days'  -- Wednesday to Friday
      WHEN 4 THEN period_start + INTERVAL '2 days'  -- Thursday to Friday
      WHEN 5 THEN period_start + INTERVAL '1 day'   -- Friday to Friday
      WHEN 6 THEN period_start                      -- Saturday to Friday (previous day)
      ELSE period_start
    END
  ),
  period_start = (
    CASE EXTRACT(DOW FROM period_start)::int
      WHEN 0 THEN period_start + INTERVAL '6 days'  -- Sunday to Friday
      WHEN 1 THEN period_start + INTERVAL '5 days'  -- Monday to Friday
      WHEN 2 THEN period_start + INTERVAL '4 days'  -- Tuesday to Friday
      WHEN 3 THEN period_start + INTERVAL '3 days'  -- Wednesday to Friday
      WHEN 4 THEN period_start + INTERVAL '2 days'  -- Thursday to Friday
      WHEN 5 THEN period_start + INTERVAL '1 day'   -- Friday to Friday
      WHEN 6 THEN period_start                      -- Saturday to Friday (previous day)
      ELSE period_start
    END
  ),
  period_end = (
    CASE EXTRACT(DOW FROM period_start)::int
      WHEN 0 THEN period_start + INTERVAL '12 days' -- Sunday to Thursday
      WHEN 1 THEN period_start + INTERVAL '11 days' -- Monday to Thursday
      WHEN 2 THEN period_start + INTERVAL '10 days' -- Tuesday to Thursday
      WHEN 3 THEN period_start + INTERVAL '9 days'  -- Wednesday to Thursday
      WHEN 4 THEN period_start + INTERVAL '8 days'  -- Thursday to Thursday
      WHEN 5 THEN period_start + INTERVAL '7 days'  -- Friday to Thursday
      WHEN 6 THEN period_start + INTERVAL '6 days'  -- Saturday to Thursday
      ELSE period_start + INTERVAL '6 days'
    END
  )
FROM "RENT_leases" l
WHERE "RENT_invoices".lease_id = l.id
AND l.rent_cadence = 'weekly';

-- 3. Fix biweekly invoices (Friday to Thursday, every other week)
UPDATE "RENT_invoices" 
SET 
  due_date = (
    CASE EXTRACT(DOW FROM period_start)::int
      WHEN 0 THEN period_start + INTERVAL '6 days'  -- Sunday to Friday
      WHEN 1 THEN period_start + INTERVAL '5 days'  -- Monday to Friday
      WHEN 2 THEN period_start + INTERVAL '4 days'  -- Tuesday to Friday
      WHEN 3 THEN period_start + INTERVAL '3 days'  -- Wednesday to Friday
      WHEN 4 THEN period_start + INTERVAL '2 days'  -- Thursday to Friday
      WHEN 5 THEN period_start + INTERVAL '1 day'   -- Friday to Friday
      WHEN 6 THEN period_start                      -- Saturday to Friday (previous day)
      ELSE period_start
    END
  ),
  period_start = (
    CASE EXTRACT(DOW FROM period_start)::int
      WHEN 0 THEN period_start + INTERVAL '6 days'  -- Sunday to Friday
      WHEN 1 THEN period_start + INTERVAL '5 days'  -- Monday to Friday
      WHEN 2 THEN period_start + INTERVAL '4 days'  -- Tuesday to Friday
      WHEN 3 THEN period_start + INTERVAL '3 days'  -- Wednesday to Friday
      WHEN 4 THEN period_start + INTERVAL '2 days'  -- Thursday to Friday
      WHEN 5 THEN period_start + INTERVAL '1 day'   -- Friday to Friday
      WHEN 6 THEN period_start                      -- Saturday to Friday (previous day)
      ELSE period_start
    END
  ),
  period_end = (
    CASE EXTRACT(DOW FROM period_start)::int
      WHEN 0 THEN period_start + INTERVAL '19 days' -- Sunday to Thursday (next week)
      WHEN 1 THEN period_start + INTERVAL '18 days' -- Monday to Thursday (next week)
      WHEN 2 THEN period_start + INTERVAL '17 days' -- Tuesday to Thursday (next week)
      WHEN 3 THEN period_start + INTERVAL '16 days' -- Wednesday to Thursday (next week)
      WHEN 4 THEN period_start + INTERVAL '15 days' -- Thursday to Thursday (next week)
      WHEN 5 THEN period_start + INTERVAL '14 days' -- Friday to Thursday (next week)
      WHEN 6 THEN period_start + INTERVAL '13 days' -- Saturday to Thursday (next week)
      ELSE period_start + INTERVAL '13 days'
    END
  )
FROM "RENT_leases" l
WHERE "RENT_invoices".lease_id = l.id
AND l.rent_cadence = 'biweekly';

-- Verify the changes
SELECT 
  p.address,
  l.rent_cadence,
  l.rent_due_day,
  i.period_start,
  i.period_end,
  i.due_date,
  i.invoice_no,
  -- Show if the due_date falls within the period
  CASE 
    WHEN i.due_date >= i.period_start AND i.due_date <= i.period_end THEN '✓ WITHIN PERIOD'
    ELSE '✗ OUTSIDE PERIOD'
  END as due_date_check
FROM "RENT_invoices" i
JOIN "RENT_leases" l ON i.lease_id = l.id
JOIN "RENT_properties" p ON l.property_id = p.id
ORDER BY p.address, i.due_date
LIMIT 20;
