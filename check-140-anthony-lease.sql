-- ============================================
-- CHECK: 140 Anthony St Lease Details
-- ============================================

-- Check if lease exists
SELECT 
  '=== LEASE INFO ===' AS section,
  l.id AS lease_id,
  l.property_id,
  l.lease_start_date,
  l.lease_end_date,
  l.status AS lease_status,
  l.rent,
  l.rent_cadence,
  l.rent_due_day,
  p.name AS property_name,
  p.address AS property_address,
  t.full_name AS tenant_name
FROM "RENT_leases" l
LEFT JOIN "RENT_properties" p ON p.id = l.property_id
LEFT JOIN "RENT_tenants" t ON t.id = l.tenant_id
WHERE l.id = '0eea0850-4945-4a13-a609-a1f132758bfa';

-- Check ALL invoices for this lease (any date)
SELECT 
  '=== ALL INVOICES FOR THIS LEASE ===' AS section,
  i.id AS invoice_id,
  i.invoice_no,
  i.due_date,
  i.status,
  i.amount_total,
  i.amount_paid,
  i.balance_due,
  CASE 
    WHEN i.due_date = '2026-01-01'::date THEN '✅ THIS IS THE ONE WE NEED'
    ELSE 'Other invoice'
  END AS is_target_invoice
FROM "RENT_invoices" i
WHERE i.lease_id = '0eea0850-4945-4a13-a609-a1f132758bfa'
ORDER BY i.due_date DESC;

-- Check if there's an invoice with amount_total = 1250.00 for this lease
SELECT 
  '=== INVOICES WITH $1,250 ===' AS section,
  i.id AS invoice_id,
  i.invoice_no,
  i.lease_id,
  i.due_date,
  i.status,
  i.amount_total,
  i.amount_paid,
  i.balance_due,
  CASE 
    WHEN i.lease_id = '0eea0850-4945-4a13-a609-a1f132758bfa' THEN '✅ MATCHES LEASE'
    ELSE 'Different lease'
  END AS lease_match
FROM "RENT_invoices" i
WHERE i.amount_total::numeric = 1250.00
  AND i.due_date >= '2025-12-01'::date
  AND i.due_date <= '2026-02-01'::date
ORDER BY i.due_date DESC;
