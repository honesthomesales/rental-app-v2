/**
 * Payment conservation + excess diagnostic tests.
 * Synthetic only — no live writes.
 */

import {
  assignPaymentsToAccounts,
  computeCandidateAccountSummaries,
  groupLeasesIntoAccounts,
  uniqueCompletedPayments,
  type ShadowDataset,
} from "@/lib/shadow-reconciliation";

const AS_OF = "2026-06-15";

function ds(
  partial: Partial<ShadowDataset> &
    Pick<ShadowDataset, "leases" | "invoices" | "payments">,
): ShadowDataset {
  return {
    asOfDate: AS_OF,
    defaultGraceDays: 5,
    tenants: [],
    ...partial,
  };
}

describe("payment conservation audit", () => {
  it("1. one payment cannot appear in two accounts", () => {
    const dataset = ds({
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2026-01-01",
          status: "occupied",
          rent: 100,
        },
        {
          id: "L2",
          tenant_id: "T2",
          property_id: "P1",
          lease_start_date: "2026-02-01",
          status: "occupied",
          rent: 100,
        },
      ],
      invoices: [
        {
          id: "I1",
          lease_id: "L1",
          due_date: "2026-01-01",
          status: "OPEN",
          amount_total: 100,
          amount_rent: 100,
          amount_late: 0,
        },
      ],
      payments: [
        {
          id: "PAY1",
          lease_id: "L1",
          invoice_id: "I1",
          tenant_id: "T1",
          property_id: "P1",
          amount: 100,
          payment_date: "2026-01-05",
          status: "completed",
        },
      ],
    });
    const bundles = groupLeasesIntoAccounts(
      dataset.leases,
      dataset.tenants,
      dataset.payments,
      AS_OF,
    );
    const { paymentsByAccount, audit } = assignPaymentsToAccounts({
      payments: dataset.payments,
      bundles,
      invoices: dataset.invoices,
      leases: dataset.leases,
    });
    expect(audit.invariantViolations).toHaveLength(0);
    let hits = 0;
    for (const list of paymentsByAccount.values()) {
      if (list.some((p) => p.id === "PAY1")) hits++;
    }
    expect(hits).toBe(1);
  });

  it("2. one payment cannot be applied twice across consecutive leases", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        leases: [
          {
            id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            lease_start_date: "2026-01-01",
            lease_end_date: "2026-02-28",
            rent: 100,
            rent_cadence: "monthly",
            rent_due_day: 1,
            status: "empty",
          },
          {
            id: "L2",
            tenant_id: "T1",
            property_id: "P1",
            lease_start_date: "2026-03-01",
            rent: 100,
            rent_cadence: "monthly",
            rent_due_day: 1,
            status: "occupied",
          },
        ],
        invoices: [
          {
            id: "I1",
            lease_id: "L1",
            due_date: "2026-01-01",
            status: "PAID",
            amount_total: 100,
            amount_rent: 100,
            amount_late: 0,
            amount_paid: 100,
          },
          {
            id: "I2",
            lease_id: "L2",
            due_date: "2026-03-01",
            status: "OPEN",
            amount_total: 100,
            amount_rent: 100,
            amount_late: 0,
          },
        ],
        payments: [
          {
            id: "PAY1",
            lease_id: "L1",
            invoice_id: "I1",
            amount: 100,
            payment_date: "2026-01-05",
            status: "completed",
            tenant_id: "T1",
            property_id: "P1",
          },
        ],
      }),
      {
        decisions: [
          {
            tenantId: "T1",
            propertyId: "P1",
            decisionType: "current",
          },
        ],
      },
    );
    const applied = c.paymentAllocations
      .filter((a) => a.paymentId === "PAY1")
      .reduce((s, a) => s + a.amount, 0);
    expect(applied).toBeLessThanOrEqual(100);
    expect(c.totalOwed).toBeGreaterThan(0); // March still open
  });

  it("3+4. allocation never exceeds payment; allocation + unapplied equals payment", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        asOfDate: "2026-01-15",
        leases: [
          {
            id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            lease_start_date: "2026-01-01",
            lease_end_date: "2026-01-31",
            rent: 100,
            rent_cadence: "monthly",
            rent_due_day: 1,
            status: "occupied",
          },
        ],
        invoices: [
          {
            id: "I1",
            lease_id: "L1",
            due_date: "2026-01-01",
            status: "OPEN",
            amount_total: 100,
            amount_rent: 100,
            amount_late: 0,
          },
        ],
        payments: [
          {
            id: "PAY1",
            lease_id: "L1",
            invoice_id: "I1",
            amount: 130,
            payment_date: "2026-01-05",
            status: "completed",
          },
        ],
      }),
    );
    const alloc = c.paymentAllocations
      .filter((a) => a.paymentId === "PAY1")
      .reduce((s, a) => s + a.amount, 0);
    expect(alloc).toBeLessThanOrEqual(130);
    expect(alloc + c.historicalExcessPayment + c.forwardCredit).toBe(130);
  });

  it("5. replacement tenant receives no predecessor payment", () => {
    const summaries = computeCandidateAccountSummaries(
      ds({
        leases: [
          {
            id: "Lold",
            tenant_id: "TOLD",
            property_id: "P1",
            lease_start_date: "2025-01-01",
            lease_end_date: "2026-01-01",
            rent: 500,
            status: "empty",
          },
          {
            id: "Lnew",
            tenant_id: "TNEW",
            property_id: "P1",
            lease_start_date: "2026-03-01",
            rent: 500,
            status: "occupied",
          },
        ],
        invoices: [
          {
            id: "Iold",
            lease_id: "Lold",
            due_date: "2025-06-01",
            status: "PAID",
            amount_total: 500,
            amount_rent: 500,
            amount_late: 0,
            amount_paid: 500,
          },
        ],
        payments: [
          {
            id: "Pold",
            lease_id: "Lold",
            invoice_id: "Iold",
            tenant_id: "TOLD",
            property_id: "P1",
            amount: 500,
            payment_date: "2025-06-02",
            status: "completed",
          },
        ],
      }),
      {
        decisions: [
          {
            tenantId: "TOLD",
            propertyId: "P1",
            decisionType: "replaced_by_new_tenant",
          },
          {
            tenantId: "TNEW",
            propertyId: "P1",
            decisionType: "current_new_tenant",
          },
        ],
      },
    );
    const neu = summaries.find((s) => s.tenantId === "TNEW")!;
    expect(neu.paymentsReceived).toBe(0);
    expect(neu.paymentAllocations.some((a) => a.paymentId === "Pold")).toBe(
      false,
    );
  });

  it("6. miscellaneous income is not automatically treated as rent credit", () => {
    const summaries = computeCandidateAccountSummaries(
      ds({
        leases: [
          {
            id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            lease_start_date: "2026-01-01",
            status: "occupied",
            rent: 100,
          },
        ],
        invoices: [],
        payments: [
          {
            id: "MISC1",
            amount: 250,
            payment_date: "2026-02-01",
            status: "completed",
            tenant_id: "TX",
            property_id: "PY",
          },
        ],
      }),
    );
    expect(summaries.every((s) => s.forwardCredit === 0)).toBe(true);
    expect(summaries.every((s) => s.unappliedCredit === 0)).toBe(true);
  });

  it("7. missing obligations prevent classification as supported overpayment", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        leases: [
          {
            id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            lease_start_date: "2026-01-01",
            lease_end_date: "2026-01-31",
            rent: 100,
            rent_cadence: "monthly",
            rent_due_day: 1,
            status: "sold",
          },
        ],
        invoices: [],
        payments: [
          {
            id: "PAY1",
            lease_id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            amount: 100,
            payment_date: "2026-01-10",
            status: "completed",
          },
        ],
      }),
      {
        decisions: [
          { tenantId: "T1", propertyId: "P1", decisionType: "sold_closed" },
        ],
      },
    );
    expect(c.forwardCredit).toBe(0);
    expect(c.unappliedCredit).toBe(0);
    expect(c.historicalPaymentReview).toBeGreaterThan(0);
    const reasons = c.excessByReason;
    const reasonTotal = Object.values(reasons).reduce((s, n) => s + n, 0);
    expect(reasonTotal).toBeGreaterThan(0);
    expect(reasonTotal).toBeCloseTo(c.historicalExcessPayment, 2);
  });

  it("8. historical excess creates no forward credit", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        asOfDate: "2026-01-15",
        leases: [
          {
            id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            lease_start_date: "2026-01-01",
            lease_end_date: "2026-01-31",
            rent: 100,
            rent_cadence: "monthly",
            rent_due_day: 1,
            status: "occupied",
          },
        ],
        invoices: [
          {
            id: "I1",
            lease_id: "L1",
            due_date: "2026-01-01",
            status: "OPEN",
            amount_total: 50,
            amount_rent: 50,
            amount_late: 0,
          },
        ],
        payments: [
          {
            id: "PAY1",
            lease_id: "L1",
            invoice_id: "I1",
            amount: 200,
            payment_date: "2026-01-05",
            status: "completed",
          },
        ],
      }),
    );
    expect(c.historicalExcessPayment).toBe(150);
    expect(c.forwardCredit).toBe(0);
  });

  it("9. closed-account excess remains historical review only", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        asOfDate: "2026-04-15",
        leases: [
          {
            id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            lease_start_date: "2026-04-01",
            lease_end_date: "2026-04-30",
            rent: 100,
            rent_cadence: "monthly",
            rent_due_day: 1,
            status: "sold",
          },
        ],
        invoices: [
          {
            id: "I1",
            lease_id: "L1",
            due_date: "2026-04-01",
            status: "OPEN",
            amount_total: 100,
            amount_rent: 100,
            amount_late: 0,
          },
        ],
        payments: [
          {
            id: "P1",
            lease_id: "L1",
            invoice_id: "I1",
            amount: 180,
            payment_date: "2026-04-10",
            status: "completed",
          },
        ],
      }),
      {
        decisions: [
          { tenantId: "T1", propertyId: "P1", decisionType: "sold_closed" },
        ],
        creditCarryForwardEffectiveDate: "2026-04-01",
      },
    );
    expect(c.totalOwed).toBe(0);
    expect(c.forwardCredit).toBe(0);
    expect(c.creditCloseoutReview + c.historicalPaymentReview).toBeGreaterThan(
      0,
    );
  });

  it("10. unique account payment totals reconcile to unique payment totals", () => {
    const dataset = ds({
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2026-01-01",
          status: "occupied",
        },
        {
          id: "L2",
          tenant_id: "T2",
          property_id: "P2",
          lease_start_date: "2026-01-01",
          status: "occupied",
        },
      ],
      invoices: [],
      payments: [
        {
          id: "A",
          lease_id: "L1",
          amount: 10,
          payment_date: "2026-01-01",
          status: "completed",
        },
        {
          id: "B",
          lease_id: "L2",
          amount: 20,
          payment_date: "2026-01-01",
          status: "completed",
        },
        {
          id: "A",
          lease_id: "L1",
          amount: 10,
          payment_date: "2026-01-01",
          status: "completed",
        },
      ],
    });
    const bundles = groupLeasesIntoAccounts(
      dataset.leases,
      [],
      dataset.payments,
      AS_OF,
    );
    const { audit } = assignPaymentsToAccounts({
      payments: dataset.payments,
      bundles,
      invoices: [],
      leases: dataset.leases,
    });
    expect(audit.uniqueCompletedPaymentTotal).toBe(30);
    expect(audit.assignedPaymentTotal).toBe(30);
    expect(audit.duplicateCountedAmount).toBe(10);
  });

  it("11. duplicate payment IDs are detected", () => {
    const r = uniqueCompletedPayments([
      {
        id: "X",
        amount: 5,
        payment_date: "2026-01-01",
        status: "completed",
      },
      {
        id: "X",
        amount: 5,
        payment_date: "2026-01-01",
        status: "completed",
      },
    ]);
    expect(r.duplicateIds).toEqual(["X"]);
    expect(r.unique).toHaveLength(1);
  });

  it("12. candidate remains disabled for UI", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        leases: [
          {
            id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            lease_start_date: "2026-01-01",
            status: "occupied",
          },
        ],
        invoices: [],
        payments: [],
      }),
    );
    expect(c.DISABLED_FOR_UI).toBe(true);
  });

  it("13. no live writes occur", () => {
    const dataset = ds({
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2026-01-01",
          status: "occupied",
        },
      ],
      invoices: [],
      payments: [],
    });
    const before = JSON.stringify(dataset);
    computeCandidateAccountSummaries(dataset);
    expect(JSON.stringify(dataset)).toBe(before);
  });
});

