# V3 API Authorization Inventory

Generated for feature/v3-launch-ready. Every `src/app/api/**/route.ts` is listed.
Service-role (`supabaseServer`) is used only after `requireApiAuth` succeeds (except logout).

| Route | Method | Read/Write | Permitted roles | Auth helper | Service-role | Test coverage |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/allocations/manual` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/auth/logout` | POST | write | authenticated session (sign-out) | `createSupabaseServerAuthClient().auth.signOut()` | no | __tests__/launch/*, __tests__/safety/* |
| `/api/auth/session` | GET | read | owner, staff, readonly (active app user) | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/*, __tests__/safety/* |
| `/api/business-date` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/dashboard/metrics` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/*, __tests__/safety/* |
| `/api/data-health/future-payments` | GET | read | owner | `requireApiAuth(request, { ownerOnly: true })` | yes (after auth) | __tests__/launch/*, __tests__/safety/* |
| `/api/deals` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/deals` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/deals` | PUT | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/deals` | DELETE | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/debug/invoice-comparison` | GET | read | owner | `requireApiAuth(request, { ownerOnly: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/documents/:id` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/documents/:id` | PUT | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/documents/:id` | DELETE | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/documents` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/documents` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/documents/upload` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/expenses` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/expenses` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/expenses` | PUT | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/expenses` | DELETE | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/generate-ejectment-forms` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/generate-notice` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/invoices/:id` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/invoices/:id` | DELETE | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/invoices/:id/void` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/invoices/batch` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/invoices/by-period` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/invoices/create-approved` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/invoices/generate-missing` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/invoices/missing-preview` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/*, __tests__/safety/* |
| `/api/invoices` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/invoices` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/invoices` | PUT | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/last-paid` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/late-fees/move` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/late-fees/remove-all` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/late-fees/remove-property` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/late-fees/waive` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/late-tenants` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/*, __tests__/safety/* |
| `/api/leases` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/leases` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/leases` | PUT | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/leases` | DELETE | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/leases/rent-change-preview` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/lease-income/* |
| `/api/leases/manual-review` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/lease-income/* |
| `/api/payments` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/payments` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/payments` | PUT | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/payments` | DELETE | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/profit/metrics` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/profit/monthly-summary` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/properties/:id` | PATCH | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/properties` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/properties` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/properties` | PUT | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/properties` | DELETE | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/rent/payments/:id` | PUT | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/rent/payments/:id` | DELETE | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/rent/payments/by-period` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/rent/payments/grid` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/rent/payments/invoice-grid` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/rent/payments/property` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/rent/payments` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/rent/payments` | PUT | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/rent/payments` | DELETE | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/rent/period-map` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/tenants` | GET | read | owner, staff, readonly | `requireApiAuth(request)` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/tenants` | POST | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/tenants` | PUT | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/tenants` | DELETE | write | owner, staff | `requireApiAuth(request, { write: true })` | yes (after auth) | __tests__/launch/api-auth.test.ts + workflow coverage |
| `/api/test-late-tenants-calculation` | GET | read | owner | `requireApiAuth(request, { ownerOnly: true })` | yes (after auth) | __tests__/launch/*, __tests__/safety/* |

## Notes

- Unauthenticated API requests return **401**.
- Authenticated users without an active `RENT_v3_app_users` row return **403**.
- Readonly users receive **403** on write methods.
- Owner-only: `/api/data-health/**`, `/api/debug/**`, `/api/test-late-tenants-calculation`.
- Shadow candidate accounting remains disabled for UI and is not exposed via these routes.
