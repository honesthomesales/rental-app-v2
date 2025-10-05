/**
 * Tests for rental period generation utilities
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { 
  generateFridayColumns, 
  calculatePeriodWindow, 
  generatePeriodsForLease,
  type Lease 
} from '../../src/lib/rent/periods';

// Set timezone to UTC for consistent tests
beforeAll(() => {
  process.env.TZ = 'UTC';
});

describe('generateFridayColumns', () => {
  it('should generate correct Friday sequence for 2025 test window', () => {
    const fridays = generateFridayColumns('2025-07-01', '2025-08-15');
    
    expect(fridays).toEqual([
      '2025-07-04',
      '2025-07-11', 
      '2025-07-18',
      '2025-07-25',
      '2025-08-01',
      '2025-08-08'
    ]);
  });
  
  it('should handle single Friday in range', () => {
    const fridays = generateFridayColumns('2025-07-04', '2025-07-04');
    expect(fridays).toEqual(['2025-07-04']);
  });
  
  it('should handle range starting on Friday', () => {
    const fridays = generateFridayColumns('2025-07-04', '2025-07-11');
    expect(fridays).toEqual(['2025-07-04', '2025-07-11']);
  });
});

describe('calculatePeriodWindow', () => {
  it('should calculate weekly period window (Sat->Fri)', () => {
    const window = calculatePeriodWindow('2025-07-04', 'weekly');
    
    expect(window.windowStart).toBe('2025-06-28T00:00:00.000Z');
    expect(window.windowEnd).toBe('2025-07-04T23:59:59.999Z');
  });
  
  it('should calculate bi-weekly period window (Sat->Fri)', () => {
    const window = calculatePeriodWindow('2025-07-11', 'biweekly');
    
    expect(window.windowStart).toBe('2025-07-05T00:00:00.000Z');
    expect(window.windowEnd).toBe('2025-07-11T23:59:59.999Z');
  });
  
  it('should calculate monthly period window (entire month)', () => {
    const window = calculatePeriodWindow('2025-07-04', 'monthly');
    
    expect(window.windowStart).toBe('2025-07-01T00:00:00.000Z');
    expect(window.windowEnd).toBe('2025-07-31T23:59:59.999Z');
  });
});

describe('generatePeriodsForLease', () => {
  const testFridays = [
    '2025-07-04', '2025-07-11', '2025-07-18', 
    '2025-07-25', '2025-08-01', '2025-08-08'
  ];
  
  it('should generate weekly periods - all Fridays active', () => {
    const lease: Lease = {
      id: 'lease-1',
      lease_start_date: '2025-07-01',
      lease_end_date: '2025-08-31',
      rent_cadence: 'Weekly',
      rent: 200
    };
    
    const periods = generatePeriodsForLease(lease, testFridays);
    
    expect(periods).toHaveLength(6);
    expect(periods.every(p => p.isActive)).toBe(true);
    expect(periods.every(p => p.cadence === 'weekly')).toBe(true);
    expect(periods.every(p => p.expectedAmount === 200)).toBe(true);
  });
  
  it('should generate bi-weekly periods - every other Friday active', () => {
    const lease: Lease = {
      id: 'lease-2', 
      lease_start_date: '2025-07-04', // Friday
      lease_end_date: '2025-08-31',
      rent_cadence: 'Bi-Weekly',
      rent: 400
    };
    
    const periods = generatePeriodsForLease(lease, testFridays);
    
    expect(periods).toHaveLength(6);
    
    // Anchor is 2025-07-04, so active periods are 7/4, 7/18, 8/1
    expect(periods[0].isActive).toBe(true);  // 2025-07-04
    expect(periods[1].isActive).toBe(false); // 2025-07-11
    expect(periods[2].isActive).toBe(true);  // 2025-07-18
    expect(periods[3].isActive).toBe(false); // 2025-07-25
    expect(periods[4].isActive).toBe(true);  // 2025-08-01
    expect(periods[5].isActive).toBe(false); // 2025-08-08
  });
  
  it('should generate monthly periods - first Friday of each month', () => {
    const lease: Lease = {
      id: 'lease-3',
      lease_start_date: '2025-07-01',
      lease_end_date: '2025-08-31', 
      rent_cadence: 'Monthly',
      rent: 490
    };
    
    const periods = generatePeriodsForLease(lease, testFridays);
    
    expect(periods).toHaveLength(6);
    
    // July first Friday = 2025-07-04, August first Friday = 2025-08-01
    expect(periods[0].isActive).toBe(true);  // 2025-07-04 (first Friday of July)
    expect(periods[1].isActive).toBe(false); // 2025-07-11
    expect(periods[2].isActive).toBe(false); // 2025-07-18
    expect(periods[3].isActive).toBe(false); // 2025-07-25
    expect(periods[4].isActive).toBe(true);  // 2025-08-01 (first Friday of August)
    expect(periods[5].isActive).toBe(false); // 2025-08-08
    
    expect(periods.every(p => p.cadence === 'monthly')).toBe(true);
  });
  
  it('should handle lease outside Friday range', () => {
    const lease: Lease = {
      id: 'lease-4',
      lease_start_date: '2025-09-01', // After test range
      lease_end_date: '2025-10-31',
      rent_cadence: 'Weekly', 
      rent: 300
    };
    
    const periods = generatePeriodsForLease(lease, testFridays);
    
    expect(periods).toHaveLength(6);
    expect(periods.every(p => !p.isActive)).toBe(true); // All outside lease period
  });
  
  it('should handle lease with no end date', () => {
    const lease: Lease = {
      id: 'lease-5',
      lease_start_date: '2025-07-01',
      lease_end_date: null,
      rent_cadence: 'Weekly',
      rent: 250
    };
    
    const periods = generatePeriodsForLease(lease, testFridays);
    
    expect(periods.every(p => p.isActive)).toBe(true); // All active (no end date)
  });
});
