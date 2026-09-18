import {
  buildAccountLedger,
  buildCollectionsSummary,
  toCollectionsSummaryRow,
} from "@/lib/portfolio-ledger/service";
import { buildLateTenantRowTotals } from "@/lib/late-tenants-summary";
import {
  computeInvoiceRealAmountOwed,
  computeRealAmountOwed,
} from "@/lib/invoice-real-balance";
import {
  planSelectedInvoiceForwardAllocation,
  toAllocatableInvoices,
} from "@/lib/payments/post-allocated-payment";
import { allocateSelectedInvoiceForward } from "@/lib/payments/allocate-selected-forward";

/**
 * 104 Camp St shape: Jan 7 stored PAID/$0 with only $160 of real payments on $225.
 * Other open balances chosen so account total is $2,735 before a $475 payment.
 */
const CAMP_LEASE = {
  id: "lease-camp-104",
  property_id: "property-camp-104",
  tenant_id: "tenant-camp-104",
  status: "occupied",
  rent: 225,
  rent_cadence: "weekly",
  rent_due_day: 7,
  lease_start_date: "2025-01-01",
  property_name: "104 Camp St",
  tenant_name: "Camp Tenant",
};

const JAN7 = "inv-jan-7";
const APR8 = "inv-apr-8";
const JUN10 = "inv-jun-10";
const JUN17 = "inv-jun-17";
const JUN24 = "inv-jun-24";
const OTHER = "inv-other-open";

function campInvoices() {
  return [
    {
      id: JAN7,
      lease_id: CAMP_LEASE.id,
      due_date: "2026-01-07",
      period_start: "2026-01-07",
      period_end: "2026-01-13",
      status: "PAID",
      amount_rent: 225,
      amount_late: 0,
      amount_other: 0,
      amount_total: 225,
      amount_paid: 225, // stale
      balance_due: 0, // stale
    },
    {
      id: APR8,
      lease_id: CAMP_LEASE.id,
      due_date: "2026-04-08",
      period_start: "2026-04-08",
      period_end: "2026-04-14",
      status: "OPEN",
      amount_rent: 15,
      amount_late: 0,
      amount_other: 0,
      amount_total: 15,
      amount_paid: 0,
      balance_due: 15,
    },
    {
      id: JUN10,
      lease_id: CAMP_LEASE.id,
      due_date: "2026-06-10",
      period_start: "2026-06-10",
      period_end: "2026-06-16",
      status: "OPEN",
      amount_rent: 145,
      amount_late: 0,
      amount_other: 0,
      amount_total: 145,
      amount_paid: 0,
      balance_due: 145,
    },
    {
      id: JUN17,
      lease_id: CAMP_LEASE.id,
      due_date: "2026-06-17",
      period_start: "2026-06-17",
      period_end: "2026-06-23",
      status: "OPEN",
      amount_rent: 235,
      amount_late: 0,
      amount_other: 0,
      amount_total: 235,
      amount_paid: 0,
      balance_due: 235,
    },
    {
      id: JUN24,
      lease_id: CAMP_LEASE.id,
      due_date: "2026-06-24",
      period_start: "2026-06-24",
      period_end: "2026-06-30",
      status: "OPEN",
      amount_rent: 80,
      amount_late: 0,
      amount_other: 0,
      amount_total: 80,
      amount_paid: 0,
      balance_due: 80,
    },
    {
      id: OTHER,
      lease_id: CAMP_LEASE.id,
      due_date: "2025-12-01",
      period_start: "2025-12-01",
      period_end: "2025-12-07",
      status: "OPEN",
      amount_rent: 2195,
      amount_late: 0,
      amount_other: 0,
      amount_total: 2195,
      amount_paid: 0,
      balance_due: 2195,
    },
  ];
}

function campExistingPayments() {
  return [
    {
      id: "pay-jan-partial",
      lease_id: CAMP_LEASE.id,
      invoice_id: JAN7,
      payment_date: "2026-01-10",
      amount: 160,
      status: "completed",
    },
  ];
}

