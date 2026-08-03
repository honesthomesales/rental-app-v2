import fs from 'fs'
import path from 'path'

describe('mobile table scroll CSS', () => {
  const css = fs.readFileSync(
    path.join(process.cwd(), 'src/app/globals.css'),
    'utf8',
  )
  const lastPaid = fs.readFileSync(
    path.join(process.cwd(), 'src/components/tenant-accounts/LastPaidPanel.tsx'),
    'utf8',
  )
  const profit = fs.readFileSync(
    path.join(process.cwd(), 'src/app/profit/page.tsx'),
    'utf8',
  )
  const payments = fs.readFileSync(
    path.join(process.cwd(), 'src/app/payments/page.tsx'),
    'utf8',
  )
  const shell = fs.readFileSync(
    path.join(process.cwd(), 'src/components/AppShell.tsx'),
    'utf8',
  )

  it('does not force all mobile tables to max-width 100%', () => {
    // Guard against the regression that collapsed Last Paid / Profit tables.
    expect(css).not.toMatch(/\n\s*table\s*\{\s*\n\s*max-width:\s*100%;/)
  })

  it('defines table-scroll-x helper that keeps tables unconstrained', () => {
    expect(css).toContain('.table-scroll-x')
    expect(css).toContain('.table-scroll-x > table')
    expect(css).toContain('max-width: none')
    expect(css).toContain('-webkit-overflow-scrolling: touch')
    expect(css).toContain('touch-action: pan-x pan-y')
  })

  it('Last Paid renders all eight table columns on phones', () => {
    expect(lastPaid).toContain('data-testid="last-paid-table-scroller"')
    expect(lastPaid).toContain('table-scroll-x')
    expect(lastPaid).not.toContain('data-testid="last-paid-mobile-cards"')
    expect(lastPaid).not.toContain('hidden md:block table-scroll-x')
    expect(lastPaid).toMatch(/min-w-\[1100px\]/)
    for (const header of [
      'Tenant',
      'Property',
      'Most recent payment',
      'Payment amount',
      'Payment method',
      'Current balance',
      'View history',
      'Text Tenant',
    ]) {
      expect(lastPaid).toContain(header)
    }
    expect(lastPaid).toContain("handleSort('tenant')")
    expect(lastPaid).toContain("handleSort('property')")
    expect(lastPaid).toContain("handleSort('lastPaid')")
    expect(lastPaid).toContain("handleSort('totalOwed')")
    expect(lastPaid).toContain('<TenantCommunicationActions')
  })

  it('Profit keeps all five sortable columns in its phone table', () => {
    expect(profit).toContain('data-testid="profit-totals-table-scroller"')
    expect(profit).toContain('table-scroll-x')
    expect(profit).not.toContain('data-testid="profit-property-cards"')
    expect(profit).toMatch(/min-w-\[900px\]/)
    for (const header of [
      'Property',
      'Expected Rent',
      'Rent Collected',
      'Misc Income',
      'Total Income',
    ]) {
      expect(profit).toContain(header)
    }
    for (const field of [
      'property',
      'expected_rent',
      'rent_collected',
      'misc_income',
      'total_income',
    ]) {
      expect(profit).toContain(`handleSort('${field}')`)
    }
    expect(profit).toContain('md:sticky md:left-0')
  })

  it('Payments stacks all invoice actions below a visible phone close button', () => {
    expect(payments).toContain('data-testid="invoice-modal-header"')
    expect(payments).toContain('data-testid="invoice-modal-actions"')
    expect(payments).toContain('grid w-full grid-cols-1')
    expect(payments).toContain('Review Missing Invoices')
    expect(payments).toContain('+ Add Invoice')
    expect(payments).toContain('<span>Edit Invoice</span>')
    expect(payments).toContain('aria-label="Close invoice details"')
    expect(payments).toContain('void reviewMissingInvoices()')
    expect(payments).toContain('setShowAddInvoiceModal(true)')
    expect(payments).toContain('openInvoiceEditor()')
  })

  it('AppShell main does not clip nested horizontal scrollers', () => {
    expect(shell).not.toMatch(/main className="[^"]*overflow-x-hidden/)
  })
})
