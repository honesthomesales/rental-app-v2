/**
 * Integration tests for payment bucketing logic
 */

import { bucketPaymentsForPeriod, createPaymentMaps, getPaymentsForLease } from '../../src/lib/rent/paymentBucket'
import { Payment, Lease } from '../../src/lib/rent/paymentBucket'

// Mock environment variables
const originalEnv = process.env

describe('Payment Bucketing', () => {
  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('Payment Matching', () => {
    test('should prefer lease_id over fallback matching', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
      
      const lease: Lease = {
        id: 'lease-123',
        property_id: 'prop-456',
        tenant_id: 'tenant-789'
      }

      const payments: Payment[] = [
        {
          id: 'payment-1',
          lease_id: 'lease-123',
          property_id: 'prop-456',
          tenant_id: 'tenant-789',
          payment_date: '2024-07-20',
          amount: 500,
          payment_type: 'Rent',
          notes: 'Primary match'
        },
        {
          id: 'payment-2',
          lease_id: null,
          property_id: 'prop-456',
          tenant_id: 'tenant-789',
          payment_date: '2024-07-21',
          amount: 300,
          payment_type: 'Rent',
          notes: 'Fallback match'
        }
      ]

      const windowStart = new Date('2024-07-19T00:00:00.000Z')
      const windowEnd = new Date('2024-07-26T23:59:59.999Z')

      const result = bucketPaymentsForPeriod(lease, windowStart, windowEnd, payments)
      
      expect(result.amountPaid).toBe(500) // Only payment-1 should match
      expect(result.payments).toHaveLength(1)
      expect(result.payments[0].id).toBe('payment-1')
    })

    test('should use fallback matching when lease_id is null', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
      
      const lease: Lease = {
        id: 'lease-123',
        property_id: 'prop-456',
        tenant_id: 'tenant-789'
      }

      const payments: Payment[] = [
        {
          id: 'payment-1',
          lease_id: null,
          property_id: 'prop-456',
          tenant_id: 'tenant-789',
          payment_date: '2024-07-20',
          amount: 500,
          payment_type: 'Rent'
        },
        {
          id: 'payment-2',
          lease_id: null,
          property_id: 'prop-999',
          tenant_id: 'tenant-999',
          payment_date: '2024-07-21',
          amount: 300,
          payment_type: 'Rent'
        }
      ]

      const windowStart = new Date('2024-07-19T00:00:00.000Z')
      const windowEnd = new Date('2024-07-26T23:59:59.999Z')

      const result = bucketPaymentsForPeriod(lease, windowStart, windowEnd, payments)
      
      expect(result.amountPaid).toBe(500) // Only payment-1 should match
      expect(result.payments).toHaveLength(1)
      expect(result.payments[0].id).toBe('payment-1')
    })

    test('should not double count payments with both lease_id and fallback', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
      
      const lease: Lease = {
        id: 'lease-123',
        property_id: 'prop-456',
        tenant_id: 'tenant-789'
      }

      const payments: Payment[] = [
        {
          id: 'payment-1',
          lease_id: 'lease-123', // Has lease_id
          property_id: 'prop-456', // Also has matching property/tenant
          tenant_id: 'tenant-789',
          payment_date: '2024-07-20',
          amount: 500,
          payment_type: 'Rent'
        }
      ]

      const windowStart = new Date('2024-07-19T00:00:00.000Z')
      const windowEnd = new Date('2024-07-26T23:59:59.999Z')

      const result = bucketPaymentsForPeriod(lease, windowStart, windowEnd, payments)
      
      expect(result.amountPaid).toBe(500) // Should only count once
      expect(result.payments).toHaveLength(1)
    })
  })

  describe('Window Boundary Testing', () => {
    test('should include payments on window start boundary', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
      
      const lease: Lease = {
        id: 'lease-123',
        property_id: 'prop-456',
        tenant_id: 'tenant-789'
      }

      const payments: Payment[] = [
        {
          id: 'payment-1',
          lease_id: 'lease-123',
          payment_date: '2024-07-19T00:00:00.000Z', // Exactly at window start
          amount: 500,
          payment_type: 'Rent'
        }
      ]

      const windowStart = new Date('2024-07-19T00:00:00.000Z')
      const windowEnd = new Date('2024-07-26T23:59:59.999Z')

      const result = bucketPaymentsForPeriod(lease, windowStart, windowEnd, payments)
      
      expect(result.amountPaid).toBe(500)
      expect(result.payments).toHaveLength(1)
    })

    test('should include payments on window end boundary', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
      
      const lease: Lease = {
        id: 'lease-123',
        property_id: 'prop-456',
        tenant_id: 'tenant-789'
      }

      const payments: Payment[] = [
        {
          id: 'payment-1',
          lease_id: 'lease-123',
          payment_date: '2024-07-26T23:59:59.999Z', // Exactly at window end
          amount: 500,
          payment_type: 'Rent'
        }
      ]

      const windowStart = new Date('2024-07-19T00:00:00.000Z')
      const windowEnd = new Date('2024-07-26T23:59:59.999Z')

      const result = bucketPaymentsForPeriod(lease, windowStart, windowEnd, payments)
      
      expect(result.amountPaid).toBe(500)
      expect(result.payments).toHaveLength(1)
    })

    test('should exclude payments before window start', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
      
      const lease: Lease = {
        id: 'lease-123',
        property_id: 'prop-456',
        tenant_id: 'tenant-789'
      }

      const payments: Payment[] = [
        {
          id: 'payment-1',
          lease_id: 'lease-123',
          payment_date: '2024-07-18T23:59:59.999Z', // Just before window
          amount: 500,
          payment_type: 'Rent'
        }
      ]

      const windowStart = new Date('2024-07-19T00:00:00.000Z')
      const windowEnd = new Date('2024-07-26T23:59:59.999Z')

      const result = bucketPaymentsForPeriod(lease, windowStart, windowEnd, payments)
      
      expect(result.amountPaid).toBe(0)
      expect(result.payments).toHaveLength(0)
    })

    test('should exclude payments after window end', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
      
      const lease: Lease = {
        id: 'lease-123',
        property_id: 'prop-456',
        tenant_id: 'tenant-789'
      }

      const payments: Payment[] = [
        {
          id: 'payment-1',
          lease_id: 'lease-123',
          payment_date: '2024-07-27T00:00:00.000Z', // Just after window
          amount: 500,
          payment_type: 'Rent'
        }
      ]

      const windowStart = new Date('2024-07-19T00:00:00.000Z')
      const windowEnd = new Date('2024-07-26T23:59:59.999Z')

      const result = bucketPaymentsForPeriod(lease, windowStart, windowEnd, payments)
      
      expect(result.amountPaid).toBe(0)
      expect(result.payments).toHaveLength(0)
    })
  })

  describe('Monthly Window Testing', () => {
    test('should bucket payments across entire calendar month', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'true'
      
      const lease: Lease = {
        id: 'monthly-lease',
        property_id: 'prop-456',
        tenant_id: 'tenant-789'
      }

      const payments: Payment[] = [
        {
          id: 'payment-1',
          lease_id: 'monthly-lease',
          payment_date: '2024-07-01T00:00:00.000Z', // First day of month
          amount: 200,
          payment_type: 'Rent'
        },
        {
          id: 'payment-2',
          lease_id: 'monthly-lease',
          payment_date: '2024-07-15T12:00:00.000Z', // Middle of month
          amount: 500,
          payment_type: 'Rent'
        },
        {
          id: 'payment-3',
          lease_id: 'monthly-lease',
          payment_date: '2024-07-31T23:59:59.999Z', // Last second of month
          amount: 300,
          payment_type: 'Rent'
        }
      ]

      const windowStart = new Date('2024-07-01T00:00:00.000Z')
      const windowEnd = new Date('2024-07-31T23:59:59.999Z')

      const result = bucketPaymentsForPeriod(lease, windowStart, windowEnd, payments)
      
      expect(result.amountPaid).toBe(1000) // All three payments
      expect(result.payments).toHaveLength(3)
    })
  })

  describe('Payment Maps', () => {
    test('should create efficient payment lookup maps', () => {
      const payments: Payment[] = [
        {
          id: 'payment-1',
          lease_id: 'lease-123',
          property_id: 'prop-456',
          tenant_id: 'tenant-789',
          payment_date: '2024-07-20',
          amount: 500,
          payment_type: 'Rent'
        },
        {
          id: 'payment-2',
          lease_id: 'lease-456',
          property_id: 'prop-456',
          tenant_id: 'tenant-789',
          payment_date: '2024-07-21',
          amount: 300,
          payment_type: 'Rent'
        },
        {
          id: 'payment-3',
          lease_id: null,
          property_id: 'prop-999',
          tenant_id: 'tenant-999',
          payment_date: '2024-07-22',
          amount: 400,
          payment_type: 'Rent'
        }
      ]

      const maps = createPaymentMaps(payments)
      
      // Check lease_id mapping
      expect(maps.paymentsByLeaseId.get('lease-123')).toHaveLength(1)
      expect(maps.paymentsByLeaseId.get('lease-456')).toHaveLength(1)
      expect(maps.paymentsByLeaseId.get('lease-999')).toBeUndefined()
      
      // Check property+tenant mapping
      expect(maps.paymentsByPropTenant.get('prop-456-tenant-789')).toHaveLength(2)
      expect(maps.paymentsByPropTenant.get('prop-999-tenant-999')).toHaveLength(1)
    })

    test('should retrieve payments for lease efficiently', () => {
      const lease: Lease = {
        id: 'lease-123',
        property_id: 'prop-456',
        tenant_id: 'tenant-789'
      }

      const payments: Payment[] = [
        {
          id: 'payment-1',
          lease_id: 'lease-123',
          payment_date: '2024-07-20',
          amount: 500,
          payment_type: 'Rent'
        },
        {
          id: 'payment-2',
          lease_id: null,
          property_id: 'prop-456',
          tenant_id: 'tenant-789',
          payment_date: '2024-07-21',
          amount: 300,
          payment_type: 'Rent'
        },
        {
          id: 'payment-3',
          lease_id: null,
          property_id: 'prop-999',
          tenant_id: 'tenant-999',
          payment_date: '2024-07-22',
          amount: 400,
          payment_type: 'Rent'
        }
      ]

      const maps = createPaymentMaps(payments)
      const leasePayments = getPaymentsForLease(lease, maps)
      
      expect(leasePayments).toHaveLength(2) // payment-1 and payment-2
      expect(leasePayments.map(p => p.id)).toEqual(['payment-1', 'payment-2'])
    })
  })

  describe('Legacy Behavior', () => {
    test('should use legacy logic when flag is disabled', () => {
      process.env.NEXT_PUBLIC_USE_CADENCE_FIX = 'false'
      
      const lease: Lease = {
        id: 'lease-123',
        property_id: 'prop-456',
        tenant_id: 'tenant-789'
      }

      const payments: Payment[] = [
        {
          id: 'payment-1',
          lease_id: 'lease-123',
          payment_date: '2024-07-20',
          amount: 500,
          payment_type: 'Rent'
        }
      ]

      const windowStart = new Date('2024-07-19T00:00:00.000Z')
      const windowEnd = new Date('2024-07-26T23:59:59.999Z')

      const result = bucketPaymentsForPeriod(lease, windowStart, windowEnd, payments)
      
      expect(result.amountPaid).toBe(500)
      expect(result.payments).toHaveLength(1)
    })
  })
})
