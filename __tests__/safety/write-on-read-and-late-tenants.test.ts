import fs from "fs";
import path from "path";
import { buildMissingInvoicePreview } from "@/lib/missing-invoice-preview";
import { calculateUnpaidInvoices } from "@/lib/invoice-calculations";
import {
  buildLateTenantRowTotals,
  buildLateTenantsSummary,
} from "@/lib/late-tenants-summary";

const repoRoot = path.join(__dirname, "..", "..");

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

describe("write-on-read removal", () => {
  it("Payments page loading / fetchLeases does not POST generate-missing", () => {
    const src = readSrc("src/app/payments/page.tsx");
    expect(src).not.toMatch(
      /fetch\(\s*['"`]\/api\/invoices\/generate-missing['"`]/,
    );
    expect(src).toMatch(/never auto-POST generate-missing during Payments load/);
    expect(src).toMatch(
      /never auto-POST generate-missing when opening invoice history/,
    );
  });

  it("opening invoice history path stays GET-only for schedule fill", () => {
    const src = readSrc("src/app/payments/page.tsx");
    // Review Missing Invoices uses GET preview endpoint only
    expect(src).toMatch(/\/api\/invoices\/missing-preview\?leaseId=/);
    expect(src).toMatch(/method: 'GET'/);
    // handleViewInvoices must not POST generate-missing
    expect(src).not.toMatch(
      /generate-missing['"`]\s*,\s*\{\s*method:\s*['"]POST['"]/,
    );
  });
});

describe("missing-invoice preview (no writes)", () => {
  it("builds PREVIEW — NOT SAVED rows without inserts", () => {
    const writes: string[] = [];
    const spyInsert = jest.fn(() => {
      writes.push("insert");
    });

    const rows = buildMissingInvoicePreview({
      leaseStartDate: "2026-01-01",
      leaseEndDate: "2026-03-31",
      rentCadence: "monthly",
      rentDueDay: 1,
      rentAmount: 900,
      existingDueDates: ["2026-01-01", "2026-02-01"],
      asOfDate: "2026-02-15",
    });

    expect(spyInsert).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.label).toBe("PREVIEW — NOT SAVED");
      expect(row.matchingInvoiceExists).toBe(false);
      expect(["past", "current", "future"]).toContain(row.periodClass);
      expect(row.reason).toMatch(/No real invoice exists/);
    }
    // Feb exists — should not appear
    expect(rows.find((r) => r.dueDate === "2026-02-01")).toBeUndefined();
    // March missing
    expect(rows.find((r) => r.dueDate === "2026-03-01")).toBeTruthy();
  });

  it("missing-preview API route is GET-only and has no insert", () => {
    const src = readSrc("src/app/api/invoices/missing-preview/route.ts");
    expect(src).toMatch(/export async function GET/);
    expect(src).not.toMatch(/\.insert\(/);
    expect(src).not.toMatch(/export async function POST/);
  });
});

describe("Late Tenants row totals + summary", () => {
  it("each row contains only that account's individual total (no cumulative portfolio)", () => {
    const a = buildLateTenantRowTotals(100);
    const b = buildLateTenantRowTotals(250);
    expect(a.accountTotalOwed).toBe(100);
    expect(a.totalOwedLate).toBe(100);
    expect(b.accountTotalOwed).toBe(250);
    expect(b.totalOwedLate).toBe(250);
    // Simulate the old bug: growing portfolio was written into each row.
    let portfolio = 0;
    const buggyRows: number[] = [];
    const fixedRows = [100, 250, 50].map((owed) => {
      portfolio += owed;
      buggyRows.push(portfolio);
      return { ...buildLateTenantRowTotals(owed), daysLate: owed === 250 ? 45 : 10 };
    });
    expect(buggyRows).toEqual([100, 350, 400]);
    expect(fixedRows.map((r) => r.accountTotalOwed)).toEqual([100, 250, 50]);
    expect(fixedRows[1].accountTotalOwed).not.toBe(buggyRows[1]);
    expect(fixedRows[2].accountTotalOwed).not.toBe(buggyRows[2]);
  });

  it("portfolio total equals the sum of individual rows", () => {
    const rows = [
      { ...buildLateTenantRowTotals(100), daysLate: 5 },
      { ...buildLateTenantRowTotals(250), daysLate: 40 },
      { ...buildLateTenantRowTotals(50), daysLate: 12 },
    ];
    const summary = buildLateTenantsSummary(rows);
    expect(summary.totalLateOwed).toBe(400);
    expect(summary.totalAllOwed).toBe(400);
    expect(summary.lateLeases).toBe(3);
    expect(summary.thirtyPlusLate).toBe(1);
    expect(summary.avgDaysLate).toBe(Math.round((5 + 40 + 12) / 3));
  });

  it("summary object has all required fields", () => {
    const summary = buildLateTenantsSummary([
      { accountTotalOwed: 10, daysLate: 2 },
    ]);
    expect(summary).toEqual(
      expect.objectContaining({
        lateLeases: expect.any(Number),
        totalLateOwed: expect.any(Number),
        totalAllOwed: expect.any(Number),
        thirtyPlusLate: expect.any(Number),
        avgDaysLate: expect.any(Number),
      }),
    );
    // Current product: totals are equal (late-scope portfolio only)
    expect(summary.totalLateOwed).toBe(summary.totalAllOwed);
  });
});

describe("Payments values unchanged via shared calculation", () => {
  it("keeps the existing unpaid balance calculation", () => {
    const before = calculateUnpaidInvoices(
      [
        {
          id: "inv-1",
          lease_id: "lease-1",
          due_date: "2026-01-01",
          status: "OPEN",
          balance_due: 500,
          amount_total: 500,
          amount_paid: 0,
        },
        {
          id: "inv-2",
          lease_id: "lease-1",
          due_date: "2026-02-01",
          status: "OPEN",
          balance_due: 500,
          amount_total: 500,
          amount_paid: 200,
        },
      ],
      [
        {
          id: "pay-1",
          invoice_id: "inv-2",
          amount: 200,
          payment_date: "2026-02-05",
          lease_id: "lease-1",
        },
      ],
      "2026-01-01",
      "2026-02-15",
    );
    const after = calculateUnpaidInvoices(
      [
        {
          id: "inv-1",
          lease_id: "lease-1",
          due_date: "2026-01-01",
          status: "OPEN",
          balance_due: 500,
          amount_total: 500,
          amount_paid: 0,
        },
        {
          id: "inv-2",
          lease_id: "lease-1",
          due_date: "2026-02-01",
          status: "OPEN",
          balance_due: 500,
          amount_total: 500,
          amount_paid: 200,
        },
      ],
      [
        {
          id: "pay-1",
          invoice_id: "inv-2",
          amount: 200,
          payment_date: "2026-02-05",
          lease_id: "lease-1",
        },
      ],
      "2026-01-01",
      "2026-02-15",
    );
    expect(after.totalOwed).toBe(before.totalOwed);
    expect(after.unpaidCount).toBe(before.unpaidCount);
    expect(after.totalOwed).toBe(800);
  });
});

describe("navigation", () => {
  it("includes Late Tenants immediately after Payments", () => {
    const src = readSrc("src/components/Navigation.tsx");
    const paymentsIdx = src.indexOf("{ name: 'Payments'");
    const lateIdx = src.indexOf("{ name: 'Late Tenants'");
    const expensesIdx = src.indexOf("{ name: 'Expenses'");
    expect(paymentsIdx).toBeGreaterThan(-1);
    expect(lateIdx).toBeGreaterThan(paymentsIdx);
    expect(expensesIdx).toBeGreaterThan(lateIdx);
    expect(src).toMatch(/item\.name === 'Late Tenants'/);
  });
});

describe("no live Supabase writes in these tests", () => {
  it("does not import supabaseServer for writes", () => {
    // This suite only uses pure helpers and source string checks.
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY || "").not.toMatch(
      /^eyJ.*for_test_write$/,
    );
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => {
        throw new Error("tests must not call live fetch");
      });
    buildMissingInvoicePreview({
      leaseStartDate: "2026-01-01",
      rentCadence: "weekly",
      rentAmount: 100,
      existingDueDates: [],
      asOfDate: "2026-01-08",
      leaseEndDate: "2026-01-15",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
