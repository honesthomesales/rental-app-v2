# Invoice Display Fix Proposal

## Issues Identified

### Issue 1: Overpaid Invoices Not Showing Green Color
**Problem**: Invoices with negative balance (overpaid) don't show green color
**Current Logic**: `if (balance === 0)` only checks for exactly zero
**Fix Needed**: Change to `if (balance <= 0)` to include overpaid invoices

### Issue 2: No Invoices Showing After Lease Change
**Problem**: When lease changed from biweekly $375 to weekly $210 with start date 1/1/2026:
- Old invoices (before 1/1/2026) not showing
- New invoices (on/after 1/1/2026) not showing
- Shows "No invoices found"

**Root Causes**:

1. **API Date Filter Issue**:
   - `handleViewInvoices` uses `leaseStart = leaseRow.lease.lease_start_date` (NEW start date: 1/1/2026)
   - API call: `/api/invoices?leaseId=X&from=2026-01-01&to=future`
   - API filters with `.gte('due_date', from)` which means `due_date >= 2026-01-01`
   - **Result**: Old invoices before 1/1/2026 are filtered out

2. **Invoice Generation Only Supports Monthly**:
   - `generateInvoicesForLease()` in lease API only supports monthly cadence
   - When lease changed to weekly, no invoices were generated
   - **Result**: No new invoices exist in database

3. **Expected Invoice Generation Only Supports Monthly**:
   - `generateExpectedInvoices()` in payments page only supports monthly cadence
   - When viewing weekly lease, no expected invoices are generated
   - **Result**: No expected invoices shown

## Proposed Fixes

### Fix 1: Overpaid Invoice Color
**File**: `src/app/payments/page.tsx`
**Change**: Update `getInvoiceStatusColor` and `getInvoiceStatusBadge` to handle negative balance

```typescript
// Change from:
if (balance === 0) return 'bg-green-200 border-green-400'

// To:
if (balance <= 0) return 'bg-green-200 border-green-400'  // Includes overpaid
```

### Fix 2: Show All Invoices (Including Old Ones)
**File**: `src/app/payments/page.tsx`
**Change**: Fetch invoices from lease creation date or a date before new lease_start_date

**Option A**: Fetch ALL invoices for lease (no date filter)
```typescript
const url = `/api/invoices?leaseId=${leaseRow.lease.id}`  // Remove from/to filters
```

**Option B**: Fetch from a date before new lease_start_date
```typescript
// Use lease creation date or 1 year before new lease_start_date
const fetchFromDate = new Date(leaseRow.lease.lease_start_date)
fetchFromDate.setFullYear(fetchFromDate.getFullYear() - 1)
const url = `/api/invoices?leaseId=${leaseRow.lease.id}&from=${fetchFromDate.toISOString().split('T')[0]}&to=${futureDateStr}`
```

**Recommendation**: Option A (fetch all invoices) - simpler and shows complete history

### Fix 3: Add Weekly Invoice Generation Support
**File**: `src/app/api/leases/route.ts`
**Change**: Extend `generateInvoicesForLease()` to support weekly cadence

**Logic Needed**:
- For weekly: Generate invoices every 7 days from lease_start_date
- Use `due_weekday` if available, or default to lease_start_date weekday
- Period: 7 days (period_start to period_start + 6 days)
- Due date: Same as period_start (or based on due_weekday)

### Fix 4: Add Weekly Expected Invoice Generation Support
**File**: `src/app/payments/page.tsx`
**Change**: Extend `generateExpectedInvoices()` to support weekly cadence

**Logic Needed**:
- For weekly: Generate expected invoices every 7 days from lease_start_date to today
- Use `due_weekday` if available, or default to lease_start_date weekday
- Period: 7 days
- Due date: Based on weekly cadence

## Questions for User

1. **Old Invoices**: Should old invoices (before new lease_start_date) be visible?
   - **Recommendation**: Yes, show them for history but maybe visually distinguish them

2. **Weekly Invoice Due Date**: For weekly invoices, what determines the due date?
   - Use `due_weekday` field? (e.g., 5 = Friday)
   - Or use the weekday of `lease_start_date`?
   - **Recommendation**: Use `due_weekday` if available, otherwise use lease_start_date weekday

3. **Biweekly Support**: Should we also add biweekly invoice generation?
   - **Recommendation**: Yes, add support for biweekly as well

4. **Invoice Periods**: For weekly invoices:
   - Period start: Day of week (e.g., Monday)
   - Period end: 6 days later (Sunday)
   - Due date: Same as period start?
   - **Recommendation**: Yes, due date = period start

## Implementation Plan

### Phase 1: Fix Overpaid Color (Quick Fix)
- Update color logic to handle `balance <= 0`
- Test with overpaid invoice

### Phase 2: Fix Invoice Fetching
- Change API call to fetch all invoices (or from earlier date)
- Test that old invoices appear

### Phase 3: Add Weekly Invoice Generation
- Extend `generateInvoicesForLease()` to support weekly
- Test invoice generation for weekly lease

### Phase 4: Add Weekly Expected Invoice Generation
- Extend `generateExpectedInvoices()` to support weekly
- Test expected invoices appear for weekly lease

### Phase 5: Add Biweekly Support (Optional)
- Extend both functions to support biweekly
- Test biweekly invoice generation

## Testing Checklist

- [ ] Overpaid invoice shows green color
- [ ] Old invoices (before new lease_start_date) appear in modal
- [ ] New weekly invoices are generated when lease is updated
- [ ] Expected weekly invoices appear when viewing lease
- [ ] Weekly invoice periods are correct (7 days)
- [ ] Weekly invoice due dates are correct
- [ ] Test with multiple lease updates
- [ ] Test with biweekly cadence (if implemented)