function buildCampAccount(asOfDate = "2026-09-18") {
  return buildAccountLedger({
    lease: CAMP_LEASE,
    invoices: campInvoices(),
    payments: campExistingPayments(),
    asOfDate,
  });
}

describe("canonical real amount owed (stale stored fields)", () => {
  it("PAID/$0 stored with $160 real payments on $225 yields $65 owed", () => {
    const invoice = campInvoices()[0];
    expect(
      computeInvoiceRealAmountOwed({
        invoice,
        payments: campExistingPayments(),
      }),
    ).toBe(65);
    expect(computeRealAmountOwed(225, 160)).toBe(65);

    const account = buildCampAccount();
    const jan = account.invoices.find((inv) => inv.invoiceId === JAN7);
    expect(jan?.calculatedBalance).toBe(65);
    expect(jan?.eligiblePaidAmount).toBe(160);
    // Stale PAID must not hide real balance from account totals.
    expect(account.totalBalanceDue).toBe(2735);
  });

  it("allocates $475 selected on Jan 7 as 65/15/145/235/15 oldest-to-newest forward", () => {
    const plan = planSelectedInvoiceForwardAllocation({
      paymentAmount: 475,
      selectedInvoiceId: JAN7,
      invoices: campInvoices(),
      payments: campExistingPayments(),
    });

    expect(plan.splits).toEqual([
      { invoiceId: JAN7, amount: 65, dueDate: "2026-01-07" },
      { invoiceId: APR8, amount: 15, dueDate: "2026-04-08" },
      { invoiceId: JUN10, amount: 145, dueDate: "2026-06-10" },
      { invoiceId: JUN17, amount: 235, dueDate: "2026-06-17" },
      { invoiceId: JUN24, amount: 15, dueDate: "2026-06-24" },
    ]);
    expect(plan.allocatedAmount).toBe(475);
    expect(plan.unallocatedAmount).toBe(0);
  });

  it("account balance drops from $2735 to $2260 after the $475 payment", () => {
    const before = buildCampAccount();
    expect(before.totalBalanceDue).toBe(2735);

    const afterPayments = [
      ...campExistingPayments(),
      {
        id: "leg-jan",
        lease_id: CAMP_LEASE.id,
        invoice_id: JAN7,
        payment_date: "2026-09-18",
        amount: 65,
        status: "completed",
      },
      {
        id: "leg-apr",
        lease_id: CAMP_LEASE.id,
        invoice_id: APR8,
        payment_date: "2026-09-18",
        amount: 15,
        status: "completed",
      },
      {
        id: "leg-jun10",
        lease_id: CAMP_LEASE.id,
        invoice_id: JUN10,
        payment_date: "2026-09-18",
        amount: 145,
        status: "completed",
      },
      {
        id: "leg-jun17",
        lease_id: CAMP_LEASE.id,
        invoice_id: JUN17,
        payment_date: "2026-09-18",
        amount: 235,
        status: "completed",
      },
      {
        id: "leg-jun24",
        lease_id: CAMP_LEASE.id,
        invoice_id: JUN24,
        payment_date: "2026-09-18",
        amount: 15,
        status: "completed",
      },
    ];

    const after = buildAccountLedger({
      lease: CAMP_LEASE,
      invoices: campInvoices(),
      payments: afterPayments,
      asOfDate: "2026-09-18",
    });

    expect(after.totalBalanceDue).toBe(2260);
    expect(before.totalBalanceDue - after.totalBalanceDue).toBe(475);
  });

  it("Payments, Late, Last Paid, and property summary share the same account balance", () => {
    const account = buildCampAccount();
    const paymentsRow = toCollectionsSummaryRow(account, CAMP_LEASE as any);
    const late = buildLateTenantRowTotals(
      account.totalBalanceDue,
      account.pastDueBalanceDue,
    );
    const summary = buildCollectionsSummary({
      leases: [CAMP_LEASE as any],
      invoicesByLease: new Map([[CAMP_LEASE.id, campInvoices()]]),
      paymentsByLease: new Map([[CAMP_LEASE.id, campExistingPayments()]]),
      asOfDate: "2026-09-18",
    });
    const propertyTotal = summary.rows.reduce((s, r) => s + r.totalOwed, 0);

    expect(paymentsRow.totalOwed).toBe(2735);
    expect(late.accountTotalOwed).toBe(2735);
    // Last Paid uses account.totalBalanceDue directly.
    expect(account.totalBalanceDue).toBe(2735);
    expect(propertyTotal).toBe(2735);
    expect(summary.rows[0].totalOwed).toBe(account.totalBalanceDue);
  });
});

