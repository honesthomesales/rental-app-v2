import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { isAuthError, requireApiAuth } from '@/lib/auth/api-auth'
import { getBusinessDate } from '@/lib/business-date'
import { partitionPaymentsByAsOf } from '@/lib/payment-eligibility'
import {
  isPhysicallyOccupied,
  countsTowardCurrentIncome,
  countsTowardEvictionPotential,
  selectNewestLeaseByProperty,
} from '@/lib/lease-status'
import {
  buildEmptyPotentialSummary,
  sumPotentialIncomeRows,
} from '@/lib/dashboard-potential'
import { monthlyEquivalentRent } from '@/lib/monthly-equivalent'
import {
  isMiscIncome,
  isOneTimeExpense,
  isRecurringExpense,
} from '@/lib/expenses/classification'

// Cache this route for 5 seconds to balance performance and freshness
export const revalidate = 5

/** Dashboard totals align with Insurance / Property Tax tables: only these types (excludes loan, other, unset). */
const OVERVIEW_RESIDENTIAL_TYPES = ['house', 'doublewide', 'singlewide'] as const

function isOverviewResidentialType(propertyType: string | null | undefined): boolean {
  return (
    propertyType != null &&
    (OVERVIEW_RESIDENTIAL_TYPES as readonly string[]).includes(propertyType)
  )
}

