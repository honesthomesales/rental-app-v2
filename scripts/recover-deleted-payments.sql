-- Emergency recovery: restore deleted RENT_payments from a Supabase backup / PITR clone
-- Project: gnisgfojzrrnidizrycj
--
-- STEP 1 — Supabase Dashboard (do this first, time-sensitive)
--   https://supabase.com/dashboard/project/gnisgfojzrrnidizrycj/database/backups
--   • If you have Point-in-Time Recovery: restore to a few minutes BEFORE the accidental delete
--     (e.g. 2026-09-01 ~00:15 Eastern) into a NEW recovery project — do NOT overwrite prod yet.
--   • Or use the latest daily backup the same way.
--
-- STEP 2 — On the RECOVERY database (not production), export missing rows:
--   Compare backup vs live. Run on recovery DB:

SELECT COUNT(*) AS backup_payment_count FROM "RENT_payments";

-- STEP 3 — On PRODUCTION, see how many rows exist now:

SELECT COUNT(*) AS live_payment_count FROM "RENT_payments";

SELECT date_trunc('month', payment_date::date) AS month, COUNT(*), SUM(amount)
FROM "RENT_payments"
GROUP BY 1
ORDER BY 1;

-- STEP 4 — List IDs present in backup but missing in production (run with dblink or export CSV from recovery):
-- Export from recovery:
--   SELECT * FROM "RENT_payments" ORDER BY payment_date;
-- Import missing rows into production with INSERT ... ON CONFLICT (id) DO NOTHING;

-- Example insert (run on PRODUCTION after exporting missing rows from recovery):
/*
INSERT INTO "RENT_payments" (
  id, tenant_id, lease_id, property_id, invoice_id,
  payment_date, amount, payment_type, payment_method, status, notes, created_at
)
SELECT
  b.id, b.tenant_id, b.lease_id, b.property_id, b.invoice_id,
  b.payment_date, b.amount, b.payment_type, b.payment_method, b.status, b.notes, b.created_at
FROM backup_export."RENT_payments" b
LEFT JOIN "RENT_payments" live ON live.id = b.id
WHERE live.id IS NULL;
*/

-- STEP 5 — After re-inserting payments, reconcile invoice totals per affected lease:
--   Use Payments page "refresh" or run existing reconcile SQL in fix-invoice-payment-inconsistency.sql

-- STEP 6 — Verify affected tenants (examples from incident report):
/*
SELECT p.payment_date, p.amount, t.full_name, prop.name, prop.address
FROM "RENT_payments" p
JOIN "RENT_tenants" t ON t.id = p.tenant_id
JOIN "RENT_properties" prop ON prop.id = p.property_id
WHERE prop.address ILIKE '%Bowers%'
   OR prop.address ILIKE '%5667%Main%'
ORDER BY p.payment_date DESC;
*/
