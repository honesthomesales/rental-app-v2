import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PHONE_WIDTHS = [320, 360, 375, 390, 412, 430] as const

const ACTIVE_ROUTES = [
  { name: 'Dashboard', path: '/' },
  { name: 'Tenant Accounts Late', path: '/tenant-accounts?view=late' },
  { name: 'Tenant Accounts Last Paid', path: '/tenant-accounts?view=last-paid' },
  { name: 'Properties', path: '/properties' },
  { name: 'Tenants', path: '/tenants' },
  { name: 'Leases', path: '/leases' },
  { name: 'Payments', path: '/payments' },
  { name: 'Expenses', path: '/expenses' },
  { name: 'Profit', path: '/profit' },
  { name: 'Deals', path: '/deals' },
  { name: 'Documents', path: '/documents' },
  { name: 'Data Health', path: '/data-health' },
] as const

type MatrixRow = {
  engine: string
  route: string
  width: number
  height: number
  textZoom: string
  status: 'pass' | 'fail'
  notes: string
}

const matrix: MatrixRow[] = []

async function assertNoPageHorizontalOverflow(page: Page, route: string) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement
    const body = document.body
    const scrollW = Math.max(doc.scrollWidth, body.scrollWidth)
    const clientW = doc.clientWidth
    let widest: { tag: string; w: number; cls: string } | null = null
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.width > (widest?.w || 0)) {
        widest = {
          tag: el.tagName.toLowerCase(),
          w: Math.round(r.width),
          cls: (el as HTMLElement).className?.toString?.().slice(0, 80) || '',
        }
      }
    })
    return { scrollW, clientW, overflowPx: scrollW - clientW, widest }
  })
  expect(
    overflow.overflowPx,
    `${route}: page-level horizontal overflow ${overflow.overflowPx}px (scroll=${overflow.scrollW}, client=${overflow.clientW}, widest=${JSON.stringify(overflow.widest)})`,
  ).toBeLessThanOrEqual(1)
}

async function assertVerticalScrollReachable(page: Page) {
  const metrics = await page.evaluate(async () => {
    const se = (document.scrollingElement || document.documentElement) as HTMLElement
    const maxScroll = Math.max(0, se.scrollHeight - se.clientHeight)
    const before = se.scrollTop
    se.scrollTop = maxScroll
    // WebKit sometimes needs a second assignment after layout
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    se.scrollTop = maxScroll
    await new Promise((r) => setTimeout(r, 150))
    return {
      before,
      scrollTop: se.scrollTop,
      maxScroll,
      scrollHeight: se.scrollHeight,
      clientHeight: se.clientHeight,
    }
  })
  if (metrics.maxScroll > 80) {
    // Sticky chrome can leave a few pixels; require a material downward scroll.
    expect(
      metrics.scrollTop,
      `expected downward scroll (top=${metrics.scrollTop}, max=${metrics.maxScroll}, before=${metrics.before})`,
    ).toBeGreaterThan(Math.min(metrics.maxScroll - 20, metrics.maxScroll * 0.4))
  }
}

async function visitAndCheck(
  page: Page,
  engine: string,
  route: string,
  width: number,
  height: number,
  textZoom: string,
) {
  await page.setViewportSize({ width, height })
  if (textZoom === '200%') {
    await page.addInitScript(() => {
      document.documentElement.style.fontSize = '200%'
    })
  }
  const response = await page.goto(route, { waitUntil: 'domcontentloaded' })
  const status = response?.status() ?? 0
  expect(status, `${route} HTTP status`).toBeLessThan(500)
  await page.waitForTimeout(250)
  // Auth middleware may send unauthenticated sessions to /login — still validate layout.
  const effectiveRoute = page.url().includes('/login') ? '/login' : route
  try {
    await assertNoPageHorizontalOverflow(page, effectiveRoute)
    await assertVerticalScrollReachable(page)
    matrix.push({
      engine,
      route: effectiveRoute,
      width,
      height,
      textZoom,
      status: 'pass',
      notes: `http=${status}; requested=${route}`,
    })
  } catch (err) {
    matrix.push({
      engine,
      route: effectiveRoute,
      width,
      height,
      textZoom,
      status: 'fail',
      notes: String(err),
    })
    throw err
  }
}

test.describe('Screen release — redirects and chrome', () => {
  test('late-tenants requires auth then Tenant Accounts late view', async ({
    page,
  }) => {
    await page.goto('/late-tenants', { waitUntil: 'domcontentloaded' })
    if (page.url().includes('/login')) {
      await expect(page).toHaveURL(/\/login/)
      await expect(
        page.getByRole('heading', { name: 'Honest Home Sales' }),
      ).toBeVisible()
      return
    }
    await expect(page).toHaveURL(/\/tenant-accounts\?view=late/)
  })

  test('last-paid requires auth then Tenant Accounts last-paid view', async ({
    page,
  }) => {
    await page.goto('/last-paid', { waitUntil: 'domcontentloaded' })
    if (page.url().includes('/login')) {
      await expect(page).toHaveURL(/\/login/)
      return
    }
    await expect(page).toHaveURL(/\/tenant-accounts\?view=last-paid/)
  })

  test('nav has Tenant Accounts when signed in; otherwise login gate', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    if (page.url().includes('/login')) {
      await expect(
        page.getByRole('heading', { name: 'Honest Home Sales' }),
      ).toBeVisible()
      return
    }
    const nav = page.locator('nav')
    await expect(nav.getByRole('link', { name: 'Tenant Accounts' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Late Tenants', exact: true })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Last Paid', exact: true })).toHaveCount(0)
  })

  test('unfinished pay route is not available', async ({ page }) => {
    const res = await page.goto('/pay/test-token', { waitUntil: 'domcontentloaded' })
    // Auth middleware may redirect to login first; either way pay UI must not appear.
    if (page.url().includes('/login')) {
      await expect(page.getByText(/continue to payment/i)).toHaveCount(0)
      return
    }
    const status = res?.status() ?? 0
    expect(status).toBeGreaterThanOrEqual(400)
    const body = ((await page.textContent('body')) || '').toLowerCase()
    expect(body).not.toMatch(/continue to payment/)
    expect(body).not.toMatch(/cash app pay — unavailable/)
  })
})

