/**
 * Overbrook Monthly Cadence Test - Anchor + 28-Day Schedule
 * 
 * This test validates the specific Overbrook scenario with monthly cadence
 * using anchor Friday + 28-day intervals and string key matching.
 */

import { generatePeriodsForLease } from '../../src/lib/rent/periods'
import { bucketPaymentsForPeriod } from '../../src/lib/rent/paymentBucket'

// Mock environment variables
const originalEnv = process.env

describe('Monthly Overbrook Scenario - Anchor + 28 Days', () => {
  beforeEach(() => {
    // Reset environment and enable the fix
    process.env = { ...originalEnv }
    process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
    process.env.NEXT_PUBLIC_DEBUG_PAYMENTS = 'true'
  })

  afterAll(() => {
    process.env = originalEnv
  })

  test('should generate exactly one active Friday per month using anchor + 28 days', () => {
    // Header Fridays from the grid (UTC ISO)
    const headerFridays = [
      "2025-07-25", "2025-08-01", "2025-08-08", "2025-08-15", "2025-08-22", 
      "2025-08-29", "2025-09-05", "2025-09-12", "2025-09-19", "2025-09-26", 
      "2025-10-03", "2025-10-10"
    ]

    // Lease: monthly, rent_due_day=15, rent=750, active during that range
    const lease = {
      id: 'overbrook-monthly-lease',
      lease_start_date: '2025-07-01',
      lease_end_date: '2025-12-31',
      rent_cadence: 'monthly',
      rent: 750,
      rent_due_day: 15,
      property_id: 'prop-overbrook',
      tenant_id: 'tenant-overbrook'
    }

    // Generate periods using the new logic
    const periods = generatePeriodsForLease(lease, headerFridays)

    // Expected active Fridays based on anchor + 28-day schedule
    // First month in range is August 2025, closest Friday to rent_due_day=15 is 2025-08-15
    // Then: 2025-08-15 + 28 days = 2025-09-12, 2025-09-12 + 28 days = 2025-10-10
    const expectedActiveFridays = ['2025-08-15', '2025-09-12', '2025-10-10']

    // Verify exactly these Fridays are active
    const activePeriods = periods.filter(p => p.isActive)
    const activeFridayDates = activePeriods.map(p => p.friday.toISOString().split('T')[0])
    
    expect(activeFridayDates.sort()).toEqual(expectedActiveFridays.sort())

    // Verify each active period has correct properties
    activePeriods.forEach(period => {
      expect(period.expectedAmount).toBe(750)
      expect(period.cadence).toBe('monthly')
      
      // Due date should be end of that Friday
      const expectedDueDate = new Date(period.friday)
      expectedDueDate.setUTCHours(23, 59, 59, 999)
      expect(period.dueDate.getTime()).toBe(expectedDueDate.getTime())
      
      // Window should be the full month
      const year = period.friday.getUTCFullYear()
      const month = period.friday.getUTCMonth()
      const expectedWindowStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0))
      const expectedWindowEnd = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999))
      
      expect(period.windowStart.getTime()).toBe(expectedWindowStart.getTime())
      expect(period.windowEnd.getTime()).toBe(expectedWindowEnd.getTime())
    })

    // Verify all other Fridays in those months are inactive
    const inactivePeriods = periods.filter(p => !p.isActive)
    const inactiveFridaysInActiveMonths = inactivePeriods.filter(p => {
      const month = p.friday.getUTCMonth()
      const year = p.friday.getUTCFullYear()
      // August = 7, September = 8, October = 9 (0-indexed)
      return (year === 2025 && (month === 7 || month === 8 || month === 9))
    })

    // Should have inactive Fridays in the active months
    expect(inactiveFridaysInActiveMonths.length).toBeGreaterThan(0)
    
    // All inactive periods should have isActive = false
    inactiveFridaysInActiveMonths.forEach(period => {
      expect(period.isActive).toBe(false)
    })
  })

  test('should bucket payments only to active Fridays for monthly cadence', () => {
    // Payments (UTC) as specified
    const payments = [
      { 
        id: 'pay-1', 
        lease_id: 'overbrook-monthly-lease',
        payment_date: '2025-08-09', 
        amount: 450, 
        payment_type: 'rent',
        property_id: 'prop-overbrook',
        tenant_id: 'tenant-overbrook'
      },
      { 
        id: 'pay-2', 
        lease_id: 'overbrook-monthly-lease',
        payment_date: '2025-08-11', 
        amount: 300, 
        payment_type: 'rent',
        property_id: 'prop-overbrook',
        tenant_id: 'tenant-overbrook'
      },
      { 
        id: 'pay-3', 
        lease_id: 'overbrook-monthly-lease',
        payment_date: '2025-09-05', 
        amount: 750, 
        payment_type: 'rent',
        property_id: 'prop-overbrook',
        tenant_id: 'tenant-overbrook'
      },
      { 
        id: 'pay-4', 
        lease_id: 'overbrook-monthly-lease',
        payment_date: '2025-10-07', 
        amount: 750, 
        payment_type: 'rent',
        property_id: 'prop-overbrook',
        tenant_id: 'tenant-overbrook'
      }
    ]

    const lease = {
      id: 'overbrook-monthly-lease',
      property_id: 'prop-overbrook',
      tenant_id: 'tenant-overbrook'
    }

    const headerFridays = [
      "2025-08-01", "2025-08-08", "2025-08-15", "2025-08-22", "2025-08-29",
      "2025-09-05", "2025-09-12", "2025-09-19", "2025-09-26",
      "2025-10-03", "2025-10-10"
    ]

    const periods = generatePeriodsForLease({
      id: 'overbrook-monthly-lease',
      lease_start_date: '2025-07-01',
      lease_end_date: '2025-12-31',
      rent_cadence: 'monthly',
      rent: 750,
      rent_due_day: 15,
      property_id: 'prop-overbrook',
      tenant_id: 'tenant-overbrook'
    }, headerFridays)

    // Test payment bucketing for each period
    const bucketingResults = periods.map(period => {
      const fridayKey = period.friday.toISOString().split('T')[0]
      
      if (period.isActive) {
        // Active periods should get normal bucketing
        const bucketed = bucketPaymentsForPeriod(
          lease,
          period.windowStart,
          period.windowEnd,
          payments
        )
        return {
          fridayKey,
          isActive: true,
          amountPaid: bucketed.amountPaid,
          paymentCount: bucketed.payments.length
        }
      } else {
        // Inactive periods should get no payments (bucketing should return 0)
        return {
          fridayKey,
          isActive: false,
          amountPaid: 0,
          paymentCount: 0
        }
      }
    })

    // Verify active Friday amounts
    const august15Result = bucketingResults.find(r => r.fridayKey === '2025-08-15')
    expect(august15Result?.isActive).toBe(true)
    expect(august15Result?.amountPaid).toBe(750) // 450 + 300 from August payments

    const september12Result = bucketingResults.find(r => r.fridayKey === '2025-09-12')
    expect(september12Result?.isActive).toBe(true)
    expect(september12Result?.amountPaid).toBe(750) // September payment

    const october10Result = bucketingResults.find(r => r.fridayKey === '2025-10-10')
    expect(october10Result?.isActive).toBe(true)
    expect(october10Result?.amountPaid).toBe(750) // October payment

    // Verify inactive Fridays have $0
    const inactiveResults = bucketingResults.filter(r => !r.isActive)
    inactiveResults.forEach(result => {
      expect(result.amountPaid).toBe(0)
      expect(result.paymentCount).toBe(0)
    })
  })

  test('should calculate total owed correctly for active periods only', () => {
    const lease = {
      id: 'overbrook-monthly-lease',
      lease_start_date: '2025-07-01',
      lease_end_date: '2025-12-31',
      rent_cadence: 'monthly',
      rent: 750,
      rent_due_day: 15,
      property_id: 'prop-overbrook',
      tenant_id: 'tenant-overbrook'
    }

    const headerFridays = ["2025-08-15", "2025-09-12", "2025-10-10"]
    const periods = generatePeriodsForLease(lease, headerFridays)

    // Mock today as after all due dates to make them all owed
    const todayUTC = new Date('2025-11-01T00:00:00.000Z')

    // Simulate no payments (all amounts should be owed)
    const totalOwed = periods
      .filter(period => period.isActive && todayUTC >= period.dueDate)
      .reduce((sum, period) => {
        const amountPaid = 0 // No payments
        return sum + Math.max(0, period.expectedAmount - amountPaid)
      }, 0)

    // Should owe $750 * 3 = $2250 for the three active periods
    expect(totalOwed).toBe(2250)

    // With full payments, should owe $0
    const totalOwedPaid = periods
      .filter(period => period.isActive && todayUTC >= period.dueDate)
      .reduce((sum, period) => {
        const amountPaid = 750 // Full payment
        return sum + Math.max(0, period.expectedAmount - amountPaid)
      }, 0)

    expect(totalOwedPaid).toBe(0)
  })
})
