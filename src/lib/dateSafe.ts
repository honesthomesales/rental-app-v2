/**
 * Date Safe Utilities
 * 
 * Provides UTC-based date operations to prevent timezone drift issues
 * in payment grid calculations.
 */

import {
  addDays,
  differenceInCalendarDays,
  parseISO,
  isValid,
  eachDayOfInterval
} from 'date-fns';

/**
 * Debug helper that logs only if NEXT_PUBLIC_DEBUG_PAYMENTS is true
 */
export function debug(...args: unknown[]): void {
  if (process.env.NEXT_PUBLIC_DEBUG_PAYMENTS === 'true') {
    console.log('[DEBUG PAYMENTS]', ...args);
  }
}

/**
 * Converts a date to UTC midnight (00:00:00 UTC)
 */
export function toUTCDate(d: Date | string): Date {
  const date = typeof d === 'string' ? parseISO(d) : d;
  
  if (!isValid(date)) {
    throw new Error(`Invalid date: ${d}`);
  }
  
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
}

/** Alias for toUTCDate for consistency */
export const toUTC = toUTCDate;

/**
 * Compares two dates using UTC year/month/date only
 */
export function sameUTCDate(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() &&
         a.getUTCMonth() === b.getUTCMonth() &&
         a.getUTCDate() === b.getUTCDate();
}

/** Alias for sameUTCDate for consistency */
export const sameUTCYMD = sameUTCDate;

/**
 * Gets all Fridays in a given month (UTC)
 */
export function fridaysInMonthUTC(year: number, month0: number): Date[] {
  const res: Date[] = [];
  const first = new Date(Date.UTC(year, month0, 1));
  const last  = new Date(Date.UTC(year, month0 + 1, 0));
  let d = new Date(first);
  while (d.getUTCDay() !== 5) d = addDaysUTC(d, 1);
  for (; d <= last; d = addDaysUTC(d, 7)) res.push(d);
  return res;
}

/**
 * Gets the first Friday on or after a given date (UTC)
 */
export function firstFridayOnOrAfter(date: Date): Date {
  const utcDate = toUTCDate(date);
  const dayOfWeek = utcDate.getUTCDay();
  
  // Friday is day 5 (0=Sunday, 1=Monday, ..., 5=Friday, 6=Saturday)
  if (dayOfWeek === 5) {
    return utcDate;
  } else if (dayOfWeek < 5) {
    // Add days to get to Friday
    return addDays(utcDate, 5 - dayOfWeek);
  } else {
    // Add days to get to next Friday
    return addDays(utcDate, 12 - dayOfWeek);
  }
}

/**
 * Gets the last second of a day in UTC
 */
export function endOfDayUTC(date: Date): Date {
  const utcDate = toUTCDate(date);
  return new Date(Date.UTC(
    utcDate.getUTCFullYear(),
    utcDate.getUTCMonth(),
    utcDate.getUTCDate(),
    23, 59, 59, 999
  ));
}

/**
 * Gets the start of a day in UTC (00:00:00 UTC)
 */
export function startOfDayUTC(date: Date): Date {
  return toUTCDate(date);
}

/**
 * Gets the start of a month in UTC
 */
export function startOfMonthUTC(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
}

/**
 * Gets the end of a month in UTC
 */
export function endOfMonthUTC(year: number, month: number): Date {
  return new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
}

/**
 * Checks if a date is within an interval (inclusive)
 */
export function isWithinIntervalUTC(
  date: Date,
  interval: { start: Date; end: Date }
): boolean {
  return date >= interval.start && date <= interval.end;
}

/**
 * Gets the difference in calendar days between two dates (UTC)
 */
export function differenceInCalendarDaysUTC(dateLeft: Date, dateRight: Date): number {
  const leftUTC = toUTCDate(dateLeft);
  const rightUTC = toUTCDate(dateRight);
  
  return differenceInCalendarDays(leftUTC, rightUTC);
}

/**
 * Finds the closest date to a target from an array of dates
 */
export function closestToUTC(target: Date, dates: Date[]): Date | undefined {
  if (dates.length === 0) return undefined;
  if (dates.length === 1) return dates[0];
  
  const targetUTC = toUTCDate(target);
  let closest = dates[0];
  let minDistance = Math.abs(differenceInCalendarDaysUTC(targetUTC, dates[0]));
  
  for (let i = 1; i < dates.length; i++) {
    const distance = Math.abs(differenceInCalendarDaysUTC(targetUTC, dates[i]));
    if (distance < minDistance) {
      minDistance = distance;
      closest = dates[i];
    }
  }
  
  return closest;
}

/**
 * Returns 'YYYY-MM-DD' string key for a date in UTC
 */
export function ymdKey(date: Date): string {
  const utcDate = toUTCDate(date);
  return utcDate.toISOString().split('T')[0];
}

/**
 * Returns 'YYYY-MM' string key for a date in UTC
 */
export function monthKey(date: Date): string {
  const utcDate = toUTCDate(date);
  const year = utcDate.getUTCFullYear();
  const month = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Gets the first day of month in UTC (00:00:00 UTC)
 */
export function firstDayOfMonthUTC(date: Date): Date {
  const utcDate = toUTCDate(date);
  return new Date(Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), 1, 0, 0, 0, 0));
}

/**
 * Gets the last day of month in UTC (23:59:59.999 UTC)
 */
export function lastDayOfMonthUTC(date: Date): Date {
  const utcDate = toUTCDate(date);
  return new Date(Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

/**
 * Adds days to a UTC date
 */
export function addDaysUTC(date: Date, days: number): Date {
  const utcDate = toUTCDate(date);
  return new Date(utcDate.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Checks if a date is within a UTC interval (inclusive)
 */
export function isWithinUTCInterval(date: Date, start: Date, end: Date): boolean {
  const dateUTC = toUTCDate(date);
  const startUTC = toUTCDate(start);
  const endUTC = toUTCDate(end);
  return dateUTC >= startUTC && dateUTC <= endUTC;
}