# Payment Mismatch Fix - Implementation Summary

## Problem Solved
**Issue**: Invoice for 140 Anthony St (due Jan 1, 2026) appeared in invoice modal showing $1,250 owed, but payments page showed $0.00.

**Root Cause**: The invoice doesn't exist in the database. The invoice modal generates "expected invoices" (virtual invoices) for missing periods, but the payments page only counted real invoices from the database.

## Solution Implemented

### Changes Made
**File**: `src/app/payments/page.tsx`

**Updated Function**: `fetchLeases()` (lines 251-294)

**Changes**:
1. ✅ Added expected invoice generation using `generateExpectedInvoices()` function
2. ✅ Combined real invoices with expected invoices
3. ✅ Updated `totalOwed` calculation to include expected invoices
4. ✅ Maintained same filtering logic (status='OPEN' AND balance_due > 0)

### Code Changes

**Before**:
```typescript
const invoices = Array.isArray(invoicesData) ? invoicesData : []

const existingUnpaidInvoices = invoices.filter((inv: Invoice) => 
  inv.status === 'OPEN' && parseFloat(inv.balance_due as any) > 0
)

const totalOwed = existingUnpaidInvoices.reduce((sum: number, inv: Invoice) => 
  sum + parseFloat(inv.balance_due as any), 0
) + missingInvoicesAmount
```

**After**:
```typescript
const invoices = Array.isArray(invoicesData) ? invoicesData : []

// Generate expected invoices for missing periods (same logic as invoice modal)
const expectedInvoices = generateExpectedInvoices(
  leaseData,
  leaseData.lease_start_date,
  today,
  invoices
)

// Combine real and expected invoices
const allInvoices = [...invoices, ...expectedInvoices]

// Filter unpaid invoices (both real and expected)
const unpaidInvoices = allInvoices.filter((inv: Invoice) => 
  inv.status === 'OPEN' && parseFloat(inv.balance_due as any) > 0
)

// Calculate total owed from unpaid invoices (real + expected)
const totalOwed = unpaidInvoices.reduce((sum: number, inv: Invoice) => 
  sum + parseFloat(inv.balance_due as any), 0
)
```

## Expected Results

### For 140 Anthony St (Lease ID: 0eea0850-4945-4a13-a609-a1f132758bfa)
- **Before**: Payments page showed $0.00 (no invoice in database)
- **After**: Payments page shows $1,250.00 (expected invoice for Jan 1, 2026)
- **Invoice Modal**: Still shows $1,250.00 (unchanged)
- **Result**: ✅ **MATCH** - Both screens now show the same amount

### General Behavior
- ✅ Payments page now includes expected invoices in `totalOwed` calculation
- ✅ Consistent with invoice modal behavior
- ✅ Expected invoices are only generated for periods between lease start and today
- ✅ Only unpaid invoices (status='OPEN' AND balance_due > 0) are counted

## Testing Recommendations

1. **Test 140 Anthony St**:
   - Navigate to Payments page
   - Verify "Total Owed" shows $1,250.00 (not $0.00)
   - Click "View Invoices" - verify invoice modal shows expected invoice for Jan 1, 2026

2. **Test Other Properties**:
   - Verify existing invoices still count correctly
   - Verify properties with no missing invoices show same amount
   - Verify properties with multiple missing invoices show correct total

3. **Edge Cases**:
   - Lease with no invoices (should show expected invoices)
   - Lease with all invoices paid (should show $0.00)
   - Lease with partial payments (should show correct balance)

## Notes

- **Late Tenants Screen**: No changes needed - it correctly shows only real late invoices from database
- **Expected Invoices**: These are virtual invoices that represent money owed but not yet invoiced
- **Consistency**: Payments page and invoice modal now use identical logic for calculating total owed

## Files Modified
- `src/app/payments/page.tsx` - Updated `fetchLeases()` function

## Files Not Modified (But Reviewed)
- `src/app/api/late-tenants/route.ts` - No changes needed (only shows real late invoices)
- `src/app/payments/page.tsx` - `generateExpectedInvoices()` function (already existed, reused)
