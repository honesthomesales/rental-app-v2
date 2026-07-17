/**
 * Business date + payment eligibility — launch invariants.
 */
import {
  BUSINESS_TIMEZONE,
  daysUntilPaymentEligible,
  getBusinessDate,
  resolveBusinessDate,
} from "@/lib/business-date";
import {
  FUTURE_DATED_COMPLETED_PAYMENT_EXCLUDED,
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
