import fs from "node:fs";
import path from "node:path";
import { buildInvoiceSchedule } from "@/lib/invoice-schedule";

describe("cadence-safe invoice scheduling", () => {
  it("creates only consecutive 7-day weekly periods", () => {
    expect(
      buildInvoiceSchedule({
        cadence: "weekly",
        scheduleStart: "2026-07-15",
        scheduleEnd: "2026-08-05",
      }),
    ).toEqual([
      {
        cadence: "weekly",
        dueDate: "2026-07-15",
        periodStart: "2026-07-15",
        periodEnd: "2026-07-21",
      },
      {
        cadence: "weekly",
        dueDate: "2026-07-22",
        periodStart: "2026-07-22",
        periodEnd: "2026-07-28",
      },
      {
        cadence: "weekly",
        dueDate: "2026-07-29",
        periodStart: "2026-07-29",
        periodEnd: "2026-08-04",
      },
      {
        cadence: "weekly",
        dueDate: "2026-08-05",
        periodStart: "2026-08-05",
        periodEnd: "2026-08-11",
      },
    ]);
  });

  it("creates only consecutive 14-day biweekly periods", () => {
    expect(
      buildInvoiceSchedule({
        cadence: "biweekly",
        scheduleStart: "2026-07-15",
        scheduleEnd: "2026-08-05",
      }),
    ).toEqual([
      {
        cadence: "biweekly",
        dueDate: "2026-07-15",
        periodStart: "2026-07-15",
        periodEnd: "2026-07-28",
      },
      {
        cadence: "biweekly",
        dueDate: "2026-07-29",
        periodStart: "2026-07-29",
        periodEnd: "2026-08-11",
      },
    ]);
  });

  it("creates one calendar-month period using the due day", () => {
    expect(
      buildInvoiceSchedule({
        cadence: "monthly",
        scheduleStart: "2026-07-01",
        scheduleEnd: "2026-09-30",
        rentDueDay: 31,
      }),
    ).toEqual([
      {
        cadence: "monthly",
        dueDate: "2026-07-31",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      },
      {
        cadence: "monthly",
        dueDate: "2026-08-31",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
      },
      {
        cadence: "monthly",
        dueDate: "2026-09-30",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
      },
    ]);
  });

  it("starts a changed cadence only on its effective date", () => {
    const schedule = buildInvoiceSchedule({
      cadence: "weekly",
      scheduleStart: "2026-08-05",
      scheduleEnd: "2026-08-31",
    });
    expect(schedule.every((period) => period.dueDate >= "2026-08-05")).toBe(true);
    expect(schedule.some((period) => period.dueDate === "2026-07-29")).toBe(false);
  });

  it("uses a lease lock plus overlap check for idempotent creation", () => {
    const sql = fs.readFileSync(
      path.join(
        process.cwd(),
        "migrations/20260718_cadence_safe_invoice_automation.sql",
      ),
      "utf8",
    );
    const functionSql = sql.split(
      "CREATE OR REPLACE FUNCTION public.rent_waive_late_fee",
    )[0];
    expect(functionSql).toContain("FOR UPDATE");
    expect(functionSql).toContain("i.due_date = p_due_date");
    expect(functionSql).toContain("i.period_start <= p_period_end");
    expect(functionSql).toContain("'already_exists'");
    expect(functionSql).toContain("'period_overlap'");
  });

  it("requires and persists a cadence effective date", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/leases/route.ts"),
      "utf8",
    );
    expect(source).toContain(
      '"cadenceEffectiveDate is required when cadence changes"',
    );
    expect(source).toContain(
      "updateData.prior_rent_cadence = currentLease.rent_cadence",
    );
    expect(source).toContain(
      "updateData.cadence_effective_date = explicitCadenceEffectiveDate",
    );
    expect(source).not.toContain(".delete().eq(\"lease_id\"");
  });
});
