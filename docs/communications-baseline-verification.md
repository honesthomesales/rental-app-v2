# Communications baseline verification

Comparison date: 2026-07-18

Clean baseline worktree:
`C:\Users\hones\OneDrive\Projects\rental-app-v2-baseline-0d0661b`

Baseline commit: `0d0661b6726b39e072212d0e5645b69e66a67cb3`

Commands run in both worktrees:

```text
npm run lint
npm test -- --runInBand
npm run build
```

## Baseline results

- Lint: 315 problems — **265 errors**, 50 warnings.
- Tests: 10 failed suites, 11 passed suites; **11 failed tests**, 117 passed.
- Build: passed.

Failing suites:

1. `tests/rent/lateTenants.spec.ts` — suite failed to run (`vitest` missing).
2. `tests/rent/paymentBucket.spec.ts` — suite failed to run (`vitest` missing).
3. `tests/rent/periods.spec.ts` — suite failed to run (`vitest` missing).
4. `src/app/api/rent/period-map/__tests__/route.test.ts`
5. `__tests__/billing/monthly.overbrook.spec.ts`
6. `__tests__/billing/periods.spec.ts`
7. `__tests__/billing/bucketing.spec.ts`
8. `__tests__/billing/monthly.spec.ts`
9. `__tests__/portfolio-ledger/request-budget.test.ts`
10. `src/lib/__tests__/cadence.test.ts`

Failing test names:

1. `/api/rent/period-map › should call Supabase RPC with correct parameters`
2. `Monthly Overbrook Scenario - Anchor + 28 Days › should generate exactly one active Friday per month using anchor + 28 days`
3. `Rental Period Generation › Bi-Weekly Leases › should handle lease starting on Friday`
4. `Rental Period Generation › Monthly Leases › should generate exactly one active period per month`
5. `Payment Bucketing › Payment Matching › should prefer lease_id over fallback matching`
6. `Monthly Period Generation › Edge Cases for rent_due_day › should handle rent_due_day = 15`
7. `Monthly Period Generation › Due Date Calculation › should set due date to active Friday at 23:59:59 UTC`
8. `Monthly Period Generation › Timezone Edge Cases › should handle UTC Friday that appears as Thursday in local timezone`
9. `Monthly Period Generation › Timezone Edge Cases › should maintain UTC consistency across different timezone scenarios`
10. `portfolio collections request budget › eligible payment recording and FIFO allocation use one transaction RPC`
11. `cadence utilities › normalizeCadence › should handle variations and spaces`

## Feature branch results (`feature/v3-communications-approval-center`)

- Lint: 321 problems — **265 errors**, 56 warnings.
- Tests: 10 failed suites, 12 passed suites; **11 failed tests**, 147 passed.
- Build: passed.

The extra 6 warnings come from untracked `local-private/` scripts that exist only
in the feature worktree and are not part of the communications commit. Lint
errors remain exactly 265. No communications source file introduced a lint
error.

Failing suites: identical to baseline (same 10 suite names).

Failing test names: identical to baseline (same 11 test names).

Passed-suite increase (11 → 12) and passed-test increase (117 → 147) come from
the new `__tests__/communications/communications.test.ts` suite (30 passing
tests). No baseline failure was newly introduced.

## Acceptance

- New test failures introduced: **0**
- New lint errors introduced: **0**
- Production build: **passed**
