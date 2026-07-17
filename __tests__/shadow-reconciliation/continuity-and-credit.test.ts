/**
 * Continuity decisions + forward-only credit policy tests.
 * Synthetic fixtures only — no live writes.
 */

import {
  computeCandidateAccountSummaries,
  makeAccountKey,
  type AccountContinuityDecision,
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

function decision(
  tenantId: string,
  propertyId: string,
  decisionType: AccountContinuityDecision["decisionType"],
  extra: Partial<AccountContinuityDecision> = {},
): AccountContinuityDecision {
  return { tenantId, propertyId, decisionType, ...extra };
}

describe("continuity + forward-only credit policy", () => {
  it("1. sold property stops obligations", () => {
    const dataset = ds({
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2026-01-01",
          lease_end_date: "2026-03-01",
          rent: 500,
          rent_cadence: "monthly",
          rent_due_day: 1,
          status: "sold",
        },
      ],
      invoices: [
        {
          id: "I1",
          lease_id: "L1",
          due_date: "2026-01-01",
          status: "OPEN",
          amount_total: 500,
          amount_rent: 500,
          amount_late: 0,
        },
      ],
      payments: [],
    });
    const [c] = computeCandidateAccountSummaries(dataset, {
      decisions: [decision("T1", "P1", "sold_closed")],
    });
    expect(c.missingExpectedObligations).toBe(0);
    expect(c.totalOwed).toBe(0);
    expect(c.historicalBalanceReview).toBe(500);
    expect(c.continuityClassification).toBe("closed");
    expect(c.DISABLED_FOR_UI).toBe(true);
  });

  it("2. moved tenant stops obligations", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        leases: [
          {
            id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            lease_start_date: "2026-01-01",
            lease_end_date: "2026-02-28",
            rent: 400,
            rent_cadence: "monthly",
            rent_due_day: 1,
            status: "empty",
          },
        ],
        invoices: [],
        payments: [],
      }),
      { decisions: [decision("T1", "P1", "moved_closed")] },
    );
    expect(c.missingExpectedObligations).toBe(0);
    expect(c.totalOwed).toBe(0);
  });

  it("3. replacement tenant does not inherit predecessor balance", () => {
    const dataset = ds({
      leases: [
        {
          id: "Lold",
          tenant_id: "TOLD",
          property_id: "P1",
          lease_start_date: "2025-01-01",
          lease_end_date: "2026-01-01",
          rent: 1000,
          rent_cadence: "monthly",
          rent_due_day: 1,
          status: "empty",
        },
        {
          id: "Lnew",
          tenant_id: "TNEW",
          property_id: "P1",
          lease_start_date: "2026-02-01",
          lease_end_date: "2027-02-01",
          rent: 1100,
          rent_cadence: "monthly",
          rent_due_day: 1,
          status: "occupied",
        },
      ],
      invoices: [
        {
          id: "Iold",
          lease_id: "Lold",
          due_date: "2025-12-01",
          status: "OPEN",
          amount_total: 1000,
          amount_rent: 1000,
          amount_late: 0,
        },
      ],
      payments: [],
    });
    const summaries = computeCandidateAccountSummaries(dataset, {
      decisions: [
        decision("TOLD", "P1", "replaced_by_new_tenant"),
        decision("TNEW", "P1", "current_new_tenant"),
      ],
    });
    const oldAcct = summaries.find((s) => s.tenantId === "TOLD")!;
    const newAcct = summaries.find((s) => s.tenantId === "TNEW")!;
    expect(oldAcct.totalOwed).toBe(0);
    expect(oldAcct.historicalBalanceReview).toBe(1000);
    expect(newAcct.totalOwed).not.toBe(1000);
    expect(newAcct.relatedLeaseIds).not.toContain("Lold");
    expect(newAcct.accountKey).not.toBe(oldAcct.accountKey);
  });

  it("4. replacement tenant does not inherit predecessor credit", () => {
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
            rent_cadence: "monthly",
            rent_due_day: 1,
            status: "empty",
          },
          {
            id: "Lnew",
            tenant_id: "TNEW",
            property_id: "P1",
            lease_start_date: "2026-03-01",
            rent: 500,
            rent_cadence: "monthly",
            rent_due_day: 1,
            status: "occupied",
          },
        ],
        invoices: [
          {
            id: "Iold",
            lease_id: "Lold",
            due_date: "2025-06-01",
            status: "OPEN",
            amount_total: 100,
            amount_rent: 100,
            amount_late: 0,
          },
        ],
        payments: [
          {
            id: "Pold",
            lease_id: "Lold",
            tenant_id: "TOLD",
            property_id: "P1",
            invoice_id: "Iold",
            amount: 400,
            payment_date: "2025-06-02",
            status: "completed",
          },
        ],
      }),
      {
        decisions: [
          decision("TOLD", "P1", "replaced_by_new_tenant"),
          decision("TNEW", "P1", "current_new_tenant"),
        ],
      },
    );
    const oldAcct = summaries.find((s) => s.tenantId === "TOLD")!;
    const newAcct = summaries.find((s) => s.tenantId === "TNEW")!;
    expect(oldAcct.historicalExcessPayment).toBeGreaterThan(0);
    expect(newAcct.historicalExcessPayment).toBe(0);
    expect(newAcct.forwardCredit).toBe(0);
    expect(newAcct.unappliedCredit).toBe(0);
  });

  it("5. empty property stops obligations", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        leases: [
          {
            id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            lease_start_date: "2025-01-01",
            lease_end_date: "2025-06-01",
            rent: 300,
            rent_cadence: "monthly",
            rent_due_day: 1,
            status: "empty",
          },
        ],
        invoices: [],
        payments: [],
      }),
      { decisions: [decision("T1", "P1", "vacant_closed")] },
    );
    expect(c.missingExpectedObligations).toBe(0);
  });

  it("6. lease never effective creates no obligations", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        leases: [
          {
            id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            lease_start_date: "2026-01-01",
            lease_end_date: "2026-12-31",
            rent: 500,
            rent_cadence: "monthly",
            rent_due_day: 1,
            status: "empty",
          },
        ],
        invoices: [],
        payments: [
          {
            id: "P1",
            lease_id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            amount: 50,
            payment_date: "2026-02-01",
            status: "completed",
          },
        ],
      }),
      { decisions: [decision("T1", "P1", "lease_never_effective")] },
    );
    expect(c.missingExpectedObligations).toBe(0);
    expect(c.totalOwed).toBe(0);
    expect(c.dataProblems).toContain("data_cleanup_required");
  });

  it("7. expired closed lease does not become holdover", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        leases: [
          {
            id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            lease_start_date: "2025-01-01",
            lease_end_date: "2025-12-31",
            rent: 500,
            rent_cadence: "monthly",
            rent_due_day: 1,
            status: "inactive",
          },
        ],
        tenants: [{ id: "T1", is_active: true }],
        invoices: [],
        payments: [
          {
            id: "P1",
            lease_id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            amount: 100,
            payment_date: "2026-02-01",
            status: "completed",
          },
        ],
      }),
      { decisions: [decision("T1", "P1", "expired_closed")] },
    );
    expect(c.confirmedHoldover).toBe(false);
    expect(c.holdoverObligations).toBe(0);
    expect(c.missingExpectedObligations).toBe(0);
  });

  it("8. confirmed holdover continues last reliable terms", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        leases: [
          {
            id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            lease_start_date: "2026-01-01",
            lease_end_date: "2026-03-31",
            rent: 500,
            rent_cadence: "monthly",
            rent_due_day: 1,
            status: "empty",
          },
        ],
        tenants: [{ id: "T1", is_active: true }],
        invoices: [
          {
            id: "I1",
            lease_id: "L1",
            due_date: "2026-01-01",
            status: "PAID",
            amount_total: 500,
            amount_rent: 500,
            amount_late: 0,
          },
          {
            id: "I2",
            lease_id: "L1",
            due_date: "2026-02-01",
            status: "PAID",
            amount_total: 500,
            amount_rent: 500,
            amount_late: 0,
          },
          {
            id: "I3",
            lease_id: "L1",
            due_date: "2026-03-01",
            status: "PAID",
            amount_total: 500,
            amount_rent: 500,
            amount_late: 0,
          },
        ],
        payments: [],
      }),
      { decisions: [decision("T1", "P1", "current_holdover")] },
    );
    expect(c.confirmedHoldover).toBe(true);
    expect(c.holdoverObligations).toBeGreaterThan(0);
    // Apr, May, Jun holdover months after Mar 31 end
    expect(c.missingExpectedObligations).toBeGreaterThanOrEqual(3);
  });

  it("9. new tenant begins only at their own start date", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        leases: [
          {
            id: "Lnew",
            tenant_id: "TNEW",
            property_id: "P1",
            lease_start_date: "2026-05-01",
            lease_end_date: "2027-05-01",
            rent: 800,
            rent_cadence: "monthly",
            rent_due_day: 1,
            status: "occupied",
          },
        ],
        invoices: [],
        payments: [],
      }),
      { decisions: [decision("TNEW", "P1", "current_new_tenant")] },
    );
    // May + Jun only (asOf Jun 15)
    expect(c.missingExpectedObligations).toBe(2);
    expect(c.totalOwed).toBe(1600);
  });

  it("10. historical overpayment creates no credit when effective date unset", () => {
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
            id: "P1",
            lease_id: "L1",
            invoice_id: "I1",
            amount: 250,
            payment_date: "2026-01-05",
            status: "completed",
          },
        ],
      }),
      { decisions: [decision("T1", "P1", "current")] },
    );
    expect(c.forwardCredit).toBe(0);
    expect(c.unappliedCredit).toBe(0);
    expect(c.historicalCreditCarried).toBe(0);
    expect(c.historicalExcessPayment).toBe(150);
  });

  it("11. pre-cutover excess cannot pay a post-cutover obligation", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        asOfDate: "2026-05-15",
        leases: [
          {
            id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            lease_start_date: "2026-01-01",
            lease_end_date: "2026-05-31",
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
            status: "PAID",
            amount_total: 100,
            amount_rent: 100,
            amount_late: 0,
          },
          {
            id: "I3",
            lease_id: "L1",
            due_date: "2026-03-01",
            status: "PAID",
            amount_total: 100,
            amount_rent: 100,
            amount_late: 0,
          },
          {
            id: "I4",
            lease_id: "L1",
            due_date: "2026-04-01",
            status: "PAID",
            amount_total: 100,
            amount_rent: 100,
            amount_late: 0,
          },
          {
            id: "I5",
            lease_id: "L1",
            due_date: "2026-05-01",
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
            amount: 200,
            payment_date: "2026-01-10",
            status: "completed",
          },
        ],
      }),
      {
        decisions: [decision("T1", "P1", "current")],
        creditCarryForwardEffectiveDate: "2026-04-01",
      },
    );
    expect(c.historicalExcessPayment).toBe(100);
    expect(c.forwardCredit).toBe(0);
    expect(c.totalOwed).toBe(100); // May obligation unpaid
  });

  it("12. post-cutover overpayment creates forward credit", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        asOfDate: "2026-05-15",
        leases: [
          {
            id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            lease_start_date: "2026-05-01",
            lease_end_date: "2026-05-31",
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
            due_date: "2026-05-01",
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
            amount: 175,
            payment_date: "2026-05-05",
            status: "completed",
          },
        ],
      }),
      {
        decisions: [decision("T1", "P1", "current")],
        creditCarryForwardEffectiveDate: "2026-04-01",
      },
    );
    expect(c.totalOwed).toBe(0);
    expect(c.forwardCredit).toBe(75);
    expect(c.historicalExcessPayment).toBe(0);
  });

  it("13. forward credit pays a later same-account obligation", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        asOfDate: "2026-05-15",
        leases: [
          {
            id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            lease_start_date: "2026-04-01",
            lease_end_date: "2026-05-31",
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
            due_date: "2026-04-01",
            status: "OPEN",
            amount_total: 100,
            amount_rent: 100,
            amount_late: 0,
          },
          {
            id: "I2",
            lease_id: "L1",
            due_date: "2026-05-01",
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
            amount: 200,
            payment_date: "2026-04-05",
            status: "completed",
          },
        ],
      }),
      {
        decisions: [decision("T1", "P1", "current")],
        creditCarryForwardEffectiveDate: "2026-04-01",
      },
    );
    expect(c.totalOwed).toBe(0);
    expect(c.forwardCredit).toBe(0);
  });

  it("14. forward credit cannot cross tenant or property", () => {
    const summaries = computeCandidateAccountSummaries(
      ds({
        asOfDate: "2026-05-15",
        leases: [
          {
            id: "LA",
            tenant_id: "TA",
            property_id: "PA",
            lease_start_date: "2026-04-01",
            lease_end_date: "2026-04-30",
            rent: 100,
            rent_cadence: "monthly",
            rent_due_day: 1,
            status: "occupied",
          },
          {
            id: "LB",
            tenant_id: "TB",
            property_id: "PB",
            lease_start_date: "2026-05-01",
            lease_end_date: "2026-05-31",
            rent: 100,
            rent_cadence: "monthly",
            rent_due_day: 1,
            status: "occupied",
          },
        ],
        invoices: [
          {
            id: "IA",
            lease_id: "LA",
            due_date: "2026-04-01",
            status: "OPEN",
            amount_total: 50,
            amount_rent: 50,
            amount_late: 0,
          },
          {
            id: "IB",
            lease_id: "LB",
            due_date: "2026-05-01",
            status: "OPEN",
            amount_total: 100,
            amount_rent: 100,
            amount_late: 0,
          },
        ],
        payments: [
          {
            id: "PA1",
            lease_id: "LA",
            tenant_id: "TA",
            property_id: "PA",
            invoice_id: "IA",
            amount: 150,
            payment_date: "2026-04-05",
            status: "completed",
          },
        ],
      }),
      {
        decisions: [
          decision("TA", "PA", "current"),
          decision("TB", "PB", "current"),
        ],
        creditCarryForwardEffectiveDate: "2026-04-01",
      },
    );
    const a = summaries.find((s) => s.tenantId === "TA")!;
    const b = summaries.find((s) => s.tenantId === "TB")!;
    expect(a.forwardCredit).toBe(100);
    expect(b.totalOwed).toBe(100);
    expect(b.forwardCredit).toBe(0);
    expect(a.accountKey).toBe(makeAccountKey("TA", "PA"));
  });

  it("15. closing an account flags remaining credit for review", () => {
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
        decisions: [decision("T1", "P1", "sold_closed")],
        creditCarryForwardEffectiveDate: "2026-04-01",
      },
    );
    expect(c.forwardCredit).toBe(0);
    expect(c.creditCloseoutReview).toBe(80);
    expect(c.dataProblems).toContain("credit_closeout_review");
  });

  it("16. candidate remains disabled for UI", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        leases: [
          {
            id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            lease_start_date: "2026-01-01",
            rent: 100,
            status: "occupied",
          },
        ],
        invoices: [],
        payments: [],
      }),
    );
    expect(c.DISABLED_FOR_UI).toBe(true);
  });

  it("17. no live writes (engine is pure / in-memory)", () => {
    const dataset = ds({
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
      invoices: [],
      payments: [],
    });
    const before = JSON.stringify(dataset);
    computeCandidateAccountSummaries(dataset, {
      decisions: [decision("T1", "P1", "current")],
      creditCarryForwardEffectiveDate: "2026-01-01",
    });
    expect(JSON.stringify(dataset)).toBe(before);
  });
});
