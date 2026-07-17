import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { isAuthError, requireApiAuth } from '@/lib/auth/api-auth'
import { getBusinessDate } from '@/lib/business-date'
import { partitionPaymentsByAsOf } from '@/lib/payment-eligibility'
import {
  isPhysicallyOccupied,
  countsTowardCurrentIncome,
  countsTowardEvictionPotential,
  isEligibleEmptyPotentialProperty,
} from '@/lib/lease-status'
import { monthlyEquivalentRent } from '@/lib/monthly-equivalent'

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
      .select('id, property_id, status, rent, rent_cadence, lease_start_date, lease_end_date, tenant_id')

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

    // Build property-level sets from leases
    const soldPropertyIds = new Set<string>()
    const physicallyOccupiedPropertyIds = new Set<string>()  // occupied OR eviction
    const currentIncomePropertyIds = new Set<string>()       // occupied only

    ;(allLeases || []).forEach(lease => {
      if (!lease.property_id) return
      if (lease.status === 'sold') soldPropertyIds.add(lease.property_id)
      if (isPhysicallyOccupied(lease.status)) physicallyOccupiedPropertyIds.add(lease.property_id)
      if (countsTowardCurrentIncome(lease.status)) currentIncomePropertyIds.add(lease.property_id)
    })

    // Valid residential properties (not sold, residential type)
    const validProperties =
      allProperties?.filter(
        property =>
          !soldPropertyIds.has(property.id) && isOverviewResidentialType(property.property_type)
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
    let emptyPotentialIncome = 0
    const emptyPotentialRows: Array<{
      propertyId: string
      propertyName: string
      address: string
      status: 'empty'
      cadence: string
      rent: number
      monthlyPotential: number
    }> = []

    validProperties.forEach(property => {
      const hasSoldLease = soldPropertyIds.has(property.id)
      const hasPhysicallyOccupied = physicallyOccupiedPropertyIds.has(property.id)
      const eligible = isEligibleEmptyPotentialProperty({
        propertyType: property.property_type,
        propertyStatus: property.status,
        rentValue: property.rent_value,
        hasPhysicallyOccupiedLease: hasPhysicallyOccupied,
        hasSoldLease,
      })
      if (!eligible) return
      const rentVal = Number(property.rent_value || 0)
      emptyPotentialIncome += rentVal
      emptyPotentialRows.push({
        propertyId: property.id,
        propertyName: property.name || '',
        address: property.address || '',
        status: 'empty',
        cadence: 'monthly',
        rent: rentVal,
        monthlyPotential: rentVal,
      })
    })

    // Eviction rows for potentialIncomeRows
    const evictionRows = evictionLeases.map(lease => {
      const property = allProperties?.find(p => p.id === lease.property_id)
      const tenantName = lease.tenant_id ? (tenantNames.get(lease.tenant_id) || '') : ''
      const monthly = monthlyEquivalentRent(lease.rent, lease.rent_cadence)
      return {
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

    const emptyRowsWithTenant = emptyPotentialRows.map(r => ({ ...r, tenantName: '' }))

    // Total potential income
    const totalPotentialIncome = currentMonthlyIncome + emptyPotentialIncome + evictionPotentialIncome

    // Occupied properties count = physically occupied (occupied OR eviction)
    const occupiedProperties = physicallyOccupiedPropertyIds.size

    // Late payments and total owed — billing-active leases (occupied + eviction)
    let latePayments = 0
    let totalOwed = 0

    if (billingActiveLeases.length > 0) {
      const leaseIds = billingActiveLeases.map(lease => lease.id)
      const leaseStartDates = new Map(billingActiveLeases.map(lease => [lease.id, lease.lease_start_date]))

      const [invoicesResult, paymentsResult] = await Promise.all([
        supabaseServer
          .from('RENT_invoices')
          .select('id, lease_id, due_date, amount_total, status')
          .in('lease_id', leaseIds)
          .eq('status', 'OPEN')
          .lte('due_date', today),
        supabaseServer
          .from('RENT_payments')
          .select('invoice_id, amount, payment_date')
          .in('lease_id', leaseIds)
          .not('invoice_id', 'is', null),
      ])

      if (!invoicesResult.error && invoicesResult.data && invoicesResult.data.length > 0) {
        const paymentsByInvoice = new Map<string, number>()
        if (paymentsResult.data) {
          const { eligible } = partitionPaymentsByAsOf(
            paymentsResult.data as Array<{ invoice_id: string; amount: number; payment_date: string }>,
            today,
          )
          eligible.forEach(p => {
            if (p.invoice_id) {
              paymentsByInvoice.set(
                p.invoice_id,
                (paymentsByInvoice.get(p.invoice_id) || 0) + (parseFloat(String(p.amount)) || 0),
              )
            }
          })
        }

        const validInvoices = invoicesResult.data
          .filter(inv => {
            const leaseStartDate = leaseStartDates.get(inv.lease_id)
            return leaseStartDate && inv.due_date >= leaseStartDate
          })
          .map(inv => {
            const actualPaid = paymentsByInvoice.get(inv.id) || 0
            const amountTotal = parseFloat(String(inv.amount_total ?? 0)) || 0
            return { ...inv, recalculated_balance: amountTotal - actualPaid }
          })
          .filter(inv => inv.recalculated_balance > 0)

        latePayments = validInvoices.length
        totalOwed = validInvoices.reduce((sum, inv) => sum + inv.recalculated_balance, 0)
      }
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
      .select('amount, interest_rate, balance')

    if (expensesError) {
      console.error('Error fetching expenses for debt calculation:', expensesError)
    }

    const totalPayments =
      expenses
        ?.filter(exp => exp.interest_rate !== -9.9999)
        .reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0) || 0

    const potentialPayments =
      expenses
        ?.filter(exp => exp.interest_rate !== -9.9999)
        .filter(expense => (Number(expense.balance) || 0) <= 0)
        .reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0) || 0

    const otherExpenses =
      expenses
        ?.filter(exp => exp.interest_rate === -9.9999)
        .reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0) || 0

    const totalFixedExpenses = totalInsurance + totalTaxes + totalPayments
    const potentialFixedExpenses = totalInsurance + totalTaxes + potentialPayments
    const totalDebt = totalFixedExpenses + otherExpenses
    const potentialDebt = potentialFixedExpenses + otherExpenses

    // Profit calculations
    // Current profit: uses currentMonthlyIncome only (eviction excluded)
    const currentProfit = currentMonthlyIncome - totalDebt
    // Potential profit: all three income parts
    const potentialProfit = totalPotentialIncome - totalDebt
    const potentialProfitNoHouseDebt = totalPotentialIncome - potentialDebt

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
      potentialIncome: emptyPotentialIncome + evictionPotentialIncome,
      totalPotentialIncome,
      // New breakdown fields
      emptyPotentialIncome,
      evictionPotentialIncome,
      emptyPotentialCount: emptyPotentialRows.length,
      evictionPotentialCount: evictionLeases.length,
      potentialIncomeRows: [...emptyRowsWithTenant, ...evictionRows],
      latePayments,
      totalOwed,
      propertyTypeBreakdown,
      totalDebt,
      currentProfit,
      potentialProfit,
      potentialProfitNoHouseDebt,
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
