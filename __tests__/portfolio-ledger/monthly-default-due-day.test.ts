import { buildAccountLedger } from "@/lib/portfolio-ledger/service";

const baseLease = {
  id: "lease-lane",
  property_id: "property-lane",
  tenant_id: "tenant-lane",
  status: "occupied",
  rent: 2250,
  rent_cadence: "monthly",
  lease_start_date: "2026-01-01",
  property_name: "Lane",
  tenant_name: "Lane",
};

function augustInvoice(dueDate = "2026-08-15") {
  return {
    id: "invoice-august",
    lease_id: baseLease.id,
    due_date: dueDate,
    period_start: "2026-08-01",
    period_end: "2026-08-31",
    status: "OPEN",
    amount_rent: 2250,
    amount_late: 45,
    amount_other: 0,
    amount_total: 2295,
    amount_paid: 0,
    balance_due: 2295,
  };
}

describe("monthly default due day ledger behavior", () => {
  it("treats monthly invoices as due on the 1st when lease rent_due_day is missing", () => {
    const account = buildAccountLedger({
      lease: { ...baseLease, rent_due_day: null },
      invoices: [augustInvoice("2026-08-15")],
      payments: [],
      asOfDate: "2026-08-11",
    });

    expect(account.invoices[0].dueDate).toBe("2026-08-01");
    expect(account.invoices[0].isFuture).toBe(false);
    expect(account.invoices[0].collectionStatus).toBe("past_due");
    expect(account.totalBalanceDue).toBe(2295);
    expect(account.pastDueBalanceDue).toBe(2295);
    expect(account.collectionStatus).toBe("past_due");
  });

  it("honors an explicit non-first monthly rent_due_day", () => {
    const account = buildAccountLedger({
      lease: { ...baseLease, rent_due_day: 15 },
      invoices: [augustInvoice("2026-08-15")],
      payments: [],
      asOfDate: "2026-08-11",
    });

    expect(account.invoices[0].dueDate).toBe("2026-08-15");
    expect(account.invoices[0].isFuture).toBe(true);
    expect(account.totalBalanceDue).toBe(0);
    expect(account.collectionStatus).toBe("current");
  });
});
