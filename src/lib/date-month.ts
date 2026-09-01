import { BUSINESS_TIMEZONE } from "@/lib/business-date";

/** YYYY-MM in America/New_York — matches server profit/dashboard business month. */
export function toBusinessMonthKey(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

/** Parse `<input type="month">` value as the first day of that month (local). */
export function parseMonthInputValue(value: string): Date {
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

/** Move a YYYY-MM key by delta months (timezone-safe calendar math). */
export function shiftMonthKey(monthKey: string, delta: number): string {
  let year = Number(monthKey.slice(0, 4));
  let month = Number(monthKey.slice(5, 7));
  month += delta;
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Inclusive calendar bounds for a business month key. */
export function monthBounds(monthKey: string): { start: string; end: string } {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const start = `${monthKey}-01`;
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start, end };
}

/** Profit rent-collected queries always span the full selected month (incl. future). */
export function profitCollectionQueryRange(monthKey: string): {
  start: string;
  end: string;
} {
  return monthBounds(monthKey);
}

/** Human-readable label for a YYYY-MM key. */
export function formatMonthKeyLabel(monthKey: string): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}
