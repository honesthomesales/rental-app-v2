# Payment Mismatch Analysis & Fix Proposal

## Problem Statement
**Issue**: Invoice for 140 Anthony St (due Jan 1, 2026) appears in invoice modal but payments page shows $0.00 total owed. Expected: $1,250.

**Date Context**: Today is January 19, 2026. Invoice due date is January 1, 2026 (18 days past due).

**CRITICAL DISCOVERY**: The invoice modal generates "expected invoices" for missing periods. These are virtual invoices (IDs like `expected-2026-01-01`) that don't exist in the database. The payments page only counts invoices that exist in the database.

---

## Root Cause Analysis

### 1. How Each Screen Calculates "Total Owed"

#### **Payments Page** (`src/app/payments/page.tsx`)
- **API Call**: `/api/invoices?leaseId=${leaseId}&from=${lease_start_date}&to=${today}`
- **Date Filter**: `due_date >= lease_start_date AND due_date <= today`
- **Status Filter**: `status === 'OPEN' AND balance_due > 0`
- **Calculation**: `totalOwed = sum(balance_due)` for filtered invoices

**Expected Behavior**: Invoice due 2026-01-01 should be included since `2026-01-01 <= 2026-01-19` ✓

#### **Late Tenants Screen** (`src/app/api/late-tenants/route.ts`)
- **API Query**: `.lte('due_date', today)` (due_date <= today)
- **Additional Filter**: `invoice.due_date >= leaseStartDate` (client-side)
- **Status Filter**: `status === 'OPEN' AND balance_due > 0`
- **Late Filter**: `dueDate < todayDate AND balance_due > 0`
- **Calculation**: `totalLateAmount = sum(balance_due)` for late invoices only

**Expected Behavior**: Invoice due 2026-01-01 should be included since `2026-01-01 < 2026-01-19` ✓

#### **Invoice Modal** (`src/app/payments/page.tsx` - `handleViewInvoices`)
- **API Call**: `/api/invoices?leaseId=${leaseId}&from=${leaseStart}&to=${futureDateStr}` (1 year ahead)
- **Date Filter**: `due_date >= lease_start_date AND due_date <= future_date`
- **No Status Filter**: Shows ALL invoices (OPEN, PAID, PARTIAL)
- **CRITICAL**: Also generates "expected invoices" via `generateExpectedInvoices()` for missing periods
- **Expected Invoices**: Virtual invoices with IDs like `expected-2026-01-01` that DON'T exist in database
- **Calculation**: Displays ALL invoices (real + expected) regardless of status

**Expected Behavior**: Invoice due 2026-01-01 is included because:
  1. If it exists in DB → shown from API
  2. If it doesn't exist → shown as "expected invoice" (virtual)
  
**PROBLEM**: Payments page only counts real invoices from database, not expected invoices!

---

### 2. Potential Causes of Mismatch

#### **Cause A: Invoice Status Issue**
- Invoice might have `status = 'PAID'` or `status = 'PARTIAL'` instead of `'OPEN'`
- Payments page filters: `status === 'OPEN'` → excludes non-OPEN invoices
- **Check**: Query invoice status in database

#### **Cause B: Balance Due Calculation Issue**
- Invoice might have `balance_due = 0` or `balance_due = NULL`
- Payments page filters: `balance_due > 0` → excludes zero-balance invoices
- **Check**: Query `balance_due` value in database

#### **Cause C: Date Comparison Issue**
- Timezone mismatch between `due_date` and `today`
- Date format inconsistency (ISO vs local)
- **Check**: Verify date comparison logic

#### **Cause D: Invoice Not Returned by API**
- API might be filtering out the invoice due to:
  - Missing `lease_id` or incorrect `lease_id`
  - Date range filter excluding it
  - Database query error
- **Check**: Query invoices API directly with same parameters

### **Cause E: Expected Invoice (Virtual Invoice) - MOST LIKELY**
- Invoice doesn't exist in database
- Modal generates "expected invoice" for missing period
- Payments page only counts real invoices from database
- **Check**: Look for invoice ID starting with `expected-` in modal
- **Solution**: Either create the invoice in database OR update payments page to count expected invoices

---

## Proposed Solution: Unified Invoice Filtering Logic

### **Goal**: Ensure all screens use the SAME logic to determine which invoices count toward "Total Owed"

### **Strategy**: Create a shared utility function for invoice filtering

---

## Fix Proposal

### **Phase 0: Immediate Fix - Handle Expected Invoices**

**Option A: Create Missing Invoice in Database**
- When expected invoice is shown in modal, automatically create it in database
- Or add button to "Create Invoice" for expected invoices

