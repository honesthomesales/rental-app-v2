import { test, expect, type Page } from '@playwright/test'

async function assertLoginPage(page: Page) {
  await expect(page.getByRole('heading', { name: 'Honest Home Sales' })).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await expect(page).not.toHaveURL(/\/logout/)
  const status = await page.evaluate(() => document.title)
  expect(status.toLowerCase()).not.toContain('404')
}

test.describe('mobile authentication hotfix', () => {
  test('missing session redirects to sign-in (desktop chromium)', async ({
    page,
  }) => {
    const res = await page.goto('/')
    expect(res?.status()).toBeLessThan(400)
    await page.waitForURL(/\/login/)
    await assertLoginPage(page)
  })

  test('login route never 404s', async ({ page }) => {
    const res = await page.goto('/login')
    expect(res?.ok()).toBeTruthy()
    await assertLoginPage(page)
  })

  test('logout destination /login exists (no 404)', async ({ page }) => {
    const res = await page.goto('/login')
    expect(res?.status()).toBe(200)
    await assertLoginPage(page)
    await expect(page.getByRole('heading', { name: '404' })).toHaveCount(0)
  })

  test('POST /api/auth/logout does not 404', async ({ request }) => {
    const res = await request.post('/api/auth/logout')
    expect(res.status()).not.toBe(404)
    expect([200, 500]).toContain(res.status())
  })

  test('unauthenticated payments does not show No active leases found', async ({
    page,
  }) => {
    await page.goto('/payments')
    await page.waitForURL(/\/login/)
    await expect(page.getByText('No active leases found')).toHaveCount(0)
    await assertLoginPage(page)
  })

  test('unauthenticated dashboard does not show legitimate zeros grid', async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForURL(/\/login/)
    await expect(page.getByText('Dashboard 1.4')).toHaveCount(0)
    await assertLoginPage(page)
  })

  test('mobile chrome viewport: auth gate identical to desktop', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/payments')
    await page.waitForURL(/\/login/)
    await assertLoginPage(page)
  })

  test('installed/standalone mode: auth gate identical', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
          matches: query.includes('display-mode: standalone'),
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }),
      })
    })
    await page.goto('/')
    await page.waitForURL(/\/login/)
    await assertLoginPage(page)
  })
})

test.describe('authenticated flows (optional credentials)', () => {
  const email = process.env.E2E_USER_EMAIL
  const password = process.env.E2E_USER_PASSWORD

  test.skip(!email || !password, 'Requires E2E_USER_EMAIL and E2E_USER_PASSWORD')

  test('valid session loads payments leases and shows identity', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(email!)
    await page.getByLabel('Password').fill(password!)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL((url) => !url.pathname.includes('/login'), {
      timeout: 60_000,
    })
    await expect(page.getByTestId('auth-status-label')).toContainText(
      /Signed in as/i,
      { timeout: 30_000 },
    )
    await page.goto('/payments')
    await expect(page.getByText('No active leases found')).toHaveCount(0)
    await expect(page.getByTestId('payments-auth-required')).toHaveCount(0)
    await expect(page.getByTestId('payments-load-error')).toHaveCount(0)
  })

  test('logout signs out and redirects to sign-in without 404', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(email!)
    await page.getByLabel('Password').fill(password!)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL((url) => !url.pathname.includes('/login'), {
      timeout: 60_000,
    })
    await page.getByTestId('sign-out-button').click()
    await page.waitForURL(/\/login/, { timeout: 30_000 })
    await assertLoginPage(page)
    const res = await page.goto('/login')
    expect(res?.status()).toBe(200)
  })
})
