import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { calculateUnpaidInvoices, type Invoice, type Payment } from '@/lib/invoice-calculations'
import {
  buildLateTenantRowTotals,
  buildLateTenantsSummary,
} from '@/lib/late-tenants-summary'

export const revalidate = 0

const API_VERSION = 'v5.4-row-total-and-summary-fix'

/**
 * Late Tenants API — read-only.
 * Row totals are per-account. Portfolio totals live only in `summary`.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const todayParam = searchParams.get('today')
    const serverToday = new Date().toISOString().split('T')[0]

    let today = serverToday
    if (todayParam) {
      const clientDate = new Date(todayParam)
      const serverDate = new Date(serverToday)
      const diffDays = Math.abs(
        (clientDate.getTime() - serverDate.getTime()) / (1000 * 60 * 60 * 24),
      )
      if (diffDays <= 1) {
        today = todayParam
      }
    }

    const { data: leases, error: leasesError } = await supabaseServer
      .from('RENT_leases')
      .select(`
        *,
        RENT_properties(*),
        RENT_tenants(*)
      `)
      .in('status', ['occupied'])

    if (leasesError) {
      throw new Error(`Error fetching leases: ${leasesError.message}`)
    }

    const activePropertyLeases = leases || []
    const lateTenantsRows: Array<Record<string, unknown>> = []

    for (const lease of activePropertyLeases) {
      const leaseId = lease.id
      const leaseStartDate = lease.lease_start_date

      try {
        const { data: invoicesData, error: invoicesError } = await supabaseServer
          .from('RENT_invoices')
          .select('*')
          .eq('lease_id', leaseId)
          .lte('due_date', today)
          .order('due_date', { ascending: false })

        if (invoicesError) {
          console.error('Error fetching invoices for late-tenants lease')
          continue
        }

        const invoices = Array.isArray(invoicesData) ? invoicesData : []
        const validInvoices = invoices.filter(
          (invoice: Invoice) =>
            !leaseStartDate || invoice.due_date >= leaseStartDate,
        )

        const { data: paymentsData, error: paymentsError } = await supabaseServer
          .from('RENT_payments')
          .select('*')
          .eq('lease_id', leaseId)
          .order('payment_date', { ascending: false })

        if (paymentsError) {
          console.error('Error fetching payments for late-tenants lease')
        }

        const payments = Array.isArray(paymentsData) ? paymentsData : []

        const { unpaidInvoices, totalOwed, unpaidCount } = calculateUnpaidInvoices(
          validInvoices as Invoice[],
          payments as Payment[],
          leaseStartDate || undefined,
          today,
        )

        if (unpaidCount === 0 || totalOwed === 0) {
          continue
        }

        const rowTotals = buildLateTenantRowTotals(totalOwed)

        let daysLate = 0
        if (unpaidInvoices.length > 0) {
          const oldestUnpaid = unpaidInvoices.reduce((oldest, inv) => {
            const invDate = new Date(inv.due_date)
            const oldestDate = new Date(oldest.due_date)
            return invDate < oldestDate ? inv : oldest
          })

          const dueDate = new Date(oldestUnpaid.due_date)
          const todayDate = new Date(today + 'T12:00:00')
          const diffTime = todayDate.getTime() - dueDate.getTime()
          daysLate = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)))
        }

        lateTenantsRows.push({
          leaseId: lease.id,
          property: lease.RENT_properties || {},
          tenant: lease.RENT_tenants || {},
          lease: {
            id: lease.id,
            rent: lease.rent,
            rent_cadence: lease.rent_cadence,
            lease_start_date: lease.lease_start_date,
            lease_end_date: lease.lease_end_date,
          },
          ...rowTotals,
          unpaidCount,
          unpaidInvoiceCount: unpaidCount,
          unpaidInvoiceIds: unpaidInvoices.map((inv) => inv.id),
          daysLate,
          lateInvoices: unpaidInvoices.map((inv) => ({
            id: inv.id,
            due_date: inv.due_date,
            amount_total: inv.amount_total,
            balance_due: inv.balance_due,
            status: inv.status,
          })),
        })
      } catch {
        console.error('Error processing lease for late-tenants')
      }
    }

    lateTenantsRows.sort(
      (a, b) => Number(b.daysLate || 0) - Number(a.daysLate || 0),
    )

    const summary = buildLateTenantsSummary(lateTenantsRows)

    return NextResponse.json({
      version: API_VERSION,
      rows: lateTenantsRows,
      total: lateTenantsRows.length,
      totalAllOwed: summary.totalAllOwed,
      summary,
    })
  } catch (error) {
    console.error('Error in late-tenants API')
    return NextResponse.json(
      {
        error: 'Failed to fetch late tenants',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}
