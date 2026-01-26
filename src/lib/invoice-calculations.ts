/**
 * Shared invoice calculation logic used by Payments page and Late Tenants API
 * 
 * This ensures both pages always calculate unpaid invoices identically.
 * DO NOT MODIFY THIS FILE without updating both consumers.
 */

export interface Invoice {
  id: string
  lease_id: string
  due_date: string
  status: string
  balance_due: number | string
  amount_total: number | string
  amount_paid?: number | string
  [key: string]: any
}

export interface Payment {
  id: string
  invoice_id: string | null
  amount: number | string
  payment_date: string
  lease_id: string
  [key: string]: any
}

export interface UnpaidInvoiceResult {
  unpaidInvoices: Invoice[]
  totalOwed: number
  unpaidCount: number
}

/**
 * Calculates unpaid invoices using the EXACT same logic as Payments page
 * 
 * Steps (matching Payments page lines 442-580):
 * 1. Filter invoices by due_date >= leaseStartDate
 * 2. Group payments by invoice_id
 * 3. Recalculate balance_due = amount_total - actualPaid
 * 4. Filter unpaid: status === 'OPEN' && balance_due > 0
 * 5. Calculate total: sum of balance_due for unpaid invoices
 * 
 * @param invoices - Invoices already filtered by due_date <= today (from /api/invoices?to=${today})
 * @param payments - All payments for the lease
 * @param leaseStartDate - Lease start date to filter invoices
 * @returns Unpaid invoices, total owed, and count
 */
export function calculateUnpaidInvoices(
  invoices: Invoice[],
  payments: Payment[],
  leaseStartDate?: string | null
): UnpaidInvoiceResult {
  // Step 1: Filter invoices by due_date >= leaseStartDate (Payments page line 451-453)
  const validInvoices = invoices.filter((invoice: Invoice) => 
    !leaseStartDate || invoice.due_date >= leaseStartDate
  )

  // Step 2: Group payments by invoice_id (Payments page lines 541-549)
  const paymentsByInvoice = new Map<string, Payment[]>()
  payments.forEach((payment: Payment) => {
    if (payment.invoice_id) {
      if (!paymentsByInvoice.has(payment.invoice_id)) {
        paymentsByInvoice.set(payment.invoice_id, [])
      }
      paymentsByInvoice.get(payment.invoice_id)!.push(payment)
    }
  })

  // Step 3: Recalculate balance_due using actual payment totals (Payments page lines 552-567)
  const invoicesWithRecalculatedBalance = validInvoices.map((invoice: Invoice) => {
    // Get actual payments linked to this invoice (Payments page line 554)
    const linkedPayments = paymentsByInvoice.get(invoice.id) || []
    // Calculate actual paid amount (Payments page lines 555-557)
    const actualPaid = linkedPayments.reduce((sum: number, payment: Payment) => 
      sum + parseFloat(payment.amount as any || 0), 0
    )
    
    // Recalculate balance_due (Payments page lines 560-561)
    const amountTotal = parseFloat(invoice.amount_total as any || 0)
    const recalculatedBalanceDue = amountTotal - actualPaid
    
    return {
      ...invoice,
      balance_due: recalculatedBalanceDue // Use recalculated balance (Payments page line 565)
    }
  })

  // Step 4: Filter unpaid invoices (Payments page lines 571-573)
  const unpaidInvoices = invoicesWithRecalculatedBalance.filter((inv: Invoice) => 
    inv.status === 'OPEN' && parseFloat(inv.balance_due as any || 0) > 0
  )

  // Step 5: Calculate total owed (Payments page lines 576-578)
  const totalOwed = unpaidInvoices.reduce((sum: number, inv: Invoice) => 
    sum + parseFloat(inv.balance_due as any || 0), 0
  )

  return {
    unpaidInvoices,
    totalOwed,
    unpaidCount: unpaidInvoices.length
  }
}
