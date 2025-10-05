/**
 * Rental Period Generation Utilities
 * 
 * This module handles the generation of rental periods based on lease cadence.
 * It implements deterministic period rules for weekly, bi-weekly, and monthly schedules.
 * 
 * NEW MONTHLY LOGIC: Uses anchor Friday + 28-day intervals aligned to headers by string keys.
 */

import {
  toUTC,
  endOfDayUTC,
  addDaysUTC,
  ymdKey,
  monthKey,
  firstDayOfMonthUTC,
  lastDayOfMonthUTC,
  fridaysInMonthUTC,
  debug
} from '../dateSafe';
import { normalizeCadence, type Cadence } from './cadence';

export interface RentalPeriod {
  friday: Date; // UTC midnight (keeping old name for compatibility)
  fridayUTC: Date; // UTC midnight
  fridayKey: string; // 'YYYY-MM-DD' string key for matching
  monthKey: string; // 'YYYY-MM' string key for monthly grouping
  isActive: boolean;
  windowStart: Date; // UTC (keeping old name for compatibility)
  windowEnd: Date; // UTC (keeping old name for compatibility)
  windowStartUTC: Date; // UTC
  windowEndUTC: Date; // UTC
  dueDate: Date; // UTC end of day (keeping old name for compatibility)
  dueDateUTC: Date; // UTC end of day
  expectedAmount: number;
  cadence?: Cadence;
}

export interface Lease {
  id: string;
  lease_start_date: string | Date;
  lease_end_date?: string | Date | null;
  rent_cadence: string;
  rent: number;
  rent_due_day?: number;
}

/**
 * Generates an array of all Fridays within the given date range (inclusive).
 * 
 * @param rangeStart - Start date (YYYY-MM-DD)
 * @param rangeEnd - End date (YYYY-MM-DD)
 * @returns Array of Friday dates in YYYY-MM-DD format
 */
export function generateFridayColumns(rangeStart: string, rangeEnd: string): string[] {
  const fridays: string[] = [];
  const start = new Date(rangeStart);
  const end = new Date(rangeEnd);
  
  // Find the first Friday on or after rangeStart
  const current = new Date(start);
  while (current.getDay() !== 5) { // 5 = Friday
    current.setDate(current.getDate() + 1);
  }
  
  // Collect all Fridays until rangeEnd
  while (current <= end) {
    fridays.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 7); // Next Friday
  }
  
  return fridays;
}

/**
 * Computes MONTHLY periods using the Friday closest to rent_due_day each month.
 * Only one active Friday per month should be shown.
 * 
 * @param lease - Lease object with monthly cadence
 * @param headerFridaysUTC - Array of header Friday dates (UTC)
 * @returns Array of RentalPeriod objects
 */
