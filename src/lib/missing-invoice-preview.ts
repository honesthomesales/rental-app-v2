/**
 * Pure missing-invoice schedule preview.
 * Calculates expected invoice periods and flags gaps vs existing invoices.
 * Never writes to the database.
 */

import { normalizeCadence, type Cadence } from "@/lib/rent/cadence";
import {
  applyPreviewSafetyToScheduleInput,
  getPreviewPaidThrough,
  isRejectedPreviewDueDate,
} from "@/lib/lease-preview-safety";
import { resolveBusinessDate } from "@/lib/business-date";
import { resolveInvoiceScheduleEnd } from "@/lib/lease-status";
import { rentAmountForDueDate } from "@/lib/rent-change";

export type MissingInvoicePeriodClass = "past" | "current" | "future";

export type MissingInvoicePreviewRow = {
  label: "PREVIEW — NOT SAVED";
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  cadence: Cadence;
  reason: string;
  periodClass: MissingInvoicePeriodClass;
  matchingInvoiceExists: boolean;
};

export type MissingInvoicePreviewInput = {
  leaseStartDate: string;
  leaseEndDate?: string | null;
  /** When occupied/eviction with past end, schedule continues (period-to-period). */
  leaseStatus?: string | null;
  rentCadence: string | null | undefined;
  rentDueDay?: number | null;
  rentAmount?: number | null;
  existingDueDates: string[];
  /** ISO date YYYY-MM-DD; defaults to today UTC */
  asOfDate?: string;
  /** When set, preview-safety overrides (cadence / paid-through / rejected dues) apply */
  leaseId?: string;
  /** Prospective rent change: dues before this date use priorRentAmount */
  rentEffectiveDate?: string | null;
  priorRentAmount?: number | null;
};

function toDateOnly(iso: string): string {
  return iso.split("T")[0];
}

function classifyPeriod(dueDate: string, asOf: string): MissingInvoicePeriodClass {
  if (dueDate < asOf) return "past";
  if (dueDate === asOf) return "current";
  return "future";
}

function resolveEndDate(
  leaseEndDate: string | null | undefined,
  asOf: string,
  leaseStatus?: string | null,
): string {
  return resolveInvoiceScheduleEnd({
    status: leaseStatus ?? "occupied",
    leaseEndDate,
    asOfDate: asOf,
  });
}

/**
 * Build expected missing-invoice rows for a lease schedule.
 * Rows where matchingInvoiceExists is true are omitted from the returned list
 * (only gaps are returned). Every returned row is labeled PREVIEW — NOT SAVED.
 */
export function buildMissingInvoicePreview(
  input: MissingInvoicePreviewInput,
): MissingInvoicePreviewRow[] {
  const safety = input.leaseId
    ? applyPreviewSafetyToScheduleInput({
        leaseId: input.leaseId,
        rentCadence: input.rentCadence,
        rentAmount: input.rentAmount,
      })
    : {
        rentCadence: input.rentCadence || "monthly",
        rentAmount: input.rentAmount,
        overrideApplied: false,
        warning: null,
      };

  const cadence =
    normalizeCadence(safety.rentCadence || "monthly") || "monthly";
  const rentDueDay = input.rentDueDay || 1;
  const rentAmount = Number(safety.rentAmount || 0);
  const leaseStartDate = toDateOnly(input.leaseStartDate);
  const asOf = toDateOnly(
    input.asOfDate || resolveBusinessDate(null),
  );
  const endDate = resolveEndDate(input.leaseEndDate, asOf, input.leaseStatus);
  const paidThrough = input.leaseId
    ? getPreviewPaidThrough(input.leaseId)
    : null;

  const existingDueDates = new Set(
    input.existingDueDates.map((d) => toDateOnly(d)),
  );

  const gaps: MissingInvoicePreviewRow[] = [];

  const pushGap = (
    dueDate: string,
    periodStart: string,
    periodEnd: string,
  ) => {
    if (dueDate < leaseStartDate || dueDate > endDate) return;
    if (input.leaseId && isRejectedPreviewDueDate(input.leaseId, dueDate)) {
      return;
    }
    if (paidThrough && dueDate <= paidThrough.paidThroughDate) {
      return;
    }
    const matchingInvoiceExists = existingDueDates.has(dueDate);
    if (matchingInvoiceExists) return;

    const periodClass = classifyPeriod(dueDate, asOf);
    const amount = rentAmountForDueDate({
      dueDate,
      newRent: rentAmount,
      priorRent: input.priorRentAmount,
      rentEffectiveDate: input.rentEffectiveDate,
    });

    gaps.push({
      label: "PREVIEW — NOT SAVED",
      dueDate,
      periodStart,
      periodEnd,
      amount,
      cadence,
      reason: `No real invoice exists for expected ${cadence} due date ${dueDate}`,
      periodClass,
      matchingInvoiceExists: false,
    });
  };

  if (cadence === "weekly") {
    const start = new Date(leaseStartDate + "T00:00:00");
    const endDateObj = new Date(endDate + "T23:59:59");
    const current = new Date(start);
    while (current <= endDateObj) {
      const dueDate = current.toISOString().split("T")[0];
      const periodStart = dueDate;
      const periodEndDate = new Date(current);
      periodEndDate.setDate(periodEndDate.getDate() + 6);
      const periodEnd = periodEndDate.toISOString().split("T")[0];
      pushGap(dueDate, periodStart, periodEnd);
      current.setDate(current.getDate() + 7);
    }
  } else if (cadence === "biweekly") {
    const start = new Date(leaseStartDate + "T00:00:00");
    const endDateObj = new Date(endDate + "T23:59:59");
    const current = new Date(start);
    while (current <= endDateObj) {
      const dueDate = current.toISOString().split("T")[0];
      const periodStart = dueDate;
      const periodEndDate = new Date(current);
      periodEndDate.setDate(periodEndDate.getDate() + 13);
      const periodEnd = periodEndDate.toISOString().split("T")[0];
      pushGap(dueDate, periodStart, periodEnd);
      current.setDate(current.getDate() + 14);
    }
  } else {
    const start = new Date(leaseStartDate + "T00:00:00");
    const current = new Date(start.getFullYear(), start.getMonth(), 1);
    const endDateObj = new Date(endDate + "T00:00:00");
    while (current <= endDateObj) {
      const year = current.getFullYear();
      const month = current.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const dueDay = Math.min(rentDueDay, daysInMonth);
      const dueDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`;
      const periodStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const periodEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
      pushGap(dueDate, periodStart, periodEnd);
      current.setMonth(current.getMonth() + 1);
    }
  }

  return gaps;
}
