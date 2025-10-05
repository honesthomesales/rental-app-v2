/**
 * Cadence Normalization Utilities
 * 
 * Provides consistent normalization of rent cadence strings to handle
 * various spellings and formats from the database.
 */

export type Cadence = 'weekly' | 'biweekly' | 'monthly';

/**
 * Normalizes a raw cadence value to a standard Cadence type.
 * Handles various spellings, formats, and edge cases.
 * 
 * @param raw - Raw cadence value from database or user input
 * @returns Normalized cadence or null if unrecognized
 */
export function normalizeCadence(raw: unknown): Cadence | null {
  if (raw === null || raw === undefined) return null;
  
  // Convert to string and normalize whitespace/separators
  const s = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ');
  
  // Weekly patterns
  if (/^weekly$|^week$|^every week$/.test(s)) {
    return 'weekly';
  }
  
  // Biweekly patterns
  if (/^biweekly$|^bi weekly$|^every 2 weeks$|^fortnight$/.test(s)) {
    return 'biweekly';
  }
  
  // Monthly patterns - expanded to catch more variations
  if (/^monthly$|^month$|^every month$|^mo$|^mth$|^Monthly$|^MONTHLY$|^Month$|^MONTH$/.test(s)) {
    return 'monthly';
  }
  
  // Fallback: if it contains "month" anywhere, treat as monthly
  if (/month/i.test(s)) {
    return 'monthly';
  }
  
  return null;
}
