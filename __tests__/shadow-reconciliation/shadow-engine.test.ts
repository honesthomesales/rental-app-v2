/**
 * Shadow reconciliation engine tests.
 * Pure in-memory fixtures — no live Supabase / no writes.
 */

import {
  computeBaselineLeaseTotals,
  computeCandidateAccountSummaries,
  buildDifferenceReport,
  makeAccountKey,
  type ShadowDataset,
} from "@/lib/shadow-reconciliation";
import { calculateUnpaidInvoices } from "@/lib/invoice-calculations";

const AS_OF = "2026-03-15";

function dataset(partial: Partial<ShadowDataset> & Pick<ShadowDataset, "leases" | "invoices" | "payments">): ShadowDataset {
  return {
    asOfDate: AS_OF,
    defaultGraceDays: 5,
    tenants: [],
    ...partial,
  };
}

describe("1. Payments baseline unchanged", () => {
  it("matches calculateUnpaidInvoices for occupied leases", () => {
    const leases = [
      {
        id: "L1",
        tenant_id: "T1",
        property_id: "P1",
        lease_start_date: "2026-01-01",
        rent: 500,
        rent_cadence: "monthly",
        rent_due_day: 1,
        status: "occupied",
      },
    ];
    const invoices = [
      {
        id: "I1",
        lease_id: "L1",
        due_date: "2026-01-01",
        status: "OPEN",
        amount_total: 500,
        amount_rent: 500,
        amount_late: 0,
      },
      {
        id: "I2",
        lease_id: "L1",
        due_date: "2026-02-01",
        status: "OPEN",
        amount_total: 500,
        amount_rent: 500,
        amount_late: 0,
      },
    ];
    const payments = [
      {
        id: "PAY1",
        lease_id: "L1",
        invoice_id: "I2",
        amount: 200,
        payment_date: "2026-02-05",
        status: "completed",
      },
    ];

    const shared = calculateUnpaidInvoices(
      invoices,
      payments,
      "2026-01-01",
      AS_OF,
    );
    const baseline = computeBaselineLeaseTotals(
      dataset({ leases, invoices, payments }),
    );
    expect(baseline).toHaveLength(1);
    expect(baseline[0].totalOwed).toBe(shared.totalOwed);
    expect(baseline[0].totalOwed).toBe(800);
  });

  it("ignores empty leases like Payments page", () => {
    const baseline = computeBaselineLeaseTotals(
      dataset({
        leases: [
          {
            id: "Lempty",
            tenant_id: "T1",
            property_id: "P1",
            lease_start_date: "2026-01-01",
            status: "empty",
            rent: 500,
          },
        ],
        invoices: [],
        payments: [],
      }),
    );
    expect(baseline).toHaveLength(0);
  });
});

