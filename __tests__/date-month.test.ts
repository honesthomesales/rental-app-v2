import { toBusinessMonthKey } from "@/lib/date-month";

describe("toBusinessMonthKey", () => {
  it("uses America/New_York for the business month", () => {
    const utcLateNight = new Date("2026-09-01T03:30:00.000Z");
    expect(toBusinessMonthKey(utcLateNight)).toBe("2026-08");
  });
});
