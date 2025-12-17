-- Performance Optimization: Database Indexes
-- These indexes will significantly improve query performance for common patterns
-- Run this script in your Supabase SQL Editor

-- ============================================================
-- INDEXES FOR RENT_leases TABLE
-- ============================================================

-- Index for active leases filtered by status and date range (dashboard, profit metrics)
CREATE INDEX IF NOT EXISTS idx_leases_status_dates 
ON public."RENT_leases" (status, lease_start_date, lease_end_date)
WHERE status = 'active';

-- Index for lease lookups by property_id (properties page, dashboard)
CREATE INDEX IF NOT EXISTS idx_leases_property_id 
ON public."RENT_leases" (property_id);

-- Index for lease lookups by tenant_id (tenants page)
CREATE INDEX IF NOT EXISTS idx_leases_tenant_id 
ON public."RENT_leases" (tenant_id);

-- Composite index for active leases by property (common query pattern)
CREATE INDEX IF NOT EXISTS idx_leases_property_status 
ON public."RENT_leases" (property_id, status)
WHERE status = 'active';

-- ============================================================
-- INDEXES FOR RENT_invoices TABLE
-- ============================================================

-- Index for invoice lookups by lease_id (payments page, late tenants, dashboard)
CREATE INDEX IF NOT EXISTS idx_invoices_lease_id 
ON public."RENT_invoices" (lease_id);

-- Index for invoice filtering by status and balance (late payments, dashboard)
CREATE INDEX IF NOT EXISTS idx_invoices_status_balance 
ON public."RENT_invoices" (status, balance_due)
WHERE status = 'OPEN' AND balance_due > 0;

-- Index for invoice date range queries (profit metrics, dashboard)
CREATE INDEX IF NOT EXISTS idx_invoices_due_date 
ON public."RENT_invoices" (due_date);

-- Composite index for common invoice queries (lease + date + status)
CREATE INDEX IF NOT EXISTS idx_invoices_lease_date_status 
ON public."RENT_invoices" (lease_id, due_date, status);

-- Index for invoice lookups by property_id (profit metrics)
CREATE INDEX IF NOT EXISTS idx_invoices_property_id 
ON public."RENT_invoices" (property_id)
WHERE property_id IS NOT NULL;

-- ============================================================
-- INDEXES FOR RENT_payments TABLE
-- ============================================================

-- Index for payment lookups by lease_id (payments page, profit metrics)
CREATE INDEX IF NOT EXISTS idx_payments_lease_id 
ON public."RENT_payments" (lease_id);

-- Index for payment lookups by property_id (profit metrics, dashboard)
CREATE INDEX IF NOT EXISTS idx_payments_property_id 
ON public."RENT_payments" (property_id)
WHERE property_id IS NOT NULL;

-- Index for payment date range queries (profit metrics, payments page)
CREATE INDEX IF NOT EXISTS idx_payments_payment_date 
ON public."RENT_payments" (payment_date);

-- Composite index for common payment queries (property + date)
CREATE INDEX IF NOT EXISTS idx_payments_property_date 
ON public."RENT_payments" (property_id, payment_date)
WHERE property_id IS NOT NULL;

-- Index for payment lookups by invoice_id (payments page)
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id 
ON public."RENT_payments" (invoice_id)
WHERE invoice_id IS NOT NULL;

-- Index for payment lookups by tenant_id
CREATE INDEX IF NOT EXISTS idx_payments_tenant_id 
ON public."RENT_payments" (tenant_id)
WHERE tenant_id IS NOT NULL;

-- ============================================================
-- INDEXES FOR RENT_expenses TABLE
-- ============================================================

-- Index for expense filtering by interest_rate (one-time expenses, misc income)
CREATE INDEX IF NOT EXISTS idx_expenses_interest_rate 
ON public."RENT_expenses" (interest_rate)
WHERE interest_rate IN (-9.9999, 9.9999);

-- Index for expense date range queries (profit metrics)
CREATE INDEX IF NOT EXISTS idx_expenses_last_paid_date 
ON public."RENT_expenses" (last_paid_date)
WHERE last_paid_date IS NOT NULL;

-- Index for expense lookups by property_id
CREATE INDEX IF NOT EXISTS idx_expenses_property_id 
ON public."RENT_expenses" (property_id)
WHERE property_id IS NOT NULL;

-- Composite index for misc income queries (profit metrics)
CREATE INDEX IF NOT EXISTS idx_expenses_income_date 
ON public."RENT_expenses" (interest_rate, last_paid_date)
WHERE interest_rate = 9.9999 AND last_paid_date IS NOT NULL;

-- ============================================================
-- INDEXES FOR RENT_properties TABLE
-- ============================================================

-- Index for property type filtering (dashboard breakdown)
CREATE INDEX IF NOT EXISTS idx_properties_type 
ON public."RENT_properties" (property_type);

-- Index for property lookups by rent_value (potential income)
CREATE INDEX IF NOT EXISTS idx_properties_rent_value 
ON public."RENT_properties" (rent_value)
WHERE rent_value > 0;

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Check all indexes created
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
    AND tablename LIKE 'RENT_%'
ORDER BY tablename, indexname;

-- Check index usage (run after some time to see which indexes are being used)
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan as index_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
    AND tablename LIKE 'RENT_%'
ORDER BY idx_scan DESC;


