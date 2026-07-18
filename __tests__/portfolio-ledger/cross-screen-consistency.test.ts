import {
  buildAccountLedger,
  buildCollectionsSummary,
  buildDueMonthCollectionFacts,
} from "@/lib/portfolio-ledger/service";

const lease = {
  id: "lease-1",
  property_id: "property-1",
  tenant_id: "tenant-1",
  status: "occupied",
  rent: 160,
  rent_cadence: "weekly",
  lease_start_date: "2026-01-01",
  property_name: "100 Willis Bell",
  tenant_name: "Jayne Long",
};

function invoice(dueDate: string) {
  const periodEnd = new Date(`${dueDate}T00:00:00Z`);
  periodEnd.setUTCDate(periodEnd.getUTCDate() + 6);
  return {
    id: `invoice-${dueDate}`,
    lease_id: lease.id,
    due_date: dueDate,
    period_start: dueDate,
    period_end: periodEnd.toISOString().slice(0, 10),
    status: "OPEN",
    amount_rent: 160,
    amount_late: 10,
    amount_other: 5,
    amount_total: 175,
  };
}

describe("portfolio ledger cross-screen consistency", () => {
  it("Payments, Late Tenants, Last Paid, and Dashboard consume identical facts", () => {
    const invoices = [invoice("2026-07-01")];
    const payments = [
      {
        id: "payment-1",
        lease_id: lease.id,
        invoice_id: invoices[0].id,
        payment_date: "2026-07-02",
        amount: 40,
        status: "completed",
      },
    ];
    const account = buildAccountLedger({
      lease,
      invoices,
      payments,
      asOfDate: "2026-07-07",
    });
    const dashboard = buildCollectionsSummary({
      leases: [lease],
      invoicesByLease: new Map([[lease.id, invoices]]),
      paymentsByLease: new Map([[lease.id, payments]]),
      asOfDate: "2026-07-07",
    }).rows[0];

    expect(dashboard.totalOwed).toBe(account.totalBalanceDue);
    expect(dashboard.lastPaidDate).toBe(account.lastEligiblePositivePaymentDate);
    expect(dashboard.oldestUnpaidDueDate).toBe(account.oldestUnpaidDueDate);
    expect(dashboard.daysLate).toBe(account.daysLate);
    expect(account.collectionStatus).toBe("past_due");
    expect(account.rentBalance + account.lateFeeBalance + account.otherChargeBalance)
      .toBe(account.totalBalanceDue);
  });

  it("five grace days are not late; the sixth day is late everywhere", () => {
    const invoices = [invoice("2026-07-01")];
    const onFifth = buildAccountLedger({
      lease,
      invoices,
      payments: [],
      asOfDate: "2026-07-06",
    });
    const onSixth = buildAccountLedger({
      lease,
      invoices,
      payments: [],
      asOfDate: "2026-07-07",
    });
    expect(onFifth.totalBalanceDue).toBe(175);
    expect(onFifth.pastDueBalanceDue).toBe(0);
    expect(onFifth.pastDueInvoiceCount).toBe(0);
    expect(onFifth.daysLate).toBeNull();
    expect(onFifth.collectionStatus).toBe("balance_due");
    expect(onSixth.daysLate).toBe(6);
    expect(onSixth.collectionStatus).toBe("past_due");
    expect(onSixth.pastDueInvoiceCount).toBe(1);
    expect(onSixth.pastDueBalanceDue).toBe(175);
  });

  it("past-due totals exclude within-grace invoices on the same account", () => {
    const invoices = [invoice("2026-06-01"), invoice("2026-07-01")];
    const account = buildAccountLedger({
      lease,
      invoices,
      payments: [],
      asOfDate: "2026-07-03",
    });
    const dashboard = buildCollectionsSummary({
      leases: [lease],
      invoicesByLease: new Map([[lease.id, invoices]]),
      paymentsByLease: new Map([[lease.id, []]]),
      asOfDate: "2026-07-03",
    }).rows[0];

    expect(account.unpaidInvoiceCount).toBe(2);
    expect(account.pastDueInvoiceCount).toBe(1);
    expect(account.pastDueBalanceDue).toBe(175);
    expect(account.totalBalanceDue).toBe(350);
    expect(dashboard.pastDueInvoicesCount).toBe(1);
    expect(dashboard.pastDueBalanceDue).toBe(175);
  });

  it("future payments affect neither balance nor Last Paid early", () => {
    const invoices = [invoice("2026-07-01")];
    const account = buildAccountLedger({
      lease,
      invoices,
      payments: [
        {
          id: "future",
          lease_id: lease.id,
          invoice_id: invoices[0].id,
          payment_date: "2026-07-20",
          amount: 175,
          status: "completed",
        },
      ],
      asOfDate: "2026-07-07",
    });
    expect(account.totalBalanceDue).toBe(175);
    expect(account.lastEligiblePositivePaymentDate).toBeNull();
    expect(account.futureOrIneligiblePayments.map((p) => p.paymentId)).toEqual([
      "future",
    ]);
  });

  it("failed/reversed payments are excluded and no payment is counted twice", () => {
    const invoices = [invoice("2026-07-01")];
    const account = buildAccountLedger({
      lease,
      invoices,
      payments: [
        {
          id: "completed",
          lease_id: lease.id,
          invoice_id: invoices[0].id,
          payment_date: "2026-07-02",
          amount: 200,
          status: "completed",
        },
        {
          id: "failed",
          lease_id: lease.id,
          invoice_id: invoices[0].id,
          payment_date: "2026-07-02",
          amount: 50,
          status: "failed",
        },
      ],
      asOfDate: "2026-07-07",
    });
    const completed = account.payments.find((p) => p.paymentId === "completed")!;
    expect(completed.allocatedAmount).toBe(175);
    expect(completed.unallocatedAmount).toBe(25);
    expect(completed.allocatedAmount + completed.unallocatedAmount).toBe(200);
    expect(account.payments.find((p) => p.paymentId === "failed")?.eligible).toBe(
      false,
    );
    expect(account.propertyTotalCollected).toBe(175);
  });

  it("Profit attributes eligible collections to invoice due month", () => {
    const invoices = [
      { ...invoice("2026-07-01"), property_id: lease.property_id },
      { ...invoice("2026-08-01"), property_id: lease.property_id },
    ];
    const facts = buildDueMonthCollectionFacts({
      invoices,
      payments: [
        {
          id: "early-july-rent",
          lease_id: lease.id,
          invoice_id: invoices[0].id,
          payment_date: "2026-06-28",
          amount: 160,
          status: "completed",
        },
        {
          id: "future-payment",
          lease_id: lease.id,
          invoice_id: invoices[0].id,
          payment_date: "2026-07-20",
          amount: 15,
          status: "completed",
        },
        {
          id: "august-invoice",
          lease_id: lease.id,
          invoice_id: invoices[1].id,
          payment_date: "2026-07-02",
          amount: 160,
          status: "completed",
        },
      ],
      monthStart: "2026-07-01",
      monthEnd: "2026-07-31",
      asOfDate: "2026-07-17",
    });
    expect(facts.totalCollected).toBe(160);
    expect(facts.collectedByProperty.get(lease.property_id)).toBe(160);
  });
});
