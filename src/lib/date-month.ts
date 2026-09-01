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
