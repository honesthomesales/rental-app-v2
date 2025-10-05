/**
 * Payment Bucketing Utilities
 * 
 * This module handles the bucketing of payments into rental periods
 * using deterministic date windows and monthly allocation logic.
 */

import { toUTC, monthKey, debug } from '../dateSafe';
import { normalizeCadence } from './cadence';

export interface Payment {
  id: string;
  lease_id?: string | null;
  property_id?: string | null;
  tenant_id?: string | null;
  payment_date: string;
  amount: number;
  payment_type: string;
  notes?: string;
}

export interface BucketedPayments {
  amountPaid: number;
  payments: Array<{
    id: string;
    date: string;
    amount: number;
    type: string;
    notes?: string;
  }>;
}

export interface Lease {
  id: string;
  property_id?: string | null;
  tenant_id?: string | null;
  rent_cadence?: string;
}

export interface Period {
  fridayKey: string;
  monthKey: string;
  isActive: boolean;
  expectedAmount: number;
  amountPaid?: number;
  windowStart?: Date;
  windowEnd?: Date;
  windowStartUTC?: Date;
  windowEndUTC?: Date;
}

/**
 * Buckets payments into periods based on cadence rules.
 * For MONTHLY: assigns payments to active Friday only per month.
 * For WEEKLY/BIWEEKLY: uses standard window-based bucketing.
 * 
 * @param lease - Lease object
 * @param periods - Array of periods for this lease
 * @param payments - Array of payments to bucket
 * @returns Updated periods array with amountPaid populated
 */
export function bucketPayments({
  lease,
  periods,
  payments
}: {
  lease: Lease;
  periods: Period[];
  payments: Payment[];
}): Period[] {
  const cadence = normalizeCadence(lease.rent_cadence || '');
  
  // Initialize all periods with 0 payments
  periods.forEach(p => (p.amountPaid = 0));

  if (cadence === 'monthly') {
    // MONTHLY: Use activeByMonth mapping
    const activeByMonth: Record<string, string> = {};
    const periodByKey: Record<string, Period> = {};
    
    for (const p of periods) {
      if (p.isActive) activeByMonth[p.monthKey] = p.fridayKey;
      periodByKey[p.fridayKey] = p;
    }

    debug('Monthly bucketing setup:', {
      leaseId: lease.id,
      activeByMonth,
      totalPayments: payments.length
    });

    for (const pay of payments) {
      // Prefer exact lease match; fallback only if lease_id is null
      if (pay.lease_id && pay.lease_id !== lease.id) continue;
      if (!pay.lease_id && (pay.property_id !== lease.property_id || pay.tenant_id !== lease.tenant_id)) continue;

      const d = toUTC(pay.payment_date);
      const mk = monthKey(d);
      const activeFridayKey = activeByMonth[mk];
      
      if (activeFridayKey && periodByKey[activeFridayKey]) {
        periodByKey[activeFridayKey].amountPaid! += Number(pay.amount || 0);
        debug(`Assigned payment ${pay.id} ($${pay.amount}) to active Friday ${activeFridayKey} for month ${mk}`);
      } else {
        debug(`Payment ${pay.id} in month ${mk} has no active Friday - not assigned`);
      }
    }
    
    return periods;
  }

  // WEEKLY/BIWEEKLY: Use existing window-based logic (unchanged)
  for (const period of periods) {
    if (!period.windowStart || !period.windowEnd) continue;
    
    for (const payment of payments) {
      // Check lease match
      const matchesLease = payment.lease_id === lease.id ||
        (payment.lease_id === null && payment.property_id === lease.property_id && payment.tenant_id === lease.tenant_id);
      
      if (!matchesLease) continue;
      
      // Check if payment falls within window
      const paymentDate = toUTC(payment.payment_date);
      if (paymentDate >= period.windowStart && paymentDate <= period.windowEnd) {
        period.amountPaid! += Number(payment.amount || 0);
      }
    }
  }

  return periods;
}

/**
 * Buckets payments for a specific lease and period.
 * 
 * @param lease - Lease object
 * @param windowStart - Period window start (Date object)
 * @param windowEnd - Period window end (Date object)
 * @param allPayments - All payments to consider
 * @returns Bucketed payments for this period
 */