test.describe('Tenant Accounts toggle', () => {
  test('toggle switches view via URL and preserves on refresh', async ({ page }) => {
    await page.goto('/tenant-accounts?view=late', { waitUntil: 'networkidle' })
    if (page.url().includes('/login')) {
      test.skip(true, 'Requires authenticated session')
      return
    }
    await expect(page.getByRole('heading', { name: 'Tenant Accounts' })).toBeVisible()
    const lateBtn = page.getByRole('button', { name: 'Late Tenants' })
    const lastBtn = page.getByRole('button', { name: 'Last Paid' })
    await expect(lateBtn).toBeVisible()
    await expect(lastBtn).toBeVisible()
    await lastBtn.click()
    await expect(page).toHaveURL(/view=last-paid/, { timeout: 20_000 })
    await expect(lastBtn).toHaveAttribute('aria-pressed', 'true')
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page).toHaveURL(/view=last-paid/)
    await lateBtn.click()
    await expect(page).toHaveURL(/view=late/, { timeout: 20_000 })
    await expect(lateBtn).toHaveAttribute('aria-pressed', 'true')
  })

  test('browser back restores previous toggle state', async ({ page }) => {
    await page.goto('/tenant-accounts?view=late', { waitUntil: 'networkidle' })
    if (page.url().includes('/login')) {
      test.skip(true, 'Requires authenticated session')
      return
    }
    await page.getByRole('button', { name: 'Last Paid' }).click()
    await expect(page).toHaveURL(/view=last-paid/, { timeout: 20_000 })
    await page.goBack()
    await expect(page).toHaveURL(/view=late/, { timeout: 20_000 })
    await page.goForward()
    await expect(page).toHaveURL(/view=last-paid/, { timeout: 20_000 })
  })
})

test.describe('Dashboard screen enhancements', () => {
  test('API version label absent; whole-dollar cards and Missing Information present', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    if (page.url().includes('/login')) {
      test.skip(true, 'Requires authenticated session')
      return
    }
    const body = (await page.textContent('body')) || ''
    expect(body).not.toContain('API: v6.0-portfolio-ledger')
    await expect(page.getByRole('button', { name: /Missing Information/i })).toBeVisible()
    await expect(page.getByText('Monthly Income').first()).toBeVisible()
    await expect(page.getByText('Dashboard', { exact: false }).first()).toBeVisible()
    // Profit card label (avoid matching longer phrases)
    await expect(page.locator('p.text-sm.font-medium.text-gray-500', { hasText: /^Profit$/ })).toBeVisible({
      timeout: 20_000,
    })
  })
})

test.describe('Call Tenant removed / Text Tenant present in bundle surface', () => {
  for (const route of ['/tenants', '/leases', '/payments', '/tenant-accounts?view=late']) {
    test(`no Call Tenant control on ${route}`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'domcontentloaded' })
      if (page.url().includes('/login')) {
        await expect(page.getByRole('button', { name: 'Call Tenant' })).toHaveCount(0)
        return
      }
      await expect(page.getByRole('link', { name: 'Call Tenant' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Call Tenant' })).toHaveCount(0)
    })
  }
})

test.describe('Viewport matrix', () => {
  for (const width of PHONE_WIDTHS) {
    test(`portrait ${width}px all active routes`, async ({ page }, testInfo) => {
      const engine = testInfo.project.name
      for (const route of ACTIVE_ROUTES) {
        await visitAndCheck(page, engine, route.path, width, 720, '100%')
      }
    })
  }

  test('phone landscape 740x360', async ({ page }, testInfo) => {
    for (const route of ACTIVE_ROUTES) {
      await visitAndCheck(page, testInfo.project.name, route.path, 740, 360, '100%')
    }
  })

  test('tablet portrait 768x1024', async ({ page }, testInfo) => {
    for (const route of ACTIVE_ROUTES) {
      await visitAndCheck(page, testInfo.project.name, route.path, 768, 1024, '100%')
    }
  })

  test('tablet landscape 1024x768', async ({ page }, testInfo) => {
    for (const route of ACTIVE_ROUTES) {
      await visitAndCheck(page, testInfo.project.name, route.path, 1024, 768, '100%')
    }
  })

  test('200% text zoom at 390px on primary screens', async ({ page }, testInfo) => {
    const primary = [
      '/',
      '/tenant-accounts?view=late',
      '/tenant-accounts?view=last-paid',
      '/properties',
      '/tenants',
      '/leases',
      '/payments',
      '/profit',
    ]
    for (const path of primary) {
      await visitAndCheck(page, testInfo.project.name, path, 390, 844, '200%')
    }
  })
})

test.afterAll(() => {
  const outDir = join(process.cwd(), 'test-results')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(
    join(outDir, 'mobile-route-matrix-executed.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        executed: true,
        cellCount: matrix.length,
        passCount: matrix.filter((r) => r.status === 'pass').length,
        failCount: matrix.filter((r) => r.status === 'fail').length,
        matrix,
      },
      null,
      2,
    ),
  )
})
