/**
 * Shared invoice calculation logic used by Payments page and Late Tenants API
 * 
 * This ensures both pages always calculate unpaid invoices identically.
 * DO NOT MODIFY THIS FILE without updating both consumers.
 *
 * Future-dated payments count toward invoice paid amounts when posted to an invoice.
 */

export interface Invoice {
  id: string
  lease_id: string
  due_date: string
  status: string
  balance_due: number | string
  amount_total: number | string
  amount_paid?: number | string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export interface Payment {
  id: string
  invoice_id: string | null
  amount: number | string
  payment_date: string
  lease_id: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
 * 1. Filter invoices by due_date >= leaseStartDate AND due_date <= today
 * 2. Group payments by invoice_id
 * 3. Recalculate balance_due = amount_total - actualPaid
 * 4. Filter unpaid: status === 'OPEN' && balance_due > 0
 * 5. Calculate total: sum of balance_due for unpaid invoices
 * 
 * @param invoices - All invoices for the lease (will be filtered by date here)
 * @param payments - All payments for the lease
 * @param leaseStartDate - Lease start date to filter invoices
 * @param actualToday - Current date in YYYY-MM-DD format (from new Date().toISOString().split('T')[0])
 * @returns Unpaid invoices, total owed, and count
 */
export function calculateUnpaidInvoices(
  invoices: Invoice[],
  payments: Payment[],
  leaseStartDate?: string | null,
  actualToday?: string
): UnpaidInvoiceResult {
  // Step 1: Filter invoices by due_date >= leaseStartDate AND due_date <= today
  // Payments page line 444: /api/invoices?leaseId=${leaseData.id}&to=${today} (filters due_date <= today)
  // Payments page line 451-453: invoice.due_date >= leaseStartDate
  const validInvoices = invoices.filter((invoice: Invoice) => {
    // Normalize due_date to YYYY-MM-DD format for comparison
    const invoiceDueDate = String(invoice.due_date || '').split('T')[0]
    
    // CRITICAL: Filter out future invoices (due_date > today)
    // This matches Payments page which calls /api/invoices?to=${today}
    if (actualToday && invoiceDueDate > actualToday) {
      return false // Exclude future invoices
    }
    
    // Filter by due_date >= leaseStartDate (Payments page line 451-453)
    if (leaseStartDate && invoiceDueDate < leaseStartDate) {
      return false
    }
    
    return true
  })

  // Step 2: Group posted payments by invoice_id (includes future-dated entries).
  const postedPayments = payments.filter((payment: Payment) => {
    if (!payment.invoice_id) return false
    const amt = parseFloat(String(payment.amount)) || 0
    if (amt <= 0) return false
    const status = String(payment.status || 'completed').toLowerCase()
    return status === 'completed'
  })

  const paymentsByInvoice = new Map<string, Payment[]>()
  postedPayments.forEach((payment: Payment) => {
    if (!paymentsByInvoice.has(payment.invoice_id!)) {
      paymentsByInvoice.set(payment.invoice_id!, [])
    }
    paymentsByInvoice.get(payment.invoice_id!)!.push(payment)
  })

  // Step 3: Recalculate balance_due using actual payment totals (Payments page lines 552-567)
  const invoicesWithRecalculatedBalance = validInvoices.map((invoice: Invoice) => {
    // Get actual payments linked to this invoice (Payments page line 554)
    const linkedPayments = paymentsByInvoice.get(invoice.id) || []
    // Calculate actual paid amount (Payments page lines 555-557)
    const actualPaid = linkedPayments.reduce((sum: number, payment: Payment) => 
      sum + (parseFloat(String(payment.amount ?? 0)) || 0), 0
    )
    
    // Recalculate balance_due (Payments page lines 560-561)
    const amountTotal = parseFloat(String(invoice.amount_total ?? 0)) || 0
    const recalculatedBalanceDue = amountTotal - actualPaid
    
    return {
      ...invoice,
      balance_due: recalculatedBalanceDue // Use recalculated balance (Payments page line 565)
    }
  })

  // Step 4: Filter unpaid invoices (Payments page lines 571-573)
  // CRITICAL: Also filter out future invoices here as a safety check
  const unpaidInvoices = invoicesWithRecalculatedBalance.filter((inv: Invoice) => {
    // Normalize due_date for comparison
    const invDueDate = String(inv.due_date || '').split('T')[0]
    const isFuture = actualToday && invDueDate > actualToday
    
    // Only count invoices with status='OPEN' and balance_due > 0 and due_date <= today
    return !isFuture && inv.status === 'OPEN' && (parseFloat(String(inv.balance_due ?? 0)) || 0) > 0
  })

  // Step 5: Calculate total owed (Payments page lines 576-578)
  const totalOwed = unpaidInvoices.reduce((sum: number, inv: Invoice) => 
    sum + (parseFloat(String(inv.balance_due ?? 0)) || 0), 0
  )

  return {
    unpaidInvoices,
    totalOwed,
    unpaidCount: unpaidInvoices.length
  }
}
