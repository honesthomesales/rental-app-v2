import { buildCollectedMonthCollectionFacts } from "@/lib/portfolio-ledger/service";

/**
 * Regression: future calendar months must include staff-posted future-dated
 * payments in that month. Capping payment_date queries at businessDate yields
 * start > end and $0 rent collected.
 */
describe("profit future-month rent collection", () => {
  const lease = { id: "lease-1", property_id: "prop-1" };

  it("counts future-dated payments in a future calendar month", () => {
    const facts = buildCollectedMonthCollectionFacts({
      payments: [
        {
          id: "oct-1",
          lease_id: lease.id,
          property_id: lease.property_id,
          invoice_id: "inv-oct",
          payment_date: "2026-10-05",
          amount: 400,
          status: "completed",
        },
        {
          id: "oct-2",
          lease_id: lease.id,
          property_id: lease.property_id,
          invoice_id: "inv-oct-2",
          payment_date: "2026-10-20",
          amount: 350,
          status: "completed",
        },
      ],
      monthStart: "2026-10-01",
      monthEnd: "2026-10-31",
      asOfDate: "2026-08-31",
    });

    expect(facts.totalCollected).toBe(750);
  });
});
