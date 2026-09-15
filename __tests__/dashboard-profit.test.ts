import {
  annualTaxDue,
  effectiveTaxPaid,
  monthlyTaxPaymentForProperty,
  sumMonthlyTaxPayments,
  taxesOwedForProperty,
} from '@/lib/dashboard-tax'
import {
  ONE_TIME_EXPENSE_RATE,
  MISC_INCOME_RATE,
} from '@/lib/expenses/classification'
import {
  buildDashboardProfit,
  calendarMonthBounds,
  expenseApplicableDate,
  qualifiesForFullNoDebtAddBack,
} from '@/lib/dashboard-profit'

describe('dashboard tax monthly payment', () => {
  it('treats property_tax as monthly and annual as ×12', () => {
    expect(annualTaxDue(100)).toBe(1200)
    expect(effectiveTaxPaid(-1)).toBe(0)
  })

  it('matches tax-section Monthly Tax (Owed/12), including color waivers', () => {
    const property = {
      id: 'p1',
      property_tax: 100,
      tax_paid_amount_current: 200,
      tax_paid_amount_previous: 0,
      tax_color_state: 0,
    }
    expect(taxesOwedForProperty(property)).toBe(1000)
    expect(monthlyTaxPaymentForProperty(property)).toBeCloseTo(1000 / 12)

    expect(monthlyTaxPaymentForProperty(property, 1)).toBe(0)
    expect(monthlyTaxPaymentForProperty(property, 2)).toBe(0)
    expect(monthlyTaxPaymentForProperty(property, 6)).toBe(0)
  })

  it('honors manual tax_owed override', () => {
    const property = {
      property_tax: 100,
      tax_owed: 240,
      tax_paid_amount_current: 0,
      tax_color_state: 0,
    }
    expect(monthlyTaxPaymentForProperty(property)).toBe(20)
  })
})

describe('dashboard profit calculations', () => {
  const businessDate = '2026-09-14'
  const { start, end } = calendarMonthBounds(businessDate)

  it('uses calendar month bounds without UTC drift', () => {
    expect(start).toBe('2026-09-01')
    expect(end).toBe('2026-09-30')
  })

  it('uses last_paid_date as the applicable expense date', () => {
    expect(
      expenseApplicableDate({
        last_paid_date: '2026-09-10',
        expense_date: '2026-08-01',
      }),
    ).toBe('2026-09-10')
  })

  it('Full / No Debt add-backs only when balance > 0', () => {
    expect(
      qualifiesForFullNoDebtAddBack({ amount: 1800, balance: 50000 }),
    ).toBe(true)
    expect(qualifiesForFullNoDebtAddBack({ amount: 1800, balance: 0 })).toBe(
      false,
    )
    expect(qualifiesForFullNoDebtAddBack({ amount: 1800, balance: -1 })).toBe(
      false,
    )
    expect(qualifiesForFullNoDebtAddBack({ amount: 1800, balance: null })).toBe(
      false,
    )
    expect(
      qualifiesForFullNoDebtAddBack({ amount: 1800, balance: undefined }),
    ).toBe(false)
  })

  it('Full / No Debt equals Potential plus monthly amounts for balance > 0', () => {
    const properties = [
      {
        id: 'a',
        insurance_premium: 50,
        property_tax: 100,
        tax_paid_amount_current: 0,
        tax_paid_amount_previous: 0,
        tax_color_state: 0,
      },
      {
        id: 'b',
        insurance_premium: 25,
        property_tax: 80,
        tax_paid_amount_current: 0,
        tax_color_state: 1,
      },
    ]

    const expenses = [
      {
        id: 'equine',
        category: 'Mortgage',
        mail_info: '946 Equine',
        amount: 1800,
        amount_owed: 1800,
        balance: 42000,
        interest_rate: 0.05,
      },
      {
        id: 'paid-off',
        category: 'Loan',
        amount: 200,
        amount_owed: 200,
        balance: 0,
        interest_rate: 0.05,
      },
      {
        id: 'neg-balance',
        category: 'Loan',
        amount: 300,
        amount_owed: 300,
        balance: -5,
        interest_rate: 0.05,
      },
      {
        id: 'ot-cur',
        category: 'One-Time Expense',
        amount: 75,
        amount_owed: 75,
        interest_rate: ONE_TIME_EXPENSE_RATE,
        last_paid_date: '2026-09-05',
      },
      {
        id: 'ot-old',
        category: 'One-Time Expense',
        amount: 999,
        amount_owed: 999,
        interest_rate: ONE_TIME_EXPENSE_RATE,
        last_paid_date: '2026-08-15',
      },
      {
        id: 'misc',
        category: 'Misc Income',
        amount: 40,
        amount_owed: 40,
        interest_rate: MISC_INCOME_RATE,
        last_paid_date: '2026-09-02',
      },
    ]

    const profit = buildDashboardProfit({
      occupiedMonthlyIncome: 10000,
      qualifyingPotentialIncome: 1500,
      properties,
      expenses,
      businessDate,
    })

    expect(profit.monthlyInsurance).toBe(75)
    expect(profit.monthlyTaxes).toBe(100)
    expect(sumMonthlyTaxPayments(properties)).toBe(profit.monthlyTaxes)

    expect(profit.recurringMonthlyPayments).toBe(2300) // 1800+200+300
    expect(profit.fullNoDebtBalanceAddBacks).toBe(1800) // only 946 Equine
    expect(profit.currentMonthOneTimeExpenses).toBe(75)
    expect(profit.currentMonthMiscIncome).toBe(40)

    // Current = 10000 + 40 − 75 − 100 − 2300 − 75 = 7490
    expect(profit.currentProfit).toBe(7490)
    expect(profit.potentialProfit).toBe(8990)
    expect(profit.potentialProfit - profit.currentProfit).toBe(1500)

    // Full / No Debt = Potential + 1800 (946 Equine)
    expect(profit.fullNoDebtProfit).toBe(10790)
    expect(profit.potentialProfitNoHouseDebt).toBe(10790)

    expect(profit.contributing.fullNoDebtAddBacks.map((r) => r.description)).toEqual([
      '946 Equine',
    ])
    expect(profit.contributing.fullNoDebtAddBacks[0].amount).toBe(1800)
  })
})
