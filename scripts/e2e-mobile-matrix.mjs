/**
 * Route inventory + static mobile matrix gate for production screens.
 * Full Chromium/WebKit visual pass still required before live deploy smoke.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const VIEWPORTS = [320, 360, 375, 390, 412, 430]
const ROUTES = [
  '/',
  '/tenant-accounts?view=late',
  '/tenant-accounts?view=last-paid',
  '/late-tenants',
  '/last-paid',
  '/properties',
  '/tenants',
  '/leases',
  '/payments',
  '/profit',
  '/expenses',
  '/data-health',
  '/documents',
  '/deals',
  '/communication-approvals',
  '/pay/test-token',
]

const engines = ['chromium', 'webkit']
const orientations = ['portrait', 'landscape-phone', 'tablet-portrait', 'tablet-landscape']

const matrix = []
for (const engine of engines) {
  for (const route of ROUTES) {
    for (const width of VIEWPORTS) {
      for (const orientation of orientations) {
        matrix.push({
          engine,
          route,
          width,
          orientation,
          textZoom: '200%',
          status: 'inventoried',
          notes:
            'Static inventory gate. Live smoke confirms scroll/reachability after deploy.',
        })
      }
    }
  }
}

const outDir = join(process.cwd(), 'test-results')
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, 'mobile-route-matrix.json')
writeFileSync(
  outFile,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      routeCount: ROUTES.length,
      viewportCount: VIEWPORTS.length,
      cellCount: matrix.length,
      routes: ROUTES,
      viewports: VIEWPORTS,
      matrix,
    },
    null,
    2,
  ),
)

console.log(`E2E mobile matrix inventoried: ${matrix.length} cells → ${outFile}`)
console.log('Routes:', ROUTES.join(', '))
process.exit(0)
