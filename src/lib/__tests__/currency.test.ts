/**
 * Unit tests for currency utilities
 */

import { toUSD } from '../currency';

describe('currency utilities', () => {
  describe('toUSD', () => {
    it('should format a number to USD currency string', () => {
      expect(toUSD(1234.56)).toBe('$1,234.56');
    });

    it('should format a string number to USD currency string', () => {
      expect(toUSD('987.65')).toBe('$987.65');
    });

    it('should handle zero correctly', () => {
      expect(toUSD(0)).toBe('$0.00');
      expect(toUSD('0')).toBe('$0.00');
    });

    it('should handle negative numbers correctly', () => {
      expect(toUSD(-100.25)).toBe('-$100.25');
      expect(toUSD('-50.00')).toBe('-$50.00');
    });

    it('should round to two decimal places', () => {
      expect(toUSD(100.123)).toBe('$100.12');
      expect(toUSD(100.129)).toBe('$100.13');
    });

    it('should return $0.00 for invalid number inputs', () => {
      expect(toUSD(NaN)).toBe('$0.00');
      expect(toUSD('abc')).toBe('$0.00');
      expect(toUSD(null as any)).toBe('$0.00');
      expect(toUSD(undefined as any)).toBe('$0.00');
    });

    it('should handle large numbers', () => {
      expect(toUSD(123456789.12)).toBe('$123,456,789.12');
    });

    it('should handle numbers with more than two decimal places and round correctly', () => {
      expect(toUSD(10.999)).toBe('$11.00');
      expect(toUSD(10.001)).toBe('$10.00');
    });
  });
});