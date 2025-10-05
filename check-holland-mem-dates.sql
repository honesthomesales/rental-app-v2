-- Check period and due dates for 423 Holland Mem Church Rd
SELECT 
  p.address,
  l.rent_cadence,
  l.rent_due_day,
  i.period_start,
  i.period_end,
  i.due_date,
  i.invoice_no,
  i.status,
  i.balance_due,
  i.amount_late,
  -- Show if the due_date falls within the period
  CASE 
    WHEN i.due_date >= i.period_start AND i.due_date <= i.period_end THEN '✓ WITHIN PERIOD'
    ELSE '✗ OUTSIDE PERIOD'
  END as due_date_check,
  -- Show what day of week the dates fall on
  TO_CHAR(i.period_start, 'Day') as period_start_day,
  TO_CHAR(i.period_end, 'Day') as period_end_day,
  TO_CHAR(i.due_date, 'Day') as due_date_day
FROM "RENT_invoices" i
JOIN "RENT_leases" l ON i.lease_id = l.id
JOIN "RENT_properties" p ON l.property_id = p.id
WHERE p.address ILIKE '%holland%'
ORDER BY i.due_date;
