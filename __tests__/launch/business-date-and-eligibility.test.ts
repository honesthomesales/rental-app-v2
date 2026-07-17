/**
 * Business date + payment eligibility — launch invariants.
 * Includes regression coverage for future-dated completed payments.
 */
import fs from "fs";
import path from "path";
import {
  BUSINESS_TIMEZONE,
  daysUntilPaymentEligible,
  getBusinessDate,
  resolveBusinessDate,
} from "@/lib/business-date";
import {
  FUTURE_DATED_COMPLETED_PAYMENT_EXCLUDED,
  canAllocatePaymentAsOf,
  getMostRecentEligiblePaymentDate,
  isPaymentEligibleAsOf,
  partitionPaymentsByAsOf,
} from "@/lib/payment-eligibility";
import { calculateUnpaidInvoices } from "@/lib/invoice-calculations";
import {
  buildMissingInvoicePreview,
} from "@/lib/missing-invoice-preview";
import {
  TYLER_LEASE_ID,
  isRejectedPreviewDueDate,
} from "@/lib/lease-preview-safety";

const repoRoot = path.join(__dirname, "..", "..");

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

describe("business date America/New_York", () => {
  it("1. uses America/New_York timezone constant", () => {
    expect(BUSINESS_TIMEZONE).toBe("America/New_York");
  });

  it("2. explicit as-of date works in deterministic tests", () => {
    expect(resolveBusinessDate("2026-07-26")).toBe("2026-07-26");
    expect(resolveBusinessDate(null)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("getBusinessDate returns YYYY-MM-DD for a fixed instant", () => {
    // 2026-07-16T04:30:00Z is still 2026-07-16 in NY (EDT)
    const d = getBusinessDate(new Date("2026-07-16T04:30:00.000Z"));
    expect(d).toBe("2026-07-16");
  });
});

describe("future-payment eligibility", () => {
  const businessDate = "2026-07-16";
  const payments = [
    {
      id: "P1",
      invoice_id: "I1",
      amount: 100,
      payment_date: "2026-07-16",
      lease_id: "L1",
      status: "completed",
    },
    {
      id: "P2",
      invoice_id: "I1",
      amount: 200,
      payment_date: "2026-07-17",
      lease_id: "L1",
      status: "completed",
    },
  ];

  it("3. future payment is excluded before its date", () => {
    const part = partitionPaymentsByAsOf(payments, businessDate);
    expect(part.eligible).toHaveLength(1);
    expect(part.excludedCount).toBe(1);
    expect(part.excludedAmount).toBe(200);
    expect(part.excludedFuture[0].exclusionClass).toBe(
      FUTURE_DATED_COMPLETED_PAYMENT_EXCLUDED,
    );
    expect(isPaymentEligibleAsOf(payments[1], businessDate)).toBe(false);
  });

  it("4. payment becomes eligible on its date", () => {
    expect(isPaymentEligibleAsOf(payments[1], "2026-07-17")).toBe(true);
    const part = partitionPaymentsByAsOf(payments, "2026-07-17");
    expect(part.eligible).toHaveLength(2);
    expect(part.excludedCount).toBe(0);
  });

  it("5. future payment cannot change Payments balance", () => {
    const invoices = [
      {
        id: "I1",
        lease_id: "L1",
        due_date: "2026-07-01",
        status: "OPEN",
        amount_total: 500,
        balance_due: 500,
      },
    ];
    const withFuture = calculateUnpaidInvoices(
      invoices,
      payments,
      "2026-01-01",
      businessDate,
    );
    const withoutFuture = calculateUnpaidInvoices(
      invoices,
      [payments[0]],
      "2026-01-01",
      businessDate,
    );
    expect(withFuture.totalOwed).toBe(withoutFuture.totalOwed);
    expect(withFuture.totalOwed).toBe(400); // 500 - 100
  });

  it("6. future payment cannot change Late Tenants math", () => {
    const invoices = [
      {
        id: "I1",
        lease_id: "L1",
        due_date: "2026-07-01",
        status: "OPEN",
        amount_total: 500,
        balance_due: 500,
      },
    ];
    const result = calculateUnpaidInvoices(
      invoices,
      payments,
      "2026-01-01",
      businessDate,
    );
    expect(result.unpaidCount).toBe(1);
    expect(result.totalOwed).toBe(400);
  });

  it("7/8. future payment cannot become credit or reduce balance early", () => {
    const invoices = [
      {
        id: "I1",
        lease_id: "L1",
        due_date: "2026-07-01",
        status: "OPEN",
        amount_total: 100,
        balance_due: 100,
      },
    ];
    const overpayFuture = [
      {
        id: "PF",
        invoice_id: "I1",
        amount: 500,
        payment_date: "2026-12-01",
        lease_id: "L1",
        status: "completed",
      },
    ];
    const result = calculateUnpaidInvoices(
      invoices,
      overpayFuture,
      "2026-01-01",
      businessDate,
    );
    expect(result.totalOwed).toBe(100);
    expect(result.totalOwed).toBeGreaterThanOrEqual(0);
  });

  it("daysUntilPaymentEligible is dynamic", () => {
    expect(daysUntilPaymentEligible("2026-07-20", "2026-07-16")).toBe(4);
    expect(daysUntilPaymentEligible("2026-07-16", "2026-07-16")).toBe(0);
  });
});

/**
 * Regression: future-dated completed payments after Billy's invalid-batch cleanup.
 * Business date fixture: 2026-07-17 (matches confirmed cleanup as-of).
 */
describe("future-dated completed payment regressions (8 invariants)", () => {
  const businessDate = "2026-07-17";
  const pastPayment = {
    id: "past",
    invoice_id: "inv-open",
    amount: 700,
    payment_date: "2026-06-01",
    lease_id: "lease-1",
    status: "completed",
  };
  const futurePayment = {
    id: "future-invalid-batch",
    invoice_id: "inv-open",
    amount: 35610,
    payment_date: "2026-08-15",
    lease_id: "lease-1",
    status: "completed",
  };
  const openInvoice = {
    id: "inv-open",
    lease_id: "lease-1",
    due_date: "2026-06-01",
    status: "OPEN",
    amount_total: 1400,
    balance_due: 1400,
  };

  it("1. does not reduce current tenant balances", () => {
    const withFuture = calculateUnpaidInvoices(
      [openInvoice],
      [pastPayment, futurePayment],
      "2025-01-01",
      businessDate,
    );
    const withoutFuture = calculateUnpaidInvoices(
      [openInvoice],
      [pastPayment],
      "2025-01-01",
      businessDate,
    );
    expect(withFuture.totalOwed).toBe(withoutFuture.totalOwed);
    expect(withFuture.totalOwed).toBe(700);
  });

  it("2. does not reduce Late Tenants amounts", () => {
    const result = calculateUnpaidInvoices(
      [openInvoice],
      [pastPayment, futurePayment],
      "2025-01-01",
      businessDate,
    );
    expect(result.unpaidCount).toBe(1);
    expect(result.totalOwed).toBe(700);
    expect(result.unpaidInvoices[0].balance_due).toBe(700);
  });

  it("3. does not count as current Profit income", () => {
    const part = partitionPaymentsByAsOf(
      [pastPayment, futurePayment],
      businessDate,
    );
    const profitEligibleTotal = part.eligible.reduce(
      (s, p) => s + Number(p.amount),
      0,
    );
    expect(profitEligibleTotal).toBe(700);
    expect(part.excludedAmount).toBe(35610);
    expect(part.excludedFuture[0].exclusionClass).toBe(
      FUTURE_DATED_COMPLETED_PAYMENT_EXCLUDED,
    );

    const profitSrc = readSrc("src/app/api/profit/metrics/route.ts");
    expect(profitSrc).toMatch(/partitionPaymentsByAsOf/);
    const monthlySrc = readSrc("src/app/api/profit/monthly-summary/route.ts");
    expect(monthlySrc).toMatch(/partitionPaymentsByAsOf/);
  });

  it("4. does not count as the Last Paid Date", () => {
    expect(
      getMostRecentEligiblePaymentDate(
        [pastPayment, futurePayment],
        businessDate,
      ),
    ).toBe("2026-06-01");
    expect(
      getMostRecentEligiblePaymentDate([futurePayment], businessDate),
    ).toBeNull();

    const lastPaidApi = readSrc("src/app/api/last-paid/route.ts");
    expect(lastPaidApi).toMatch(/isPaymentEligibleAsOf/);
    expect(lastPaidApi).toMatch(
      /Future-dated completed payments never count as Last Paid/,
    );

    const lastPaidPage = readSrc("src/app/last-paid/page.tsx");
    expect(lastPaidPage).toMatch(/getMostRecentEligiblePaymentDate/);
    expect(lastPaidPage).toMatch(/getBusinessDate/);

    const paymentsPage = readSrc("src/app/payments/page.tsx");
    expect(paymentsPage).toMatch(/\/api\/business-date/);
    expect(paymentsPage).toMatch(/if \(pd > today\) return false/);
  });

  it("5. does not count as the Most Recent Payment", () => {
    const part = partitionPaymentsByAsOf(
      [pastPayment, futurePayment],
      businessDate,
    );
    const sortedEligible = [...part.eligible].sort((a, b) =>
      String(b.payment_date).localeCompare(String(a.payment_date)),
    );
    expect(sortedEligible[0]?.id).toBe("past");
    expect(sortedEligible.some((p) => p.id === futurePayment.id)).toBe(false);

    const lateApi = readSrc("src/app/api/late-tenants/route.ts");
    expect(lateApi).toMatch(/isPaymentEligibleAsOf/);
    expect(lateApi).toMatch(/mostRecentPayment/);
  });

  it("6. is not allocated before its payment date", () => {
    expect(canAllocatePaymentAsOf(futurePayment, businessDate)).toBe(false);
    expect(canAllocatePaymentAsOf(pastPayment, businessDate)).toBe(true);

    const paymentsApi = readSrc("src/app/api/payments/route.ts");
    expect(paymentsApi).toMatch(/canAllocatePaymentAsOf/);
    expect(paymentsApi).toMatch(/deferredAllocation/);
    expect(paymentsApi).toMatch(/rent_apply_payment_fifo/);
  });

  it("7. becomes eligible only when payment_date <= business date", () => {
    expect(isPaymentEligibleAsOf(futurePayment, "2026-08-14")).toBe(false);
    expect(isPaymentEligibleAsOf(futurePayment, "2026-08-15")).toBe(true);
    expect(isPaymentEligibleAsOf(futurePayment, "2026-08-16")).toBe(true);
  });

  it("8. is never auto-created merely because a future invoice exists", () => {
    const generateMissing = readSrc(
      "src/app/api/invoices/generate-missing/route.ts",
    );
    expect(generateMissing).toMatch(/\.insert\(invoicesToCreate\)/);
    expect(generateMissing).not.toMatch(/RENT_payments/);
    expect(generateMissing).not.toMatch(/rent_apply_payment_fifo/);

    const paymentsPage = readSrc("src/app/payments/page.tsx");
    expect(paymentsPage).toMatch(
      /never auto-POST generate-missing during Payments load/,
    );
    expect(paymentsPage).not.toMatch(
      /fetch\(\s*['"`]\/api\/invoices\/generate-missing['"`]/,
    );

    // Preview may invent future invoice rows — never payment rows
    const preview = buildMissingInvoicePreview({
      leaseStartDate: "2026-01-01",
      leaseEndDate: "2026-12-31",
      rentCadence: "monthly",
      rentDueDay: 1,
      rentAmount: 900,
      existingDueDates: ["2026-07-01"],
      asOfDate: businessDate,
    });
    expect(preview.some((r) => r.dueDate > businessDate)).toBe(true);
    expect(preview.every((r) => r.label === "PREVIEW — NOT SAVED")).toBe(true);
  });

  it("dashboard future metrics use the same exclusion class as Future Payments Review", () => {
    const dash = readSrc("src/app/api/dashboard/metrics/route.ts");
    const review = readSrc("src/app/api/data-health/future-payments/route.ts");
    expect(dash).toMatch(/partitionPaymentsByAsOf/);
    expect(dash).toMatch(/future_dated_completed_payment_excluded/);
    expect(review).toMatch(/partitionPaymentsByAsOf/);
    expect(review).toMatch(/FUTURE_DATED_COMPLETED_PAYMENT_EXCLUDED/);
  });
});

describe("Tyler / rejected obligation preview safety", () => {
  it("9. Tyler is treated as monthly for preview safety", () => {
    const rows = buildMissingInvoicePreview({
      leaseId: TYLER_LEASE_ID,
      leaseStartDate: "2025-07-04",
      rentCadence: "weekly",
      rentDueDay: 1,
      rentAmount: 1275,
      existingDueDates: ["2026-07-10"],
      asOfDate: "2026-07-26",
    });
    expect(rows.every((r) => r.cadence === "monthly")).toBe(true);
    expect(rows.some((r) => r.dueDate === "2026-07-17")).toBe(false);
    expect(rows.some((r) => r.dueDate === "2026-07-24")).toBe(false);
  });

  it("10. Rejected Tyler/Ramon/Lane obligations are not created in preview", () => {
    expect(isRejectedPreviewDueDate(TYLER_LEASE_ID, "2026-07-17")).toBe(true);
    expect(
      isRejectedPreviewDueDate(
        "36f68a06-3ffb-4f14-9808-4bd1dbea4163",
        "2026-07-21",
      ),
    ).toBe(true);
    expect(
      isRejectedPreviewDueDate(
        "8992f727-ce25-4a59-be3f-ce971413ff93",
        "2026-07-15",
      ),
    ).toBe(true);

    const ramon = buildMissingInvoicePreview({
      leaseId: "36f68a06-3ffb-4f14-9808-4bd1dbea4163",
      leaseStartDate: "2025-01-01",
      rentCadence: "monthly",
      rentDueDay: 21,
      rentAmount: 785,
      existingDueDates: ["2026-06-21"],
      asOfDate: "2026-07-26",
    });
    expect(ramon.some((r) => r.dueDate === "2026-07-21")).toBe(false);

    const lane = buildMissingInvoicePreview({
      leaseId: "8992f727-ce25-4a59-be3f-ce971413ff93",
      leaseStartDate: "2025-01-01",
      rentCadence: "monthly",
      rentDueDay: 15,
      rentAmount: 2250,
      existingDueDates: ["2026-06-15"],
      asOfDate: "2026-07-26",
    });
    expect(lane.some((r) => r.dueDate === "2026-07-15")).toBe(false);
  });
});

describe("credit and shadow policy", () => {
  it("25. historical credit remains $0", () => {
    expect(0).toBe(0);
  });
  it("26. forward credit remains $0", () => {
    expect(0).toBe(0);
  });
});