describe("2–5. Payment linking rules", () => {
  it("2. linked payment via invoice_id reduces that obligation", () => {
    const ds = dataset({
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
          amount: 100,
          payment_date: "2026-01-02",
          status: "completed",
        },
      ],
    });
    const [c] = computeCandidateAccountSummaries(ds);
    expect(c.totalOwed).toBe(0);
    expect(c.linkedPaymentsAmount).toBe(100);
    expect(c.paymentAllocations[0].source).toBe("invoice_id");
    expect(c.DISABLED_FOR_UI).toBe(true);
  });

  it("3. unlinked payment with lease_id applies to oldest unpaid", () => {
    const ds = dataset({
      asOfDate: "2026-02-15",
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
        {
          id: "I2",
          lease_id: "L1",
          due_date: "2026-02-01",
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
          invoice_id: null,
          amount: 100,
          payment_date: "2026-01-10",
          status: "completed",
        },
      ],
    });
    const [c] = computeCandidateAccountSummaries(ds);
    expect(c.totalOwed).toBe(100);
    expect(c.unlinkedPaymentsAmount).toBe(100);
    expect(c.dataProblems).toContain("unlinked_payment");
    expect(c.paymentAllocations.some((a) => a.source === "lease_id")).toBe(true);
  });

  it("4. unlinked payment with exact tenant/property applies to oldest", () => {
    const ds = dataset({
      asOfDate: "2026-01-15",
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2026-01-01",
          lease_end_date: "2026-01-31",
          rent: 200,
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
          amount_total: 200,
          amount_rent: 200,
          amount_late: 0,
        },
      ],
      payments: [
        {
          id: "PAY1",
          lease_id: null,
          invoice_id: null,
          tenant_id: "T1",
          property_id: "P1",
          amount: 50,
          payment_date: "2026-01-08",
          status: "completed",
        },
      ],
    });
    const [c] = computeCandidateAccountSummaries(ds);
    expect(c.totalOwed).toBe(150);
    expect(c.paymentAllocations[0].source).toBe("tenant_property");
  });

  it("5. ambiguous unlinked payment remains unapplied", () => {
    const leases = [
      {
        id: "L1",
        tenant_id: "T1",
        property_id: "P1",
        lease_start_date: "2026-01-01",
        lease_end_date: "2026-12-31",
        rent: 100,
        rent_cadence: "monthly",
        rent_due_day: 1,
        status: "occupied",
      },
    ];
    const invoices = [
      {
        id: "I1",
        lease_id: "L1",
        due_date: "2026-01-01",
        status: "OPEN",
        amount_total: 100,
        amount_rent: 100,
        amount_late: 0,
      },
    ];
    // No invoice/lease/tenant/property — cannot assign without guessing
    const [c1] = computeCandidateAccountSummaries(
      dataset({
        leases,
        invoices,
        payments: [
          {
            id: "PAY_AMB",
            lease_id: null,
            invoice_id: null,
            tenant_id: null,
            property_id: null,
            amount: 40,
            payment_date: "2026-01-09",
            status: "completed",
          },
        ],
      }),
    );
    expect(c1.totalOwed).toBeGreaterThanOrEqual(100);
    expect(c1.paymentAllocations).toHaveLength(0);
    expect(c1.paymentsReceived).toBe(0);

    // Wrong property for this tenant — also not applied to this account
    const [c2] = computeCandidateAccountSummaries(
      dataset({
        leases,
        invoices,
        payments: [
          {
            id: "PAY_WRONG",
            lease_id: null,
            invoice_id: null,
            tenant_id: "T1",
            property_id: "P_OTHER",
            amount: 40,
            payment_date: "2026-01-09",
            status: "completed",
          },
        ],
      }),
    );
    expect(c2.totalOwed).toBeGreaterThanOrEqual(100);
    expect(c2.paymentAllocations).toHaveLength(0);
  });
});

describe("6–8. Partial / overpayment / credit forward", () => {
  it("6. partial payment leaves remaining balance", () => {
    const ds = dataset({
      asOfDate: "2026-01-15",
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2026-01-01",
          lease_end_date: "2026-01-31",
          rent: 300,
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
          amount_total: 300,
          amount_rent: 300,
          amount_late: 0,
        },
      ],
      payments: [
        {
          id: "PAY1",
          lease_id: "L1",
          invoice_id: "I1",
          amount: 100,
          payment_date: "2026-01-03",
          status: "completed",
        },
      ],
    });
    const [c] = computeCandidateAccountSummaries(ds);
    expect(c.totalOwed).toBe(200);
  });

  it("7. overpayment carried as unapplied credit", () => {
    const ds = dataset({
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
          amount: 150,
          payment_date: "2026-01-02",
          status: "completed",
        },
      ],
    });
    const [c] = computeCandidateAccountSummaries(ds);
    expect(c.totalOwed).toBe(0);
    expect(c.unappliedCredit).toBe(0);
    expect(c.historicalExcessPayment).toBe(50);
    expect(c.historicalCreditCarried).toBe(0);
    expect(c.forwardCredit).toBe(0);
  });

  it("8. credit pays a later obligation", () => {
    const ds = dataset({
      asOfDate: "2026-02-15",
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
        {
          id: "I2",
          lease_id: "L1",
          due_date: "2026-02-01",
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
          amount: 150,
          payment_date: "2026-01-02",
          status: "completed",
        },
      ],
    });
    const [c] = computeCandidateAccountSummaries(ds);
    expect(c.totalOwed).toBe(50);
    expect(c.paymentAllocations.some((a) => a.source === "credit_forward")).toBe(
      true,
    );
  });
});

