import {
  buildAccountLedger,
  buildCollectionsSummary,
  buildCollectedMonthCollectionFacts,
} from "@/lib/portfolio-ledger/service";

const lease = {
  id: "lease-1",
  property_id: "property-1",
  tenant_id: "tenant-1",
  status: "occupied",
  rent: 160,
  rent_cadence: "weekly",
  rent_due_day: 1,
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

  it("five grace days are not late; the 6th calendar date is late for rent due on the 1st", () => {
    const monthlyLease = {
      ...lease,
      rent_cadence: "monthly",
      rent_due_day: 1,
      rent: 1125,
    };
    const invoices = [
      {
        id: "august",
        lease_id: monthlyLease.id,
        due_date: "2026-08-01",
        period_start: "2026-08-01",
        period_end: "2026-08-31",
        status: "OPEN",
        amount_rent: 1125,
        amount_late: 45,
        amount_other: 0,
        amount_total: 1170,
      },
    ];
    const onFifth = buildAccountLedger({
      lease: monthlyLease,
      invoices,
      payments: [],
      asOfDate: "2026-08-05",
    });
    const onSixth = buildAccountLedger({
      lease: monthlyLease,
      invoices,
      payments: [],
      asOfDate: "2026-08-06",
    });
    expect(onFifth.totalBalanceDue).toBe(1170);
    expect(onFifth.pastDueBalanceDue).toBe(0);
    expect(onFifth.pastDueInvoiceCount).toBe(0);
    expect(onFifth.daysLate).toBeNull();
    expect(onFifth.collectionStatus).toBe("balance_due");
    expect(onSixth.daysLate).toBe(5);
    expect(onSixth.collectionStatus).toBe("past_due");
    expect(onSixth.pastDueInvoiceCount).toBe(1);
    expect(onSixth.pastDueBalanceDue).toBe(1170);
  });

  it("uses the lease due day for monthly invoice periods when stored due_date is stale", () => {
    const crystalLease = {
      ...lease,
      id: "crystal-lease",
      property_id: "166-tullyton",
      tenant_id: "crystal-pagoada",
      rent: 1125,
      rent_cadence: "monthly",
      rent_due_day: 1,
      property_name: "166 Tullyton",
      tenant_name: "Crystal Pagoada",
    };
    const invoices = [
      {
        id: "august-stale-due-date",
        lease_id: crystalLease.id,
        // Historical bad/stale value: this would have made the Aug invoice look Future.
        due_date: "2026-08-15",
        period_start: "2026-08-01",
        period_end: "2026-08-31",
        status: "OPEN",
        amount_rent: 1125,
        amount_late: 45,
        amount_other: 0,
        amount_total: 1170,
      },
    ];

    const account = buildAccountLedger({
      lease: crystalLease,
      invoices,
      payments: [],
      asOfDate: "2026-08-10",
    });

    expect(account.invoices[0].dueDate).toBe("2026-08-01");
    expect(account.invoices[0].isFuture).toBe(false);
    expect(account.invoices[0].collectionStatus).toBe("past_due");
    expect(account.totalBalanceDue).toBe(1170);
    expect(account.pastDueBalanceDue).toBe(1170);
    expect(account.collectionStatus).toBe("past_due");
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

  it("posted future payments reduce balance; Last Paid stays business-date only", () => {
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
    expect(account.totalBalanceDue).toBe(0);
    expect(account.lastEligiblePositivePaymentDate).toBeNull();
    expect(account.eligiblePayments.map((p) => p.paymentId)).toEqual(["future"]);
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

  it("Profit attributes eligible collections to payment collection month", () => {
    const facts = buildCollectedMonthCollectionFacts({
      payments: [
        {
          id: "paid-in-june-for-july-invoice",
          lease_id: lease.id,
          property_id: lease.property_id,
          invoice_id: "inv-july",
          payment_date: "2026-06-28",
          amount: 160,
          status: "completed",
        },
        {
          id: "paid-in-july",
          lease_id: lease.id,
          property_id: lease.property_id,
          invoice_id: "inv-august",
          payment_date: "2026-07-02",
          amount: 160,
          status: "completed",
        },
        {
          id: "future-payment",
          lease_id: lease.id,
          property_id: lease.property_id,
          invoice_id: "inv-july",
          payment_date: "2026-07-20",
          amount: 15,
          status: "completed",
        },
      ],
      monthStart: "2026-07-01",
      monthEnd: "2026-07-31",
      asOfDate: "2026-07-17",
    });
    // July 2 + future July 20 both count in July profit month view.
    expect(facts.totalCollected).toBe(175);
    expect(facts.collectedByProperty.get(lease.property_id)).toBe(175);
  });
});
