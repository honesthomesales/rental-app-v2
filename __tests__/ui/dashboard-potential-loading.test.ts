import fs from 'fs'
import path from 'path'

describe('dashboard potential income + loading UX', () => {
  const page = fs.readFileSync(
    path.join(process.cwd(), 'src/app/page.tsx'),
    'utf8',
  )
  const sessionState = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/auth/session-state.ts'),
    'utf8',
  )
  const metricsRoute = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/dashboard/metrics/route.ts'),
    'utf8',
  )

  it('does not show Checking sign-in while authenticated dashboard data loads', () => {
    expect(sessionState).toContain('data_pending')
    expect(page).toContain('data-testid="dashboard-data-pending"')
    expect(page).toContain('Loading dashboard…')
    expect(page).toContain('metrics?.potentialIncomeRows || []')
  })

  it('Potential Income card uses the combined API potential total and row count', () => {
    expect(page).toContain('data-testid="dashboard-potential-income"')
    expect(page).toContain('data-testid="dashboard-potential-income-count"')
    expect(page).toMatch(/metrics\?\.potentialIncome/)
    expect(page).toContain('potentialIncomeRows.length')
  })

  it('expandable list and modal render the same combined API rows', () => {
    expect(page).toContain('data-testid="potential-income-list-row"')
    expect(page).toContain('data-testid="potential-income-modal-row"')
    expect(page).toContain('data-testid="potential-income-modal-total"')
    expect(page).not.toContain('setPotentialIncomeProperties')
    expect(page).not.toContain("filter((row) => row.status === 'empty')")
    expect(metricsRoute).toContain('buildEmptyPotentialSummary')
    expect(metricsRoute).toContain('sumPotentialIncomeRows')
    expect(metricsRoute).toContain('emptyPotentialCount')
    expect(metricsRoute).toContain('const potentialIncomeRows = [...emptyPotentialRows, ...evictionRows]')
    expect(metricsRoute).toContain('const potentialIncome = sumPotentialIncomeRows(potentialIncomeRows)')
  })
})
