import {
  formatMonthKeyLabel,
  monthBounds,
  profitCollectionQueryRange,
  shiftMonthKey,
  toBusinessMonthKey,
} from "@/lib/date-month";

describe("toBusinessMonthKey", () => {
  it("uses America/New_York for the business month", () => {
    const utcLateNight = new Date("2026-09-01T03:30:00.000Z");
    expect(toBusinessMonthKey(utcLateNight)).toBe("2026-08");
  });
});

describe("shiftMonthKey", () => {
  it("moves across year boundaries", () => {
    expect(shiftMonthKey("2026-12", 1)).toBe("2027-01");
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
  });
});

describe("profitCollectionQueryRange", () => {
  it("uses the full calendar month for future months (not capped at business date)", () => {
    const range = profitCollectionQueryRange("2026-12");
    expect(range).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    expect(range.start <= range.end).toBe(true);
  });

  it("matches monthBounds", () => {
    expect(profitCollectionQueryRange("2026-02")).toEqual(
      monthBounds("2026-02"),
    );
  });
});

describe("formatMonthKeyLabel", () => {
  it("formats a month key for display", () => {
    expect(formatMonthKeyLabel("2026-09")).toBe("September 2026");
  });
});