describe("PAID-invoice historical obligation accounting", () => {
  const lease = {
    id: "L1",
    tenant_id: "T1",
    property_id: "P1",
    lease_start_date: "2026-01-01",
    lease_end_date: "2026-01-31",
    rent: 1000,
    rent_cadence: "monthly",
    rent_due_day: 1,
    status: "occupied" as const,
  };

  const opts = {
    decisions: [
      {
        tenantId: "T1",
        propertyId: "P1",
        decisionType: "current" as const,
      },
    ],
  };

  it("1. PAID invoice plus matching payment produces zero excess", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        asOfDate: "2026-01-15",
        leases: [lease],
        invoices: [
          {
            id: "I1",
            lease_id: "L1",
            due_date: "2026-01-01",
            status: "PAID",
            amount_total: 1000,
            amount_rent: 1000,
            amount_late: 0,
            amount_paid: 1000,
          },
        ],
        payments: [
          {
            id: "PAY1",
            lease_id: "L1",
            invoice_id: "I1",
            amount: 1000,
            payment_date: "2026-01-05",
            status: "completed",
          },
        ],
      }),
      opts,
    );
    expect(c.historicalExcessPayment).toBe(0);
    expect(c.totalOwed).toBe(0);
    expect(c.realInvoiceObligationTotal).toBe(1000);
  });

  it("2. PAID invoice paid through multiple payments produces zero excess", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        asOfDate: "2026-01-15",
        leases: [lease],
        invoices: [
          {
            id: "I1",
            lease_id: "L1",
            due_date: "2026-01-01",
            status: "PAID",
            amount_total: 1000,
            amount_rent: 1000,
            amount_late: 0,
            amount_paid: 1000,
          },
        ],
        payments: [
          {
            id: "PAY1",
            lease_id: "L1",
            invoice_id: "I1",
            amount: 400,
            payment_date: "2026-01-03",
            status: "completed",
          },
          {
            id: "PAY2",
            lease_id: "L1",
            invoice_id: "I1",
            amount: 600,
            payment_date: "2026-01-08",
            status: "completed",
          },
        ],
      }),
      opts,
    );
    expect(c.historicalExcessPayment).toBe(0);
    expect(c.paymentsReceived).toBe(1000);
  });

  it("3. Overpayment above a PAID invoice produces only the true remainder", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        asOfDate: "2026-01-15",
        leases: [lease],
        invoices: [
          {
            id: "I1",
            lease_id: "L1",
            due_date: "2026-01-01",
            status: "PAID",
            amount_total: 1000,
            amount_rent: 1000,
            amount_late: 0,
            amount_paid: 1000,
          },
        ],
        payments: [
          {
            id: "PAY1",
            lease_id: "L1",
            invoice_id: "I1",
            amount: 1150,
            payment_date: "2026-01-05",
            status: "completed",
          },
        ],
      }),
      opts,
    );
    expect(c.historicalExcessPayment).toBe(150);
    expect(c.excessByReason.confirmed_payment_above_recorded_obligations).toBe(
      150,
    );
    expect(c.forwardCredit).toBe(0);
    expect(c.historicalCreditCarried).toBe(0);
  });

  it("4. A recorded late fee on a PAID invoice remains part of the obligation", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        asOfDate: "2026-01-15",
        leases: [lease],
        invoices: [
          {
            id: "I1",
            lease_id: "L1",
            due_date: "2026-01-01",
            status: "PAID",
            amount_total: 1045,
            amount_rent: 1000,
            amount_late: 45,
            amount_paid: 1045,
          },
        ],
        payments: [
          {
            id: "PAY1",
            lease_id: "L1",
            invoice_id: "I1",
            amount: 1045,
            payment_date: "2026-01-10",
            status: "completed",
          },
        ],
      }),
      opts,
    );
    expect(c.realInvoiceObligationTotal).toBe(1045);
    expect(c.recordedLateFees).toBe(45);
    expect(c.historicalExcessPayment).toBe(0);
  });

  it("5. A void invoice does not create an obligation", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        asOfDate: "2026-01-15",
        leases: [lease],
        invoices: [
          {
            id: "I1",
            lease_id: "L1",
            due_date: "2026-01-01",
            status: "VOID",
            amount_total: 1000,
            amount_rent: 1000,
            amount_late: 0,
          },
        ],
        payments: [],
      }),
      // unresolved → no expected gap obligations
      {
        decisions: [
          {
            tenantId: "T1",
            propertyId: "P1",
            decisionType: "unresolved",
          },
        ],
      },
    );
    expect(c.realInvoiceObligationTotal).toBe(0);
    expect(c.totalOwed).toBe(0);
  });

  it("6. A payment linked to a void invoice is flagged for review", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        asOfDate: "2026-01-15",
        leases: [lease],
        invoices: [
          {
            id: "I1",
            lease_id: "L1",
            due_date: "2026-01-01",
            status: "VOID",
            amount_total: 1000,
            amount_rent: 1000,
            amount_late: 0,
          },
        ],
        payments: [
          {
            id: "PAY1",
            lease_id: "L1",
            invoice_id: "I1",
            amount: 500,
            payment_date: "2026-01-05",
            status: "completed",
          },
        ],
      }),
      {
        decisions: [
          {
            tenantId: "T1",
            propertyId: "P1",
            decisionType: "unresolved",
          },
        ],
      },
    );
    expect(c.historicalExcessPayment).toBe(500);
    expect(c.excessByReason.payment_linked_to_void_invoice).toBe(500);
  });
});