export function computeMonthlyPeriods({
  lease,
  headerFridaysUTC
}: {
  lease: Lease;
  headerFridaysUTC: Date[];
}): RentalPeriod[] {
  const cadence = normalizeCadence(lease.rent_cadence);
  if (cadence !== 'monthly') return [];

  const startHeader = toUTC(headerFridaysUTC[0]);
  const endHeader = toUTC(headerFridaysUTC[headerFridaysUTC.length - 1]);
  const leaseStart = toUTC(lease.lease_start_date);
  const leaseEnd = lease.lease_end_date ? toUTC(lease.lease_end_date) : endHeader;

  debug('🔥 MONTHLY CADENCE - Computing periods:', {
    leaseId: lease.id,
    rentDueDay: lease.rent_due_day,
    headerRange: `${ymdKey(startHeader)} to ${ymdKey(endHeader)}`,
    leaseRange: `${ymdKey(leaseStart)} to ${ymdKey(leaseEnd)}`
  });
  
  console.log('🔥 MONTHLY CADENCE DEBUG - Starting period generation for lease:', lease.id);

  const rentDueDay = lease.rent_due_day ?? 1;
  
  // Create a map to track which months have active Fridays
  const activeFridaysByMonth: Record<string, Date> = {};
  
  // Process each month in the header range to find the active Friday
  const startMonth = firstDayOfMonthUTC(startHeader);
  const endMonth = lastDayOfMonthUTC(endHeader);
  
  console.log(`🔥 MONTHLY DEBUG - Date range:`, {
    startHeader: ymdKey(startHeader),
    endHeader: ymdKey(endHeader),
    startMonth: ymdKey(startMonth),
    endMonth: ymdKey(endMonth),
    leaseStart: ymdKey(leaseStart),
    leaseEnd: ymdKey(leaseEnd)
  });
  
  // Group header Fridays by month
  const fridaysByMonth: Record<string, Date[]> = {};
  headerFridaysUTC.forEach(friday => {
    const monthKeyStr = monthKey(friday);
    if (!fridaysByMonth[monthKeyStr]) {
      fridaysByMonth[monthKeyStr] = [];
    }
    fridaysByMonth[monthKeyStr].push(friday);
  });
  
  console.log(`🔥 MONTHLY DEBUG - Fridays by month:`, Object.entries(fridaysByMonth).map(([month, fridays]) => ({
    month,
    fridays: fridays.map(f => ymdKey(f))
  })));
  
  // For each month that has Fridays in the header range, find the active one
  Object.entries(fridaysByMonth).forEach(([monthKeyStr, monthFridays]) => {
    console.log(`🔥 MONTHLY DEBUG - Processing month ${monthKeyStr} with ${monthFridays.length} Fridays`);
    
    // Check if this month is within the lease period
    const firstFriday = monthFridays[0];
    const monthStart = firstDayOfMonthUTC(firstFriday);
    const monthEnd = lastDayOfMonthUTC(firstFriday);
    const inLease = monthStart <= leaseEnd && (leaseEnd ? monthEnd >= leaseStart : true);
    
    if (inLease && monthFridays.length > 0) {
      // Find the Friday closest to rent_due_day
      let closestFriday: Date | null = null;
      
      // First, check for exact match
      const exactMatch = monthFridays.find(f => f.getUTCDate() === rentDueDay);
      if (exactMatch) {
        closestFriday = exactMatch;
      } else {
        // Rule: Always prefer the Friday that comes BEFORE the rent_due_day
        const fridaysBeforeDue = monthFridays.filter(f => f.getUTCDate() <= rentDueDay);
        if (fridaysBeforeDue.length > 0) {
          // Choose the Friday before the rent_due_day that is closest to it
          closestFriday = fridaysBeforeDue.reduce((closest, current) => {
            const currentDistance = Math.abs(current.getUTCDate() - rentDueDay);
            const closestDistance = Math.abs(closest.getUTCDate() - rentDueDay);
            return currentDistance < closestDistance ? current : closest;
          });
        } else {
          // If no Friday comes before the rent_due_day, choose the closest one overall
          closestFriday = monthFridays.reduce((closest, current) => {
            const currentDistance = Math.abs(current.getUTCDate() - rentDueDay);
            const closestDistance = Math.abs(closest.getUTCDate() - rentDueDay);
            return currentDistance < closestDistance ? current : closest;
          });
        }
      }
      
      console.log(`🔥 MONTHLY DEBUG - Closest Friday to day ${rentDueDay}:`, closestFriday ? ymdKey(closestFriday) : 'none');
      
      if (closestFriday) {
        activeFridaysByMonth[monthKeyStr] = closestFriday;
        
        debug(`Generated monthly period for ${ymdKey(closestFriday)}:`, {
          fridayDate: ymdKey(closestFriday),
          rentDueDay,
          monthFridays: monthFridays.map(f => ymdKey(f)),
          isActive: true,
          monthKey: monthKeyStr
        });
      }
    }
  });
  
  console.log(`🔥 MONTHLY DEBUG - Active Fridays by month:`, Object.entries(activeFridaysByMonth).map(([month, friday]) => ({
    month,
    friday: ymdKey(friday)
  })));
  
  // Now map header Fridays to periods - only show active Fridays
  console.log(`🔥 MONTHLY DEBUG - Mapping ${headerFridaysUTC.length} header Fridays to periods`);
  
  return headerFridaysUTC.map((hdr) => {
    const h = toUTC(hdr);
    const hKey = ymdKey(h);
    const monthKeyStr = monthKey(h);
    const inLease = h >= leaseStart && h <= leaseEnd;
    
    // Check if this Friday is the active Friday for its month
    const activeFridayForMonth = activeFridaysByMonth[monthKeyStr];
    const isActiveFriday = activeFridayForMonth && hKey === ymdKey(activeFridayForMonth);
    
    if (isActiveFriday) {
      console.log(`🔥 MONTHLY DEBUG - Header Friday ${hKey} is active for month ${monthKeyStr}`);
      
      const windowStartUTC = firstDayOfMonthUTC(h);
      const windowEndUTC = lastDayOfMonthUTC(h);
      const dueDateUTC = endOfDayUTC(h);
      
      debug(`Header Friday ${hKey} is active monthly period:`, {
        fridayDate: hKey,
        isActive: true,
        inLease,
        windowStart: ymdKey(windowStartUTC),
        windowEnd: ymdKey(windowEndUTC)
      });
      
      return {
        friday: h, // Compatibility
        fridayUTC: h,
        fridayKey: hKey,
        monthKey: monthKeyStr,
        isActive: true,
        windowStart: windowStartUTC, // Compatibility
        windowEnd: windowEndUTC, // Compatibility
        windowStartUTC,
        windowEndUTC,
        dueDate: dueDateUTC, // Compatibility
        dueDateUTC,
        expectedAmount: lease.rent,
        cadence
      };
    } else {
      // This Friday is not the active Friday for its month
      const windowStartUTC = firstDayOfMonthUTC(h);
      const windowEndUTC = lastDayOfMonthUTC(h);
      const dueDateUTC = endOfDayUTC(h);
      
      console.log(`🔥 MONTHLY DEBUG - Header Friday ${hKey} is not active for month ${monthKeyStr}`);
      
      debug(`Header Friday ${hKey} is not active monthly period:`, {
        fridayDate: hKey,
        isActive: false,
        inLease,
        windowStart: ymdKey(windowStartUTC),
        windowEnd: ymdKey(windowEndUTC)
      });
      
      return {
        friday: h, // Compatibility
        fridayUTC: h,
        fridayKey: hKey,
        monthKey: monthKeyStr,
        isActive: false,
        windowStart: windowStartUTC, // Compatibility
        windowEnd: windowEndUTC, // Compatibility
        windowStartUTC,
        windowEndUTC,
        dueDate: dueDateUTC, // Compatibility
        dueDateUTC,
        expectedAmount: lease.rent,
        cadence
      };
    }
  });
}

