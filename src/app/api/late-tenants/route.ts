import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

// Cache this route for 30 seconds to improve performance
export const revalidate = 30

/**
 * Late Tenants API
 * 
 * Identifies leases with overdue invoices using the new invoice system.
 * Consistent with the payment grid data and invoice-based approach.
 * OPTIMIZED: Uses batch queries instead of N+1 pattern.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const todayParam = searchParams.get('today')
    const today = todayParam || new Date().toISOString().split('T')[0]
    const todayDate = new Date(today)
    
    console.log('Fetching late tenants for date:', today)
    
    // Fetch active leases with property and tenant data
    const { data: leases, error: leasesError } = await supabaseServer
      .from('RENT_leases')
      .select(`
        *,
        RENT_properties(*),
        RENT_tenants(*)
      `)
      .eq('status', 'active')

    if (leasesError) {
      throw new Error(`Error fetching leases: ${leasesError.message}`)
    }

    console.log('Found active leases:', leases?.length || 0)

    if (!leases || leases.length === 0) {
      return NextResponse.json({
        summary: {
          lateLeases: 0,
          totalLateOwed: 0,
          totalAllOwed: 0,
          thirtyPlusLate: 0,
          avgDaysLate: 0
        },
        rows: []
      })
    }

    // OPTIMIZED: Batch fetch all invoices for all active leases in a single query
    const leaseIds = leases.map(lease => lease.id)
    const leaseStartDates = new Map(leases.map(lease => [lease.id, lease.lease_start_date]))
    
    const { data: allInvoices, error: invoicesError } = await supabaseServer
      .from('RENT_invoices')
      .select('*')
      .in('lease_id', leaseIds)
      .lte('due_date', today)
      .order('due_date', { ascending: false })

    if (invoicesError) {
      console.error('Error fetching invoices:', invoicesError)
      throw new Error(`Error fetching invoices: ${invoicesError.message}`)
    }

    // OPTIMIZED: Batch fetch all payments for all active leases in a single query
    const { data: allPayments, error: paymentsError } = await supabaseServer
      .from('RENT_payments')
      .select('*')
      .in('lease_id', leaseIds)
      .order('payment_date', { ascending: true })

    if (paymentsError) {
      console.error('Error fetching payments:', paymentsError)
      // Don't throw - payments are optional for display
    }

    // Group invoices and payments by lease_id for efficient lookup
    const invoicesByLease = new Map<string, any[]>()
    const paymentsByLease = new Map<string, any[]>()
    
    allInvoices?.forEach(invoice => {
      const leaseId = invoice.lease_id
      if (!invoicesByLease.has(leaseId)) {
        invoicesByLease.set(leaseId, [])
      }
      invoicesByLease.get(leaseId)!.push(invoice)
    })

    allPayments?.forEach(payment => {
      const leaseId = payment.lease_id
      if (!paymentsByLease.has(leaseId)) {
        paymentsByLease.set(leaseId, [])
      }
      paymentsByLease.get(leaseId)!.push(payment)
    })

    // Process each lease to identify late tenants using the same logic as payments page
    const lateTenantsRows: any[] = []
    let totalAllOwed = 0 // Track all unpaid invoices (like dashboard)

    for (const lease of leases) {
      // Get invoices for this lease (already filtered by date range)
      const invoices = invoicesByLease.get(lease.id) || []
      
      // Filter invoices within lease start date range
      const leaseStartDate = leaseStartDates.get(lease.id)
      const validInvoices = invoices.filter(invoice => 
        !leaseStartDate || invoice.due_date >= leaseStartDate
      )

      // Find all unpaid invoices (like dashboard) - status = 'OPEN' AND balance_due > 0
      const allUnpaidInvoices = validInvoices.filter(invoice => 
        invoice.status === 'OPEN' && parseFloat(invoice.balance_due || 0) > 0
      )

      // Find late invoices (due before today and not fully paid) - same logic as payments page
      const lateInvoices = validInvoices.filter(invoice => {
        const dueDate = new Date(invoice.due_date)
        const isPastDue = dueDate < todayDate
        const hasBalance = parseFloat(invoice.balance_due || 0) > 0
        return isPastDue && hasBalance
      })

      // Add to total all owed (like dashboard)
      totalAllOwed += allUnpaidInvoices.reduce((sum, invoice) => 
        sum + parseFloat(invoice.balance_due || 0), 0
      )

      if (lateInvoices.length === 0) {
        continue // Skip if no late invoices
      }

      // Calculate days late for the oldest late invoice
      const oldestLateInvoice = lateInvoices.reduce((oldest, current) => {
        const oldestDate = new Date(oldest.due_date)
        const currentDate = new Date(current.due_date)
        return currentDate < oldestDate ? current : oldest
      })
      
      const daysLate = Math.floor((todayDate.getTime() - new Date(oldestLateInvoice.due_date).getTime()) / (1000 * 60 * 60 * 24))
      
      // Calculate totals using the same logic as payments page
      const totalLateAmount = lateInvoices.reduce((sum, invoice) => 
        sum + parseFloat(invoice.balance_due || 0), 0
      )
      const totalLateFees = lateInvoices.reduce((sum, invoice) => 
        sum + parseFloat(invoice.amount_late || 0), 0
      )
      const totalLatePeriods = lateInvoices.length

      // Get payments for this lease (already fetched in batch)
      const payments = paymentsByLease.get(lease.id) || []

      // Create late tenant row
      const lateTenantRow = {
        leaseId: lease.id,
        property: lease.RENT_properties,
        tenant: lease.RENT_tenants,
        lease: {
          id: lease.id,
          rent: lease.rent,
          rent_cadence: lease.rent_cadence,
          lease_start_date: lease.lease_start_date,
          lease_end_date: lease.lease_end_date,
          rent_due_day: lease.rent_due_day,
          grace_days: lease.grace_days,
          late_fee_amount: lease.late_fee_amount
        },
        daysLate,
        totalOwedLate: totalLateAmount,
        totalLateFees,
        totalLatePeriods,
        lateInvoices: lateInvoices.map(invoice => ({
          id: invoice.id,
          due_date: invoice.due_date,
          period_start: invoice.period_start,
          period_end: invoice.period_end,
          amount_total: parseFloat(invoice.amount_total || 0),
          amount_paid: parseFloat(invoice.amount_paid || 0),
          balance_due: parseFloat(invoice.balance_due || 0),
          amount_late: parseFloat(invoice.amount_late || 0),
          status: invoice.status,
          days_late: Math.floor((todayDate.getTime() - new Date(invoice.due_date).getTime()) / (1000 * 60 * 60 * 24))
        })),
        lastPaymentDate: payments && payments.length > 0 ? 
          payments[payments.length - 1].payment_date : null,
        totalPayments: payments.length,
        totalPaid: payments.reduce((sum, payment) => sum + parseFloat(payment.amount || 0), 0)
      }
      
      lateTenantsRows.push(lateTenantRow)
    }

    // Calculate summary metrics
    const summary = {
      lateLeases: lateTenantsRows.length,
      totalLateOwed: lateTenantsRows.reduce((sum, row) => sum + row.totalOwedLate, 0),
      totalAllOwed: totalAllOwed, // All unpaid invoices (like dashboard)
      thirtyPlusLate: lateTenantsRows.filter(row => row.daysLate >= 30).length,
      avgDaysLate: lateTenantsRows.length > 0 ? 
        Math.round(lateTenantsRows.reduce((sum, row) => sum + row.daysLate, 0) / lateTenantsRows.length) : 0
    }

    // Sort by total owed (highest first)
    lateTenantsRows.sort((a, b) => b.totalOwedLate - a.totalOwedLate)

    console.log('Late tenants summary:', summary)
    console.log('Late tenants rows:', lateTenantsRows.length)

    return NextResponse.json({
      summary,
      rows: lateTenantsRows
    })
  } catch (error) {
    console.error('Error in late tenants API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch late tenants', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
