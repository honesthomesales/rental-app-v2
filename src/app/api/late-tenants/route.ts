import { NextResponse } from 'next/server'
import {
  buildLateTenantRowTotals,
  buildLateTenantsSummary,
} from '@/lib/late-tenants-summary'
import { isAuthError, requireApiAuth } from '@/lib/auth/api-auth'
import { getBusinessDate, resolveBusinessDate } from '@/lib/business-date'
import { buildAccountLedger } from '@/lib/portfolio-ledger/service'
import {
  loadBillingLeases,
  loadInvoicesForLeases,
  loadPaymentsForLeases,
} from '@/lib/portfolio-ledger/repository'

export const revalidate = 0

const API_VERSION = 'v6.0-portfolio-ledger'

/**
 * Late Tenants API — read-only.
 * Totals derive from portfolio-ledger (same baseline as Payments).
 * Future-dated completed payments are excluded from balances.
 */
export async function GET(request: Request) {
  const auth = await requireApiAuth(request)
  if (isAuthError(auth)) return auth

  try {
    const { searchParams } = new URL(request.url)
    const todayParam = searchParams.get('today')
    const serverToday = getBusinessDate()

    let today = serverToday
    if (todayParam) {
      const resolved = resolveBusinessDate(todayParam)
      const clientDate = new Date(resolved)
      const serverDate = new Date(serverToday)
      const diffDays = Math.abs(
        (clientDate.getTime() - serverDate.getTime()) / (1000 * 60 * 60 * 24),
      )
      if (diffDays <= 1) {
        today = resolved
      }
    }

    const leases = await loadBillingLeases()
    const leaseIds = leases.map((l) => l.id)
    const [invoicesByLease, paymentsByLease] = await Promise.all([
      loadInvoicesForLeases(leaseIds),
      loadPaymentsForLeases(leaseIds),
    ])

    const lateTenantsRows: Array<Record<string, unknown>> = []

    for (const lease of leases) {
      const account = buildAccountLedger({
        lease,
        invoices: invoicesByLease.get(lease.id) || [],
        payments: paymentsByLease.get(lease.id) || [],
        asOfDate: today,
      })

      if (
        account.collectionStatus !== 'past_due' ||
        account.unpaidInvoiceCount === 0 ||
        account.totalBalanceDue <= 0
      ) {
        continue
      }

      const unpaidInvoices = account.invoices.filter(
        (inv) =>
          !inv.isFuture &&
          inv.calculatedBalance > 0 &&
          inv.collectionStatus === 'past_due' &&
          ['OPEN', 'PARTIAL'].includes(inv.storedStatus),
      )

      if (unpaidInvoices.length === 0 || account.pastDueBalanceDue <= 0) {
        continue
      }

      const rowTotals = buildLateTenantRowTotals(
        account.totalBalanceDue,
        account.pastDueBalanceDue,
      )
      const daysLate = account.daysLate ?? 0

      const lastPay = account.payments
        .filter((p) => p.eligible && p.amount > 0)
        .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate))[0]

      lateTenantsRows.push({
        leaseId: lease.id,
        property: lease.property || {},
        tenant: lease.tenant || {},
        lease: {
          id: lease.id,
          rent: lease.rent,
          rent_cadence: lease.rent_cadence,
          lease_start_date: lease.lease_start_date,
          lease_end_date: lease.lease_end_date,
        },
        ...rowTotals,
        unpaidCount: account.pastDueInvoiceCount,
        unpaidInvoiceCount: account.pastDueInvoiceCount,
        unpaidInvoiceIds: unpaidInvoices.map((inv) => inv.invoiceId),
        daysLate,
        mostRecentPayment: lastPay
          ? {
              date: lastPay.paymentDate,
              amount: lastPay.amount,
              method: lastPay.paymentMethod || '',
            }
          : null,
        lateInvoices: unpaidInvoices.map((inv) => {
          const due = String(inv.dueDate).split('T')[0]
          const ms =
            Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)
          const invoiceDaysLate = Math.max(0, Math.round(ms / 86_400_000))
          return {
            id: inv.invoiceId,
            due_date: inv.dueDate,
            period_start: inv.periodStart,
            period_end: inv.periodEnd,
            amount_total: inv.calculatedTotal,
            amount_paid: inv.eligiblePaidAmount,
            amount_late: inv.storedLateFee,
            late_fee_waived: inv.lateFeeWaived,
            balance_due: inv.calculatedBalance,
            days_late: invoiceDaysLate,
            status: inv.storedStatus,
          }
        }),
        ledgerVersion: account.ledgerVersion,
      })
    }

    lateTenantsRows.sort(
      (a, b) => Number(b.daysLate || 0) - Number(a.daysLate || 0),
    )

    const summary = buildLateTenantsSummary(lateTenantsRows)

    return NextResponse.json({
      version: API_VERSION,
      ledgerVersion: lateTenantsRows[0]
        ? (lateTenantsRows[0] as { ledgerVersion?: string }).ledgerVersion
        : undefined,
      rows: lateTenantsRows,
      total: lateTenantsRows.length,
      totalAllOwed: summary.totalAllOwed,
      summary,
      writePerformed: false,
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
