-- ============================================
-- QUICK DIAGNOSTIC: 140 Anthony St Invoice Mismatch
-- Run this to identify why invoice shows in modal but not in payments page
-- ============================================

-- Replace these with actual values from your database:
-- lease_id: 0eea0850-4945-4a13-a609-a1f132758bfa
-- property_id: 401180e3-2cef-41e7-aefe-28f582545276
-- today: 2026-01-19

WITH lease_info AS (
  SELECT 
    l.id AS lease_id,
    l.lease_start_date,
    l.status AS lease_status,
    p.id AS property_id,
    p.address AS property_address
  FROM "RENT_leases" l
  JOIN "RENT_properties" p ON p.id = l.property_id
  WHERE l.id = '0eea0850-4945-4a13-a609-a1f132758bfa'
     OR p.address ILIKE '%140 Anthony%'
  LIMIT 1
),
all_invoices AS (
  SELECT 
    i.*,
    li.lease_start_date,
    li.property_address,
    CASE 
      WHEN i.due_date < '2026-01-19'::date THEN 'PAST DUE'
      WHEN i.due_date = '2026-01-19'::date THEN 'DUE TODAY'
      WHEN i.due_date > '2026-01-19'::date THEN 'FUTURE'
    END AS due_status,
    CASE 
      WHEN i.due_date >= li.lease_start_date 
       AND i.due_date <= '2026-01-19'::date
       AND i.status = 'OPEN'
       AND (i.balance_due::numeric > 0)
      THEN 'YES - WOULD BE COUNTED'
      ELSE 'NO - NOT COUNTED'
    END AS would_be_included_in_payments_page,
    CASE 
      WHEN i.due_date >= li.lease_start_date 
       AND i.due_date < '2026-01-19'::date
       AND i.status = 'OPEN'
       AND (i.balance_due::numeric > 0)
      THEN 'YES - WOULD BE COUNTED'
      ELSE 'NO - NOT COUNTED'
    END AS would_be_included_in_late_tenants
  FROM "RENT_invoices" i
  CROSS JOIN lease_info li
  WHERE i.lease_id = li.lease_id
     OR i.property_id = li.property_id
)
SELECT 
  '=== DIAGNOSTIC RESULTS ===' AS section,
  ai.id AS invoice_id,
  ai.invoice_no,
  ai.due_date,
  ai.due_status,
  ai.status AS invoice_status,
  ai.amount_total,
  ai.amount_paid,
  ai.balance_due,
  ai.lease_start_date,
  ai.property_address,
  ai.would_be_included_in_payments_page,
  ai.would_be_included_in_late_tenants,
  CASE 
    WHEN ai.status != 'OPEN' THEN '❌ Status is not OPEN: ' || ai.status
    WHEN ai.balance_due::numeric <= 0 THEN '❌ balance_due is zero or negative: ' || ai.balance_due
    WHEN ai.due_date < ai.lease_start_date THEN '❌ Invoice due_date is before lease_start_date'
    WHEN ai.due_date > '2026-01-19'::date THEN '❌ Invoice due_date is in the future (excluded by to= parameter)'
    WHEN ai.due_date >= ai.lease_start_date 
     AND ai.due_date <= '2026-01-19'::date
     AND ai.status = 'OPEN'
     AND ai.balance_due::numeric > 0
    THEN '✅ Should be included - check API query/logs'
    ELSE '❓ Unknown reason'
  END AS diagnostic_message,
  -- Check balance_due calculation
  CASE 
    WHEN ABS((ai.amount_total::numeric - ai.amount_paid::numeric) - ai.balance_due::numeric) > 0.01
    THEN '⚠️ balance_due calculation mismatch: expected ' || 
         (ai.amount_total::numeric - ai.amount_paid::numeric)::text || 
         ' but got ' || ai.balance_due::text
    ELSE '✅ balance_due calculation correct'
  END AS balance_calculation_check
FROM all_invoices ai
ORDER BY ai.due_date DESC;

-- ============================================
-- EXPECTED RESULT FOR JAN 1, 2026 INVOICE:
-- ============================================
-- If invoice is correct:
--   - due_date: 2026-01-01
--   - status: OPEN
--   - balance_due: 1250.00
--   - would_be_included_in_payments_page: YES - WOULD BE COUNTED
--   - would_be_included_in_late_tenants: YES - WOULD BE COUNTED
--
-- If invoice is NOT included, check:
--   1. status != 'OPEN' → Fix status
--   2. balance_due = 0 → Recalculate balance_due
--   3. due_date mismatch → Check date format/timezone
--   4. API query issue → Check API logs
-- ============================================
