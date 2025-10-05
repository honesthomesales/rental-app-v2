-- Check current invoice due dates vs rent_due_day from leases
SELECT 
  p.address,
  l.rent_due_day,
  i.due_date,
  i.period_start,
  i.period_end,
  i.invoice_no,
  -- Show what the due_date should be based on rent_due_day
  CASE 
    WHEN l.rent_due_day IS NOT NULL THEN
      DATE_TRUNC('month', i.period_start) + INTERVAL '1 month' + 
      (l.rent_due_day - 1) * INTERVAL '1 day'
    ELSE
      DATE_TRUNC('month', i.period_start) + INTERVAL '1 month'
  END as calculated_due_date
FROM "RENT_invoices" i
JOIN "RENT_leases" l ON i.lease_id = l.id
JOIN "RENT_properties" p ON l.property_id = p.id
WHERE l.rent_cadence = 'monthly'
  AND p.address ILIKE '%holland%' OR p.address ILIKE '%hosch%'
ORDER BY p.address, i.due_date;
