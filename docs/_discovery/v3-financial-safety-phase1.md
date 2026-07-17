# Phase 1 Discovery — V3 Financial Safety

**Repo:** `C:\Users\hones\OneDrive\Projects\rental-app-v2`  
**Branch:** `feature/v3-tenant-communications` (ahead of origin; CI/deploy workflow builds `master`)  
**HEAD:** `d6c76af` checkpoint before checking out fix/web-safe-clean  
**Prior release commit with rent-change work:** `69630a7 release(v3): lease income, period-to-period, eviction, and prospective rent changes`

## Root cause: $160 lease / $140 future invoices (100 Willis Bell / Jayne Long)

1. Lease UI confirms rent change → `PUT /api/leases` with `rent` + `rentEffectiveDate`.
2. PUT **first** updates `RENT_leases.rent` to $160.
3. PUT **then** best-effort patches OPEN/PARTIAL invoices with `due_date >= effectiveDate`.
4. Per-invoice patch errors are only logged; the API still returns success.
5. `generateMissingFutureInvoicesOnly` only **inserts missing** due dates; it never rewrites existing `$140` `amount_rent`.
6. `rentEffectiveDate` / prior rent are **not persisted** on the lease row, so later generate-missing uses only `lease.rent`.
7. Result: lease shows $160; existing future invoice rows remain frozen at create-time `$140`.

Eligibility helper already exists and is correct in principle (`invoiceEligibleForRentChange` / `buildRentChangePreview` in `src/lib/rent-change.ts`), but apply is non-atomic and fail-open.

## Payments page baseline (authoritative for current balances)

`src/app/payments/page.tsx` `fetchLeases`:

- Business date from `/api/business-date` (America/New_York).
- Per lease: invoices `due_date <= businessDate` and `>= lease_start`, payments for lease.
- Exclude future-dated payments (`payment_date > businessDate`).
- Group by `invoice_id`; `balance_due = amount_total − sum(eligible payments)`.
- Unpaid = OPEN with positive recalculated balance; `totalOwed` = sum of those balances.
- Shared copy: `calculateUnpaidInvoices` in `src/lib/invoice-calculations.ts`.

Baseline uses **stored invoice `amount_total`**, not live `lease.rent`.

## Allocation source of truth

- Production-compatible reads: **`RENT_payments.invoice_id`** direct link; sum amounts.
- Write: insert payment → RPC `rent_apply_payment_fifo` (allocation failure does not roll back payment insert today).
- `RENT_payment_allocations` is optional/legacy; create script exists; invoice GET returns empty allocations.
- Do **not** invent a new allocation table for the ledger.

## Late fee storage

| Location | Role |
|---|---|
| `RENT_leases.late_fee_amount` | Lease default override |
| `RENT_leases.grace_days` | Used in SQL/shadow code; thin in app types |
| `RENT_invoices.amount_late` | Billed late fee on invoice |
| Payments UI waive | Sets `amount_late = 0` via invoice PUT |
| `POST /api/late-fees/waive` | Writes into lease notes — does not clear `amount_late` |
| `RENT_rent_periods.late_fee_*` | Legacy period model |

No single authoritative idempotent late-fee reconciler yet.

## Multi-write non-transactional ops

1. Lease PUT: lease update → N invoice patches → optional invoice inserts.
2. Payment POST: optional invoice create → payment insert → FIFO RPC.
3. Payments UI: create invoice then payment; separate balance update.

## Duplicated financial math / N+1

- Payments (client per-lease), Late Tenants API, Last Paid API, Dashboard, Profit, shadow-reconciliation.
- Payments load: **1 + N×(invoices + payments)** browser requests.
- Invoice modals often fetch payments per invoice.

## Schema notes

- No `supabase/migrations/` folder; SQL is root `*.sql` scripts.
- No `rent_effective_date` / `prior_rent` columns in app today.
- Types vs DB mismatches: Invoice status enums, Payment missing `invoice_id` in older interfaces, allocations period-centric types.

## Phase 2 approach (approved by discovery)

Single Postgres RPC `rent_apply_prospective_change` locking lease + eligible invoices, updating lease rent (+ optional effective/prior columns), rewriting OPEN/PARTIAL invoices with `due_date >= effective_date` using eligible paid totals, fail-closed, return structured apply result. App PUT must call that RPC instead of silent per-row loops.
