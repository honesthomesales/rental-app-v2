# Lease Update Invoice Fix Proposal

## Problem Statement

**Issue**: When a lease is updated (start date, rent amount, or cadence changed), the system:
- ✅ Keeps old invoices in database (historical data preserved)
- ❌ Still shows future invoices with old lease terms
- ❌ Future invoices don't match new lease terms (amount, cadence, due dates)
- ❌ Causes confusion and incorrect "Total Owed" calculations

**Example Scenario**:
- **Old Lease**: $150/weekly, start date: Dec 1, 2025
- **New Lease**: $850/monthly, start date: Jan 1, 2026
- **Problem**: Future invoices still show $150/week instead of $850/month
- **Expected**: Delete all future invoices (due_date >= Jan 1, 2026) and regenerate with new terms

---

## Root Cause Analysis

### Current Behavior

1. **Lease Update API** (`src/app/api/leases/route.ts` PUT):
   - Updates lease record with new values ✅
   - Does NOT delete future invoices ❌
   - Does NOT regenerate invoices ❌

2. **Invoice Storage**: 
   - Old invoices (before new `lease_start_date`) remain (correct - preserves history) ✅
   - Future invoices (on/after new `lease_start_date`) remain with OLD terms ❌
   - These future invoices have wrong amounts, cadence, due dates

3. **Total Owed Calculation**:
   - Counts future invoices with old terms
   - Shows incorrect amounts

### The Fix Needed

**Key Principle**: 
- **Historical invoices** (before new `lease_start_date`) should be:
  - ✅ Kept in database (preserve history)
  - ✅ Shown in invoice modal (for reference)
  - ❌ **NOT deleted** (preserve history)

**Future invoices** (on/after new `lease_start_date`) should be:
  - ❌ **DELETED** when lease is updated
  - ✅ **REGENERATED** with new lease terms (amount, cadence, due dates)
  - ✅ Match current lease terms exactly

---

## Proposed Solution

### Phase 1: Update Lease API to Delete Future Invoices and Regenerate

**File**: `src/app/api/leases/route.ts`

**Change: Update PUT handler to detect lease changes and regenerate invoices**

```typescript
// Current code (line 94-128):
export async function PUT(request: Request) {
  try {
    const { id, ...updateData } = await request.json()
    
    if (!id) {
      return NextResponse.json({ error: 'Lease ID is required' }, { status: 400 })
    }

    console.log('Updating lease:', id, updateData)
    
    const { data, error } = await supabaseServer
      .from('RENT_leases')
      .update(updateData)
      .eq('id', id)
      .select(`*, RENT_properties(*), RENT_tenants(*)`)
      .single()

    if (error) {
      console.error('Error updating lease:', error)
      throw new Error(`Supabase error: ${error.message}`)
    }

    console.log('Lease updated successfully:', data)
    return NextResponse.json(data)
  } catch (error) {
    // ... error handling
  }
}
```