export async function GET(request: Request) {
  const auth = await requireApiAuth(request)
  if (isAuthError(auth)) return auth

  try {
    // Fetch all properties (excluding retired)
    const { data: allProperties, error: propertiesError } = await supabaseServer
      .from('RENT_properties')
      .select('*')
      .neq('status', 'retired')

    if (propertiesError) {
      throw new Error(`Error fetching properties: ${propertiesError.message}`)
    }

    // Fetch ALL leases (for sold-exclusion, occupancy sets, and eviction potential)
    const { data: allLeases, error: allLeasesError } = await supabaseServer
      .from('RENT_leases')
      .select('id, property_id, status, rent, rent_cadence, created_at, lease_start_date, lease_end_date, tenant_id')

    if (allLeasesError) {
      throw new Error(`Error fetching all leases: ${allLeasesError.message}`)
    }

    // Fetch tenant names for eviction leases
    const evictionLeaseIds = (allLeases || [])
      .filter(l => l.status === 'eviction' && l.tenant_id)
      .map(l => l.tenant_id)

    const tenantNames = new Map<string, string>()
    if (evictionLeaseIds.length > 0) {
      const { data: tenants } = await supabaseServer
        .from('RENT_tenants')
        .select('id, full_name, first_name, last_name')
        .in('id', evictionLeaseIds)

      tenants?.forEach(t => {
        const name = t.full_name || `${t.first_name || ''} ${t.last_name || ''}`.trim() || ''
        tenantNames.set(t.id, name)
      })
    }

    // Match Properties: one deterministic newest lease classifies each property.
    const newestLeaseByProperty = selectNewestLeaseByProperty(allLeases || [])
    const soldPropertyIds = new Set<string>()

    newestLeaseByProperty.forEach((lease, propertyId) => {
      if (lease.status === 'sold') soldPropertyIds.add(propertyId)
    })

    // Valid residential properties (not sold, residential type)
    const validProperties =
      allProperties?.filter(
        property =>
          String(property.status || '').toLowerCase() !== 'sold' &&
          !soldPropertyIds.has(property.id) &&
          isOverviewResidentialType(property.property_type)
      ) || []

    const today = getBusinessDate()

    // Billing-active leases: occupied + eviction (for late payments / total owed)
    const billingActiveLeases = (allLeases || []).filter(l => isPhysicallyOccupied(l.status))

    // Current monthly income — occupied leases only
    let currentMonthlyIncome = 0
    ;(allLeases || []).filter(l => countsTowardCurrentIncome(l.status)).forEach(lease => {
      currentMonthlyIncome += monthlyEquivalentRent(lease.rent, lease.rent_cadence)
    })

    // Eviction potential income — eviction leases only
    let evictionPotentialIncome = 0
    const evictionLeases = (allLeases || []).filter(l => countsTowardEvictionPotential(l.status))
    evictionLeases.forEach(lease => {
      evictionPotentialIncome += monthlyEquivalentRent(lease.rent, lease.rent_cadence)
    })

    // Empty potential income — eligible empty residential properties
    const {
      rows: emptyPotentialRows,
      count: emptyPotentialCount,
      total: emptyPotentialIncome,
    } = buildEmptyPotentialSummary(validProperties, allLeases || [])

    // Eviction rows for potentialIncomeRows
    const evictionRows = evictionLeases.map(lease => {
      const property = allProperties?.find(p => p.id === lease.property_id)
      const tenantName = lease.tenant_id ? (tenantNames.get(lease.tenant_id) || '') : ''
      const monthly = monthlyEquivalentRent(lease.rent, lease.rent_cadence)
      return {
        leaseId: lease.id,
        propertyId: lease.property_id || '',
        propertyName: property?.name || '',
        address: property?.address || '',
        tenantName,
        status: 'eviction' as const,
        cadence: lease.rent_cadence || 'monthly',
        rent: Number(lease.rent || 0),
        monthlyPotential: monthly,
      }
    })

    // Potential Income card/list/modal: empty property rent + eviction potential.
    // Derive the displayed total from the exact API rows so they cannot drift.
    const potentialIncomeRows = [...emptyPotentialRows, ...evictionRows]
    const potentialIncome = sumPotentialIncomeRows(potentialIncomeRows)
    const totalPotentialIncome = currentMonthlyIncome + potentialIncome

    // Properties with Tenants count = newest lease status is exactly occupied
    // (eviction stays in Potential Income; do not change isPhysicallyOccupied elsewhere)
    let occupiedProperties = 0
    newestLeaseByProperty.forEach((lease) => {
      if (countsTowardCurrentIncome(lease.status)) occupiedProperties += 1
    })

    // Late payments and total owed — portfolio ledger (Payments baseline)
    let latePayments = 0
    let totalOwed = 0
    let ledgerVersion: string | undefined

    if (billingActiveLeases.length > 0) {
      const {
        buildCollectionsSummary,
      } = await import('@/lib/portfolio-ledger/service')
      const {
        loadBillingLeases,
        loadInvoicesForLeases,
        loadPaymentsForLeases,
      } = await import('@/lib/portfolio-ledger/repository')

      const leases = await loadBillingLeases()
      const leaseIds = leases.map((l) => l.id)
      const [invoicesByLease, paymentsByLease] = await Promise.all([
        loadInvoicesForLeases(leaseIds),
        loadPaymentsForLeases(leaseIds),
      ])
      const summary = buildCollectionsSummary({
        leases,
        invoicesByLease,
        paymentsByLease,
        asOfDate: today,
      })
      totalOwed = summary.totalOwed
      latePayments = summary.rows.reduce(
        (s, r) =>
          s +
          (r.collectionStatus === 'past_due'
            ? r.pastDueInvoicesCount || 0
            : 0),
        0,
      )
      ledgerVersion = summary.ledgerVersion
    }

    // Property type breakdown
    const propertyTypeBreakdown = { house: 0, doublewide: 0, singlewide: 0, loan: 0 }
    validProperties.forEach(property => {
      const type = property.property_type
      if (type === 'house') propertyTypeBreakdown.house++
      else if (type === 'doublewide') propertyTypeBreakdown.doublewide++
      else if (type === 'singlewide') propertyTypeBreakdown.singlewide++
      else if (type === 'loan') propertyTypeBreakdown.loan++
    })

    // Expenses for debt calculation
    const totalInsurance = validProperties.reduce((sum, p) => sum + (Number(p.insurance_premium) || 0), 0)
    const totalTaxes = validProperties.reduce((sum, p) => sum + (Number(p.property_tax) || 0), 0)

    const { data: expenses, error: expensesError } = await supabaseServer
      .from('RENT_expenses')
      .select('amount, amount_owed, interest_rate, balance, category, last_paid_date')

    if (expensesError) {
      console.error('Error fetching expenses for debt calculation:', expensesError)
    }

    const expenseRows = expenses || []
    const recurringExpenses = expenseRows.filter(isRecurringExpense)

    // Recurring expenses only — Misc Income must not inflate debt.
    const totalPayments = recurringExpenses.reduce(
      (sum, expense) => sum + (Number(expense.amount) || 0),
      0,
    )

    const potentialPayments = recurringExpenses
      .filter((expense) => (Number(expense.balance) || 0) <= 0)
      .reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0)

    const otherExpenses = expenseRows
      .filter(isOneTimeExpense)
      .reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0)

    // Current-month Misc Income credits income (and therefore profit).
    const monthStart = `${today.slice(0, 7)}-01`
    const monthEndDate = new Date(
      Number(today.slice(0, 4)),
      Number(today.slice(5, 7)),
      0,
    )
    const monthEnd = monthEndDate.toISOString().slice(0, 10)
    const currentMonthMiscIncome = expenseRows
      .filter(isMiscIncome)
      .filter((exp) => {
        const d = String(exp.last_paid_date || '')
        return d >= monthStart && d <= monthEnd
      })
      .reduce(
        (sum, exp) => sum + (Number(exp.amount_owed) || Number(exp.amount) || 0),
        0,
      )

    const totalFixedExpenses = totalInsurance + totalTaxes + totalPayments
    const potentialFixedExpenses = totalInsurance + totalTaxes + potentialPayments
    const totalDebt = totalFixedExpenses + otherExpenses
    const potentialDebt = potentialFixedExpenses + otherExpenses

    const incomeWithMisc = currentMonthlyIncome + currentMonthMiscIncome
    const potentialIncomeWithMisc = totalPotentialIncome + currentMonthMiscIncome

    // Profit calculations
    // Current profit: rent income + current-month misc − debt (misc excluded from debt)
    const currentProfit = incomeWithMisc - totalDebt
    // Potential profit: all three income parts + misc
    const potentialProfit = potentialIncomeWithMisc - totalDebt
    const potentialProfitNoHouseDebt = potentialIncomeWithMisc - potentialDebt

    // Portfolio-wide future-dated completed payment exclusion
    const { data: allCompletedPayments } = await supabaseServer
      .from('RENT_payments')
      .select('id, amount, payment_date, status')
      .eq('status', 'completed')

    const futurePartition = partitionPaymentsByAsOf(
      (allCompletedPayments || []) as Array<{
        id: string
        amount: number
        payment_date: string
        status: string
      }>,
      today,
    )

    const metrics = {
      totalProperties: validProperties.length,
      occupiedProperties,
      // Backward-compatible income field names
      monthlyIncome: currentMonthlyIncome,
      potentialIncome,
      totalPotentialIncome,
      // New breakdown fields
      emptyPotentialIncome,
      evictionPotentialIncome,
      emptyPotentialCount,
      evictionPotentialCount: evictionLeases.length,
      potentialIncomeRows,
      latePayments,
      totalOwed,
      ledgerVersion,
      propertyTypeBreakdown,
      totalDebt,
      currentProfit,
      potentialProfit,
      potentialProfitNoHouseDebt,
      /** Current calendar-month Misc Income credited into currentProfit (not in totalDebt). */
      currentMonthMiscIncome: Math.round(currentMonthMiscIncome * 100) / 100,
      businessDate: today,
      futureDatedCompletedPayments: {
        classification: 'future_dated_completed_payment_excluded',
        count: futurePartition.excludedCount,
        total: futurePartition.excludedAmount,
      },
    }

    return NextResponse.json(metrics)
  } catch (error) {
    console.error('Error in dashboard metrics API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch dashboard metrics' },
      { status: 500 },
    )
  }
}
