import { test, expect, type Page } from '@playwright/test'

async function probeOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    const body = document.body
    const scrollW = Math.max(doc.scrollWidth, body.scrollWidth)
    const clientW = doc.clientWidth
    let widest: { tag: string; w: number; cls: string; testId: string | null } | null =
      null
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (!widest || r.width > widest.w) {
        widest = {
          tag: el.tagName.toLowerCase(),
          w: Math.round(r.width),
          cls: (el as HTMLElement).className?.toString?.().slice(0, 80) || '',
          testId: el.getAttribute('data-testid'),
        }
      }
    })
    return {
      overflowPx: scrollW - clientW,
      scrollW,
      clientW,
      widest,
      hasLastPaidScroller: Boolean(
        document.querySelector('[data-testid="last-paid-table-scroller"]'),
      ),
      hasProfitScroller: Boolean(
        document.querySelector('[data-testid="profit-totals-table-scroller"]'),
      ),
    }
  })
}

test.describe('Stage A — Deals / Docs consolidation', () => {
  test('combined nav and page toggle with URL state', async ({ page }) => {
    await page.goto('/deals-docs?view=deals', { waitUntil: 'domcontentloaded' })
    if (page.url().includes('/login')) {
      test.skip(true, 'Requires authenticated session')
      return
    }
    await expect(page.getByRole('heading', { name: 'Deals / Docs' })).toBeVisible()
    await expect(page.getByTestId('deals-docs-toggle-deals')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.getByTestId('deals-docs-toggle-docs').click()
    await expect(page).toHaveURL(/view=docs/)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/view=docs/)
    await page.goBack()
    await expect(page).toHaveURL(/view=deals/)
  })

  test('legacy /deals and /documents redirect', async ({ page }) => {
    await page.goto('/deals', { waitUntil: 'domcontentloaded' })
    if (page.url().includes('/login')) {
      await expect(page).toHaveURL(/\/login/)
      return
    }
    await expect(page).toHaveURL(/\/deals-docs\?view=deals/)
    await page.goto('/documents', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/deals-docs\?view=docs/)
  })

  test('nav has single Deals / Docs item', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    // Login page has no nav; check authenticated shell via redirect target markup not available.
    // After auth middleware, unauthenticated protected routes redirect to login.
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    if (page.url().includes('/login')) {
      test.skip(true, 'Requires authenticated session for nav assertion')
      return
    }
    const nav = page.locator('nav')
    await expect(nav.getByRole('link', { name: 'Deals / Docs' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Deal', exact: true })).toHaveCount(0)
  })
})

test.describe('Stage A — table overflow matrix', () => {
  const widths = [320, 360, 375, 390, 412, 430] as const

  for (const width of widths) {
    test(`last-paid reachable columns at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/tenant-accounts?view=last-paid', {
        waitUntil: 'domcontentloaded',
      })
      if (page.url().includes('/login')) {
        test.skip(true, 'Requires authenticated session')
        return
      }
      const scroller = page.getByTestId('last-paid-table-scroller')
      await expect(scroller).toBeVisible()
      await expect(page.getByText('Payment method').first()).toBeAttached()
      await expect(page.getByText('Current balance').first()).toBeAttached()
      await expect(page.getByText('View history').first()).toBeAttached()
      await expect(page.getByText('Text Tenant').first()).toBeAttached()
      // Scroll scroller to end so last columns are reachable
      await scroller.evaluate((el) => {
        el.scrollLeft = el.scrollWidth
      })
      const probe = await probeOverflow(page)
      expect(
        probe.overflowPx,
        `page overflow at ${width}: ${JSON.stringify(probe.widest)}`,
      ).toBeLessThanOrEqual(1)
    })

    test(`profit totals reachable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/profit', { waitUntil: 'domcontentloaded' })
      if (page.url().includes('/login')) {
        test.skip(true, 'Requires authenticated session')
        return
      }
      // Monthly detail view should expose the income table when present
      const scroller = page.getByTestId('profit-totals-table-scroller')
      if ((await scroller.count()) === 0) {
        // Rolling view months may be default; still assert no page overflow
        const probe = await probeOverflow(page)
        expect(probe.overflowPx).toBeLessThanOrEqual(1)
        return
      }
      await scroller.evaluate((el) => {
        el.scrollLeft = el.scrollWidth
      })
      await expect(page.getByText('Total Income').first()).toBeAttached()
      const probe = await probeOverflow(page)
      expect(probe.overflowPx).toBeLessThanOrEqual(1)
    })
  }

  test('200% text zoom last-paid columns reachable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => {
      document.documentElement.style.fontSize = '200%'
    })
    await page.goto('/tenant-accounts?view=last-paid', {
      waitUntil: 'domcontentloaded',
    })
    if (page.url().includes('/login')) {
      test.skip(true, 'Requires authenticated session')
      return
    }
    const scroller = page.getByTestId('last-paid-table-scroller')
    await expect(scroller).toBeVisible()
    await scroller.evaluate((el) => {
      el.scrollLeft = el.scrollWidth
    })
    const probe = await probeOverflow(page)
    expect(probe.overflowPx).toBeLessThanOrEqual(1)
  })
})
