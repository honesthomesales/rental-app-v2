/**
 * Tests for late tenants functionality
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { 
  generateFridayColumns, 
  generatePeriodsForLease,
  type Lease 
} from '../../src/lib/rent/periods';
import { 
  bucketPaymentsForPeriod,
  createPaymentMaps,
  getPaymentsForLease,
  type Payment 
} from '../../src/lib/rent/paymentBucket';

// Set timezone to UTC for consistent tests
beforeAll(() => {
  process.env.TZ = 'UTC';
});

describe('Late Tenants Logic', () => {
  const testFridays = [
    '2025-07-04', '2025-07-11', '2025-07-18', 
    '2025-07-25', '2025-08-01', '2025-08-08'
  ];
  const today = '2025-08-10';
  
  it('should identify no late periods for 609 Capps (Weekly, fully paid)', () => {
    const lease: Lease = {
      id: 'lease-609',
      lease_start_date: '2025-07-01',
      lease_end_date: '2025-08-31',
      rent_cadence: 'Weekly',
      rent: 200
    };
    
    const payments: Payment[] = [
      {
        id: 'pay-1',
        lease_id: 'lease-609',
        payment_date: '2025-07-05', // Saturday - buckets to 7/4
        amount: 200,
        payment_type: 'Rent'
      },
      {
        id: 'pay-2',
        lease_id: 'lease-609',
        payment_date: '2025-07-11', // Friday
        amount: 150,
        payment_type: 'Rent'
      },
      {
        id: 'pay-3',
        lease_id: 'lease-609',
        payment_date: '2025-07-14', // Monday - buckets to 7/11
        amount: 50,
        payment_type: 'Rent'
      }
    ];
    
    const periods = generatePeriodsForLease(lease, testFridays);
    const paymentMaps = createPaymentMaps(payments);
    const leasePayments = getPaymentsForLease(lease, paymentMaps);
    
    const latePeriods: any[] = [];
    
    for (const period of periods) {
      if (!period.isActive) continue;
      
      const bucketedPayments = bucketPaymentsForPeriod(
        lease,
        period.windowStart,
        period.windowEnd,
        leasePayments
      );
      
      const isLate = period.dueDate < today && bucketedPayments.amountPaid < period.expectedAmount;
      
      if (isLate) {
        latePeriods.push({
          dueDate: period.dueDate,
          expectedAmount: period.expectedAmount,
          amountPaid: bucketedPayments.amountPaid,
          shortfall: Math.max(0, period.expectedAmount - bucketedPayments.amountPaid)
        });
      }
    }
    
    // Should have no late periods - 7/4 and 7/11 are both paid
    expect(latePeriods).toHaveLength(0);
  });
  
  it('should identify late periods for 109 Hosch Chad Lail (Monthly)', () => {
    const lease: Lease = {
      id: 'lease-109',
      lease_start_date: '2025-07-01',
      lease_end_date: '2025-08-31',
      rent_cadence: 'Monthly',
      rent: 500 // Set to 500 so 490 payment is partial
    };
    
    const payments: Payment[] = [
      {
        id: 'pay-1',
        lease_id: 'lease-109',
        payment_date: '2025-07-06',
        amount: 300,
        payment_type: 'Rent'
      },
      {
        id: 'pay-2',
        lease_id: 'lease-109',
        payment_date: '2025-07-18',
        amount: 190,
        payment_type: 'Rent'
      }
    ];
    
    const periods = generatePeriodsForLease(lease, testFridays);
    const paymentMaps = createPaymentMaps(payments);
    const leasePayments = getPaymentsForLease(lease, paymentMaps);
    
    const latePeriods: any[] = [];
    
    for (const period of periods) {
      if (!period.isActive) continue;
      
      const bucketedPayments = bucketPaymentsForPeriod(
        lease,
        period.windowStart,
        period.windowEnd,
        leasePayments
      );
      
      const isLate = period.dueDate < today && bucketedPayments.amountPaid < period.expectedAmount;
      
      if (isLate) {
        latePeriods.push({
          dueDate: period.dueDate,
          expectedAmount: period.expectedAmount,
          amountPaid: bucketedPayments.amountPaid,
          shortfall: Math.max(0, period.expectedAmount - bucketedPayments.amountPaid)
        });
      }
    }
    
    // July period (7/4) should be late with $10 shortfall (500 - 490)
    expect(latePeriods).toHaveLength(1);
    expect(latePeriods[0].dueDate).toBe('2025-07-04');
    expect(latePeriods[0].amountPaid).toBe(490);
    expect(latePeriods[0].shortfall).toBe(10);
  });
  
  it('should identify late periods for 107 Willis Bell (Weekly)', () => {
    const lease: Lease = {
      id: 'lease-107',
      lease_start_date: '2025-07-01',
      lease_end_date: '2025-08-31',
      rent_cadence: 'Weekly',
      rent: 400
    };
    
    const payments: Payment[] = [
      {
        id: 'pay-1',
        lease_id: 'lease-107',
        payment_date: '2025-07-18', // Friday - buckets to 7/18
        amount: 400,
        payment_type: 'Rent'
      }
    ];
    
    const periods = generatePeriodsForLease(lease, testFridays);
    const paymentMaps = createPaymentMaps(payments);
    const leasePayments = getPaymentsForLease(lease, paymentMaps);
    
    const latePeriods: any[] = [];
    
    for (const period of periods) {
      if (!period.isActive) continue;
      
      const bucketedPayments = bucketPaymentsForPeriod(
        lease,
        period.windowStart,
        period.windowEnd,
        leasePayments
      );
      
      const isLate = period.dueDate < today && bucketedPayments.amountPaid < period.expectedAmount;
      
      if (isLate) {
        latePeriods.push({
          dueDate: period.dueDate,
          expectedAmount: period.expectedAmount,
          amountPaid: bucketedPayments.amountPaid,
          shortfall: Math.max(0, period.expectedAmount - bucketedPayments.amountPaid)
        });
      }
    }
    
    // Should have late periods for 7/4, 7/11, 7/25, 8/1, 8/8 (all except 7/18 which was paid)
    expect(latePeriods.length).toBeGreaterThan(0);
    
    // 7/25 should be late with $400 shortfall
    const july25Period = latePeriods.find(p => p.dueDate === '2025-07-25');
    expect(july25Period).toBeDefined();
    expect(july25Period?.shortfall).toBe(400);
    
    // Calculate days late for 7/25 to 8/10
    const oldestPeriod = latePeriods.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    const daysLate = Math.floor((new Date(today).getTime() - new Date(oldestPeriod.dueDate).getTime()) / (24 * 60 * 60 * 1000));
    
    if (oldestPeriod.dueDate === '2025-07-25') {
      expect(daysLate).toBe(16); // 7/25 to 8/10 = 16 days
    }
  });
  
  it('should handle bi-weekly anchor correctly', () => {
    const lease: Lease = {
      id: 'lease-biweekly',
      lease_start_date: '2025-06-20', // Friday 6/20 is anchor
      lease_end_date: '2025-08-31',
      rent_cadence: 'Bi-Weekly',
      rent: 400
    };
    
    // No payments - all periods should be late
    const payments: Payment[] = [];
    
    const periods = generatePeriodsForLease(lease, testFridays);
    const activePeriods = periods.filter(p => p.isActive);
    
    // Active periods should be anchor + 14 days: 6/20 → 7/4 → 7/18 → 8/1
    // Within our test window, should have 7/4, 7/18, 8/1 active
    expect(activePeriods.length).toBe(3);
    expect(activePeriods.map(p => p.dueDate)).toEqual(['2025-07-04', '2025-07-18', '2025-08-01']);
    
    const paymentMaps = createPaymentMaps(payments);
    const leasePayments = getPaymentsForLease(lease, paymentMaps);
    
    const latePeriods: any[] = [];
    
    for (const period of periods) {
      if (!period.isActive) continue;
      
      const bucketedPayments = bucketPaymentsForPeriod(
        lease,
        period.windowStart,
        period.windowEnd,
        leasePayments
      );
      
      const isLate = period.dueDate < today && bucketedPayments.amountPaid < period.expectedAmount;
      
      if (isLate) {
        latePeriods.push({
          dueDate: period.dueDate,
          shortfall: period.expectedAmount
        });
      }
    }
    
    // All active periods before today should be late
    expect(latePeriods.length).toBe(3); // 7/4, 7/18, 8/1 all late
  });
  
  it('should show monthly owed cell when unpaid', () => {
    const lease: Lease = {
      id: 'lease-monthly-unpaid',
      lease_start_date: '2025-08-01',
      lease_end_date: '2025-12-31',
      rent_cadence: 'Monthly',
      rent: 600
    };
    
    // No payments in August
    const payments: Payment[] = [];
    
    const periods = generatePeriodsForLease(lease, testFridays);
    const paymentMaps = createPaymentMaps(payments);
    const leasePayments = getPaymentsForLease(lease, paymentMaps);
    
    const latePeriods: any[] = [];
    
    for (const period of periods) {
      if (!period.isActive) continue;
      
      const bucketedPayments = bucketPaymentsForPeriod(
        lease,
        period.windowStart,
        period.windowEnd,
        leasePayments
      );
      
      const isLate = period.dueDate < today && bucketedPayments.amountPaid < period.expectedAmount;
      
      if (isLate) {
        latePeriods.push({
          dueDate: period.dueDate,
          expectedAmount: period.expectedAmount,
          amountPaid: bucketedPayments.amountPaid,
          shortfall: Math.max(0, period.expectedAmount - bucketedPayments.amountPaid)
        });
      }
    }
    
    // August first Friday (8/1) should be late with full rent shortfall
    expect(latePeriods).toHaveLength(1);
    expect(latePeriods[0].dueDate).toBe('2025-08-01');
    expect(latePeriods[0].shortfall).toBe(600);
  });
  
  it('should calculate correct late metrics', () => {
    // Mock a lease with multiple late periods
    const latePeriods = [
      { dueDate: '2025-07-04', shortfall: 100 },
      { dueDate: '2025-07-11', shortfall: 200 },
      { dueDate: '2025-07-18', shortfall: 150 }
    ];
    
    const oldestPeriod = latePeriods.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    const daysLate = Math.floor((new Date(today).getTime() - new Date(oldestPeriod.dueDate).getTime()) / (24 * 60 * 60 * 1000));
    const totalOwedLate = latePeriods.reduce((sum, p) => sum + p.shortfall, 0);
    
    expect(daysLate).toBe(37); // 7/4 to 8/10
    expect(totalOwedLate).toBe(450); // 100 + 200 + 150
    expect(latePeriods.length).toBe(3);
    expect(oldestPeriod.dueDate).toBe('2025-07-04');
  });
});
