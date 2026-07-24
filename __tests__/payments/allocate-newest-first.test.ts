import {
  allocateNewestEligibleFirst,
  orderInvoicesNewestFirst,
  selectEligibleInvoicesForAllocation,
} from "@/lib/payments/allocate-newest-first";

describe("allocateNewestEligibleFirst", () => {
  it("allocates $200 newest-first across three $150 weekly invoices", () => {
    const plan = allocateNewestEligibleFirst({
      paymentAmount: 200,
      paymentEffectiveDate: "2026-07-23",
      invoices: [
        {
          id: "oldest",
          dueDate: "2026-07-01",
          sequence: 1,
          balanceDue: 150,
          status: "OPEN",
        },
        {
          id: "middle",
          dueDate: "2026-07-08",
          sequence: 2,
          balanceDue: 150,
          status: "OPEN",
        },
        {
          id: "newest",
          dueDate: "2026-07-15",
          sequence: 3,
          balanceDue: 150,
          status: "OPEN",
        },
      ],
    });

    expect(plan.splits).toEqual([
      { invoiceId: "newest", amount: 150, dueDate: "2026-07-15" },
      { invoiceId: "middle", amount: 50, dueDate: "2026-07-08" },
    ]);
    expect(plan.allocatedAmount).toBe(200);
    expect(plan.unallocatedAmount).toBe(0);

    // Remaining balances after this plan
    const remaining = {
      newest: 150 - 150,
      middle: 150 - 50,
      oldest: 150 - 0,
    };
    expect(remaining).toEqual({ newest: 0, middle: 100, oldest: 150 });
    expect(remaining.newest + remaining.middle + remaining.oldest).toBe(250);
  });

  it("excludes future, void, and fully paid invoices", () => {
    const plan = allocateNewestEligibleFirst({
      paymentAmount: 100,
      paymentEffectiveDate: "2026-07-10",
      invoices: [
        {
          id: "future",
          dueDate: "2026-07-20",
          balanceDue: 100,
          status: "OPEN",
        },
        {
          id: "voided",
          dueDate: "2026-07-05",
          balanceDue: 100,
          status: "VOID",
        },
        {
          id: "paid",
          dueDate: "2026-07-05",
          balanceDue: 0,
          status: "PAID",
        },
        {
          id: "open",
          dueDate: "2026-07-05",
          balanceDue: 80,
          status: "OPEN",
        },
      ],
    });
    expect(plan.splits).toEqual([
      { invoiceId: "open", amount: 80, dueDate: "2026-07-05" },
    ]);
    expect(plan.unallocatedAmount).toBe(20);
  });

  it("orders by due date desc, then sequence desc, then id", () => {
    const ordered = orderInvoicesNewestFirst(
      selectEligibleInvoicesForAllocation(
        [
          { id: "b", dueDate: "2026-07-01", sequence: 1, balanceDue: 10 },
          { id: "a", dueDate: "2026-07-01", sequence: 1, balanceDue: 10 },
          { id: "c", dueDate: "2026-07-08", sequence: 2, balanceDue: 10 },
          { id: "d", dueDate: "2026-07-08", sequence: 9, balanceDue: 10 },
        ],
        "2026-07-10",
      ),
    );
    expect(ordered.map((i) => i.id)).toEqual(["d", "c", "a", "b"]);
  });
});