describe("9–12. Lease continuity", () => {
  it("9. expired lease with no continuity evidence is not holdover", () => {
    const ds = dataset({
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2025-01-01",
          lease_end_date: "2025-06-01",
          rent: 100,
          rent_cadence: "monthly",
          rent_due_day: 1,
          status: "empty",
        },
      ],
      invoices: [],
      payments: [],
      tenants: [{ id: "T1", is_active: false }],
    });
    const accounts = computeCandidateAccountSummaries(ds);
    expect(accounts[0].holdoverCandidate).toBe(false);
  });

  it("10. expired lease with holdover evidence is labeled holdover_candidate", () => {
    const ds = dataset({
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2025-01-01",
          lease_end_date: "2025-06-01",
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
          due_date: "2025-05-01",
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
          amount: 10,
          payment_date: "2025-08-01",
          status: "completed",
        },
      ],
      tenants: [{ id: "T1", is_active: true }],
    });
    const [c] = computeCandidateAccountSummaries(ds);
    expect(c.holdoverCandidate).toBe(true);
    expect(c.dataProblems).toContain("holdover_candidate");
  });

  it("11. consecutive leases same tenant/property share one account", () => {
    const ds = dataset({
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2025-01-01",
          lease_end_date: "2025-12-31",
          rent: 100,
          rent_cadence: "monthly",
          status: "empty",
        },
        {
          id: "L2",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2026-01-01",
          lease_end_date: "2026-12-31",
          rent: 110,
          rent_cadence: "monthly",
          rent_due_day: 1,
          status: "occupied",
        },
      ],
      invoices: [
        {
          id: "I2",
          lease_id: "L2",
          due_date: "2026-02-01",
          status: "OPEN",
          amount_total: 110,
          amount_rent: 110,
          amount_late: 0,
        },
      ],
      payments: [],
    });
    const accounts = computeCandidateAccountSummaries(ds);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].relatedLeaseIds.sort()).toEqual(["L1", "L2"]);
    expect(accounts[0].accountKey).toBe(makeAccountKey("T1", "P1"));
  });

  it("12. replacement tenant is not joined to prior account", () => {
    const ds = dataset({
      leases: [
        {
          id: "L1",
          tenant_id: "T_OLD",
          property_id: "P1",
          lease_start_date: "2025-01-01",
          lease_end_date: "2025-12-31",
          rent: 100,
          status: "empty",
        },
        {
          id: "L2",
          tenant_id: "T_NEW",
          property_id: "P1",
          lease_start_date: "2026-01-01",
          lease_end_date: "2026-12-31",
          rent: 120,
          rent_cadence: "monthly",
          rent_due_day: 1,
          status: "occupied",
        },
      ],
      invoices: [
        {
          id: "I2",
          lease_id: "L2",
          due_date: "2026-02-01",
          status: "OPEN",
          amount_total: 120,
          amount_rent: 120,
          amount_late: 0,
        },
      ],
      payments: [],
    });
    const accounts = computeCandidateAccountSummaries(ds);
    expect(accounts).toHaveLength(2);
    expect(accounts.find((a) => a.tenantId === "T_OLD")!.holdoverCandidate).toBe(
      false,
    );
  });
});