describe("real-balance edge coverage", () => {
  it("supports weekly and monthly leases with partial payments", () => {
    const weekly = buildAccountLedger({
      lease: { ...CAMP_LEASE, rent_cadence: "weekly", rent: 160 },
      invoices: [
        {
          id: "w1",
          lease_id: CAMP_LEASE.id,
          due_date: "2026-08-01",
          status: "PARTIAL",
          amount_rent: 160,
          amount_late: 0,
          amount_other: 0,
          amount_total: 160,
          amount_paid: 999,
          balance_due: 0,
        },
      ],
      payments: [
        {
          id: "p1",
          lease_id: CAMP_LEASE.id,
          invoice_id: "w1",
          payment_date: "2026-08-02",
          amount: 40,
          status: "completed",
        },
      ],
      asOfDate: "2026-09-18",
    });
    expect(weekly.totalBalanceDue).toBe(120);

    const monthly = buildAccountLedger({
      lease: {
        ...CAMP_LEASE,
        rent_cadence: "monthly",
        rent: 1125,
        rent_due_day: 1,
      },
      invoices: [
        {
          id: "m1",
          lease_id: CAMP_LEASE.id,
          due_date: "2026-08-01",
          period_start: "2026-08-01",
          period_end: "2026-08-31",
          status: "OPEN",
          amount_rent: 1125,
          amount_late: 45,
          amount_other: 0,
          amount_total: 1170,
          amount_paid: 0,
          balance_due: 1170,
        },
      ],
      payments: [
        {
          id: "mp",
          lease_id: CAMP_LEASE.id,
          invoice_id: "m1",
          payment_date: "2026-08-05",
          amount: 170,
          status: "completed",
        },
      ],
      asOfDate: "2026-09-18",
    });
    expect(monthly.totalBalanceDue).toBe(1000);
  });

  it("rolls overpayments forward and ignores void/cancelled invoices", () => {
    const plan = planSelectedInvoiceForwardAllocation({
      paymentAmount: 300,
      selectedInvoiceId: "a",
      invoices: [
        {
          id: "a",
          due_date: "2026-01-01",
          amount_total: 100,
          amount_paid: 0,
          balance_due: 100,
          status: "OPEN",
        },
        {
          id: "voided",
          due_date: "2026-02-01",
          amount_total: 100,
          amount_paid: 0,
          balance_due: 100,
          status: "VOID",
        },
        {
          id: "cancelled",
          due_date: "2026-03-01",
          amount_total: 100,
          amount_paid: 0,
          balance_due: 100,
          status: "CANCELLED",
        },
        {
          id: "b",
          due_date: "2026-04-01",
          amount_total: 100,
          amount_paid: 0,
          balance_due: 100,
          status: "OPEN",
        },
      ],
      payments: [],
    });
    expect(plan.splits).toEqual([
      { invoiceId: "a", amount: 100, dueDate: "2026-01-01" },
      { invoiceId: "b", amount: 100, dueDate: "2026-04-01" },
    ]);
    expect(plan.unallocatedAmount).toBe(100);
  });

  it("includes future-dated completed payments in balances (existing staff posting rule)", () => {
    const account = buildAccountLedger({
      lease: CAMP_LEASE,
      invoices: [
        {
          id: "fut",
          lease_id: CAMP_LEASE.id,
          due_date: "2026-08-01",
          status: "OPEN",
          amount_rent: 200,
          amount_late: 0,
          amount_other: 0,
          amount_total: 200,
          amount_paid: 0,
          balance_due: 200,
        },
      ],
      payments: [
        {
          id: "future-pay",
          lease_id: CAMP_LEASE.id,
          invoice_id: "fut",
          payment_date: "2026-12-01",
          amount: 50,
          status: "completed",
        },
      ],
      asOfDate: "2026-09-18",
    });
    expect(account.totalBalanceDue).toBe(150);
  });

  it("does not trust stale OPEN/PARTIAL/PAID status or stored amount_paid/balance_due", () => {
    const invoices = [
      {
        id: "stale-open",
        due_date: "2026-05-01",
        amount_total: 100,
        amount_paid: 100,
        balance_due: 0,
        status: "OPEN",
      },
      {
        id: "stale-partial",
        due_date: "2026-06-01",
        amount_total: 100,
        amount_paid: 20,
        balance_due: 80,
        status: "PARTIAL",
      },
      {
        id: "stale-paid",
        due_date: "2026-07-01",
        amount_total: 100,
        amount_paid: 100,
        balance_due: 0,
        status: "PAID",
      },
    ];
    const payments = [
      {
        id: "p-open",
        invoice_id: "stale-open",
        amount: 100,
        status: "completed",
        payment_date: "2026-05-02",
      },
      {
        id: "p-partial",
        invoice_id: "stale-partial",
        amount: 20,
        status: "completed",
        payment_date: "2026-06-02",
      },
      {
        id: "p-paid",
        invoice_id: "stale-paid",
        amount: 40,
        status: "completed",
        payment_date: "2026-07-02",
      },
    ];

    const allocatable = toAllocatableInvoices(invoices, payments);
    expect(allocatable.find((i) => i.id === "stale-open")?.balanceDue).toBe(0);
    expect(allocatable.find((i) => i.id === "stale-partial")?.balanceDue).toBe(
      80,
    );
    expect(allocatable.find((i) => i.id === "stale-paid")?.balanceDue).toBe(60);

    const account = buildAccountLedger({
      lease: CAMP_LEASE,
      invoices: invoices.map((inv) => ({
        ...inv,
        lease_id: CAMP_LEASE.id,
        amount_rent: Number(inv.amount_total),
        amount_late: 0,
        amount_other: 0,
      })),
      payments: payments.map((p) => ({
        ...p,
        lease_id: CAMP_LEASE.id,
      })),
      asOfDate: "2026-09-18",
    });
    // Only partial ($80) + stale-paid real ($60) remain collectible.
    expect(account.totalBalanceDue).toBe(140);
  });

  it("allocation planning is deterministic for duplicate submissions of the same inputs", () => {
    const args = {
      paymentAmount: 475,
      selectedInvoiceId: JAN7,
      invoices: campInvoices(),
      payments: campExistingPayments(),
    };
    const first = planSelectedInvoiceForwardAllocation(args);
    const second = planSelectedInvoiceForwardAllocation(args);
    expect(second).toEqual(first);

    // Pure allocator also stable when given identical real balances twice.
    const once = allocateSelectedInvoiceForward({
      paymentAmount: 475,
      selectedInvoiceId: JAN7,
      invoices: toAllocatableInvoices(campInvoices(), campExistingPayments()),
    });
    const twice = allocateSelectedInvoiceForward({
      paymentAmount: 475,
      selectedInvoiceId: JAN7,
      invoices: toAllocatableInvoices(campInvoices(), campExistingPayments()),
    });
    expect(twice).toEqual(once);
  });
});
