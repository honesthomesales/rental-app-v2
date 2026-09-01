import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { isAuthError, requireApiAuth } from '@/lib/auth/api-auth'
import { resolveBusinessDate } from '@/lib/business-date'
import { monthBounds } from '@/lib/date-month'
import { buildCollectedMonthCollectionFacts } from '@/lib/portfolio-ledger/service'
import {
  MISC_INCOME_RATE,
  ONE_TIME_EXPENSE_RATE,
  isRecurringExpense,
} from '@/lib/expenses/classification'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function endOfMonthIso(year: number, monthIndex0: number): string {
  const monthKey = `${year}-${String(monthIndex0 + 1).padStart(2, '0')}`
  return monthBounds(monthKey).end
}

/** Last N calendar months, oldest → newest (for stacked display). */
function getMonthKeys(reference: Date, count: number): string[] {
  const keys: string[] = []
  for (let back = count - 1; back >= 0; back--) {
    const d = new Date(reference.getFullYear(), reference.getMonth() - back, 1)
    keys.push(monthKeyFromDate(d))
  }
  return keys
}

function labelForMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

const SUPABASE_PAGE_SIZE = 1000

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return 'Unknown error'
}

/** PostgREST defaults to 1000 rows; paginate so 12-month ranges include all rows. */
async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await fetchPage(from, from + SUPABASE_PAGE_SIZE - 1)
    if (error) throw error
    if (!data?.length) break
    rows.push(...data)
    if (data.length < SUPABASE_PAGE_SIZE) break
    from += SUPABASE_PAGE_SIZE
  }
  return rows
}

export async function GET(request: Request) {
  const auth = await requireApiAuth(request)
  if (isAuthError(auth)) return auth
try {
    const { searchParams } = new URL(request.url)
    const asOfParam = searchParams.get('asOf')
    const monthsParam = searchParams.get('months')
    const monthCount = monthsParam === '12' ? 12 : 6
    const businessDate = resolveBusinessDate(asOfParam)
    const reference = asOfParam ? new Date(asOfParam + 'T12:00:00') : new Date()

    const monthKeys = getMonthKeys(reference, monthCount)
    const rangeStart = `${monthKeys[0]}-01`
    const lastMonth = monthKeys[monthKeys.length - 1]
    const [ly, lm] = lastMonth.split('-').map(Number)
    const rangeEnd = endOfMonthIso(ly, lm - 1)
    const paymentRangeEnd = rangeEnd

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
      .select('amount, amount_owed, balance, interest_rate, category')

    if (expensesError) throw expensesError

    const recurringExpenses = (expenses ?? []).filter(isRecurringExpense)

    const totalPayments = recurringExpenses.reduce(
      (sum, expense) => sum + (Number(expense.amount_owed) || 0),
      0
    )

    const potentialPayments = recurringExpenses
      .filter((expense) => (Number(expense.balance) || 0) <= 0)
      .reduce((sum, expense) => sum + (Number(expense.amount_owed) || 0), 0)

    const totalFixedExpenses = totalInsurance + totalTaxes + totalPayments
    const potentialFixedExpenses = totalInsurance + totalTaxes + potentialPayments

    const leasePropertyById = new Map<string, string>()
    for (const lease of allLeases || []) {
      if (lease.id && lease.property_id) {
        leasePropertyById.set(String(lease.id), String(lease.property_id))
      }
    }

    // Cash collected by payment_date (not invoice due month).
    const [payments, miscExpenses, oneTimeExpenses] = await Promise.all([
      fetchAllPages<{
        id: string
        lease_id: string
        property_id: string | null
        invoice_id: string | null
        amount: number
        payment_date: string
        status: string | null
      }>((from, to) =>
        supabaseServer
          .from('RENT_payments')
          .select('id, lease_id, property_id, invoice_id, amount, payment_date, status')
          .gte('payment_date', rangeStart)
          .lte('payment_date', paymentRangeEnd)
          .order('payment_date', { ascending: true })
          .range(from, to),
      ),
      fetchAllPages<{ amount_owed: number | null; last_paid_date: string }>((from, to) =>
        supabaseServer
          .from('RENT_expenses')
          .select('amount_owed, last_paid_date')
          .eq('interest_rate', MISC_INCOME_RATE)
          .gte('last_paid_date', rangeStart)
          .lte('last_paid_date', rangeEnd)
          .order('last_paid_date', { ascending: true })
          .range(from, to)
      ),
      fetchAllPages<{ amount_owed: number | null; last_paid_date: string }>((from, to) =>
        supabaseServer
          .from('RENT_expenses')
          .select('amount_owed, last_paid_date')
          .eq('interest_rate', ONE_TIME_EXPENSE_RATE)
          .gte('last_paid_date', rangeStart)
          .lte('last_paid_date', rangeEnd)
          .order('last_paid_date', { ascending: true })
          .range(from, to)
      ),
    ])

    const rentByMonth = new Map<string, number>()
    const miscByMonth = new Map<string, number>()
    const otherByMonth = new Map<string, number>()

    const addToMonth = (map: Map<string, number>, dateStr: string, amount: number) => {
      const key = dateStr.slice(0, 7)
      map.set(key, (map.get(key) || 0) + amount)
    }

    for (const month of monthKeys) {
      const facts = buildCollectedMonthCollectionFacts({
        payments: payments.map((payment) => ({
          id: String(payment.id),
          lease_id: String(payment.lease_id || ''),
          property_id: payment.property_id,
          invoice_id: payment.invoice_id ? String(payment.invoice_id) : null,
          amount: Number(payment.amount) || 0,
          payment_date: String(payment.payment_date || ''),
          status: payment.status,
        })),
        leasePropertyById,
        monthStart: `${month}-01`,
        monthEnd: endOfMonthIso(
          Number(month.slice(0, 4)),
          Number(month.slice(5, 7)) - 1,
        ),
        asOfDate: businessDate,
      })
      rentByMonth.set(month, facts.totalCollected)
    }

    miscExpenses.forEach((e) => {
      addToMonth(miscByMonth, e.last_paid_date, Number(e.amount_owed) || 0)
    })

    oneTimeExpenses.forEach((e) => {
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

    return NextResponse.json(
      {
        months,
        monthCount,
        referenceMonth: monthKeyFromDate(reference),
      },
      {
        headers: {
          'Cache-Control': 'private, no-store, must-revalidate',
        },
      },
    )
  } catch (error) {
    console.error('Error in profit monthly-summary API:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch monthly profit summary',
        details: errorMessage(error),
      },
      { status: 500 }
    )
  }
}
