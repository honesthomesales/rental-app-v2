/**
 * Rent-specific types for the batched period-invoice mapping system
 */

// Period invoice row from RENT_period_invoice_map_many RPC
export type PeriodInvoiceRow = {
  lease_id: string;
  property_id: string | null;
  tenant_id: string | null;
  cadence: 'Weekly' | 'Biweekly' | 'Monthly';
  period_start: string; // YYYY-MM-DD
  period_end: string;   // YYYY-MM-DD
  due_date: string;     // YYYY-MM-DD
  invoice_id: string | null;
  billed_total: number; // from invoice if present, else 0 or generated
  paid_to_rent: number; // sum allocs
  paid_to_late: number; // sum allocs
  balance_due: number;  // billed_total - (paid_to_rent + paid_to_late)
  is_missing_invoice: boolean;
};

// Request payload for the batched period-map API
export type PeriodMapRequest = {
  leaseIds: string[];
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
};

// Response from the batched period-map API
export type PeriodMapResponse = {
  rows: PeriodInvoiceRow[];
};

// Feature flag configuration
export type BatchPeriodMapConfig = {
  useBatchPeriodMap: boolean;
  maxLeaseIds: number;
  maxDateRangeMonths: number;
};