export function bucketPaymentsForPeriod(
  lease: Lease,
  windowStart: Date,
  windowEnd: Date,
  allPayments: Payment[]
): BucketedPayments {
  const useCadenceFix = process.env.NEXT_PUBLIC_USE_CADENCE_FIX === 'true';
  
  if (!useCadenceFix) {
    // Return old behavior when flag is off
    return bucketPaymentsForPeriodLegacy(lease, windowStart.toISOString(), windowEnd.toISOString(), allPayments);
  }
  
  debug(`Bucketing payments for lease ${lease.id}:`, {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    totalPayments: allPayments.length
  });
  
  // Filter payments that match this lease and fall within the window
  const matchingPayments = allPayments.filter(payment => {
    // Check if payment matches lease
    const matchesLease = payment.lease_id === lease.id ||
      (payment.lease_id === null && payment.property_id === lease.property_id && payment.tenant_id === lease.tenant_id);
    
    if (!matchesLease) return false;
    
    // Check if payment falls within window (UTC)
    const paymentDate = toUTC(payment.payment_date);
    return paymentDate >= windowStart && paymentDate <= windowEnd;
  });
  
  debug(`Found ${matchingPayments.length} matching payments:`, 
    matchingPayments.map(p => ({
      id: p.id,
      date: p.payment_date,
      amount: p.amount,
      lease_id: p.lease_id
    }))
  );
  
  // Calculate total amount and format payment details
  const amountPaid = matchingPayments.reduce((sum, payment) => sum + payment.amount, 0);
  
  const payments = matchingPayments.map(payment => ({
    id: payment.id,
    date: payment.payment_date,
    amount: payment.amount,
    type: payment.payment_type,
    notes: payment.notes
  }));
  
  return {
    amountPaid,
    payments
  };
}

/**
 * Legacy payment bucketing (old behavior when flag is off)
 */
function bucketPaymentsForPeriodLegacy(
  lease: Lease,
  windowStart: string,
  windowEnd: string,
  allPayments: Payment[]
): BucketedPayments {
  const windowStartDate = new Date(windowStart);
  const windowEndDate = new Date(windowEnd);
  
  // Filter payments that match this lease and fall within the window
  const matchingPayments = allPayments.filter(payment => {
    // Check if payment matches lease
    const matchesLease = payment.lease_id === lease.id ||
      (payment.property_id === lease.property_id && payment.tenant_id === lease.tenant_id);
    
    if (!matchesLease) return false;
    
    // Check if payment falls within window
    const paymentDate = new Date(payment.payment_date);
    return paymentDate >= windowStartDate && paymentDate <= windowEndDate;
  });
  
  // Calculate total amount and format payment details
  const amountPaid = matchingPayments.reduce((sum, payment) => sum + payment.amount, 0);
  
  const payments = matchingPayments.map(payment => ({
    id: payment.id,
    date: payment.payment_date,
    amount: payment.amount,
    type: payment.payment_type,
    notes: payment.notes
  }));
  
  return {
    amountPaid,
    payments
  };
}

/**
 * Creates optimized payment maps for efficient lookup.
 * 
 * @param allPayments - All payments to map
 * @returns Object with payment maps by lease_id and by property_id+tenant_id
 */
export function createPaymentMaps(allPayments: Payment[]): {
  paymentsByLeaseId: Map<string, Payment[]>;
  paymentsByPropTenant: Map<string, Payment[]>;
} {
  const paymentsByLeaseId = new Map<string, Payment[]>();
  const paymentsByPropTenant = new Map<string, Payment[]>();
  
  for (const payment of allPayments) {
    // Map by lease_id if available
    if (payment.lease_id) {
      if (!paymentsByLeaseId.has(payment.lease_id)) {
        paymentsByLeaseId.set(payment.lease_id, []);
      }
      paymentsByLeaseId.get(payment.lease_id)!.push(payment);
    }
    
    // Map by property_id + tenant_id for fallback
    if (payment.property_id && payment.tenant_id) {
      const key = `${payment.property_id}-${payment.tenant_id}`;
      if (!paymentsByPropTenant.has(key)) {
        paymentsByPropTenant.set(key, []);
      }
      paymentsByPropTenant.get(key)!.push(payment);
    }
  }
  
  return { paymentsByLeaseId, paymentsByPropTenant };
}