**Fixed code**:
```typescript
export async function PUT(request: Request) {
  try {
    const { id, ...updateData } = await request.json()
    
    if (!id) {
      return NextResponse.json({ error: 'Lease ID is required' }, { status: 400 })
    }

    // Fetch current lease to compare changes
    const { data: currentLease, error: fetchError } = await supabaseServer
      .from('RENT_leases')
      .select('lease_start_date, rent, rent_cadence, rent_due_day, property_id, tenant_id')
      .eq('id', id)
      .single()

    if (fetchError || !currentLease) {
      return NextResponse.json({ error: 'Lease not found' }, { status: 404 })
    }

    // Check if lease terms that affect invoices have changed
    const leaseTermsChanged = 
      (updateData.lease_start_date && updateData.lease_start_date !== currentLease.lease_start_date) ||
      (updateData.rent && updateData.rent !== currentLease.rent) ||
      (updateData.rent_cadence && updateData.rent_cadence !== currentLease.rent_cadence) ||
      (updateData.rent_due_day !== undefined && updateData.rent_due_day !== currentLease.rent_due_day)

    // Determine new lease_start_date (use updated value or current)
    const newLeaseStartDate = updateData.lease_start_date || currentLease.lease_start_date

    // Update lease
    const { data: updatedLease, error: updateError } = await supabaseServer
      .from('RENT_leases')
      .update(updateData)
      .eq('id', id)
      .select(`*, RENT_properties(*), RENT_tenants(*)`)
      .single()

    if (updateError) {
      console.error('Error updating lease:', updateError)
      throw new Error(`Supabase error: ${updateError.message}`)
    }

    // If lease terms changed, delete future invoices and regenerate
    if (leaseTermsChanged) {
      console.log('Lease terms changed, deleting future invoices and regenerating...')
      
      // Delete all invoices with due_date >= new lease_start_date
      // Only delete unpaid invoices (preserve paid invoices for history)
      const { error: deleteError } = await supabaseServer
        .from('RENT_invoices')
        .delete()
        .eq('lease_id', id)
        .gte('due_date', newLeaseStartDate)
        .eq('status', 'OPEN')  // Only delete unpaid invoices

      if (deleteError) {
        console.error('Error deleting future invoices:', deleteError)
        // Continue anyway - regeneration will handle duplicates
      } else {
        console.log('Deleted future unpaid invoices')
      }

      // Generate new invoices from new lease_start_date forward
      await generateInvoicesForLease(updatedLease, newLeaseStartDate)
    }

    console.log('Lease updated successfully:', updatedLease)
    return NextResponse.json(updatedLease)
  } catch (error) {
    console.error('Error in lease update API:', error)
    return NextResponse.json(
      { error: 'Failed to update lease', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// Helper function to generate invoices for a lease
async function generateInvoicesForLease(lease: any, startDate: string) {
  const cadence = normalizeCadence(lease.rent_cadence || 'monthly')
  const rentDueDay = lease.rent_due_day || 1
  const rentAmount = lease.rent || 0
  
  if (cadence !== 'monthly') {
    // Only handle monthly for now (can extend later)
    console.log('Invoice generation only supports monthly cadence for now')
    return
  }

  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const start = new Date(startDate)
  const current = new Date(start.getFullYear(), start.getMonth(), 1)
  const end = new Date(today)

  const invoicesToCreate: any[] = []

  while (current <= end) {
    const year = current.getFullYear()
    const month = current.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const dueDay = Math.min(rentDueDay, daysInMonth)
    const dueDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`
    
    // Only create invoice if due date is on/after lease start
    if (dueDate >= startDate && dueDate <= todayStr) {
      const periodStart = `${year}-${String(month + 1).padStart(2, '0')}-01`
      const periodEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
      
      // Check if invoice already exists
      const { data: existing } = await supabaseServer
        .from('RENT_invoices')
        .select('id')
        .eq('lease_id', lease.id)
        .eq('due_date', dueDate)
        .maybeSingle()

      if (!existing) {
        invoicesToCreate.push({
          lease_id: lease.id,
          property_id: lease.property_id,
          tenant_id: lease.tenant_id,
          due_date: dueDate,
          period_start: periodStart,
          period_end: periodEnd,
          amount_rent: rentAmount,
          amount_late: 0,
          amount_other: 0,
          amount_total: rentAmount,
          amount_paid: 0,
          balance_due: rentAmount,
          status: 'OPEN'
        })
      }
    }

    // Move to next month
    current.setMonth(current.getMonth() + 1)
  }

  // Insert all new invoices
  if (invoicesToCreate.length > 0) {
    const { error: insertError } = await supabaseServer
      .from('RENT_invoices')
      .insert(invoicesToCreate)

    if (insertError) {
      console.error('Error creating invoices:', insertError)
    } else {
      console.log(`Created ${invoicesToCreate.length} new invoices for lease ${lease.id}`)
    }
  }
}
```

**Note**: Need to import `normalizeCadence` helper function (likely from a shared utility).

---

## Implementation Plan

### Step 1: Update Lease API
- Add logic to detect lease term changes (start_date, rent, cadence, rent_due_day)
- Delete future unpaid invoices when lease terms change
- Generate new invoices based on new lease terms
- Test with lease update

### Step 2: Create Invoice Generation Helper
- Create `generateInvoicesForLease()` function
- Support monthly cadence (can extend to weekly/biweekly later)
- Only create invoices for periods that don't already exist
- Only create invoices up to today (not future)

### Step 3: Handle Edge Cases
- Lease updated with future start date (no invoices to delete, just create new ones)
- Lease updated with past start date (delete invoices from old start date forward)
- Lease updated multiple times (each update regenerates invoices)
- Paid invoices (preserve them, only delete unpaid ones)

### Step 4: Test Scenarios
- Update lease: change start date, rent, cadence
- Verify old invoices (before new start date) remain
- Verify future invoices (on/after new start date) are deleted and regenerated
- Verify new invoices have correct amounts, cadence, due dates
- Test with multiple lease updates

---

## Testing Checklist

- [ ] Update lease: change start date, rent, cadence
- [ ] Verify old invoices (before new start date) remain in database
- [ ] Verify future unpaid invoices (on/after new start date) are deleted
- [ ] Verify new invoices are created with correct amounts, cadence, due dates
- [ ] Verify "Total Owed" shows correct amount based on new invoices
- [ ] Verify invoice modal shows all invoices (historical + new)
- [ ] Verify no duplicate invoices for same due dates
- [ ] Test with multiple lease updates
- [ ] Test with weekly -> monthly conversion
- [ ] Test with monthly -> weekly conversion
- [ ] Test with future start date (no invoices to delete)
- [ ] Test with past start date (delete from old start date)
- [ ] Verify paid invoices are preserved (not deleted)

---

## Benefits

1. ✅ **Preserves History**: Old invoices (before new start date) remain in database
2. ✅ **Clean Database**: Future invoices match current lease terms exactly
3. ✅ **Accurate Totals**: "Total Owed" reflects correct amounts based on new lease terms
4. ✅ **Automatic Regeneration**: New invoices created automatically when lease is updated
5. ✅ **No Manual Cleanup**: System handles invoice deletion and regeneration automatically
6. ✅ **No Duplicates**: Only creates invoices that don't already exist

---

## Potential Considerations

1. **What about paid invoices?**
   - Only delete unpaid invoices (status = 'OPEN')
   - Preserve paid invoices for history and accounting
   - This prevents data loss for completed transactions

2. **What if lease is updated multiple times?**
   - Each update deletes future unpaid invoices and regenerates
   - Only the latest lease terms are reflected in invoices
   - Previous invoice generations are replaced

3. **What about partial payments?**
   - Invoices with partial payments (status = 'PARTIAL') should probably be preserved
   - May need to check `balance_due > 0` instead of just `status = 'OPEN'`
   - Or preserve all invoices with `amount_paid > 0`

4. **What if user wants to keep a specific future invoice?**
   - Current approach deletes all future unpaid invoices
   - Could add a flag to preserve specific invoices, but adds complexity
   - For now, user can manually recreate if needed

5. **Invoice generation for weekly/biweekly cadence?**
   - Currently only supports monthly
   - Can extend `generateInvoicesForLease()` to support weekly/biweekly later
   - For now, weekly/biweekly leases won't auto-generate invoices on update

---

## Approval Required

Please review this proposal and approve before implementation.
