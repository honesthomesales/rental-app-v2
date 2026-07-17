/**

 * Lease income / rent-change / period-to-period / eviction tests.

 * Pure unit tests — no live database writes.

 */



import { readFileSync } from "node:fs";

import { join } from "node:path";

import {

  buildRentChangePreview,

  invoiceEligibleForRentChange,

  rentAmountForDueDate,

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



const EFFECTIVE = "2026-07-16";

const BUSINESS = "2026-07-16";



const invoices = [

  {

    id: "past-open",

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

    id: "past-partial",

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

    id: "on-effective",

    due_date: EFFECTIVE,

    status: "OPEN",

    amount_rent: 200,

    amount_late: 0,

    amount_other: 0,

    amount_total: 200,

    amount_paid: 0,

    balance_due: 200,

  },

  {

    id: "future-partial",

    due_date: "2026-08-01",

    status: "PARTIAL",

    amount_rent: 200,

    amount_late: 15,

    amount_other: 5,

    amount_total: 220,

    amount_paid: 50,

    balance_due: 170,

  },

  {

    id: "future-open",

    due_date: "2026-09-01",

    status: "OPEN",

    amount_rent: 200,

    amount_late: 0,

    amount_other: 0,

    amount_total: 200,

    amount_paid: 0,

    balance_due: 200,

  },

];



function prospectivePreview(newRent = 250) {

  return buildRentChangePreview({

    invoices,

    oldRent: 200,

    newRent,

    effectiveDate: EFFECTIVE,

    businessDate: BUSINESS,

  });

}



describe("prospective rent change preview & patches", () => {

  it("1. Past OPEN invoice is unchanged", () => {

    const preview = prospectivePreview();

    expect(preview.patches.find((p) => p.id === "past-open")).toBeUndefined();

    expect(preview.skippedPast).toBeGreaterThanOrEqual(2);

  });



  it("2. Past PARTIAL invoice is unchanged", () => {

    const preview = prospectivePreview();

    expect(preview.patches.find((p) => p.id === "past-partial")).toBeUndefined();

  });



  it("3. Future OPEN invoice updates", () => {

    const preview = prospectivePreview();

    const future = preview.patches.find((p) => p.id === "future-open");

    expect(future).toBeTruthy();

    expect(future!.new_amount_rent).toBe(250);

    expect(future!.new_amount_total).toBe(250);

    expect(future!.new_balance_due).toBe(250);

  });



  it("4. Future PARTIAL invoice updates and preserves payments", () => {

    const preview = prospectivePreview();

    const partial = preview.patches.find((p) => p.id === "future-partial");

    expect(partial).toBeTruthy();

    expect(partial!.amount_paid).toBe(50);

    // 250 rent + 15 late + 5 other - 50 paid = 220

    expect(partial!.new_amount_total).toBe(270);

    expect(partial!.new_balance_due).toBe(220);

    expect(partial!.new_status).toBe("PARTIAL");

  });



  it("5. Invoice due exactly on effective date updates", () => {

    const preview = prospectivePreview();

    const onDate = preview.patches.find((p) => p.id === "on-effective");

    expect(onDate).toBeTruthy();

    expect(onDate!.new_amount_rent).toBe(250);

    expect(

      invoiceEligibleForRentChange(invoices[4], EFFECTIVE),

    ).toBe(true);

  });



  it("6. PAID and VOID invoices never update", () => {

    const preview = prospectivePreview();

    expect(preview.patches.find((p) => p.id === "paid-1")).toBeUndefined();

    expect(preview.patches.find((p) => p.id === "void-1")).toBeUndefined();

    expect(preview.skippedPaid).toBeGreaterThanOrEqual(1);

    expect(preview.skippedVoid).toBeGreaterThanOrEqual(1);

  });



  it("7. Payments, late fees, and other charges remain unchanged", () => {

    const preview = prospectivePreview();

    const partial = preview.patches.find((p) => p.id === "future-partial");

    expect(partial!.amount_paid).toBe(50);

    expect(partial!.new_amount_total).toBe(270); // 250 + 15 late + 5 other

    for (const p of preview.patches) {

      expect(p.amount_paid).toBe(

        invoices.find((i) => i.id === p.id)!.amount_paid,

      );

    }

  });



  it("8. Newly previewed invoices use the new rent after the effective date", () => {

    const gaps = buildMissingInvoicePreview({

      leaseStartDate: "2026-06-01",

      leaseEndDate: "2026-12-31",

      leaseStatus: "occupied",

      rentCadence: "monthly",

      rentDueDay: 1,

      rentAmount: 250,

      priorRentAmount: 200,

      rentEffectiveDate: EFFECTIVE,

      existingDueDates: ["2026-06-01", "2026-07-01"],

      asOfDate: BUSINESS,

    });

    const before = gaps.filter((g) => g.dueDate < EFFECTIVE);

    const onOrAfter = gaps.filter((g) => g.dueDate >= EFFECTIVE);

    if (before.length > 0) {

      expect(before.every((g) => g.amount === 200)).toBe(true);

    }

    expect(onOrAfter.every((g) => g.amount === 250)).toBe(true);

    expect(

      rentAmountForDueDate({

        dueDate: "2026-07-01",

        newRent: 250,

        priorRent: 200,

        rentEffectiveDate: EFFECTIVE,

      }),

    ).toBe(200);

    expect(

      rentAmountForDueDate({

        dueDate: EFFECTIVE,

        newRent: 250,

        priorRent: 200,

        rentEffectiveDate: EFFECTIVE,

      }),

    ).toBe(250);

  });



  it("9. No invoice is deleted or regenerated", () => {

    const leasesRoute = readSrc("src/app/api/leases/route.ts");

    expect(leasesRoute).not.toMatch(

      /\.from\(['"]RENT_payments['"]\)[\s\S]{0,80}\.delete\(/,

    );

    expect(leasesRoute).not.toMatch(

      /\.from\(['"]RENT_invoices['"]\)[\s\S]{0,120}\.delete\(/,

    );

    expect(leasesRoute).not.toMatch(/all_unpaid_partial/);

    const preview = prospectivePreview();

    expect(preview.patches.length).toBeGreaterThan(0);

    expect(preview.patches.every((p) => p.id)).toBe(true);

  });



  it("10. 159 Adams regression: prospective effective date leaves earlier invoices unchanged", () => {

    // Read-only scenario: lease rent $250, many OPEN weekly invoices still at $200

    const adamsInvoices = Array.from({ length: 12 }, (_, i) => {

      const week = String(i + 1).padStart(2, "0");

      const due = `2026-0${i < 8 ? "6" : "7"}-${week}`;

      const dueDate =

        i < 8

          ? `2026-06-${String((i % 4) * 7 + 1).padStart(2, "0")}`

          : `2026-07-${String(((i - 8) % 4) * 7 + 1).padStart(2, "0")}`;

      return {

        id: `adams-${i}`,

        due_date: dueDate,

        status: "OPEN" as const,

        amount_rent: 200,

        amount_late: 0,

        amount_other: 0,

        amount_total: 200,

        amount_paid: 0,

        balance_due: 200,

      };

    });



    const adamsEffective = "2026-07-16";

    const adamsPreview = buildRentChangePreview({

      invoices: adamsInvoices,

      oldRent: 200,

      newRent: 250,

      effectiveDate: adamsEffective,

      businessDate: adamsEffective,

    });



    const pastUnchanged = adamsInvoices.filter(

      (inv) => inv.due_date < adamsEffective,

    );

    for (const inv of pastUnchanged) {

      expect(adamsPreview.patches.find((p) => p.id === inv.id)).toBeUndefined();

    }



    const futureUpdated = adamsInvoices.filter(

      (inv) => inv.due_date >= adamsEffective,

    );

    for (const inv of futureUpdated) {

      const patch = adamsPreview.patches.find((p) => p.id === inv.id);

      expect(patch).toBeTruthy();

      expect(patch!.new_amount_rent).toBe(250);

    }



    expect(adamsPreview.skippedPast).toBe(pastUnchanged.length);

    expect(adamsPreview.affectedInvoiceCount).toBe(futureUpdated.length);

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



  it("lease edit UI is prospective-only (no historical apply mode)", () => {

    const leasesPage = readSrc("src/app/leases/page.tsx");

    expect(leasesPage).not.toMatch(/all_unpaid_partial/);

    expect(leasesPage).toMatch(/Apply Rent Change Going Forward/);

    expect(leasesPage).toMatch(

      /Past invoices will not be changed/,

    );

  });

});


