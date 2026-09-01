import {
  mergeProfitPayments,
  resolveProfitPaymentPropertyId,
  selectProfitPaymentsForMonth,
} from "@/lib/profit/rent-collected";

describe("profit rent collected attribution", () => {
  const invoiceDueDateById = new Map([
    ["inv-sep", "2026-09-01"],
    ["inv-aug", "2026-08-01"],
  ]);

  it("counts early payments in the invoice due month (next month on PC)", () => {
    const payments = [
      {
        id: "early-sep",
        lease_id: "lease-1",
        property_id: "prop-1",
        invoice_id: "inv-sep",
        payment_date: "2026-08-28",
        amount: 400,
        status: "completed",
      },
    ];

    const september = selectProfitPaymentsForMonth(
      payments,
      invoiceDueDateById,
      "2026-09-01",
      "2026-09-30",
    );
    expect(september).toHaveLength(1);
    expect(september[0].amount).toBe(400);

    const august = selectProfitPaymentsForMonth(
      payments,
      invoiceDueDateById,
      "2026-08-01",
      "2026-08-31",
    );
    expect(august).toHaveLength(0);
  });

  it("dedupes merged payment lists by id", () => {
    const payment = {
      id: "p1",
      lease_id: "l1",
      invoice_id: "inv-sep",
      payment_date: "2026-09-05",
      amount: 100,
      status: "completed",
    };
    const merged = mergeProfitPayments([payment], [payment]);
    expect(merged).toHaveLength(1);
  });

  it("resolves property from invoice when payment.property_id is missing", () => {
    const invoiceMeta = new Map([
      ["inv-sep", { due_date: "2026-09-01", property_id: "prop-99" }],
    ]);
    const propertyId = resolveProfitPaymentPropertyId(
      {
        id: "p1",
        lease_id: "",
        invoice_id: "inv-sep",
        payment_date: "2026-08-28",
        amount: 400,
        status: "completed",
      },
      new Map(),
      invoiceMeta,
    );
    expect(propertyId).toBe("prop-99");
  });
});
