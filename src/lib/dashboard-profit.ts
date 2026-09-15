import {
  isMiscIncome,
  isOneTimeExpense,
  isRecurringExpense,
  type ExpenseLike,
} from '@/lib/expenses/classification'
import {
  sumMonthlyTaxPayments,
  type DashboardTaxProperty,
} from '@/lib/dashboard-tax'

export type ProfitPropertyRow = DashboardTaxProperty & {
  insurance_premium?: number | string | null
}

export type ProfitExpenseRow = ExpenseLike & {
  id?: string
  amount?: number | string | null
  amount_owed?: number | string | null
  balance?: number | string | null
  last_paid_date?: string | null
  expense_date?: string | null
  category?: string | null
  mail_info?: string | null
  property_id?: string | null
}

export type ProfitExpenseContribution = {
  id: string
  category: string
  description: string
  amount: number
  amountOwed: number | null
  applicableDate: string | null
}

export type DashboardProfitBreakdown = {
  occupiedMonthlyIncome: number
  qualifyingPotentialIncome: number
  currentMonthMiscIncome: number
  monthlyInsurance: number
  monthlyTaxes: number
  recurringMonthlyPayments: number
  fullNoDebtRecurringPayments: number
  currentMonthOneTimeExpenses: number
  currentProfit: number
  potentialProfit: number
  fullNoDebtProfit: number
  /** Alias for Full / No Debt (existing API field name). */
  potentialProfitNoHouseDebt: number
  totalDebt: number
  contributing: {
    miscIncome: ProfitExpenseContribution[]
    recurringAll: ProfitExpenseContribution[]
    recurringFullNoDebt: ProfitExpenseContribution[]
    oneTimeCurrentMonth: ProfitExpenseContribution[]
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function money(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Calendar month bounds for a YYYY-MM-DD business date (no UTC shift). */
export function calendarMonthBounds(businessDate: string): {
  start: string
  end: string
} {
  const [y, m] = businessDate.split('-').map(Number)
  const start = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const end = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

/** One-time / misc applicable date: last_paid_date (form "Date Paid"), else expense_date. */
export function expenseApplicableDate(
  expense: Pick<ProfitExpenseRow, 'last_paid_date' | 'expense_date'>,
): string | null {
  const raw = String(expense.last_paid_date || expense.expense_date || '').trim()
  if (!raw) return null
  return raw.slice(0, 10)
}

export function isInCalendarMonth(
  date: string | null | undefined,
  businessDate: string,
): boolean {
  if (!date) return false
  const { start, end } = calendarMonthBounds(businessDate)
  const d = String(date).slice(0, 10)
  return d >= start && d <= end
}

/** Monthly payment amount for a recurring expense row. */
export function recurringMonthlyPayment(expense: ProfitExpenseRow): number {
  return money(expense.amount)
}

/**
 * Full / No Debt includes the monthly payment only when Amount Owed > 0.
 * Missing / null / NaN amount_owed is excluded.
 */
export function qualifiesForFullNoDebtRecurring(
  expense: ProfitExpenseRow,
): boolean {
  if (expense.amount_owed == null || expense.amount_owed === '') return false
  const owed = Number(expense.amount_owed)
  return Number.isFinite(owed) && owed > 0
}

function toContribution(expense: ProfitExpenseRow): ProfitExpenseContribution {
  return {
    id: String(expense.id || ''),
    category: String(expense.category || ''),
    description: String(expense.mail_info || expense.category || '').trim(),
    amount: recurringMonthlyPayment(expense),
    amountOwed:
      expense.amount_owed == null || expense.amount_owed === ''
        ? null
        : Number.isFinite(Number(expense.amount_owed))
          ? Number(expense.amount_owed)
          : null,
    applicableDate: expenseApplicableDate(expense),
  }
}

function oneTimeContribution(expense: ProfitExpenseRow): ProfitExpenseContribution {
  const paid = money(expense.amount_owed) || money(expense.amount)
  return {
    ...toContribution(expense),
    amount: paid,
  }
}

function miscContribution(expense: ProfitExpenseRow): ProfitExpenseContribution {
  const credited = money(expense.amount_owed) || money(expense.amount)
  return {
    ...toContribution(expense),
    amount: credited,
  }
}

/**
 * Dashboard profit figures from confirmed V3 rules.
 * Insurance premium is already monthly (never ÷12).
 * Taxes use the tax-section Monthly Tax (Owed/12) helper.
 */
export function buildDashboardProfit(args: {
  occupiedMonthlyIncome: number
  qualifyingPotentialIncome: number
  properties: readonly ProfitPropertyRow[]
  expenses: readonly ProfitExpenseRow[]
  businessDate: string
}): DashboardProfitBreakdown {
  const occupiedMonthlyIncome = round2(args.occupiedMonthlyIncome)
  const qualifyingPotentialIncome = round2(args.qualifyingPotentialIncome)

  const monthlyInsurance = round2(
    args.properties.reduce((sum, p) => sum + money(p.insurance_premium), 0),
  )
  const monthlyTaxes = round2(sumMonthlyTaxPayments(args.properties))

  const miscRows = args.expenses
    .filter(isMiscIncome)
    .filter((e) => isInCalendarMonth(expenseApplicableDate(e), args.businessDate))
  const currentMonthMiscIncome = round2(
    miscRows.reduce(
      (sum, e) => sum + (money(e.amount_owed) || money(e.amount)),
      0,
    ),
  )

  const recurringRows = args.expenses.filter(isRecurringExpense)
  const recurringMonthlyPayments = round2(
    recurringRows.reduce((sum, e) => sum + recurringMonthlyPayment(e), 0),
  )
  const fullNoDebtRecurringRows = recurringRows.filter(qualifiesForFullNoDebtRecurring)
  const fullNoDebtRecurringPayments = round2(
    fullNoDebtRecurringRows.reduce((sum, e) => sum + recurringMonthlyPayment(e), 0),
  )

  const oneTimeRows = args.expenses
    .filter(isOneTimeExpense)
    .filter((e) => isInCalendarMonth(expenseApplicableDate(e), args.businessDate))
  const currentMonthOneTimeExpenses = round2(
    oneTimeRows.reduce(
      (sum, e) => sum + (money(e.amount_owed) || money(e.amount)),
      0,
    ),
  )

  const expenseTotalCurrent =
    monthlyInsurance +
    monthlyTaxes +
    recurringMonthlyPayments +
    currentMonthOneTimeExpenses
  const expenseTotalFullNoDebt =
    monthlyInsurance +
    monthlyTaxes +
    fullNoDebtRecurringPayments +
    currentMonthOneTimeExpenses

  const incomeCurrent = occupiedMonthlyIncome + currentMonthMiscIncome
  const incomeFull =
    occupiedMonthlyIncome + qualifyingPotentialIncome + currentMonthMiscIncome

  const currentProfit = round2(incomeCurrent - expenseTotalCurrent)
  const potentialProfit = round2(currentProfit + qualifyingPotentialIncome)
  const fullNoDebtProfit = round2(incomeFull - expenseTotalFullNoDebt)

  return {
    occupiedMonthlyIncome,
    qualifyingPotentialIncome,
    currentMonthMiscIncome,
    monthlyInsurance,
    monthlyTaxes,
    recurringMonthlyPayments,
    fullNoDebtRecurringPayments,
    currentMonthOneTimeExpenses,
    currentProfit,
    potentialProfit,
    fullNoDebtProfit,
    potentialProfitNoHouseDebt: fullNoDebtProfit,
    totalDebt: round2(expenseTotalCurrent),
    contributing: {
      miscIncome: miscRows.map(miscContribution),
      recurringAll: recurringRows.map(toContribution),
      recurringFullNoDebt: fullNoDebtRecurringRows.map(toContribution),
      oneTimeCurrentMonth: oneTimeRows.map(oneTimeContribution),
    },
  }
}
