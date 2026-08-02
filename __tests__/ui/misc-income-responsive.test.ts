import fs from 'fs'
import path from 'path'

describe('misc income + responsive screen markers', () => {
  const root = process.cwd()
  const classification = fs.readFileSync(
    path.join(root, 'src/lib/expenses/classification.ts'),
    'utf8',
  )
  const profitMetrics = fs.readFileSync(
    path.join(root, 'src/app/api/profit/metrics/route.ts'),
    'utf8',
  )
  const dashboard = fs.readFileSync(
    path.join(root, 'src/app/api/dashboard/metrics/route.ts'),
    'utf8',
  )
  const expensesPage = fs.readFileSync(path.join(root, 'src/app/expenses/page.tsx'), 'utf8')
  const paymentsPage = fs.readFileSync(path.join(root, 'src/app/payments/page.tsx'), 'utf8')
  const profitPage = fs.readFileSync(path.join(root, 'src/app/profit/page.tsx'), 'utf8')
  const lastPaid = fs.readFileSync(
    path.join(root, 'src/components/tenant-accounts/LastPaidPanel.tsx'),
    'utf8',
  )

  it('exports shared Misc Income / one-time sentinels', () => {
    expect(classification).toContain('MISC_INCOME_RATE = 9.9999')
    expect(classification).toContain('ONE_TIME_EXPENSE_RATE = -9.9999')
    expect(classification).toContain('export function isRecurringExpense')
  })

  it('excludes misc from profit debt via isRecurringExpense', () => {
    expect(profitMetrics).toContain('isRecurringExpense')
    expect(profitMetrics).toContain('MISC_INCOME_RATE')
    expect(profitMetrics).toContain('Unassigned / Portfolio')
  })

  it('dashboard excludes misc from debt and credits currentMonthMiscIncome', () => {
    expect(dashboard).toContain('isRecurringExpense')
    expect(dashboard).toContain('isMiscIncome')
    expect(dashboard).toContain('currentMonthMiscIncome')
  })

  it('expenses page separates Misc Income from recurring expenses', () => {
    expect(expensesPage).toContain('isMiscIncome')
    expect(expensesPage).toContain('data-testid="expenses-misc-income-section"')
    expect(expensesPage).toContain('data-testid="expenses-summary-cards"')
  })

  it('payments uses MISC_INCOME_RATE and wraps action buttons', () => {
    expect(paymentsPage).toContain('MISC_INCOME_RATE')
    expect(paymentsPage).toContain('data-testid="add-misc-income-button"')
    expect(paymentsPage).toContain('data-testid="payments-action-buttons"')
  })

  it('profit page has error/retry and mobile cards (no stuck Loading)', () => {
    expect(profitPage).toContain('data-testid="profit-metrics-error"')
    expect(profitPage).toContain('data-testid="profit-property-cards"')
    expect(profitPage).toContain('Retry')
    expect(profitPage).not.toMatch(/monthlyMetrics \? `No property[^`]+` : 'Loading\.\.\.'/)
  })

  it('Last Paid uses mobile cards without sticky tenant column on narrow screens', () => {
    expect(lastPaid).toContain('data-testid="last-paid-mobile-cards"')
    expect(lastPaid).toContain('hidden md:block table-scroll-x')
    expect(lastPaid).not.toContain('sticky left-0 z-10 bg-white px-4 py-3')
  })
})
