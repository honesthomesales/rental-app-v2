# Fix Payment Inconsistency - Complete Plan

## Problem Identified

1. **Invoice shows `amount_paid = 600` but NO payment records exist**
2. **`handleSubmitPayment` updates invoice directly WITHOUT creating payment records**
3. **Display logic falls back to `invoice.amount_paid` when no payments found**
4. **`updateInvoiceBalance` doesn't properly recalculate `balance_due`**

## Root Cause

The `handleSubmitPayment` function (line 735-784) updates the invoice table directly instead of:
1. Creating a payment record in `RENT_payments` table
2. Then updating invoice from payment records

This creates data inconsistency where `invoice.amount_paid` doesn't match actual payment records.

## Solution Plan

### Step 1: Fix Database (SQL Query)
- Run `fix-invoice-payment-inconsistency.sql`
- Sets `amount_paid = 0` for invoices with no payment records
- Recalculates `balance_due` correctly

### Step 2: Fix Payment Creation (`handleSubmitPayment`)
**Current (WRONG):**
- Updates invoice directly via `/api/invoices` PUT
- No payment record created

**Fixed (CORRECT):**
- Create payment record via `/api/payments` POST
- Payment record includes `invoice_id`
- Then recalculate invoice from payment records

### Step 3: Fix Display Logic
**Current (WRONG):**
- Falls back to `invoice.amount_paid` if no payments found (line 252, 256, 261)

**Fixed (CORRECT):**
- ALWAYS use payment records total
- If no payments found, show $0.00 (not invoice.amount_paid)
- This ensures display matches actual payment records

### Step 4: Fix Invoice Balance Update (`updateInvoiceBalance`)
**Current:**
- Calculates `totalPaid` correctly from payments
- But sets `balance_due: totalPaid` (WRONG - should be `amount_total - totalPaid`)

**Fixed:**
- Calculate `totalPaid` from payments
- Calculate `balance_due = amount_total - totalPaid`
- Update invoice with correct values

### Step 5: Ensure Delete Payment Updates Invoice
**Current:**
- Deletes payment
- Calls `updateInvoiceBalance` which recalculates correctly
- ✅ This is already correct

## Files to Change

1. `fix-invoice-payment-inconsistency.sql` - SQL query to fix bad data ✅ CREATED
2. `src/app/payments/page.tsx` - Fix `handleSubmitPayment` function
3. `src/app/payments/page.tsx` - Fix display logic (remove fallback to invoice.amount_paid)
4. `src/app/payments/page.tsx` - Fix `updateInvoiceBalance` function

## Testing Checklist

After fixes:
- [ ] Add payment creates payment record AND updates invoice
- [ ] Delete payment removes record AND updates invoice
- [ ] Edit payment updates record AND updates invoice
- [ ] Display always shows payment records total (never invoice.amount_paid)
- [ ] No invoices show amount_paid > 0 without payment records