/**
 * Generates rental periods for a lease based on its cadence.
 * Uses new logic when NEXT_PUBLIC_USE_CADENCE_FIX is enabled.
 * 
 * @param lease - Lease object
 * @param fridays - Array of Friday dates to consider (YYYY-MM-DD strings)
 * @returns Array of RentalPeriod objects
 */
export function generatePeriodsForLease(lease: Lease, fridays: string[]): RentalPeriod[] {
  const useCadenceFix = process.env.NEXT_PUBLIC_USE_CADENCE_FIX === 'true';
  const cadence = normalizeCadence(lease.rent_cadence);
  
  console.log(`🔥 PERIOD GENERATION - Lease ${lease.id}:`, {
    raw: lease.rent_cadence,
    normalized: cadence,
    useCadenceFix,
    isMonthly: cadence === 'monthly'
  });
  
  if (!useCadenceFix) {
    console.log(`🔥 PERIOD GENERATION - Using legacy logic for lease ${lease.id}`);
    // Return old behavior when flag is off
    return generatePeriodsForLeaseLegacy(lease, fridays);
  }
  
  const headerFridaysUTC = fridays.map(f => toUTC(f));
  const leaseStart = toUTC(lease.lease_start_date);
  const leaseEnd = lease.lease_end_date ? toUTC(lease.lease_end_date) : null;
  
  debug(`Generating periods for lease ${lease.id}:`, {
    cadence: `"${lease.rent_cadence}" -> "${cadence}"`,
    leaseRange: `${ymdKey(leaseStart)} to ${leaseEnd ? ymdKey(leaseEnd) : 'open'}`,
    headerRange: `${fridays[0]} to ${fridays[fridays.length - 1]}`
  });

  if (cadence === 'monthly') {
    console.log(`🔥 MONTHLY PERIOD GENERATION - Using new logic for lease ${lease.id}`);
    // Use new monthly logic
    return computeMonthlyPeriods({ lease, headerFridaysUTC });
  }
  
  // Fallback: if raw cadence contains "month", treat as monthly
  const rawCadence = lease.rent_cadence?.toLowerCase() || '';
  if (rawCadence.includes('month')) {
    console.log(`🔥 MONTHLY FALLBACK - Raw cadence contains 'month' for lease ${lease.id}: ${lease.rent_cadence}`);
    return computeMonthlyPeriods({ lease, headerFridaysUTC });
  }

  // Weekly and biweekly logic (unchanged)
  return headerFridaysUTC.map(fridayUTC => {
    const fridayKey = ymdKey(fridayUTC);
    const isWithinLease = fridayUTC >= leaseStart && (leaseEnd ? fridayUTC <= leaseEnd : true);
    
    let isActive = false;
    
    if (isWithinLease) {
      switch (cadence) {
        case 'weekly':
          isActive = true;
          break;
          
        case 'biweekly':
          // Simple approach: every other Friday is active, starting from index 0
          const currentIndex = fridays.findIndex(f => f === fridayKey);
          isActive = currentIndex >= 0 && currentIndex % 2 === 0;
          break;
      }
    }
    
    // Weekly/biweekly window: Sat 00:00:00 UTC → Fri 23:59:59 UTC
    const windowStartUTC = addDaysUTC(fridayUTC, -6); // Previous Saturday
    const windowEndUTC = endOfDayUTC(fridayUTC);
    const dueDateUTC = endOfDayUTC(fridayUTC);
    
    return {
      friday: fridayUTC, // Compatibility
      fridayUTC,
      fridayKey,
      monthKey: monthKey(fridayUTC),
      isActive,
      windowStart: windowStartUTC, // Compatibility
      windowEnd: windowEndUTC, // Compatibility
      windowStartUTC,
      windowEndUTC,
      dueDate: dueDateUTC, // Compatibility
      dueDateUTC,
      expectedAmount: lease.rent,
      cadence
    };
  });
}

