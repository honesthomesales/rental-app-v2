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
  qualifiesForFullNoDebtRecurring,
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
    // annual 1200 − 200 = 1000 owed → 1000/12
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

  it('Full / No Debt includes recurring only when amount_owed > 0', () => {
    expect(
      qualifiesForFullNoDebtRecurring({ amount: 500, amount_owed: 1200 }),
    ).toBe(true)
    expect(qualifiesForFullNoDebtRecurring({ amount: 500, amount_owed: 0 })).toBe(
      false,
    )
    expect(
      qualifiesForFullNoDebtRecurring({ amount: 500, amount_owed: -1 }),
    ).toBe(false)
    expect(
      qualifiesForFullNoDebtRecurring({ amount: 500, amount_owed: null }),
    ).toBe(false)
    expect(
      qualifiesForFullNoDebtRecurring({ amount: 500, amount_owed: undefined }),
    ).toBe(false)
  })

  it('applies confirmed Current / Potential / Full No Debt formulas', () => {
    const properties = [
      {
        id: 'a',
        insurance_premium: 50, // monthly as stored — never ÷12
        property_tax: 100,
        tax_paid_amount_current: 0,
        tax_paid_amount_previous: 0,
        tax_color_state: 0, // monthly tax = 1200/12 = 100
      },
      {
        id: 'b',
        insurance_premium: 25,
        property_tax: 80,
        tax_paid_amount_current: 0,
        tax_color_state: 1, // waived in tax section
      },
    ]

    const expenses = [
      {
        id: 'r1',
        category: 'Mortgage',
        amount: 1000,
        amount_owed: 50000,
        interest_rate: 0.05,
      },
      {
        id: 'r2',
        category: 'Paid Off Loan',
        amount: 200,
        amount_owed: 0,
        interest_rate: 0.05,
      },
      {
        id: 'r3',
        category: 'Legacy balance filter bait',
        amount: 300,
        amount_owed: 10,
        balance: -5, // old Full/No Debt used balance <= 0; must use amount_owed
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

    expect(profit.monthlyInsurance).toBe(75) // 50+25, no ÷12
    expect(profit.monthlyTaxes).toBe(100) // only property a; b waived
    expect(sumMonthlyTaxPayments(properties)).toBe(profit.monthlyTaxes)

    expect(profit.recurringMonthlyPayments).toBe(1500) // 1000+200+300
    expect(profit.fullNoDebtRecurringPayments).toBe(1300) // 1000+300 (owed>0); excludes r2
    expect(profit.currentMonthOneTimeExpenses).toBe(75) // excludes August 999
    expect(profit.currentMonthMiscIncome).toBe(40)

    // Current = 10000 + 40 − 75 − 100 − 1500 − 75 = 8290
    expect(profit.currentProfit).toBe(8290)
    // Potential = Current + potential rent
    expect(profit.potentialProfit).toBe(9790)
    expect(profit.potentialProfit - profit.currentProfit).toBe(1500)

    // Full / No Debt = 10000 + 1500 + 40 − 75 − 100 − 1300 − 75 = 9990
    expect(profit.fullNoDebtProfit).toBe(9990)
    expect(profit.potentialProfitNoHouseDebt).toBe(9990)

    expect(profit.contributing.oneTimeCurrentMonth.map((r) => r.id)).toEqual([
      'ot-cur',
    ])
    expect(profit.contributing.recurringFullNoDebt.map((r) => r.id)).toEqual([
      'r1',
      'r3',
    ])
  })
})
