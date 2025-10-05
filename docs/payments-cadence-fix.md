# Payment Grid Cadence Fix

## Overview

This document describes the comprehensive fix for payment grid cadence logic to resolve issues with weekly, bi-weekly, and monthly period display, payment bucketing, and status calculation.

## Problem Statement

The original implementation had several critical issues:

1. **All periods showing as gray/locked** for monthly leases
2. **Timezone drift** causing incorrect period matching
3. **Incorrect payment bucketing** due to local time calculations
4. **Inconsistent status calculation** leading to wrong colors and states
5. **Bi-weekly anchor drift** when computed in local time
6. **Monthly period selection** not properly handling rent due dates

## Solution Architecture

### Feature Flag Implementation

The fix is implemented behind a feature flag `NEXT_PUBLIC_USE_CADENCE_FIX` to ensure safe deployment:

- **`true`**: Uses new UTC-based logic
- **`false`**: Falls back to legacy behavior

### Core Components

1. **`lib/dateSafe.ts`**: UTC-based date utilities
2. **`lib/rent/periods.ts`**: Enhanced period generation logic
3. **`lib/rent/paymentBucket.ts`**: Improved payment bucketing
4. **`app/api/rent/payments/grid/route.ts`**: Fixed status calculation
5. **`app/payments/page.tsx`**: Updated frontend display

## Period Generation Logic

### Weekly Leases
- **Active Periods**: Every Friday within lease date range
- **Payment Window**: Saturday 00:00:00 UTC → Friday 23:59:59 UTC
- **Logic**: All Fridays between lease start and end are active

### Bi-Weekly Leases
- **Active Periods**: Every 14 days starting from anchor Friday
- **Anchor Calculation**: First Friday on or after lease start date (UTC)
- **Payment Window**: Previous Saturday 00:00:00 UTC → Friday 23:59:59 UTC
- **Logic**: `differenceInCalendarDays(friday, anchor) % 14 === 0`

### Monthly Leases
- **Active Periods**: Friday closest to `rent_due_day` in each month
- **Payment Window**: Entire calendar month (start of month → end of month)
- **Logic**: 
  1. Find all Fridays in the month
  2. Calculate distance to `rent_due_day`
  3. Select Friday with minimum distance
  4. All other Fridays in month are locked

## Payment Bucketing

### Matching Rules
1. **Primary**: `payment.lease_id === lease.id`
2. **Fallback**: `payment.property_id === lease.property_id AND payment.tenant_id === lease.tenant_id` (only if lease_id is null)

### Window Matching
- All dates converted to UTC for consistent comparison
- Uses `isWithinIntervalUTC()` for inclusive boundary checking
- Prevents double-counting payments

## Status Calculation

### Status Hierarchy
1. **Outside Lease**: `status='outside_lease'`, `isLocked=true`
2. **Active Periods**:
   - `amountPaid >= expectedAmount` → `paid` (green)
   - `amountPaid > 0` → `partial` (yellow)
   - `today < dueDate` → `upcoming` (gray)
   - `else` → `owed` (red)
3. **Inactive Within Lease**:
   - **Monthly**: Locked unless payment exists
   - **Weekly/Bi-weekly**: Locked unless payment exists

### Locked Period Rules
- **Monthly**: All Fridays except closest to rent_due_day
- **Bi-weekly**: All Fridays except every 14th day from anchor
- **Weekly**: No locked periods (all active)
- **Outside Lease**: All periods locked

## Total Owed Calculation

```typescript
const totalOwed = periods
  .filter(period => period.isActive && todayUTC >= period.dueDate)
  .reduce((sum, period) => sum + Math.max(0, expectedAmount - amountPaid), 0)
```

Only active periods that are past due are included in the total.

## Debug Features

When `NEXT_PUBLIC_DEBUG_PAYMENTS=true`, the system logs:

- Lease processing details
- Period generation for each cadence
- Payment bucketing results
- Status calculation steps
- Final cell states

## Testing

### Acceptance Tests

1. **Weekly**: 4-5 periods per month, payments on Sunday belong to upcoming Friday
2. **Bi-weekly**: Anchor-based 14-day intervals, edge case handling
3. **Monthly**: Exactly 1 active period per month, rent_due_day edge cases (1, 15, 31)

### Integration Tests

- Payment matching prefers lease_id over fallback
- No double bucketing of payments
- UTC boundary timestamp handling

## Environment Variables

```bash
# Enable new cadence logic
NEXT_PUBLIC_USE_CADENCE_FIX=true

# Enable debug logging
NEXT_PUBLIC_DEBUG_PAYMENTS=false
```

## Migration Strategy

1. Deploy with flag disabled (`false`)
2. Test legacy behavior unchanged
3. Enable flag (`true`) for testing
4. Monitor debug logs for issues
5. Full rollout once validated

## Benefits

- **Accurate Period Display**: Exactly 1 active period per month for monthly leases
- **Timezone Safe**: All calculations in UTC prevent drift
- **Proper Payment Bucketing**: Payments correctly assigned to periods
- **Consistent Status**: Green/yellow/red colors display correctly
- **Locked Period Indicators**: Clear visual feedback for non-clickable periods
- **Feature Flag Safety**: Can rollback instantly if issues arise
