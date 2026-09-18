const fs = require('fs')
const path = require('path')

describe('owed amount display sources stay on portfolio ledger', () => {
  const paymentsPage = fs.readFileSync(
    path.join(process.cwd(), 'src/app/payments/page.tsx'),
    'utf8',
  )
  const latePanel = fs.readFileSync(
    path.join(process.cwd(), 'src/components/tenant-accounts/LateTenantsPanel.tsx'),
    'utf8',
  )
  const lateRoute = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/late-tenants/route.ts'),
    'utf8',
  )

  it('Payments invoice open uses ledger totals and does not auto-generate missing invoices', () => {
    expect(paymentsPage).toContain('totalBalanceDue')
    expect(paymentsPage).toContain('calculatedBalance')
    expect(paymentsPage).toContain('eligiblePaidAmount')
    expect(paymentsPage).toContain(
      'Do not auto-generate missing invoices here',
    )
  })

  it('Late Tenants uses server business date and accountTotalOwed for Total Owed', () => {
    expect(latePanel).not.toContain('today=${today}')
    expect(latePanel).toContain('/api/late-tenants?t=${timestamp}')
    expect(latePanel).toContain('accountTotalOwed ?? tenant.totalOwedLate')
    expect(lateRoute).toContain('getBusinessDate()')
    expect(lateRoute).not.toContain('todayParam')
  })
})
