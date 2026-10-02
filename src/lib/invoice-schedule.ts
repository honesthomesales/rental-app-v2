import { normalizeCadence, type Cadence } from "@/lib/rent/cadence";

export type ScheduledInvoicePeriod = {
  cadence: Cadence;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
};

function dateOnly(date: Date): string {
  return date.toISOString().split("T")[0];
}

function parseDate(value: string): Date {
  return new Date(`${String(value).split("T")[0]}T00:00:00Z`);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function buildInvoiceSchedule(args: {
  cadence: string | null | undefined;
  scheduleStart: string;
  scheduleEnd: string;
  rentDueDay?: number | null;
}): ScheduledInvoicePeriod[] {
  const cadence = normalizeCadence(args.cadence || "monthly");
  const startDate = parseDate(args.scheduleStart);
  const endDate = parseDate(args.scheduleEnd);
  const periods: ScheduledInvoicePeriod[] = [];
  if (startDate > endDate) return periods;

  if (cadence === "weekly" || cadence === "biweekly") {
    const periodDays = cadence === "weekly" ? 7 : 14;
    for (
      let current = new Date(startDate);
      current <= endDate;
      current = addDays(current, periodDays)
    ) {
      periods.push({
        cadence,
        dueDate: dateOnly(current),
        periodStart: dateOnly(current),
        periodEnd: dateOnly(addDays(current, periodDays - 1)),
      });
    }
    return periods;
  }

  const rentDueDay = Math.max(1, Math.trunc(Number(args.rentDueDay) || 1));
  const month = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1),
  );
  while (month <= endDate) {
    const year = month.getUTCFullYear();
    const monthIndex = month.getUTCMonth();
    const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 0));
    const dueDay = Math.min(rentDueDay, monthEnd.getUTCDate());
    const dueDate = new Date(Date.UTC(year, monthIndex, dueDay));
    if (dueDate >= startDate && dueDate <= endDate) {
      periods.push({
        cadence: "monthly",
        dueDate: dateOnly(dueDate),
        periodStart: dateOnly(month),
        periodEnd: dateOnly(monthEnd),
      });
    }
    month.setUTCMonth(month.getUTCMonth() + 1);
  }
  return periods;
}

function openingMonthlyPeriod(
  leaseStart: string,
  rentDueDay: number,
): ScheduledInvoicePeriod {
  const start = parseDate(leaseStart);
  const year = start.getUTCFullYear();
  const monthIndex = start.getUTCMonth();
  const monthStart = new Date(Date.UTC(year, monthIndex, 1));
  const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 0));
  const dueDay = Math.min(
    Math.max(1, Math.trunc(rentDueDay) || 1),
    monthEnd.getUTCDate(),
  );
  return {
    cadence: "monthly",
    dueDate: dateOnly(new Date(Date.UTC(year, monthIndex, dueDay))),
    periodStart: dateOnly(monthStart),
    periodEnd: dateOnly(monthEnd),
  };
}

/**
 * Pay periods from the lease start through scheduleEnd that do not already
 * have an invoice. Monthly leases include the opening calendar month even
 * when the due day falls before the lease start date.
 */
export function listMissingPayPeriods(args: {
  cadence: string | null | undefined;
  leaseStart: string;
  scheduleEnd: string;
  rentDueDay?: number | null;
  existingPeriodStarts?: Array<string | null | undefined>;
  existingDueDates?: Array<string | null | undefined>;
}): ScheduledInvoicePeriod[] {
  const leaseStart = String(args.leaseStart || "").split("T")[0];
  const scheduleEnd = String(args.scheduleEnd || "").split("T")[0];
  if (!leaseStart || !scheduleEnd) return [];

  const periods = buildInvoiceSchedule({
    cadence: args.cadence,
    scheduleStart: leaseStart,
    scheduleEnd,
    rentDueDay: args.rentDueDay,
  });

  if (normalizeCadence(args.cadence || "monthly") === "monthly") {
    const opening = openingMonthlyPeriod(
      leaseStart,
      Math.max(1, Math.trunc(Number(args.rentDueDay) || 1)),
    );
    if (
      opening.periodStart <= scheduleEnd &&
      !periods.some((period) => period.periodStart === opening.periodStart)
    ) {
      periods.unshift(opening);
    }
  }

  const starts = new Set(
    (args.existingPeriodStarts || [])
      .map((value) => String(value || "").split("T")[0])
      .filter(Boolean),
  );
  const dues = new Set(
    (args.existingDueDates || [])
      .map((value) => String(value || "").split("T")[0])
      .filter(Boolean),
  );

  return periods.filter(
    (period) => !starts.has(period.periodStart) && !dues.has(period.dueDate),
  );
}
