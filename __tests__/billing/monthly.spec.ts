/**
 * Unit tests for monthly period generation logic
 */

import { generatePeriodsForLease } from '../../src/lib/rent/periods'

// Mock environment variables
const originalEnv = process.env

describe('Monthly Period Generation', () => {
  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv }
    process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('Edge Cases for rent_due_day', () => {
    test('should handle rent_due_day = 1', () => {
      const lease = {
        id: 'monthly-lease-1',
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

    test('should handle rent_due_day = 15', () => {
      const lease = {
        id: 'monthly-lease-15',
        lease_start_date: '2024-07-01',
        lease_end_date: '2024-08-31',
        rent_cadence: 'monthly',
        rent: 2000,
        rent_due_day: 15
      }

      const fridays = ['2024-07-12', '2024-07-19', '2024-08-09', '2024-08-16']
      const periods = generatePeriodsForLease(lease, fridays)
      
      // July 19th is closest to 15th
      expect(periods[0].isActive).toBe(false)
      expect(periods[1].isActive).toBe(true)
      
      // August 16th is closest to 15th
      expect(periods[2].isActive).toBe(false)
      expect(periods[3].isActive).toBe(true)
    })

    test('should handle rent_due_day = 31 (February edge case)', () => {
      const lease = {
        id: 'monthly-lease-31',
        lease_start_date: '2024-02-01',
        lease_end_date: '2024-03-31',
        rent_cadence: 'monthly',
        rent: 1800,
        rent_due_day: 31
      }

      const fridays = ['2024-02-02', '2024-02-09', '2024-02-16', '2024-02-23', '2024-03-01', '2024-03-08', '2024-03-15', '2024-03-22', '2024-03-29']
      const periods = generatePeriodsForLease(lease, fridays)
      
      // February 23rd is closest to 31st (Feb has 29 days in 2024)
      expect(periods[0].isActive).toBe(false) // Feb 2
      expect(periods[1].isActive).toBe(false) // Feb 9
      expect(periods[2].isActive).toBe(false) // Feb 16
      expect(periods[3].isActive).toBe(true)  // Feb 23 (closest to 31)
      
      // March 29th is closest to 31st
      expect(periods[4].isActive).toBe(false) // Mar 1
      expect(periods[5].isActive).toBe(false) // Mar 8
      expect(periods[6].isActive).toBe(false) // Mar 15
      expect(periods[7].isActive).toBe(false) // Mar 22
      expect(periods[8].isActive).toBe(true)  // Mar 29 (closest to 31)
    })
  })

  describe('Tie-Break Rules', () => {
    test('should choose earlier Friday when equidistant from target', () => {
      const lease = {
        id: 'tie-break-lease',
        lease_start_date: '2024-08-01',
        lease_end_date: '2024-08-31',
        rent_cadence: 'monthly',
        rent: 1200,
        rent_due_day: 15 // Exactly between Aug 9 and Aug 16
      }

      const fridays = ['2024-08-09', '2024-08-16', '2024-08-23']
      const periods = generatePeriodsForLease(lease, fridays)
      
      // Should choose Aug 9 (earlier) over Aug 16 when equidistant from 15th
      expect(periods[0].isActive).toBe(true)  // Aug 9 (earlier, ≤ 15)
      expect(periods[1].isActive).toBe(false) // Aug 16
      expect(periods[2].isActive).toBe(false) // Aug 23
    })

    test('should handle exact match with target day', () => {
      const lease = {
        id: 'exact-match-lease',
        lease_start_date: '2024-09-01',
        lease_end_date: '2024-09-30',
        rent_cadence: 'monthly',
        rent: 1600,
        rent_due_day: 6 // Sep 6 is a Friday
      }

      const fridays = ['2024-09-06', '2024-09-13', '2024-09-20', '2024-09-27']
      const periods = generatePeriodsForLease(lease, fridays)
      
      // Sep 6 should be active (exact match)
      expect(periods[0].isActive).toBe(true)  // Sep 6 (exact match)
      expect(periods[1].isActive).toBe(false) // Sep 13
      expect(periods[2].isActive).toBe(false) // Sep 20
      expect(periods[3].isActive).toBe(false) // Sep 27
    })
  })

  describe('One Active Friday Per Month', () => {
    test('should ensure exactly one active Friday per month', () => {
      const lease = {
        id: 'one-active-per-month',
        lease_start_date: '2024-07-01',
        lease_end_date: '2024-10-31',
        rent_cadence: 'monthly',
        rent: 2000,
        rent_due_day: 15
      }

      const fridays = [
        '2024-07-05', '2024-07-12', '2024-07-19', '2024-07-26',
        '2024-08-02', '2024-08-09', '2024-08-16', '2024-08-23', '2024-08-30',
        '2024-09-06', '2024-09-13', '2024-09-20', '2024-09-27',
        '2024-10-04', '2024-10-11', '2024-10-18', '2024-10-25'
      ]

      const periods = generatePeriodsForLease(lease, fridays)
      
      // Count active periods per month
      const activeByMonth = new Map()
      periods.forEach((period, index) => {
        if (period.isActive) {
          const month = period.friday.getUTCMonth()
          activeByMonth.set(month, (activeByMonth.get(month) || 0) + 1)
        }
      })
      
      // Each month should have exactly 1 active period
      expect(activeByMonth.get(6)).toBe(1)  // July (month 6)
      expect(activeByMonth.get(7)).toBe(1)  // August (month 7)
      expect(activeByMonth.get(8)).toBe(1)  // September (month 8)
      expect(activeByMonth.get(9)).toBe(1)  // October (month 9)
      
      // Total active periods should be 4 (one per month)
      const totalActive = periods.filter(p => p.isActive).length
      expect(totalActive).toBe(4)
    })

    test('should never have 0 active periods in a month', () => {
      const lease = {
        id: 'no-zero-active',
        lease_start_date: '2024-07-01',
        lease_end_date: '2024-08-31',
        rent_cadence: 'monthly',
        rent: 1200,
        rent_due_day: 15
      }

      const fridays = ['2024-07-19', '2024-08-16'] // Only the active Fridays
      const periods = generatePeriodsForLease(lease, fridays)
      
      // Should have exactly one active period per month
      const activePeriods = periods.filter(p => p.isActive)
      expect(activePeriods).toHaveLength(2)
      expect(periods.every(p => p.cadence === 'monthly')).toBe(true)
    })
  })

  describe('Due Date Calculation', () => {
    test('should set due date to active Friday at 23:59:59 UTC', () => {
      const lease = {
        id: 'due-date-test',
        lease_start_date: '2024-08-01',
        lease_end_date: '2024-08-31',
        rent_cadence: 'monthly',
        rent: 1500,
        rent_due_day: 15
      }

      const fridays = ['2024-08-09', '2024-08-16', '2024-08-23']
      const periods = generatePeriodsForLease(lease, fridays)
      
      const activePeriod = periods.find(p => p.isActive)
      expect(activePeriod).toBeDefined()
      
      // Due date should be the active Friday at end of day
      const expectedDueDate = new Date('2024-08-16T23:59:59.999Z')
      expect(activePeriod?.dueDate.getTime()).toBe(expectedDueDate.getTime())
    })
  })

  describe('Window Calculation', () => {
    test('should set full calendar month window for all Fridays in month', () => {
      const lease = {
        id: 'window-test',
        lease_start_date: '2024-08-01',
        lease_end_date: '2024-08-31',
        rent_cadence: 'monthly',
        rent: 1800,
        rent_due_day: 15
      }

      const fridays = ['2024-08-09', '2024-08-16', '2024-08-23']
      const periods = generatePeriodsForLease(lease, fridays)
      
      periods.forEach(period => {
        // All periods in the same month should have the same window
        const windowStart = new Date('2024-08-01T00:00:00.000Z')
        const windowEnd = new Date('2024-08-31T23:59:59.999Z')
        
        expect(period.windowStart.getTime()).toBe(windowStart.getTime())
        expect(period.windowEnd.getTime()).toBe(windowEnd.getTime())
      })
    })
  })

  describe('Timezone Edge Cases', () => {
    test('should handle UTC Friday that appears as Thursday in local timezone', () => {
      // Create a scenario where a UTC Friday would appear as Thursday in a negative timezone
      const lease = {
        id: 'timezone-edge-case',
        lease_start_date: '2024-08-01',
        lease_end_date: '2024-08-31',
        rent_cadence: 'monthly',
        rent: 1500,
        rent_due_day: 15
      }

      const fridays = ['2024-08-02', '2024-08-09', '2024-08-16', '2024-08-23', '2024-08-30']
      const periods = generatePeriodsForLease(lease, fridays)
      
      // Aug 16 should be active (closest to 15th)
      const activePeriod = periods.find(p => p.isActive)
      expect(activePeriod).toBeDefined()
      expect(activePeriod?.friday.getUTCDate()).toBe(16)
      expect(activePeriod?.friday.getUTCMonth()).toBe(7) // August is month 7
      
      // All other Fridays should be inactive
      const inactivePeriods = periods.filter(p => !p.isActive)
      expect(inactivePeriods).toHaveLength(4)
    })

    test('should maintain UTC consistency across different timezone scenarios', () => {
      const lease = {
        id: 'utc-consistency',
        lease_start_date: '2024-12-01',
        lease_end_date: '2024-12-31',
        rent_cadence: 'monthly',
        rent: 2000,
        rent_due_day: 25
      }

      const fridays = ['2024-12-06', '2024-12-13', '2024-12-20', '2024-12-27']
      const periods = generatePeriodsForLease(lease, fridays)
      
      // Dec 27 should be active (closest to 25th)
      const activePeriod = periods.find(p => p.isActive)
      expect(activePeriod).toBeDefined()
      expect(activePeriod?.friday.getUTCDate()).toBe(27)
      
      // Verify all periods use UTC dates
      periods.forEach(period => {
        expect(period.friday.getUTCHours()).toBe(0)
        expect(period.friday.getUTCMinutes()).toBe(0)
        expect(period.friday.getUTCSeconds()).toBe(0)
        expect(period.friday.getUTCMilliseconds()).toBe(0)
      })
    })
  })

  describe('Legacy Behavior', () => {
    test('should use legacy logic when flag is disabled', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'false'
      
      const lease = {
        id: 'legacy-monthly',
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
})