**Option B: Include Expected Invoices in Payments Page**
- Update `fetchLeases()` to also generate expected invoices
- Count expected invoices toward totalOwed
- Ensure consistency between modal and payments page

**Recommended**: Option B (include expected invoices) because:
- Expected invoices represent real money owed
- User expects to see them counted
- More consistent with modal behavior

### **Phase 1: Create Shared Invoice Filter Utility**

**File**: `src/lib/invoice-filters.ts` (NEW)

```typescript
/**
 * Shared invoice filtering logic to ensure consistency across all screens
 * 
 * This ensures:
 * - Payments page and Late Tenants screen show the same "Total Owed"
 * - Invoice modal can optionally filter by same logic
 * - All screens use identical criteria
 */

export interface InvoiceFilterOptions {
  leaseStartDate?: string | null
  today?: string // ISO date string (YYYY-MM-DD)
  includeFuture?: boolean // If true, includes invoices with due_date > today
  includePaid?: boolean // If true, includes PAID invoices
  minBalanceDue?: number // Minimum balance_due to include (default: 0.01)
}

export interface Invoice {
  id: string
  lease_id: string
  due_date: string
  status: string
  balance_due: number | string
  amount_total: number | string
  amount_paid: number | string
  // ... other fields
}

/**
 * Filters invoices using consistent logic across all screens
 */
export function filterUnpaidInvoices(
  invoices: Invoice[],
  options: InvoiceFilterOptions = {}
): Invoice[] {
  const {
    leaseStartDate,
    today = new Date().toISOString().split('T')[0],
    includeFuture = false,
    includePaid = false,
    minBalanceDue = 0.01
  } = options

  const todayDate = new Date(today)
  todayDate.setHours(0, 0, 0, 0)

  return invoices.filter(invoice => {
    // 1. Filter by lease start date
    if (leaseStartDate) {
      const invoiceDueDate = new Date(invoice.due_date)
      invoiceDueDate.setHours(0, 0, 0, 0)
      const leaseStart = new Date(leaseStartDate)
      leaseStart.setHours(0, 0, 0, 0)
      
      if (invoiceDueDate < leaseStart) {
        return false // Invoice before lease start
      }
    }

    // 2. Filter by due date (unless includeFuture is true)
    if (!includeFuture) {
      const invoiceDueDate = new Date(invoice.due_date)
      invoiceDueDate.setHours(0, 0, 0, 0)
      
      if (invoiceDueDate > todayDate) {
        return false // Future invoice excluded
      }
    }

    // 3. Filter by status
    if (!includePaid && invoice.status === 'PAID') {
      return false // Paid invoices excluded
    }

    // 4. Filter by balance_due
    const balanceDue = parseFloat(invoice.balance_due as any) || 0
    if (balanceDue < minBalanceDue) {
      return false // Zero or negative balance excluded
    }

    return true
  })
}

/**
 * Calculates total owed from filtered invoices
 */
export function calculateTotalOwed(
  invoices: Invoice[],
  options: InvoiceFilterOptions = {}
): number {
  const filtered = filterUnpaidInvoices(invoices, options)
  return filtered.reduce((sum, invoice) => {
    return sum + (parseFloat(invoice.balance_due as any) || 0)
  }, 0)
}

/**
 * Filters for "late" invoices (past due date)
 */
export function filterLateInvoices(
  invoices: Invoice[],
  options: InvoiceFilterOptions = {}
): Invoice[] {
  const {
    today = new Date().toISOString().split('T')[0],
    ...otherOptions
  } = options

  const todayDate = new Date(today)
  todayDate.setHours(0, 0, 0, 0)

  return filterUnpaidInvoices(invoices, {
    ...otherOptions,
    includeFuture: false,
    includePaid: false
  }).filter(invoice => {
    const invoiceDueDate = new Date(invoice.due_date)
    invoiceDueDate.setHours(0, 0, 0, 0)
    return invoiceDueDate < todayDate // Past due only
  })
}

/**
 * Calculates total late amount
 */
export function calculateTotalLateOwed(
  invoices: Invoice[],
  options: InvoiceFilterOptions = {}
): number {
  const filtered = filterLateInvoices(invoices, options)
  return filtered.reduce((sum, invoice) => {
    return sum + (parseFloat(invoice.balance_due as any) || 0)
  }, 0)
}
```

---

### **Phase 2: Update Payments Page to Use Shared Logic**

**File**: `src/app/payments/page.tsx`

