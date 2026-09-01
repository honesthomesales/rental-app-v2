import fs from 'fs'
import path from 'path'

describe('PWA production cache refresh', () => {
  const serviceWorker = fs.readFileSync(
    path.join(process.cwd(), 'public/sw.js'),
    'utf8',
  )
  const installer = fs.readFileSync(
    path.join(process.cwd(), 'src/components/PWAInstaller.tsx'),
    'utf8',
  )

  it('activates a versioned cache immediately and removes older caches', () => {
    expect(serviceWorker).toContain("CACHE_NAME = 'rental-app-v2-2026-08-31-profit'")
    expect(serviceWorker).toContain('self.skipWaiting()')
    expect(serviceWorker).toContain('self.clients.claim()')
    expect(serviceWorker).toContain('caches.delete(cacheName)')
  })

  it('uses the network first for page navigations while retaining offline fallback', () => {
    expect(serviceWorker).toContain("event.request.mode !== 'navigate'")
    expect(serviceWorker).toContain('fetch(event.request)')
    expect(serviceWorker).toContain("cached.match('/')")
  })

  it('does not intercept API routes or Next.js bundles', () => {
    expect(serviceWorker).toContain("url.includes('/api/')")
    expect(serviceWorker).toContain("url.includes('/_next/')")
  })

  it('bypasses the HTTP cache when checking for an updated worker', () => {
    expect(installer).toContain("updateViaCache: 'none'")
    expect(installer).toContain('registration.update()')
    expect(installer).toContain("'controllerchange'")
  })
})
