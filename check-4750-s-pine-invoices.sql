-- Check current invoices for 4750 S Pine
SELECT 
  p.address,
  l.rent_cadence,
  l.rent,
  i.period_start,
  i.period_end,
  i.due_date,
  i.amount_rent,
  i.amount_total,
  i.status,
  i.invoice_no
FROM "RENT_invoices" i
JOIN "RENT_leases" l ON i.lease_id = l.id
JOIN "RENT_properties" p ON l.property_id = p.id
WHERE p.address ILIKE '%4750%s%pine%'
ORDER BY i.due_date;
