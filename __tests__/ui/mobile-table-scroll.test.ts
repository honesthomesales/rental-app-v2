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
  })

  it('Last Paid and Profit use scrollable table wrappers', () => {
    expect(lastPaid).toContain('data-testid="last-paid-table-scroller"')
    expect(lastPaid).toContain('table-scroll-x')
    expect(lastPaid).toContain('data-testid="last-paid-mobile-cards"')
    expect(lastPaid).toMatch(/min-w-\[1100px\]/)
    expect(profit).toContain('data-testid="profit-totals-table-scroller"')
    expect(profit).toContain('table-scroll-x')
    expect(profit).not.toContain('data-testid="profit-property-cards"')
    expect(profit).toMatch(/min-w-\[900px\]/)
  })

  it('AppShell main does not clip nested horizontal scrollers', () => {
    expect(shell).not.toMatch(/main className="[^"]*overflow-x-hidden/)
  })
})
