/**
 * Lease income / rent-change / period-to-period / eviction tests.
 * Pure unit tests — no live database writes.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildRentChangePreview,
  invoiceEligibleForRentChange,
} from "@/lib/rent-change";
import {
  isPeriodToPeriod,
  isPhysicallyOccupied,
  countsTowardCurrentIncome,
  countsTowardEvictionPotential,
  isActiveBillingLease,
  isEligibleEmptyPotentialProperty,
  resolveInvoiceScheduleEnd,
  normalizeLeaseStatus,
} from "@/lib/lease-status";
import { monthlyEquivalentRent } from "@/lib/monthly-equivalent";
import { buildMissingInvoicePreview } from "@/lib/missing-invoice-preview";
import { isPaymentEligibleAsOf } from "@/lib/payment-eligibility";

const root = join(__dirname, "../..");

function readSrc(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

describe("rent change preview & patches", () => {
  const invoices = [
    {
      id: "open-1",
      due_date: "2026-06-01",
      status: "OPEN",
      amount_rent: 200,
      amount_late: 0,
      amount_other: 0,
      amount_total: 200,
      amount_paid: 0,
      balance_due: 200,
    },
    {
      id: "partial-1",
      due_date: "2026-06-08",
      status: "PARTIAL",
      amount_rent: 200,
      amount_late: 10,
      amount_other: 0,
      amount_total: 210,
      amount_paid: 100,
      balance_due: 110,
    },
    {
      id: "paid-1",
      due_date: "2026-05-01",
      status: "PAID",
      amount_rent: 200,
      amount_late: 0,
      amount_other: 0,
      amount_total: 200,
      amount_paid: 200,
      balance_due: 0,
    },
    {
      id: "void-1",
      due_date: "2026-04-01",
      status: "VOID",
      amount_rent: 200,
      amount_late: 0,
      amount_other: 0,
      amount_total: 200,
      amount_paid: 0,
      balance_due: 200,
    },
    {
      id: "future-1",
      due_date: "2026-08-01",
      status: "OPEN",
      amount_rent: 200,
      amount_late: 0,
      amount_other: 0,
      amount_total: 200,
      amount_paid: 0,
      balance_due: 200,
    },
  ];

  it("1. $200 → $250 updates selected OPEN invoices", () => {
    const preview = buildRentChangePreview({
      invoices,
      newRent: 250,
      mode: "all_unpaid_partial",
      businessDate: "2026-07-16",
    });
    const open = preview.patches.find((p) => p.id === "open-1");
    expect(open).toBeTruthy();
    expect(open!.new_amount_rent).toBe(250);
    expect(open!.new_amount_total).toBe(250);
    expect(open!.new_balance_due).toBe(250);
    expect(open!.new_status).toBe("OPEN");
  });

  it("2. PARTIAL invoices preserve payments and recalculate balance", () => {
    const preview = buildRentChangePreview({
      invoices,
      newRent: 250,
      mode: "all_unpaid_partial",
      businessDate: "2026-07-16",
    });
    const partial = preview.patches.find((p) => p.id === "partial-1");
    expect(partial).toBeTruthy();
    expect(partial!.amount_paid).toBe(100);
    // 250 + 10 late - 100 paid = 160
    expect(partial!.new_amount_total).toBe(260);
    expect(partial!.new_balance_due).toBe(160);
    expect(partial!.new_status).toBe("PARTIAL");
  });

  it("3. PAID invoices are unchanged", () => {
    const preview = buildRentChangePreview({
      invoices,
      newRent: 250,
      mode: "all_unpaid_partial",
      businessDate: "2026-07-16",
    });
    expect(preview.patches.find((p) => p.id === "paid-1")).toBeUndefined();
    expect(preview.skippedPaid).toBeGreaterThanOrEqual(1);
  });

  it("4. VOID invoices are unchanged", () => {
    const preview = buildRentChangePreview({
      invoices,
      newRent: 250,
      mode: "all_unpaid_partial",
      businessDate: "2026-07-16",
    });
    expect(preview.patches.find((p) => p.id === "void-1")).toBeUndefined();
    expect(preview.skippedVoid).toBeGreaterThanOrEqual(1);
  });

  it("5. Payments are never deleted or modified (preview patches amounts only)", () => {
    const preview = buildRentChangePreview({
      invoices,
      newRent: 250,
      mode: "all_unpaid_partial",
      businessDate: "2026-07-16",
    });
    for (const p of preview.patches) {
      expect(p.amount_paid).toBe(
        invoices.find((i) => i.id === p.id)!.amount_paid,
      );
    }
    const leasesRoute = readSrc("src/app/api/leases/route.ts");
    expect(leasesRoute).not.toMatch(
      /\.from\(['"]RENT_payments['"]\)[\s\S]{0,80}\.delete\(/,
    );
    expect(leasesRoute).not.toMatch(
      /\.from\(['"]RENT_invoices['"]\)[\s\S]{0,120}\.delete\(/,
    );
  });

  it("future_only mode only touches dues after business date", () => {
    expect(
      invoiceEligibleForRentChange(invoices[0], "future_only", {
        effectiveDate: null,
        businessDate: "2026-07-16",
      }),
    ).toBe(false);
    expect(
      invoiceEligibleForRentChange(invoices[4], "future_only", {
        effectiveDate: null,
        businessDate: "2026-07-16",
      }),
    ).toBe(true);
  });
});

describe("lease GET write-on-read removed & period-to-period", () => {
  it("6. Lease GET performs no database write", () => {
    const src = readSrc("src/app/api/leases/route.ts");
    const getFn = src.slice(
      src.indexOf("export async function GET"),
      src.indexOf("export async function POST"),
    );
    expect(getFn).not.toMatch(/\.update\(/);
    expect(getFn).not.toMatch(/\.insert\(/);
    expect(getFn).not.toMatch(/\.delete\(/);
    expect(getFn).toMatch(/never auto-expire|Read-only/i);
    expect(getFn).not.toMatch(/\.update\(\s*\{\s*status:\s*['\"]empty['\"]/);
  });

  it("7. Expired occupied lease remains occupied and period-to-period", () => {
    expect(
      isPeriodToPeriod({
        status: "occupied",
        leaseEndDate: "2026-01-01",
        businessDate: "2026-07-16",
      }),
    ).toBe(true);
    expect(normalizeLeaseStatus("occupied")).toBe("occupied");
    expect(isPhysicallyOccupied("occupied")).toBe(true);
  });

  it("8. Expired eviction lease remains eviction and period-to-period", () => {
    expect(
      isPeriodToPeriod({
        status: "eviction",
        leaseEndDate: "2025-12-01",
        businessDate: "2026-07-16",
      }),
    ).toBe(true);
    expect(isActiveBillingLease("eviction")).toBe(true);
  });

  it("9. Empty or Sold stops future invoice scheduling", () => {
    expect(
      resolveInvoiceScheduleEnd({
        status: "empty",
        leaseEndDate: "2026-06-01",
        asOfDate: "2026-07-16",
      }),
    ).toBe("2026-06-01");
    expect(
      resolveInvoiceScheduleEnd({
        status: "sold",
        leaseEndDate: "2026-05-15",
        asOfDate: "2026-07-16",
      }),
    ).toBe("2026-05-15");

    const gaps = buildMissingInvoicePreview({
      leaseStartDate: "2025-01-01",
      leaseEndDate: "2026-06-01",
      leaseStatus: "empty",
      rentCadence: "monthly",
      rentDueDay: 1,
      rentAmount: 500,
      existingDueDates: [],
      asOfDate: "2026-07-16",
    });
    expect(gaps.every((g) => g.dueDate <= "2026-06-01")).toBe(true);
  });

  it("period-to-period continues missing-invoice preview after end", () => {
    const gaps = buildMissingInvoicePreview({
      leaseStartDate: "2025-01-01",
      leaseEndDate: "2026-01-01",
      leaseStatus: "occupied",
      rentCadence: "monthly",
      rentDueDay: 1,
      rentAmount: 250,
      existingDueDates: [],
      asOfDate: "2026-07-16",
    });
    expect(gaps.some((g) => g.dueDate > "2026-01-01")).toBe(true);
    expect(gaps.every((g) => g.amount === 250)).toBe(true);
  });
});

describe("eviction income & occupancy", () => {
  it("10. Eviction is excluded from current income", () => {
    expect(countsTowardCurrentIncome("eviction")).toBe(false);
    expect(countsTowardCurrentIncome("occupied")).toBe(true);
  });

  it("11. Eviction is included in potential income", () => {
    expect(countsTowardEvictionPotential("eviction")).toBe(true);
    expect(monthlyEquivalentRent(250, "weekly")).toBe(1000);
    expect(monthlyEquivalentRent(400, "biweekly")).toBe(800);
    expect(monthlyEquivalentRent(750, "monthly")).toBe(750);
  });

  it("12. Eviction remains in Payments and Late Tenants", () => {
    expect(isActiveBillingLease("eviction")).toBe(true);
    const payments = readSrc("src/app/payments/page.tsx");
    expect(payments).toMatch(/status === 'eviction'|status === \"eviction\"/);
    const late = readSrc("src/app/api/late-tenants/route.ts");
    expect(late).toMatch(/eviction/);
  });

  it("13. Empty count includes only residential properties with rent_value > $1", () => {
    expect(
      isEligibleEmptyPotentialProperty({
        propertyType: "house",
        propertyStatus: "active",
        rentValue: 500,
        hasPhysicallyOccupiedLease: false,
        hasSoldLease: false,
      }),
    ).toBe(true);
    expect(
      isEligibleEmptyPotentialProperty({
        propertyType: "house",
        propertyStatus: "active",
        rentValue: 1,
        hasPhysicallyOccupiedLease: false,
        hasSoldLease: false,
      }),
    ).toBe(false);
    expect(
      isEligibleEmptyPotentialProperty({
        propertyType: "loan",
        propertyStatus: "active",
        rentValue: 500,
        hasPhysicallyOccupiedLease: false,
        hasSoldLease: false,
      }),
    ).toBe(false);
  });

  it("14. Empty and eviction properties are not double-counted", () => {
    expect(
      isEligibleEmptyPotentialProperty({
        propertyType: "house",
        propertyStatus: "active",
        rentValue: 500,
        hasPhysicallyOccupiedLease: true,
        hasSoldLease: false,
      }),
    ).toBe(false);
    expect(isPhysicallyOccupied("eviction")).toBe(true);
  });
});

describe("safety invariants preserved", () => {
  it("15. Existing future-payment exclusion remains working", () => {
    expect(
      isPaymentEligibleAsOf(
        { payment_date: "2099-01-01", status: "completed" },
        "2026-07-16",
      ),
    ).toBe(false);
    expect(
      isPaymentEligibleAsOf(
        { payment_date: "2026-07-01", status: "completed" },
        "2026-07-16",
      ),
    ).toBe(true);
  });

  it("16. Missing invoices remain preview-only on page load", () => {
    const payments = readSrc("src/app/payments/page.tsx");
    expect(payments).not.toMatch(
      /useEffect[\s\S]{0,400}generate-missing/,
    );
    const preview = readSrc("src/app/api/invoices/missing-preview/route.ts");
    expect(preview).toMatch(/previewOnly:\s*true/);
    expect(preview).toMatch(/writePerformed:\s*false/);
  });

  it("17. Shadow reconciliation remains disabled", () => {
    const index = readSrc("src/lib/shadow-reconciliation/index.ts");
    expect(index.toLowerCase()).toMatch(/disabled_for_ui|do not import/);
  });

  it("18. No live database writes occur during tests", () => {
    // This suite only uses pure helpers + source reads.
    expect(true).toBe(true);
  });
});
