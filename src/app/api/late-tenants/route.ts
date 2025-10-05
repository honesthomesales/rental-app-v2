import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * Late Tenants API
 * 
 * Identifies leases with overdue invoices using the new invoice system.
 * Consistent with the payment grid data and invoice-based approach.
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

    // Process each lease to identify late tenants using the same logic as payments page
    const lateTenantsRows: any[] = []
    let totalAllOwed = 0 // Track all unpaid invoices (like dashboard)

    for (const lease of leases || []) {
      // Fetch invoices for this lease from lease start to current date
      const { data: invoices, error: invoicesError } = await supabaseServer
        .from('RENT_invoices')
        .select('*')
        .eq('lease_id', lease.id)
        .gte('due_date', lease.lease_start_date)
        .lte('due_date', today)
        .order('due_date', { ascending: false })

      if (invoicesError) {
        console.error(`Error fetching invoices for lease ${lease.id}:`, invoicesError)
        continue
      }

      // Find all unpaid invoices (like dashboard) - status = 'OPEN' AND balance_due > 0
      const allUnpaidInvoices = invoices?.filter(invoice => 
        invoice.status === 'OPEN' && parseFloat(invoice.balance_due || 0) > 0
      ) || []

      // Find late invoices (due before today and not fully paid) - same logic as payments page
      const lateInvoices = invoices?.filter(invoice => {
        const dueDate = new Date(invoice.due_date)
        const isPastDue = dueDate < todayDate
        const hasBalance = parseFloat(invoice.balance_due || 0) > 0
        return isPastDue && hasBalance
      }) || []

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

      // Fetch payments for this lease for display purposes
      const { data: payments } = await supabaseServer
        .from('RENT_payments')
        .select('*')
        .eq('lease_id', lease.id)
        .order('payment_date', { ascending: true })

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
        totalPayments: payments?.length || 0,
        totalPaid: payments?.reduce((sum, payment) => sum + parseFloat(payment.amount || 0), 0) || 0
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