/**
 * Legacy period generation (old behavior when flag is off)
 */
function generatePeriodsForLeaseLegacy(lease: Lease, fridays: string[]): RentalPeriod[] {
  const leaseStart = new Date(lease.lease_start_date);
  const leaseEnd = lease.lease_end_date ? new Date(lease.lease_end_date) : null;
  const cadence = normalizeCadence(lease.rent_cadence);
  
  return fridays.map(fridayDate => {
    const friday = new Date(fridayDate);
    const fridayUTC = toUTC(friday);
    const isWithinLease = friday >= leaseStart && (leaseEnd ? friday <= leaseEnd : true);
    
    let isActive = false;
    
    if (isWithinLease) {
      switch (cadence) {
        case 'weekly':
          isActive = true;
          break;
          
        case 'biweekly':
          // Find first Friday on or after lease start
          const anchor = new Date(leaseStart);
          while (anchor.getDay() !== 5) {
            anchor.setDate(anchor.getDate() + 1);
          }
          
          // Check if this Friday is anchor + k*14 days
          const daysDiff = Math.floor((friday.getTime() - anchor.getTime()) / (24 * 60 * 60 * 1000));
          isActive = daysDiff >= 0 && daysDiff % 14 === 0;
          break;
          
        case 'monthly':
          // Old monthly logic: Friday closest to rent_due_day each month
          const rentDueDay = lease.rent_due_day || 1;
          const year = friday.getFullYear();
          const month = friday.getMonth();
          
          const fridaysInMonth: Date[] = [];
          for (let day = 1; day <= new Date(year, month + 1, 0).getDate(); day++) {
            const date = new Date(year, month, day);
            if (date.getDay() === 5) {
              fridaysInMonth.push(new Date(date));
            }
          }
          
          let closestFriday: Date | null = null;
          let minDistance = Infinity;
          
          for (const fridayCandidate of fridaysInMonth) {
            const distance = Math.abs(fridayCandidate.getDate() - rentDueDay);
            if (distance < minDistance) {
              minDistance = distance;
              closestFriday = fridayCandidate;
            }
          }
          
          if (closestFriday) {
            isActive = friday.getTime() === closestFriday.getTime();
          }
          break;
      }
    }
    
    // Legacy window calculation
    let windowStartUTC: Date;
    let windowEndUTC: Date;
    
    if (cadence === 'monthly') {
      windowStartUTC = firstDayOfMonthUTC(fridayUTC);
      windowEndUTC = lastDayOfMonthUTC(fridayUTC);
    } else {
      windowStartUTC = addDaysUTC(fridayUTC, -6);
      windowEndUTC = endOfDayUTC(fridayUTC);
    }
    
    return {
      friday: fridayUTC, // Compatibility
      fridayUTC,
      fridayKey: ymdKey(fridayUTC),
      monthKey: monthKey(fridayUTC),
      isActive,
      windowStart: windowStartUTC, // Compatibility
      windowEnd: windowEndUTC, // Compatibility
      windowStartUTC,
      windowEndUTC,
      dueDate: endOfDayUTC(fridayUTC), // Compatibility
      dueDateUTC: endOfDayUTC(fridayUTC),
      expectedAmount: lease.rent,
      cadence
    };
  });
}

// Legacy export for backward compatibility
export { generatePeriodsForLease as generatePeriodsForLease };

// Re-export types for backward compatibility
export type { RentalPeriod as RentalPeriod };
export type { Lease as Lease };