**Changes**:
1. Import shared filter functions
2. Replace inline filtering with `filterUnpaidInvoices()`
3. Replace calculation with `calculateTotalOwed()`

**Before** (line 264-276):
```typescript
const existingUnpaidInvoices = invoices.filter((inv: Invoice) => 
  inv.status === 'OPEN' && parseFloat(inv.balance_due as any) > 0
)

const totalOwed = existingUnpaidInvoices.reduce((sum: number, inv: Invoice) => 
  sum + parseFloat(inv.balance_due as any), 0
) + missingInvoicesAmount
```

**After**:
```typescript
import { filterUnpaidInvoices, calculateTotalOwed } from '@/lib/invoice-filters'
import { generateExpectedInvoices } from '@/lib/invoice-utils' // Move to shared utility

// Generate expected invoices for missing periods (same as modal)
const expectedInvoices = generateExpectedInvoices(
  leaseData, 
  leaseData.lease_start_date, 
  today, 
  invoices
)

// Combine real and expected invoices
const allInvoices = [...invoices, ...expectedInvoices]

// Filter and calculate using shared logic
const existingUnpaidInvoices = filterUnpaidInvoices(allInvoices, {
  leaseStartDate: leaseData.lease_start_date,
  today: today,
  includeFuture: false,
  includePaid: false
})

const totalOwed = calculateTotalOwed(allInvoices, {
  leaseStartDate: leaseData.lease_start_date,
  today: today,
  includeFuture: false,
  includePaid: false
}) + missingInvoicesAmount
```

---

### **Phase 3: Update Late Tenants API to Use Shared Logic**

**File**: `src/app/api/late-tenants/route.ts`

**Changes**:
1. Import shared filter functions
2. Replace inline filtering with `filterLateInvoices()`
3. Replace calculation with `calculateTotalLateOwed()`

**Before** (line 114-125):
```typescript
const allUnpaidInvoices = validInvoices.filter(invoice => 
  invoice.status === 'OPEN' && parseFloat(invoice.balance_due || 0) > 0
)

const lateInvoices = validInvoices.filter(invoice => {
  const dueDate = new Date(invoice.due_date)
  const isPastDue = dueDate < todayDate
  const hasBalance = parseFloat(invoice.balance_due || 0) > 0
  return isPastDue && hasBalance
})
```

**After**:
```typescript
import { filterUnpaidInvoices, filterLateInvoices, calculateTotalLateOwed } from '@/lib/invoice-filters'

const allUnpaidInvoices = filterUnpaidInvoices(validInvoices, {
  leaseStartDate: leaseStartDate,
  today: today,
  includeFuture: false,
  includePaid: false
})

const lateInvoices = filterLateInvoices(validInvoices, {
  leaseStartDate: leaseStartDate,
  today: today
})
```

---

### **Phase 4: Add Validation & Debugging**

**File**: `src/lib/invoice-filters.ts` (add to existing)