/**
 * Gets all payments for a lease using optimized maps.
 * 
 * @param lease - Lease object
 * @param paymentMaps - Pre-built payment maps
 * @returns Array of payments for this lease
 */
export function getPaymentsForLease(
  lease: Lease,
  paymentMaps: {
    paymentsByLeaseId: Map<string, Payment[]>;
    paymentsByPropTenant: Map<string, Payment[]>;
  }
): Payment[] {
  const payments: Payment[] = [];
  
  // Get payments by lease_id (preferred)
  const leasePayments = paymentMaps.paymentsByLeaseId.get(lease.id) || [];
  payments.push(...leasePayments);
  
  // Get payments by property_id + tenant_id (fallback)
  if (lease.property_id && lease.tenant_id) {
    const key = `${lease.property_id}-${lease.tenant_id}`;
    const propTenantPayments = paymentMaps.paymentsByPropTenant.get(key) || [];
    
    // Avoid duplicates (payments that have both lease_id and property_id+tenant_id)
    for (const payment of propTenantPayments) {
      if (!payment.lease_id || payment.lease_id !== lease.id) {
        payments.push(payment);
      }
    }
  }
  
  return payments;
}

/**
 * Buckets payments for MONTHLY cadence using activeByMonth mapping.
 * Only assigns payments to the active Friday in each month.
 * 
 * @param lease - Lease object
 * @param periods - All periods for this lease
 * @param allPayments - All payments to consider
 * @returns Map of fridayKey -> BucketedPayments
 */
export function bucketMonthlyPayments(
  lease: Lease,
  periods: Array<{ fridayKey: string; monthKey: string; isActive: boolean; windowStart?: Date; windowEnd?: Date; windowStartUTC?: Date; windowEndUTC?: Date }>,
  allPayments: Payment[]
): Map<string, BucketedPayments> {
  const useCadenceFix = process.env.NEXT_PUBLIC_USE_CADENCE_FIX === 'true';
  
  if (!useCadenceFix) {
    // Fallback to regular bucketing for each period
    const result = new Map<string, BucketedPayments>();
    periods.forEach(period => {
      if (period.windowStart && period.windowEnd) {
        const bucketed = bucketPaymentsForPeriod(lease, period.windowStart, period.windowEnd, allPayments);
        result.set(period.fridayKey, bucketed);
      } else {
        result.set(period.fridayKey, { amountPaid: 0, payments: [] });
      }
    });
    return result;
  }

  // Build activeByMonth dictionary: month -> active Friday key
  const activeByMonth: Record<string, string> = {};
  periods.forEach(period => {
    if (period.isActive) {
      activeByMonth[period.monthKey] = period.fridayKey;
    }
  });

  debug(`Monthly payment bucketing - activeByMonth:`, activeByMonth);

  // Initialize result map with empty buckets for all periods
  const result = new Map<string, BucketedPayments>();
  periods.forEach(period => {
    result.set(period.fridayKey, { amountPaid: 0, payments: [] });
  });

  // Filter payments that match this lease
  const leasePayments = allPayments.filter(payment => {
    return payment.lease_id === lease.id ||
      (payment.lease_id === null && payment.property_id === lease.property_id && payment.tenant_id === lease.tenant_id);
  });

  debug(`Found ${leasePayments.length} payments for lease ${lease.id}`);

  // Assign each payment to its month's active Friday (if any)
  leasePayments.forEach(payment => {
    const paymentDate = toUTC(payment.payment_date);
    const mk = monthKey(paymentDate);
    const activeFridayKey = activeByMonth[mk];

    if (activeFridayKey) {
      // This month has an active Friday in view, assign payment to it
      const bucket = result.get(activeFridayKey)!;
      bucket.amountPaid += payment.amount;
      bucket.payments.push({
        id: payment.id,
        date: payment.payment_date,
        amount: payment.amount,
        type: payment.payment_type,
        notes: payment.notes
      });

      debug(`Assigned payment ${payment.id} (${payment.amount}) to active Friday ${activeFridayKey} for month ${mk}`);
    } else {
      debug(`Payment ${payment.id} in month ${mk} has no active Friday in view - not assigned`);
    }
  });

  return result;
}