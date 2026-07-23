# Tenant Payment Portal migration — rollback & verify (Option 1 collision fix)

## Preflight (run before apply)

```sql
-- Confirm backup coverage first.
SELECT count(*) AS tenants FROM public."RENT_tenants";
SELECT count(*) AS leases FROM public."RENT_leases";
SELECT count(*) AS payments FROM public."RENT_payments";
SELECT count(*) AS invoices FROM public."RENT_invoices";

-- Legacy receipts must exist unchanged (do not modify these):
SELECT count(*) AS legacy_receipts FROM public."RENT_v3_payment_receipts";
SELECT count(*) AS legacy_items FROM public."RENT_v3_payment_receipt_items";
```

## Verification after apply

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'RENT_v3_%'
ORDER BY 1;

-- Portal receipts only:
SELECT table_name FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN (
    'RENT_v3_portal_payment_receipts',
    'RENT_v3_portal_payment_receipt_items'
  );

-- Legacy still present and untouched:
SELECT count(*) FROM public."RENT_v3_payment_receipts";
SELECT count(*) FROM public."RENT_v3_payment_receipt_items";

SELECT relname, relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public'
  AND relname LIKE 'RENT_v3_portal%' OR relname LIKE 'RENT_v3_payment_attempt%'
ORDER BY 1;
```

## Rollback (drops portal-created objects only — never legacy receipts)

```sql
DROP TABLE IF EXISTS public."RENT_v3_contact_audit_events" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_contact_verification_attempts" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_tenant_contact_points" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_staff_exceptions" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_confirmed_sender_mappings" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_payment_match_candidates" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_bank_transactions" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_bank_connections" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_portal_payment_receipt_items" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_portal_payment_receipts" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_provider_events" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_payment_attempt_events" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_payment_attempts" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_payment_fee_policies" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_tenant_payment_references" CASCADE;
DROP TABLE IF EXISTS public."RENT_v3_portal_access_tokens" CASCADE;
DROP FUNCTION IF EXISTS public.rent_v3_portal_assert_table_ready(text, text[]);

-- DO NOT drop:
-- public."RENT_v3_payment_receipts"
-- public."RENT_v3_payment_receipt_items"
```

Do not apply to production until owner approves and backup is confirmed.