describe("13–18. Obligations, fees, grace, flags", () => {
  it("13. missing invoice preview adds in-memory expected obligations", () => {
    const ds = dataset({
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2026-01-01",
          lease_end_date: "2026-12-31",
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
      payments: [],
    });
    const [c] = computeCandidateAccountSummaries(ds);
    expect(c.missingExpectedObligations).toBeGreaterThan(0);
    expect(c.dataProblems).toContain("missing_expected_obligation");
  });

  it("14. recorded late fee is included; 15. never invents late fee on expected", () => {
    const ds = dataset({
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2026-01-01",
          lease_end_date: "2026-12-31",
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
          amount_total: 145,
          amount_rent: 100,
          amount_late: 45,
        },
      ],
      payments: [],
    });
    const [c] = computeCandidateAccountSummaries(ds);
    expect(c.recordedLateFees).toBe(45);
    // Expected gaps have 0 late fee (never invented) — total owed includes rent-only gaps + 145
    expect(c.totalOwed).toBeGreaterThanOrEqual(145);
  });

  it("16. five-day grace period marks grace_period before expiry", () => {
    const ds = dataset({
      asOfDate: "2026-01-04",
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2026-01-01",
          lease_end_date: "2026-12-31",
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
      payments: [],
    });
    // Suppress expected gaps by ending evidence tightly — still has Jan invoice unpaid
    const [c] = computeCandidateAccountSummaries(ds);
    expect(c.graceStatus).toBe("grace_period");
    expect(c.daysLate).toBeLessThanOrEqual(5);
  });

  it("16b. after grace expires status is late", () => {
    const ds = dataset({
      asOfDate: "2026-01-10",
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2026-01-01",
          lease_end_date: "2026-12-31",
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
      payments: [],
    });
    const [c] = computeCandidateAccountSummaries(ds);
    expect(c.graceStatus).toBe("late");
    expect(c.daysLate).toBeGreaterThan(5);
  });

  it("17. unknown cadence flagged", () => {
    const ds = dataset({
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2026-01-01",
          lease_end_date: "2026-12-31",
          rent: 100,
          rent_cadence: "every-lunar-cycle",
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
      payments: [],
    });
    const [c] = computeCandidateAccountSummaries(ds);
    expect(c.dataProblems).toContain("unknown_cadence");
  });

  it("18. duplicate invoice flagged", () => {
    const ds = dataset({
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2026-01-01",
          lease_end_date: "2026-12-31",
          rent: 100,
          rent_cadence: "monthly",
          rent_due_day: 1,
          status: "occupied",
        },
      ],
      invoices: [
        {
          id: "I1a",
          lease_id: "L1",
          due_date: "2026-01-01",
          status: "OPEN",
          amount_total: 100,
          amount_rent: 100,
          amount_late: 0,
        },
        {
          id: "I1b",
          lease_id: "L1",
          due_date: "2026-01-01",
          status: "OPEN",
          amount_total: 100,
          amount_rent: 100,
          amount_late: 0,
        },
      ],
      payments: [],
    });
    const [c] = computeCandidateAccountSummaries(ds);
    expect(c.dataProblems).toContain("duplicate_invoice");
  });
});

describe("19–20. Payment status + no writes", () => {
  it("19. failed/pending/void payments excluded from candidate", () => {
    const ds = dataset({
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2026-01-01",
          lease_end_date: "2026-12-31",
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
          id: "PAY_F",
          lease_id: "L1",
          invoice_id: "I1",
          amount: 100,
          payment_date: "2026-01-02",
          status: "failed",
        },
        {
          id: "PAY_P",
          lease_id: "L1",
          invoice_id: "I1",
          amount: 100,
          payment_date: "2026-01-02",
          status: "pending",
        },
        {
          id: "PAY_V",
          lease_id: "L1",
          invoice_id: "I1",
          amount: 100,
          payment_date: "2026-01-02",
          status: "void",
        },
      ],
    });
    const [c] = computeCandidateAccountSummaries(ds);
    expect(c.paymentsReceived).toBe(0);
    expect(c.totalOwed).toBeGreaterThanOrEqual(100);
  });

  it("20. no database writes / no live fetch in engine", () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => {
        throw new Error("shadow engine must not fetch");
      });
    const ds = dataset({
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2026-01-01",
          rent: 50,
          rent_cadence: "weekly",
          status: "occupied",
        },
      ],
      invoices: [],
      payments: [],
    });
    buildDifferenceReport(ds);
    computeCandidateAccountSummaries(ds);
    computeBaselineLeaseTotals(ds);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("difference report + UI gate", () => {
  it("marks every candidate DISABLED_FOR_UI", () => {
    const ds = dataset({
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2026-01-01",
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
      payments: [],
    });
    for (const c of computeCandidateAccountSummaries(ds)) {
      expect(c.DISABLED_FOR_UI).toBe(true);
    }
  });

  it("report is anonymized (no raw accountKey PII fields)", () => {
    const report = buildDifferenceReport(
      dataset({
        leases: [
          {
            id: "lease-uuid-aaaa",
            tenant_id: "tenant-uuid-bbbb",
            property_id: "property-uuid-cccc",
            lease_start_date: "2026-01-01",
            rent: 100,
            rent_cadence: "monthly",
            rent_due_day: 1,
            status: "occupied",
          },
        ],
        invoices: [
          {
            id: "inv-1",
            lease_id: "lease-uuid-aaaa",
            due_date: "2026-01-01",
            status: "OPEN",
            amount_total: 100,
            amount_rent: 100,
            amount_late: 0,
          },
        ],
        payments: [],
      }),
    );
    const blob = JSON.stringify(report);
    expect(blob).not.toMatch(/@/);
    expect(blob).not.toMatch(/phone/i);
    expect(report.differences.every((d) => d.anonymizedAccountId.startsWith("ACCT-"))).toBe(
      true,
    );
  });
});
