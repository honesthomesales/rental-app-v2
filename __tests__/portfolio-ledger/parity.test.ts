import { calculateUnpaidInvoices } from "@/lib/invoice-calculations";
import {
  buildAccountLedger,
  buildCollectionsSummary,
  PORTFOLIO_LEDGER_VERSION,
} from "@/lib/portfolio-ledger/service";

describe("portfolio ledger parity with Payments baseline", () => {
  const asOf = "2026-07-17";
  const lease = {
    id: "lease-a",
    property_id: "prop-a",
    tenant_id: "ten-a",
    status: "occupied",
    rent: 160,
    rent_cadence: "weekly",
    lease_start_date: "2026-01-01",
    property_name: "100 Willis Bell",
    tenant_name: "Jayne Long",
  };

  const invoices = [
    {
      id: "inv-past",
      lease_id: "lease-a",
      due_date: "2026-07-10",
      status: "OPEN",
      amount_rent: 140,
      amount_late: 0,
      amount_other: 0,
      amount_total: 140,
    },
    {
      id: "inv-current",
      lease_id: "lease-a",
      due_date: "2026-07-17",
      status: "OPEN",
      amount_rent: 160,
      amount_late: 0,
      amount_other: 0,
      amount_total: 160,
    },
    {
      id: "inv-future",
      lease_id: "lease-a",
      due_date: "2026-07-24",
      status: "OPEN",
      amount_rent: 160,
      amount_late: 0,
      amount_other: 0,
      amount_total: 160,
    },
  ];

  const payments = [
    {
      id: "pay-1",
      lease_id: "lease-a",
      invoice_id: "inv-past",
      payment_date: "2026-07-11",
      amount: 40,
      status: "completed",
    },
    {
      id: "pay-future",
      lease_id: "lease-a",
      invoice_id: "inv-current",
      payment_date: "2026-07-20",
      amount: 160,
      status: "completed",
    },
  ];

  it("matches calculateUnpaidInvoices totalOwed", () => {
    const baseline = calculateUnpaidInvoices(
      invoices as never[],
      payments as never[],
      lease.lease_start_date,
      asOf,
    );
    const account = buildAccountLedger({
      lease,
      invoices,
      payments,
      asOfDate: asOf,
    });
    expect(account.totalBalanceDue).toBe(baseline.totalOwed);
    expect(account.ledgerVersion).toBe(PORTFOLIO_LEDGER_VERSION);
  });

  it("excludes future payment from current balance and last paid", () => {
    const account = buildAccountLedger({
      lease,
      invoices,
      payments,
      asOfDate: asOf,
    });
    // past: 140-40=100; current: 160 (future pay ignored); future scheduled separate
    expect(account.totalBalanceDue).toBe(260);
    expect(account.lastEligiblePositivePaymentDate).toBe("2026-07-11");
    expect(account.futureScheduledCharges).toBe(160);
  });

  it("conserves allocated + unallocated for eligible payments", () => {
    const account = buildAccountLedger({
      lease,
      invoices,
      payments,
      asOfDate: asOf,
    });
    for (const p of account.payments.filter((x) => x.eligible)) {
      expect(p.allocatedAmount + p.unallocatedAmount).toBe(p.amount);
    }
  });

  it("collections summary does not create per-lease HTTP (pure batch builder)", () => {
    const summary = buildCollectionsSummary({
      leases: [lease, { ...lease, id: "lease-b", tenant_id: "ten-b" }],
      invoicesByLease: new Map([
        ["lease-a", invoices],
        ["lease-b", []],
      ]),
      paymentsByLease: new Map([
        ["lease-a", payments],
        ["lease-b", []],
      ]),
      asOfDate: asOf,
    });
    expect(summary.rows).toHaveLength(2);
    expect(summary.rows[0].totalOwed).toBeGreaterThanOrEqual(
      summary.rows[1].totalOwed,
    );
  });
});
