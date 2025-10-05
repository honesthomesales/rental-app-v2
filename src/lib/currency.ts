/**
 * Currency formatting utilities for USD
 * 
 * Handles both string and number inputs from PostgREST NUMERIC fields
 * Always formats as USD using Intl.NumberFormat
 */

/**
 * Converts a value to USD formatted string
 * Handles both string and number inputs from PostgREST NUMERIC fields
 * 
 * @param value - String or number value to format
 * @returns Formatted USD string (e.g., "$1,234.56")
 */
export function toUSD(value: string | number): string {
  // Convert to number, handling string inputs from PostgREST
  const numericValue = typeof value === 'string' ? parseFloat(value) : value;
  
  // Handle invalid inputs
  if (isNaN(numericValue)) {
    return '$0.00';
  }
  
  // Format as USD using Intl.NumberFormat
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericValue);
}

/**
 * Converts a value to USD formatted string without currency symbol
 * 
 * @param value - String or number value to format
 * @returns Formatted USD string without $ (e.g., "1,234.56")
 */
export function toUSDNoSymbol(value: string | number): string {
  const numericValue = typeof value === 'string' ? parseFloat(value) : value;
  
  if (isNaN(numericValue)) {
    return '0.00';
  }
  
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericValue);
}

/**
 * Parses a USD string back to a number
 * Handles strings like "$1,234.56" or "1,234.56"
 * 
 * @param usdString - USD formatted string
 * @returns Number value
 */
export function fromUSD(usdString: string): number {
  // Remove currency symbols and commas
  const cleanString = usdString.replace(/[$,\s]/g, '');
  return parseFloat(cleanString) || 0;
}

/**
 * Safely converts PostgREST NUMERIC to number
 * Handles both string and number inputs gracefully
 * 
 * @param value - PostgREST NUMERIC value (string | number)
 * @returns Number value, defaults to 0 for invalid inputs
 */
export function safeNumeric(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  
  const numericValue = typeof value === 'string' ? parseFloat(value) : value;
  
  return isNaN(numericValue) ? 0 : numericValue;
}
