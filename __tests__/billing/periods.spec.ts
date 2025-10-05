/**
 * Unit tests for rental period generation logic
 */

import { generatePeriodsForLease } from '../../src/lib/rent/periods'

// Mock environment variables
const originalEnv = process.env

describe('Rental Period Generation', () => {
  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('Weekly Leases', () => {
    test('should generate active periods for every Friday within lease range', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
      
      const lease = {
        id: 'weekly-lease-1',
        lease_start_date: '2024-07-16', // Tuesday
        lease_end_date: '2024-08-16',
        rent_cadence: 'weekly',
        rent: 500,
        rent_due_day: undefined
      }

      const fridays = [
        '2024-07-19', // First Friday after start
        '2024-07-26',
        '2024-08-02',
        '2024-08-09',
        '2024-08-16' // Last Friday before end
      ]

      const periods = generatePeriodsForLease(lease, fridays)
      
      // All Fridays within lease should be active
      expect(periods).toHaveLength(5)
      expect(periods.every(p => p.isActive)).toBe(true)
      expect(periods.every(p => p.cadence === 'weekly')).toBe(true)
    })

    test('should handle payments on Sunday belonging to upcoming Friday', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
      
      const lease = {
        id: 'weekly-lease-2',
        lease_start_date: '2024-07-15', // Monday
        lease_end_date: '2024-08-15',
        rent_cadence: 'weekly',
        rent: 600,
        rent_due_day: undefined
      }

      const fridays = ['2024-07-19', '2024-07-26']
      const periods = generatePeriodsForLease(lease, fridays)
      
      expect(periods[0].isActive).toBe(true)
      expect(periods[1].isActive).toBe(true)
    })
  })

  describe('Bi-Weekly Leases', () => {
    test('should generate active periods every 14 days from anchor Friday', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
      
      const lease = {
        id: 'biweekly-lease-1',
        lease_start_date: '2024-07-17', // Wednesday
        lease_end_date: '2024-09-17',
        rent_cadence: 'biweekly',
        rent: 1000,
        rent_due_day: undefined
      }

      const fridays = [
        '2024-07-19', // Anchor Friday (first Friday after start)
        '2024-07-26', // +7 days (inactive)
        '2024-08-02', // +14 days (active)
        '2024-08-09', // +21 days (inactive)
        '2024-08-16', // +28 days (active)
        '2024-08-23'  // +35 days (inactive)
      ]

      const periods = generatePeriodsForLease(lease, fridays)
      
      expect(periods).toHaveLength(6)
      expect(periods[0].isActive).toBe(true)  // Anchor
      expect(periods[1].isActive).toBe(false) // +7 days
      expect(periods[2].isActive).toBe(true)  // +14 days
      expect(periods[3].isActive).toBe(false) // +21 days
      expect(periods[4].isActive).toBe(true)  // +28 days
      expect(periods[5].isActive).toBe(false) // +35 days
    })

    test('should handle lease starting on Friday', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
      
      const lease = {
        id: 'biweekly-lease-2',
        lease_start_date: '2024-07-19', // Friday
        lease_end_date: '2024-08-19',
        rent_cadence: 'biweekly',
        rent: 800,
        rent_due_day: undefined
      }

      const fridays = ['2024-07-19', '2024-08-02', '2024-08-16']
      const periods = generatePeriodsForLease(lease, fridays)
      
      expect(periods[0].isActive).toBe(true)  // Start date
      expect(periods[1].isActive).toBe(true)  // +14 days
      expect(periods[2].isActive).toBe(true)  // +28 days
    })
  })

  describe('Monthly Leases', () => {
    test('should generate exactly one active period per month', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
      
      const lease = {
        id: 'monthly-lease-1',
        lease_start_date: '2024-07-01',
        lease_end_date: '2024-10-31',
        rent_cadence: 'monthly',
        rent: 2000,
        rent_due_day: 15
      }

      const fridays = [
        '2024-07-05', '2024-07-12', '2024-07-19', '2024-07-26',
        '2024-08-02', '2024-08-09', '2024-08-16', '2024-08-23', '2024-08-30',
        '2024-09-06', '2024-09-13', '2024-09-20', '2024-09-27'
      ]

      const periods = generatePeriodsForLease(lease, fridays)
      
      // Should have exactly 3 active periods (one per month)
      const activePeriods = periods.filter(p => p.isActive)
      expect(activePeriods).toHaveLength(3)
      
      // July: 19th is closest to 15th
      expect(periods[2].isActive).toBe(true)  // July 19
      
      // August: 16th is closest to 15th
      expect(periods[6].isActive).toBe(true)  // August 16
      
      // September: 13th is closest to 15th
      expect(periods[10].isActive).toBe(true) // September 13
    })

    test('should handle rent_due_day = 1', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
      
      const lease = {
        id: 'monthly-lease-2',
        lease_start_date: '2024-08-01',
        lease_end_date: '2024-09-30',
        rent_cadence: 'monthly',
        rent: 1500,
        rent_due_day: 1
      }

      const fridays = ['2024-08-02', '2024-08-09', '2024-09-06', '2024-09-13']
      const periods = generatePeriodsForLease(lease, fridays)
      
      // August 2nd is closest to 1st
      expect(periods[0].isActive).toBe(true)
      expect(periods[1].isActive).toBe(false)
      
      // September 6th is closest to 1st
      expect(periods[2].isActive).toBe(true)
      expect(periods[3].isActive).toBe(false)
    })

    test('should handle rent_due_day = 31 (edge case)', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
      
      const lease = {
        id: 'monthly-lease-3',
        lease_start_date: '2024-07-01',
        lease_end_date: '2024-08-31',
        rent_cadence: 'monthly',
        rent: 1800,
        rent_due_day: 31
      }

      const fridays = ['2024-07-26', '2024-08-02', '2024-08-09', '2024-08-16', '2024-08-23', '2024-08-30']
      const periods = generatePeriodsForLease(lease, fridays)
      
      // July 26th is closest to 31st (July has 31 days)
      expect(periods[0].isActive).toBe(true)
      expect(periods[1].isActive).toBe(false)
      expect(periods[2].isActive).toBe(false)
      expect(periods[3].isActive).toBe(false)
      expect(periods[4].isActive).toBe(false)
      
      // August 30th is closest to 31st
      expect(periods[5].isActive).toBe(true)
    })

    test('should never have 0 active periods in a month', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
      
      const lease = {
        id: 'monthly-lease-4',
        lease_start_date: '2024-07-01',
        lease_end_date: '2024-08-31',
        rent_cadence: 'monthly',
        rent: 1200,
        rent_due_day: 15
      }

      const fridays = ['2024-07-19', '2024-08-16']
      const periods = generatePeriodsForLease(lease, fridays)
      
      // Should have exactly one active period per month
      const activePeriods = periods.filter(p => p.isActive)
      expect(activePeriods).toHaveLength(2)
      expect(periods.every(p => p.cadence === 'monthly')).toBe(true)
    })
  })

  describe('Legacy Behavior', () => {
    test('should use legacy logic when flag is disabled', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'false'
      
      const lease = {
        id: 'legacy-lease-1',
        lease_start_date: '2024-07-01',
        lease_end_date: '2024-08-31',
        rent_cadence: 'monthly',
        rent: 1000,
        rent_due_day: 15
      }

      const fridays = ['2024-07-05', '2024-07-12', '2024-08-02', '2024-08-09']
      const periods = generatePeriodsForLease(lease, fridays)
      
      // Should return periods with legacy structure
      expect(periods).toHaveLength(4)
      expect(periods.every(p => p.cadence === 'monthly')).toBe(true)
    })
  })

  describe('Edge Cases', () => {
    test('should handle lease with no end date', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
      
      const lease = {
        id: 'ongoing-lease',
        lease_start_date: '2024-07-01',
        lease_end_date: null,
        rent_cadence: 'monthly',
        rent: 2000,
        rent_due_day: 15
      }

      const fridays = ['2024-07-19', '2024-08-16', '2024-09-13']
      const periods = generatePeriodsForLease(lease, fridays)
      
      expect(periods).toHaveLength(3)
      expect(periods.every(p => p.isActive)).toBe(true)
    })

    test('should handle Friday outside lease period', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
      
      const lease = {
        id: 'bounded-lease',
        lease_start_date: '2024-07-15',
        lease_end_date: '2024-08-15',
        rent_cadence: 'weekly',
        rent: 500,
        rent_due_day: undefined
      }

      const fridays = [
        '2024-07-12', // Before lease start
        '2024-07-19', // Within lease
        '2024-08-16'  // After lease end
      ]

      const periods = generatePeriodsForLease(lease, fridays)
      
      expect(periods[0].isActive).toBe(false) // Before lease
      expect(periods[1].isActive).toBe(true)  // Within lease
      expect(periods[2].isActive).toBe(false) // After lease
    })
  })
})
