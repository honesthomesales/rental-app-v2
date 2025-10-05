-- Check current setup for Jonesville doublewide
SELECT 
  p.address,
  p.name,
  l.rent_cadence,
  l.rent,
  l.rent_due_day,
  l.lease_start_date,
  l.lease_end_date,
  COUNT(i.id) as invoice_count
FROM "RENT_leases" l
JOIN "RENT_properties" p ON l.property_id = p.id
LEFT JOIN "RENT_invoices" i ON l.id = i.lease_id
WHERE p.address ILIKE '%jonesville%' 
   OR p.name ILIKE '%jonesville%'
   OR p.address ILIKE '%doublewide%'
   OR p.name ILIKE '%doublewide%'
GROUP BY p.address, p.name, l.rent_cadence, l.rent, l.rent_due_day, l.lease_start_date, l.lease_end_date;
