# Tenant Payment Portal migration — rollback & verify

## Preflight (run before apply)

```sql
-- Confirm backup / PITR coverage in Supabase dashboard first.
SELECT count(*) AS tenants FROM public."RENT_tenants";
SELECT count(*) AS leases FROM public."RENT_leases";
SELECT count(*) AS payments FROM public."RENT_payments";
SELECT count(*) AS invoices FROM public."RENT_invoices";
```

## Verification after apply

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'RENT_v3_%'
ORDER BY 1;

SELECT relname, relrowsecurity
FROM pg_class
WHERE relname LIKE 'RENT_v3_%';
```

## Rollback (drops additive objects only)

```sql
DROP TABLE IF EXISTS public."RENT_v3_contact_audit_events" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_contact_verification_attempts" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_tenant_contact_points" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_staff_exceptions" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_confirmed_sender_mappings" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_payment_match_candidates" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_bank_transactions" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_bank_connections" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_payment_receipts" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_provider_events" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_payment_attempt_events" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_payment_attempts" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_payment_fee_policies" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_tenant_payment_references" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_portal_access_tokens" CASCADE;
```

Do not apply to production until owner approves and backup/PITR is confirmed.
