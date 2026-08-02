import fs from 'fs'
import path from 'path'
import { isEligibleEmptyPotentialProperty } from '@/lib/lease-status'

describe('dashboard potential income + loading UX', () => {
  const page = fs.readFileSync(
    path.join(process.cwd(), 'src/app/page.tsx'),
    'utf8',
  )
  const sessionState = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/auth/session-state.ts'),
    'utf8',
  )

  it('does not show Checking sign-in while authenticated dashboard data loads', () => {
    expect(sessionState).toContain('data_pending')
    expect(page).toContain('data-testid="dashboard-data-pending"')
    expect(page).toContain('Loading dashboard…')
    expect(page).toContain('isEligibleEmptyPotentialProperty')
  })

  it('Potential Income card uses emptyPotentialIncome (not totalPotentialIncome)', () => {
    expect(page).toContain('data-testid="dashboard-empty-potential"')
    expect(page).toContain('emptyPotentialIncome')
    expect(page).toMatch(/metrics\?\.emptyPotentialIncome/)
  })

  it('empty eligibility matches API: rent_value > 1 and no occupied/eviction lease', () => {
    expect(
      isEligibleEmptyPotentialProperty({
        propertyType: 'house',
        propertyStatus: 'active',
        rentValue: 800,
        hasPhysicallyOccupiedLease: false,
        hasSoldLease: false,
      }),
    ).toBe(true)
    expect(
      isEligibleEmptyPotentialProperty({
        propertyType: 'house',
        propertyStatus: 'active',
        rentValue: 1,
        hasPhysicallyOccupiedLease: false,
        hasSoldLease: false,
      }),
    ).toBe(false)
    expect(
      isEligibleEmptyPotentialProperty({
        propertyType: 'house',
        propertyStatus: 'active',
        rentValue: 800,
        hasPhysicallyOccupiedLease: true,
        hasSoldLease: false,
      }),
    ).toBe(false)
  })
})
