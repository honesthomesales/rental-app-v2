import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { isAuthError, requireApiAuth } from '@/lib/auth/api-auth'
import { getBusinessDate } from '@/lib/business-date'
import { buildCollectedMonthCollectionFacts } from '@/lib/portfolio-ledger/service'

// Cache profit metrics for 60 seconds - historical data doesn't change
export const revalidate = 60

const SUPABASE_PAGE_SIZE = 1000

type CollectedPaymentRow = {
  id: string
  property_id?: string | null
  lease_id: string
  tenant_id?: string | null
  invoice_id: string | null
  amount: number
  payment_date: string
  status?: string | null
}

/** Payments actually received in the date range (by payment_date). */
async function fetchPaymentsCollectedBetween(
  rangeStart: string,
  rangeEnd: string,
): Promise<CollectedPaymentRow[]> {
  const rows: CollectedPaymentRow[] = []
  let from = 0
  for (;;) {
    const { data, error } = await supabaseServer
      .from('RENT_payments')
      .select('id, property_id, lease_id, tenant_id, invoice_id, amount, payment_date, status')
      .gte('payment_date', rangeStart)
      .lte('payment_date', rangeEnd)
      .order('payment_date', { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1)

    if (error) throw error
    const chunk = data || []
    rows.push(
      ...chunk.map((row) => ({
        id: String(row.id),
        property_id: row.property_id ? String(row.property_id) : null,
        lease_id: String(row.lease_id || ''),
        tenant_id: row.tenant_id ? String(row.tenant_id) : null,
        invoice_id: row.invoice_id ? String(row.invoice_id) : null,
        amount: Number(row.amount) || 0,
        payment_date: String(row.payment_date || ''),
        status: row.status,
      })),
    )
    if (chunk.length < SUPABASE_PAGE_SIZE) break
    from += SUPABASE_PAGE_SIZE
  }
  return rows
}

function buildLeaseToPropertyMap(allLeases: Array<{ id?: string; property_id?: string | null }>) {
  const map = new Map<string, string>()
  allLeases.forEach((lease) => {
    if (lease.id && lease.property_id) map.set(lease.id, lease.property_id)
  })
  return map
}

/** Cap income recognition at business date (or month end if earlier). */
function incomeAsOfDate(endOfMonth: string): string {
  const businessDate = getBusinessDate()
  return endOfMonth < businessDate ? endOfMonth : businessDate
}

async function fetchRentCollectedInMonth(pastStartOfMonth: string, pastEndOfMonth: string) {
  const asOf = incomeAsOfDate(pastEndOfMonth)
  const payments = await fetchPaymentsCollectedBetween(pastStartOfMonth, asOf)
  const { data: leases } = await supabaseServer.from('RENT_leases').select('id, property_id')
  return buildCollectedMonthCollectionFacts({
    payments,
    leasePropertyById: buildLeaseToPropertyMap(leases || []),
    monthStart: pastStartOfMonth,
    monthEnd: pastEndOfMonth,
    asOfDate: asOf,
  }).totalCollected
}

export async function GET(request: Request) {
  const auth = await requireApiAuth(request)
  if (isAuthError(auth)) return auth
try {
    const { searchParams } = new URL(request.url)
    let month = searchParams.get('month') || new Date().toISOString().slice(0, 7) // YYYY-MM format
    
    // If no month specified, use current month
    if (!searchParams.get('month')) {
      month = new Date().toISOString().slice(0, 7)
    }
    
    console.log('Fetching profit metrics for month:', month)
    
    // Get start and end of month
    const startOfMonth = `${month}-01`
    const year = parseInt(month.split('-')[0])
    const monthNum = parseInt(month.split('-')[1]) - 1 // JavaScript months are 0-indexed
    const endOfMonth = new Date(year, monthNum + 1, 0).toISOString().slice(0, 10)
    
    console.log('Date range:', startOfMonth, 'to', endOfMonth)
    
    // Fetch all properties for insurance and tax calculations (same as dashboard)
    const { data: properties, error: propertiesError } = await supabaseServer
      .from('RENT_properties')
      .select('*')
    
    if (propertiesError) {
      console.error('Error fetching properties:', propertiesError)
      throw propertiesError
    }
    
    console.log('Properties found:', properties?.length || 0)
    
    // Fetch all leases to identify properties with "sold" status (matching dashboard)
    const { data: allLeases, error: allLeasesError } = await supabaseServer
      .from('RENT_leases')
      .select('id, property_id, status')

    if (allLeasesError) {
      console.error('Error fetching all leases:', allLeasesError)
    }

    // Create a set of property IDs that have "sold" status leases
    const soldPropertyIds = new Set(
      allLeases
        ?.filter(lease => lease.status === 'sold')
        .map(lease => lease.property_id)
    )

    // Filter out properties with "sold" status leases and "other" property type (matching dashboard)
    const validProperties = properties?.filter(
      property => !soldPropertyIds.has(property.id) && property.property_type !== 'other'
    ) || []
    
    // Calculate total insurance (annual premium, not divided by 12)
    // Use all properties that are NOT sold (exclude sold properties only)
    const nonSoldProperties = properties?.filter(
      property => !soldPropertyIds.has(property.id)
    ) || []
    
    const totalInsurance = nonSoldProperties
      ?.reduce((sum, p) => sum + (Number(p.insurance_premium) || 0), 0) || 0
    
    // Calculate total taxes (annual tax, not divided by 12)
    // Use all properties that are NOT sold (exclude sold properties only)
    const totalTaxes = nonSoldProperties
      ?.reduce((sum, p) => sum + (Number(p.property_tax) || 0), 0) || 0
    
    console.log('Total insurance:', totalInsurance)
    console.log('Total taxes:', totalTaxes)
    
    // Total payments: match Expenses page regular-expense totals (footer "Amount Owed" column).
    // Same rules: exclude one-time rows (interest_rate === -9.9999); sum amount_owed (not amount).
    const { data: expenses, error: expensesError } = await supabaseServer
      .from('RENT_expenses')
      .select('amount, amount_owed, balance, interest_rate')
    
    if (expensesError) {
      console.error('Error fetching expenses:', expensesError)
      throw expensesError
    }

    const recurringExpenses = expenses?.filter(
      (expense) => expense.interest_rate !== -9.9999
    ) || []

    const totalPayments = recurringExpenses.reduce(
      (sum, expense) => sum + (Number(expense.amount_owed) || 0),
      0
    )

    // Potential payments: same basis as totalPayments, exclude rows with balance > 0
    const potentialPayments = recurringExpenses
      .filter((expense) => (Number(expense.balance) || 0) <= 0)
      .reduce((sum, expense) => sum + (Number(expense.amount_owed) || 0), 0)
    
    console.log('Expenses found:', expenses?.length || 0)
    console.log('Total payments from expenses:', totalPayments)
    console.log('Potential payments (excluding balance > 0):', potentialPayments)
    
    // Rent collected: cash received this month (payment_date), not invoice due month.
    let rentCollected = 0
    let expectedRent = 0
    const propertyDetails: any[] = []

    try {
      const asOf = incomeAsOfDate(endOfMonth)
      const [monthRentPayments, leasesResult] = await Promise.all([
        fetchPaymentsCollectedBetween(startOfMonth, asOf),
        supabaseServer
          .from('RENT_leases')
          .select('id, property_id, rent, rent_cadence, lease_start_date, lease_end_date, status'),
      ])

      if (leasesResult.error) {
        console.error('Error fetching leases:', leasesResult.error)
      }

      const allLeasesForRent = leasesResult.data || []
      const leaseToPropertyMap = buildLeaseToPropertyMap(allLeasesForRent)
      const collectionFacts = buildCollectedMonthCollectionFacts({
        payments: monthRentPayments,
        leasePropertyById: leaseToPropertyMap,
        monthStart: startOfMonth,
        monthEnd: endOfMonth,
        asOfDate: asOf,
      })
      const eligibleMonthPayments = collectionFacts.eligiblePayments
      rentCollected = collectionFacts.totalCollected

      console.log(
        'Rent collected by payment_date in month:',
        rentCollected,
        'from',
        monthRentPayments.length,
        'payments (',
        eligibleMonthPayments.length,
        'eligible)'
      )

      // Billing-active leases: occupied + eviction both generate invoices
      const activeLeases = allLeasesForRent.filter(
        (l: any) => l.status === 'occupied' || l.status === 'eviction',
      )
      activeLeases.forEach((lease: any) => {
        const rent = Number(lease.rent) || 0
        const cadence = lease.rent_cadence?.toLowerCase() || 'monthly'
        switch (cadence) {
          case 'weekly':
            expectedRent += rent * 4
            break
          case 'bi-weekly':
          case 'biweekly':
            expectedRent += rent * 2
            break
          case 'monthly':
          default:
            expectedRent += rent
            break
        }
      })

      if (validProperties && validProperties.length > 0) {
        const { data: miscIncomeByProperty, error: miscError } = await supabaseServer
          .from('RENT_expenses')
          .select('property_id, amount_owed')
          .eq('interest_rate', 9.9999)
          .gte('last_paid_date', startOfMonth)
          .lte('last_paid_date', endOfMonth)

        if (miscError) {
          console.error('Error fetching misc income:', miscError)
        }

        const paymentsByPropertyMap = collectionFacts.collectedByProperty

        const miscIncomeByPropertyMap = new Map<string, number>()
        miscIncomeByProperty?.forEach((m: any) => {
          const propId = m.property_id || 'no-property'
          miscIncomeByPropertyMap.set(
            propId,
            (miscIncomeByPropertyMap.get(propId) || 0) + (Number(m.amount_owed) || 0)
          )
        })

        validProperties.forEach((property: any) => {
          const rentCollectedForProperty = paymentsByPropertyMap.get(property.id) || 0
          let expectedRentForProperty = 0
          const miscIncomeForProperty = miscIncomeByPropertyMap.get(property.id) || 0

          const propertyLeases = activeLeases.filter(
            (l: any) => l.property_id === property.id,
          )
          propertyLeases.forEach((lease: any) => {
            const leaseStart = new Date(lease.lease_start_date)
            const leaseEnd = lease.lease_end_date
              ? new Date(lease.lease_end_date)
              : new Date(endOfMonth)
            const monthStart = new Date(startOfMonth)
            const monthEnd = new Date(endOfMonth)

            if (leaseStart <= monthEnd && leaseEnd >= monthStart) {
              const rent = Number(lease.rent) || 0
              const cadence = lease.rent_cadence?.toLowerCase() || 'monthly'
              switch (cadence) {
                case 'weekly':
                  expectedRentForProperty += rent * 4
                  break
                case 'bi-weekly':
                case 'biweekly':
                  expectedRentForProperty += rent * 2
                  break
                case 'monthly':
                default:
                  expectedRentForProperty += rent
                  break
              }
            }
          })

          if (
            rentCollectedForProperty > 0 ||
            expectedRentForProperty > 0 ||
            miscIncomeForProperty > 0
          ) {
            propertyDetails.push({
              property_id: property.id,
              property_name: property.name,
              property_address: property.address,
              expected_rent: expectedRentForProperty,
              rent_collected: rentCollectedForProperty,
              misc_income: miscIncomeForProperty,
            })
          }
        })

        console.log('Property details built. Count:', propertyDetails.length)
      }
    } catch (error) {
      console.error('Error fetching rent data:', error)
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack')
    }
    
    console.log('Rent collected:', rentCollected)
    console.log('Expected rent:', expectedRent)
    
    // Get one-time expenses for the month to calculate repairs, other expenses, and misc income
    const { data: oneTimeExpenses, error: oneTimeError } = await supabaseServer
      .from('RENT_expenses')
      .select('category, amount_owed, last_paid_date, mail_info')
      .eq('interest_rate', -9.9999) // One-time expenses are marked with -9.9999
      .gte('last_paid_date', startOfMonth)
      .lte('last_paid_date', endOfMonth)
    
    if (oneTimeError) {
      console.error('Error fetching one-time expenses:', oneTimeError)
    }
    
    console.log('One-time expenses found:', oneTimeExpenses?.length || 0)
    
    // Calculate other expenses (all one-time expenses)
    const otherExpenses = oneTimeExpenses
      ?.reduce((sum, expense) => sum + (Number(expense.amount_owed) || 0), 0) || 0
    
    // Get misc income from expenses with interest_rate = -888
    const { data: miscIncomeExpenses, error: miscIncomeError } = await supabaseServer
      .from('RENT_expenses')
      .select('amount_owed, last_paid_date')
      .eq('interest_rate', 9.9999) // Misc income is marked with 9.9999 (one-time expenses use -9.9999)
      .gte('last_paid_date', startOfMonth)
      .lte('last_paid_date', endOfMonth)
    
    if (miscIncomeError) {
      console.error('Error fetching misc income:', miscIncomeError)
    }
    
    console.log('Misc income expenses found:', miscIncomeExpenses?.length || 0)
    
    const miscIncome = miscIncomeExpenses
      ?.reduce((sum, expense) => sum + (Number(expense.amount_owed) || 0), 0) || 0
    
    const totalFixedExpenses = totalInsurance + totalTaxes + totalPayments
    const potentialFixedExpenses = totalInsurance + totalTaxes + potentialPayments
    const totalDebt = totalFixedExpenses + otherExpenses
    const potentialDebt = potentialFixedExpenses + otherExpenses
    
    const totalIncome = rentCollected + miscIncome
    
    // Collection rate as percentage (0-100)
    const collectionRatePercent = expectedRent > 0 ? (rentCollected / expectedRent) * 100 : 0
    // Collection rate as decimal (0-1) for gauge
    const collectionRate = expectedRent > 0 ? (rentCollected / expectedRent) : 0
    
    // Calculate average profit for previous 12 months
    let averageProfit12Months = 0
    try {
      const profitAmounts: number[] = []
      const currentMonth = new Date(year, monthNum, 1)
      
      // Calculate profit for each of the previous 12 months
      for (let i = 1; i <= 12; i++) {
        const pastMonth = new Date(currentMonth)
        pastMonth.setMonth(pastMonth.getMonth() - i)
        const pastMonthStr = `${pastMonth.getFullYear()}-${String(pastMonth.getMonth() + 1).padStart(2, '0')}`
        
        const pastStartOfMonth = `${pastMonthStr}-01`
        const pastYear = pastMonth.getFullYear()
        const pastMonthNum = pastMonth.getMonth()
        const pastEndOfMonth = new Date(pastYear, pastMonthNum + 1, 0).toISOString().slice(0, 10)
        
        const pastRentCollected = await fetchRentCollectedInMonth(
          pastStartOfMonth,
          pastEndOfMonth
        )
        
        // Fetch misc income for that month
        const { data: pastMiscIncome } = await supabaseServer
          .from('RENT_expenses')
          .select('amount_owed')
          .eq('interest_rate', 9.9999)
          .gte('last_paid_date', pastStartOfMonth)
          .lte('last_paid_date', pastEndOfMonth)
        
        const pastMiscIncomeAmount = pastMiscIncome?.reduce((sum, e) => sum + (Number(e.amount_owed) || 0), 0) || 0
        
        // Fetch one-time expenses for that month
        const { data: pastOneTimeExpenses } = await supabaseServer
          .from('RENT_expenses')
          .select('amount_owed')
          .eq('interest_rate', -9.9999)
          .gte('last_paid_date', pastStartOfMonth)
          .lte('last_paid_date', pastEndOfMonth)
        
        const pastOtherExpenses = pastOneTimeExpenses?.reduce((sum, e) => sum + (Number(e.amount_owed) || 0), 0) || 0
        
        // Calculate profit for that month (income - expenses)
        const pastTotalIncome = pastRentCollected + pastMiscIncomeAmount
        const pastTotalExpenses = totalInsurance + totalTaxes + totalPayments + pastOtherExpenses
        const pastProfit = pastTotalIncome - pastTotalExpenses
        
        profitAmounts.push(pastProfit)
      }
      
      // Calculate average
      if (profitAmounts.length > 0) {
        averageProfit12Months = profitAmounts.reduce((sum, p) => sum + p, 0) / profitAmounts.length
      }
    } catch (error) {
      console.error('Error calculating average profit:', error)
      // Continue with 0 if calculation fails
    }
    
    // Calculate potential profit if House Debt is paid (expenses with balance > 0 reduced to zero)
    const potentialProfit = totalIncome - potentialDebt
    
    const metrics = {
      fixedExpenses: {
        insurance: Math.round(totalInsurance * 100) / 100,
        taxes: Math.round(totalTaxes * 100) / 100,
        totalPayments: Math.round(totalPayments * 100) / 100,
        total: Math.round(totalFixedExpenses * 100) / 100,
        potential: Math.round(potentialFixedExpenses * 100) / 100
      },
      oneTimeExpenseIncome: {
        expenses: {
          otherExpenses: Math.round(otherExpenses * 100) / 100
        },
        income: {
          miscIncome: Math.round(miscIncome * 100) / 100
        },
        totalIncome: Math.round(totalIncome * 100) / 100,
        totalDebt: Math.round(totalDebt * 100) / 100,
        potentialDebt: Math.round(potentialDebt * 100) / 100
      },
      potentialProfit: Math.round(potentialProfit * 100) / 100,
      propertyDetails: propertyDetails.map((p: any) => ({
        property_id: p.property_id,
        property_name: p.property_name,
        property_address: p.property_address,
        expected_rent: Math.round(p.expected_rent * 100) / 100,
        rent_collected: Math.round(p.rent_collected * 100) / 100,
        misc_income: Math.round(p.misc_income * 100) / 100
      })),
      rentCollection: {
        collected: Math.round(rentCollected * 100) / 100,
        expected: Math.round(expectedRent * 100) / 100,
        collectionRate: Math.round(collectionRatePercent * 100) / 100, // Percentage for display
        collectionRateDecimal: collectionRate // Decimal 0-1 for gauge
      },
      averageProfit12Months: Math.round(averageProfit12Months * 100) / 100
    }
    
    console.log('Calculated metrics:', JSON.stringify(metrics, null, 2))
    console.log('Property details in response:', metrics.propertyDetails?.length || 0)
    
    return NextResponse.json(metrics)
  } catch (error) {
    console.error('Error in profit metrics API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch profit metrics', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
