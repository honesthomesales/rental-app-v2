/**
 * Unit tests for cadence utilities
 */

import { normalizeCadence } from '../cadence';

describe('cadence utilities', () => {
  describe('normalizeCadence', () => {
    it('should normalize weekly cadences', () => {
      expect(normalizeCadence('weekly')).toBe('weekly');
      expect(normalizeCadence('WEEKLY')).toBe('weekly');
      expect(normalizeCadence('week')).toBe('weekly');
    });

    it('should normalize biweekly cadences', () => {
      expect(normalizeCadence('biweekly')).toBe('biweekly');
      expect(normalizeCadence('BIWEEKLY')).toBe('biweekly');
      expect(normalizeCadence('bi-weekly')).toBe('biweekly');
      expect(normalizeCadence('every 2 weeks')).toBe('biweekly');
      expect(normalizeCadence('fortnight')).toBe('biweekly');
    });

    it('should normalize monthly cadences', () => {
      expect(normalizeCadence('monthly')).toBe('monthly');
      expect(normalizeCadence('MONTHLY')).toBe('monthly');
      expect(normalizeCadence('month')).toBe('monthly');
      expect(normalizeCadence('mo')).toBe('monthly');
      expect(normalizeCadence('mth')).toBe('monthly');
    });

    it('should return null for invalid cadences', () => {
      expect(normalizeCadence('invalid')).toBe(null);
      expect(normalizeCadence('')).toBe(null);
      expect(normalizeCadence(null)).toBe(null);
      expect(normalizeCadence(undefined)).toBe(null);
    });

    it('should handle variations and spaces', () => {
      expect(normalizeCadence('every_week')).toBe('weekly');
      expect(normalizeCadence('bi weekly')).toBe('biweekly');
      expect(normalizeCadence('every month')).toBe('monthly');
    });
  });
});
