import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export const revalidate = 60

function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function endOfMonthIso(year: number, monthIndex0: number): string {
  return new Date(year, monthIndex0 + 1, 0).toISOString().slice(0, 10)
}

/** Last 6 calendar months, oldest → newest (for stacked display). */
function getSixMonthKeys(reference: Date): string[] {
  const keys: string[] = []
  for (let back = 5; back >= 0; back--) {
    const d = new Date(reference.getFullYear(), reference.getMonth() - back, 1)
    keys.push(monthKeyFromDate(d))
  }
  return keys
}

function labelForMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const asOfParam = searchParams.get('asOf')
    const reference = asOfParam ? new Date(asOfParam + 'T12:00:00') : new Date()

    const monthKeys = getSixMonthKeys(reference)
    const rangeStart = `${monthKeys[0]}-01`
    const lastMonth = monthKeys[monthKeys.length - 1]
    const [ly, lm] = lastMonth.split('-').map(Number)
    const rangeEnd = endOfMonthIso(ly, lm - 1)

    const { data: properties, error: propertiesError } = await supabaseServer
      .from('RENT_properties')
      .select('*')

    if (propertiesError) throw propertiesError

    const { data: allLeases, error: allLeasesError } = await supabaseServer
      .from('RENT_leases')
      .select('id, property_id, status')

    if (allLeasesError) {
      console.error('Error fetching leases for monthly-summary:', allLeasesError)
    }

    const soldPropertyIds = new Set(
      allLeases?.filter((lease) => lease.status === 'sold').map((lease) => lease.property_id) ?? []
    )

    const nonSoldProperties =
      properties?.filter((property) => !soldPropertyIds.has(property.id)) ?? []

    const totalInsurance = nonSoldProperties.reduce(
      (sum, p) => sum + (Number(p.insurance_premium) || 0),
      0
    )
    const totalTaxes = nonSoldProperties.reduce(
      (sum, p) => sum + (Number(p.property_tax) || 0),
      0
    )

    const { data: expenses, error: expensesError } = await supabaseServer
      .from('RENT_expenses')
      .select('amount, amount_owed, balance, interest_rate')

    if (expensesError) throw expensesError

    const recurringExpenses =
      expenses?.filter((expense) => expense.interest_rate !== -9.9999) ?? []

    const totalPayments = recurringExpenses.reduce(
      (sum, expense) => sum + (Number(expense.amount_owed) || 0),
      0
    )

    const potentialPayments = recurringExpenses
      .filter((expense) => (Number(expense.balance) || 0) <= 0)
      .reduce((sum, expense) => sum + (Number(expense.amount_owed) || 0), 0)

    const totalFixedExpenses = totalInsurance + totalTaxes + totalPayments
    const potentialFixedExpenses = totalInsurance + totalTaxes + potentialPayments

    const [paymentsRes, miscRes, oneTimeRes] = await Promise.all([
      supabaseServer
        .from('RENT_payments')
        .select('amount, payment_date')
        .not('invoice_id', 'is', null)
        .gte('payment_date', rangeStart)
        .lte('payment_date', rangeEnd),
      supabaseServer
        .from('RENT_expenses')
        .select('amount_owed, last_paid_date')
        .eq('interest_rate', 9.9999)
        .gte('last_paid_date', rangeStart)
        .lte('last_paid_date', rangeEnd),
      supabaseServer
        .from('RENT_expenses')
        .select('amount_owed, last_paid_date')
        .eq('interest_rate', -9.9999)
        .gte('last_paid_date', rangeStart)
        .lte('last_paid_date', rangeEnd),
    ])

    if (paymentsRes.error) throw paymentsRes.error
    if (miscRes.error) throw miscRes.error
    if (oneTimeRes.error) throw oneTimeRes.error

    const rentByMonth = new Map<string, number>()
    const miscByMonth = new Map<string, number>()
    const otherByMonth = new Map<string, number>()

    const addToMonth = (map: Map<string, number>, dateStr: string, amount: number) => {
      const key = dateStr.slice(0, 7)
      map.set(key, (map.get(key) || 0) + amount)
    }

    paymentsRes.data?.forEach((p: { amount: string | number; payment_date: string }) => {
      addToMonth(rentByMonth, p.payment_date, parseFloat(String(p.amount)) || 0)
    })

    miscRes.data?.forEach((e: { amount_owed: number | null; last_paid_date: string }) => {
      addToMonth(miscByMonth, e.last_paid_date, Number(e.amount_owed) || 0)
    })

    oneTimeRes.data?.forEach((e: { amount_owed: number | null; last_paid_date: string }) => {
      addToMonth(otherByMonth, e.last_paid_date, Number(e.amount_owed) || 0)
    })

    const months = monthKeys.map((month) => {
      const rent = rentByMonth.get(month) || 0
      const misc = miscByMonth.get(month) || 0
      const other = otherByMonth.get(month) || 0
      const totalIncome = rent + misc
      const currentProfit = totalIncome - (totalFixedExpenses + other)
      const potentialProfit = totalIncome - (potentialFixedExpenses + other)

      return {
        month,
        label: labelForMonth(month),
        currentProfit: Math.round(currentProfit * 100) / 100,
        potentialProfit: Math.round(potentialProfit * 100) / 100,
      }
    })

    return NextResponse.json({ months, referenceMonth: monthKeyFromDate(reference) })
  } catch (error) {
    console.error('Error in profit monthly-summary API:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch monthly profit summary',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