```typescript
/**
 * Validates invoice data consistency
 * Logs warnings for potential issues
 */
export function validateInvoice(invoice: Invoice): {
  isValid: boolean
  warnings: string[]
} {
  const warnings: string[] = []
  
  const amountTotal = parseFloat(invoice.amount_total as any) || 0
  const amountPaid = parseFloat(invoice.amount_paid as any) || 0
  const balanceDue = parseFloat(invoice.balance_due as any) || 0
  const expectedBalance = amountTotal - amountPaid
  
  // Check balance_due calculation
  if (Math.abs(balanceDue - expectedBalance) > 0.01) {
    warnings.push(
      `Invoice ${invoice.id}: balance_due (${balanceDue}) doesn't match ` +
      `amount_total (${amountTotal}) - amount_paid (${amountPaid}) = ${expectedBalance}`
    )
  }
  
  // Check status consistency
  if (balanceDue <= 0 && invoice.status === 'OPEN') {
    warnings.push(
      `Invoice ${invoice.id}: status is 'OPEN' but balance_due is ${balanceDue}`
    )
  }
  
  if (balanceDue > 0 && invoice.status === 'PAID') {
    warnings.push(
      `Invoice ${invoice.id}: status is 'PAID' but balance_due is ${balanceDue}`
    )
  }
  
  return {
    isValid: warnings.length === 0,
    warnings
  }
}
```

---

### **Phase 5: Add Diagnostic Endpoint**

**File**: `src/app/api/invoices/diagnose/route.ts` (NEW)

```typescript
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { filterUnpaidInvoices, calculateTotalOwed, validateInvoice } from '@/lib/invoice-filters'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const leaseId = searchParams.get('leaseId')
    const propertyId = searchParams.get('propertyId')
    
    if (!leaseId && !propertyId) {
      return NextResponse.json(
        { error: 'leaseId or propertyId is required' },
        { status: 400 }
      )
    }
    
    // Fetch all invoices
    let query = supabaseServer.from('RENT_invoices').select('*')
    if (leaseId) query = query.eq('lease_id', leaseId)
    if (propertyId) query = query.eq('property_id', propertyId)
    
    const { data: invoices, error } = await query.order('due_date', { ascending: false })
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    // Get lease start date
    let leaseStartDate: string | null = null
    if (leaseId) {
      const { data: lease } = await supabaseServer
        .from('RENT_leases')
        .select('lease_start_date')
        .eq('id', leaseId)
        .single()
      leaseStartDate = lease?.lease_start_date || null
    }
    
    const today = new Date().toISOString().split('T')[0]
    
    // Apply filters
    const unpaidInvoices = filterUnpaidInvoices(invoices || [], {
      leaseStartDate,
      today,
      includeFuture: false,
      includePaid: false
    })
    
    const totalOwed = calculateTotalOwed(invoices || [], {
      leaseStartDate,
      today,
      includeFuture: false,
      includePaid: false
    })
    
    // Validate all invoices
    const validations = invoices?.map(invoice => validateInvoice(invoice)) || []
    const allWarnings = validations.flatMap(v => v.warnings)
    
    return NextResponse.json({
      totalInvoices: invoices?.length || 0,
      unpaidInvoicesCount: unpaidInvoices.length,
      totalOwed,
      today,
      leaseStartDate,
      invoices: invoices?.map(invoice => ({
        id: invoice.id,
        due_date: invoice.due_date,
        status: invoice.status,
        amount_total: invoice.amount_total,
        amount_paid: invoice.amount_paid,
        balance_due: invoice.balance_due,
        isIncluded: unpaidInvoices.some(ui => ui.id === invoice.id),
        validation: validateInvoice(invoice)
      })),
      warnings: allWarnings
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
```

---

## Implementation Steps

### **Step 1: Immediate Fix (Diagnosis)**
1. Run SQL diagnostic queries to check invoice status/balance
2. Call diagnostic API endpoint: `/api/invoices/diagnose?leaseId={leaseId}`
3. Identify exact cause of mismatch

### **Step 2: Create Shared Utility**
1. Create `src/lib/invoice-filters.ts` with shared filtering logic
2. Add TypeScript types for Invoice and options
3. Add validation function

### **Step 3: Update Payments Page**
1. Import shared functions
2. Replace inline filtering logic
3. Test with known problematic invoice

### **Step 4: Update Late Tenants API**
1. Import shared functions
2. Replace inline filtering logic
3. Ensure consistency with payments page

### **Step 5: Add Diagnostic Endpoint**
1. Create `/api/invoices/diagnose/route.ts`
2. Add UI button to call diagnostic endpoint
3. Display warnings/errors to user

### **Step 6: Testing**
1. Test with invoice due Jan 1, 2026 (should show $1,250)
2. Test with paid invoices (should show $0)
3. Test with future invoices (should be excluded from payments page)
4. Verify late tenants screen matches payments page

---

## Prevention Strategy

### **1. Shared Logic**
- All screens use same filtering functions
- Changes to logic automatically apply everywhere
- Reduces risk of mismatches

### **2. Validation**
- Validate invoice data consistency
- Log warnings for discrepancies
- Alert users to data issues

### **3. Diagnostic Tools**
- API endpoint to diagnose mismatches
- UI to call diagnostic endpoint
- Clear error messages

### **4. Testing**
- Unit tests for filter functions
- Integration tests for API endpoints
- E2E tests for UI consistency

---

## Expected Outcomes

### **After Fix**:
1. ✅ Payments page shows $1,250 for 140 Anthony St
2. ✅ Late Tenants screen shows same amount
3. ✅ Invoice modal shows invoice with correct status
4. ✅ All screens use identical filtering logic
5. ✅ Diagnostic tools help identify future issues

### **Long-term Benefits**:
- No more mismatches between screens
- Easier to maintain and update logic
- Better debugging capabilities
- Consistent user experience

---

## Approval Required

**Please review and approve**:
1. ✅ Create shared invoice filter utility
2. ✅ Update payments page to use shared logic
3. ✅ Update late tenants API to use shared logic
4. ✅ Add diagnostic endpoint
5. ✅ Add validation and warnings

**Questions**:
- Should we also update the invoice modal to use shared filtering?
- Should we add a UI button to call the diagnostic endpoint?
- Any other screens that need updating?
