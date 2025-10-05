-- Check specific properties mentioned by user
SELECT 
  p.address,
  l.rent_due_day,
  i.due_date,
  i.period_start,
  i.period_end,
  i.invoice_no,
  i.status,
  i.balance_due,
  i.amount_late,
  -- Check if this invoice is actually late based on due_date
  CASE 
    WHEN i.due_date < CURRENT_DATE AND i.balance_due > 0 THEN 'LATE'
    WHEN i.due_date >= CURRENT_DATE AND i.balance_due > 0 THEN 'DUE'
    WHEN i.balance_due <= 0 THEN 'PAID'
    ELSE 'UNKNOWN'
  END as calculated_status
FROM "RENT_invoices" i
JOIN "RENT_leases" l ON i.lease_id = l.id
JOIN "RENT_properties" p ON l.property_id = p.id
WHERE l.rent_cadence = 'monthly'
  AND (p.address ILIKE '%holland%' OR p.address ILIKE '%hosch%')
ORDER BY p.address, i.due_date;
