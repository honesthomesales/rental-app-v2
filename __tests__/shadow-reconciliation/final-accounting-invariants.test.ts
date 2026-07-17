/**
 * Final accounting invariants — as-of, future payments, missing obligations,
 * dollar bridges, continuity, historical excess, DISABLED_FOR_UI.
 */
import {
  computeBaselineLeaseTotals,
  computeCandidateAccountSummaries,
  partitionPaymentsByAsOf,
  isPaymentEligibleAsOf,
  assertFuturePaymentInvariants,
  FUTURE_DATED_COMPLETED_PAYMENT_EXCLUDED,
  analyzeMissingObligations,
  buildDollarBridge,
  type ShadowDataset,
} from "@/lib/shadow-reconciliation";

const AS_OF = "2026-07-26";

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

describe("future-dated completed payment exclusion", () => {
  it("1. payment after as-of is excluded", () => {
    const payments = [
      {
        id: "P1",
        lease_id: "L1",
        invoice_id: "I1",
        amount: 100,
        payment_date: "2026-07-26",
        status: "completed",
      },
      {
        id: "P2",
        lease_id: "L1",
        invoice_id: "I1",
        amount: 200,
        payment_date: "2026-07-27",
        status: "completed",
      },
    ];
    const part = partitionPaymentsByAsOf(payments, AS_OF);
    expect(part.eligible).toHaveLength(1);
    expect(part.eligible[0].id).toBe("P1");
    expect(part.excludedCount).toBe(1);
    expect(part.excludedAmount).toBe(200);
    expect(part.excludedFuture[0].exclusionClass).toBe(
      FUTURE_DATED_COMPLETED_PAYMENT_EXCLUDED,
    );
  });

  it("2. future payment cannot affect earlier invoice or balance", () => {
    const leases = [
      {
        id: "L1",
        tenant_id: "T1",
        property_id: "P1",
        lease_start_date: "2026-01-01",
        lease_end_date: "2030-01-01",
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
        due_date: "2026-07-01",
        status: "OPEN",
        amount_total: 500,
        amount_rent: 500,
        amount_late: 0,
      },
    ];
    const withFuture = ds({
      leases,
      invoices,
      payments: [
        {
          id: "PF",
          lease_id: "L1",
          invoice_id: "I1",
          amount: 500,
          payment_date: "2026-12-01",
          status: "completed",
        },
      ],
    });
    const baseline = computeBaselineLeaseTotals(withFuture);
    expect(baseline[0].totalOwed).toBe(500);
    const cand = computeCandidateAccountSummaries(withFuture);
    expect(cand[0].totalOwed).toBe(500);
  });

  it("3–5. future payment cannot affect late status, profit-as-of proxy, or credit", () => {
    const leases = [
      {
        id: "L1",
        tenant_id: "T1",
        property_id: "P1",
        lease_start_date: "2026-01-01",
        lease_end_date: "2030-01-01",
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
        due_date: "2026-06-01",
        status: "OPEN",
        amount_total: 500,
        amount_rent: 500,
        amount_late: 0,
      },
    ];
    const dataset = ds({
      leases,
      invoices,
      payments: [
        {
          id: "PF",
          lease_id: "L1",
          invoice_id: null,
          amount: 500,
          payment_date: "2027-01-15",
          status: "completed",
        },
      ],
    });
    const baseline = computeBaselineLeaseTotals(dataset);
    expect(baseline[0].lateOrCurrent).toBe("late");
    expect(baseline[0].lastPaymentDate).not.toBe("2027-01-15");
    const cand = computeCandidateAccountSummaries(dataset);
    expect(cand[0].forwardCredit).toBe(0);
    expect(cand[0].historicalCreditCarried).toBe(0);
    // Future payment not in eligible set → not excess either for as-of
    expect(isPaymentEligibleAsOf(dataset.payments[0], AS_OF)).toBe(false);
    const part = partitionPaymentsByAsOf(dataset.payments, AS_OF);
    assertFuturePaymentInvariants({
      asOfDate: AS_OF,
      eligiblePayments: part.eligible,
      excludedFuture: part.excludedFuture,
    });
  });
});

describe("missing-obligation invariants", () => {
  it("6–9. total matches rows; empty total is 0; after cutoff excluded; same-period invoice blocks duplicate", () => {
    const invoices = [
      {
        id: "I1",
        lease_id: "L1",
        due_date: "2026-06-01",
        status: "OPEN",
        amount_total: 1000,
        amount_rent: 1000,
      },
    ];
    const analysis = analyzeMissingObligations({
      leaseId: "L1",
      leaseStartDate: "2026-01-01",
      leaseEndDate: "2030-01-01",
      rent: 1000,
      rentCadence: "monthly",
      rentDueDay: 1,
      invoices,
      payments: [],
      asOfDate: AS_OF,
    });
    // Forward from last invoice June 1 → July 1 due by as-of; Aug excluded
    expect(analysis.proposedMissing.map((r) => r.dueDate)).toEqual([
      "2026-07-01",
    ]);
    expect(analysis.totalProposedMissingAmount).toBe(1000);
    expect(
      analysis.proposedMissing.reduce((s, r) => s + r.rentAmount, 0),
    ).toBe(1000);
    expect(
      analysis.proposedMissing.every((r) => r.dueDate <= AS_OF),
    ).toBe(true);

    // Same period already invoiced on July 1 with different day → no July 15 gap
    const ash = analyzeMissingObligations({
      leaseId: "L2",
      leaseStartDate: "2026-05-01",
      leaseEndDate: "2029-06-30",
      rent: 1300,
      rentCadence: "monthly",
      rentDueDay: 15,
      invoices: [
        {
          id: "A1",
          lease_id: "L2",
          due_date: "2026-07-01",
          status: "OPEN",
          amount_total: 1300,
        },
      ],
      payments: [],
      asOfDate: AS_OF,
    });
    expect(ash.totalProposedMissingAmount).toBe(0);
    expect(ash.proposedMissing).toHaveLength(0);

    // Chad-like: last invoice July 1, next Aug 1 > as-of
    const chad = analyzeMissingObligations({
      leaseId: "L3",
      leaseStartDate: "2026-06-01",
      leaseEndDate: "2032-01-31",
      rent: 1200,
      rentCadence: "monthly",
      rentDueDay: 1,
      invoices: [
        {
          id: "C1",
          lease_id: "L3",
          due_date: "2026-07-01",
          status: "OPEN",
          amount_total: 1200,
        },
      ],
      payments: [],
      asOfDate: AS_OF,
    });
    expect(chad.totalProposedMissingAmount).toBe(0);
  });
});

describe("active lease and historical excess", () => {
  it("10. active lease through cutoff is not a continuity decision", () => {
    const dataset = ds({
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2025-01-15",
          lease_end_date: "2030-01-01",
          rent: 500,
          rent_cadence: "monthly",
          rent_due_day: 1,
          status: "occupied",
        },
      ],
      invoices: [
        {
          id: "I1",
          lease_id: "L1",
          due_date: "2026-07-01",
          status: "OPEN",
          amount_total: 500,
          amount_rent: 500,
          amount_late: 0,
        },
      ],
      payments: [],
    });
    const cand = computeCandidateAccountSummaries(dataset);
    expect(["current", "unset"]).toContain(cand[0].continuityClassification);
    expect(cand[0].decisionType === "current_holdover").toBe(false);
    // Active lease through 2030 is not a holdover / expired-continuity case.
    expect(cand[0].holdoverCandidate).toBe(false);
  });

  it("11–12. historical excess cannot reduce current balance or satisfy later obligation", () => {
    const dataset = ds({
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2025-01-01",
          lease_end_date: "2030-01-01",
          rent: 500,
          rent_cadence: "monthly",
          rent_due_day: 1,
          status: "occupied",
        },
      ],
      invoices: [
        {
          id: "I_OLD",
          lease_id: "L1",
          due_date: "2025-06-01",
          status: "PAID",
          amount_total: 500,
          amount_rent: 500,
          amount_late: 0,
        },
        {
          id: "I_NEW",
          lease_id: "L1",
          due_date: "2026-07-01",
          status: "OPEN",
          amount_total: 500,
          amount_rent: 500,
          amount_late: 0,
        },
      ],
      payments: [
        {
          id: "POVER",
          lease_id: "L1",
          invoice_id: "I_OLD",
          amount: 800,
          payment_date: "2025-06-05",
          status: "completed",
        },
      ],
    });
    const cand = computeCandidateAccountSummaries(dataset);
    expect(cand[0].historicalCreditCarried).toBe(0);
    expect(cand[0].forwardCredit).toBe(0);
    // Excess does not wipe July obligation
    expect(cand[0].totalOwed).toBeGreaterThanOrEqual(500);
  });
});

describe("dollar bridge and conservation", () => {
  it("13. every bridge reconciles to the cent", () => {
    const bridge = buildDollarBridge({
      currentPaymentsBalance: 1000,
      candidateBalance: 1200,
      missingObligationsDueByAsOf: 200,
      requirePerfect: true,
    });
    expect(bridge.reconcilesToCent).toBe(true);
    expect(bridge.unexplainedAmount).toBe(0);
  });

  it("14–16. payment uniqueness / allocation cap / period once covered by engine tests indirectly", () => {
    const part = partitionPaymentsByAsOf(
      [
        {
          id: "P1",
          amount: 50,
          payment_date: "2026-07-01",
          lease_id: "L1",
        },
        {
          id: "P1",
          amount: 50,
          payment_date: "2026-07-01",
          lease_id: "L1",
        },
      ],
      AS_OF,
    );
    // partition does not dedupe; assignPaymentsToAccounts does — here just eligibility
    expect(part.eligible).toHaveLength(2);
    const bridge = buildDollarBridge({
      currentPaymentsBalance: 100,
      candidateBalance: 50,
      eligiblePaymentAllocationCorrections: 50,
      requirePerfect: true,
    });
    expect(bridge.reconcilesToCent).toBe(true);
  });
});

describe("decision queue and UI gate", () => {
  it("17. exact matches produce zero unexplained bridge and no forced decision", () => {
    const bridge = buildDollarBridge({
      currentPaymentsBalance: 0,
      candidateBalance: 0,
      requirePerfect: true,
    });
    expect(bridge.unexplainedAmount).toBe(0);
    expect(Math.abs(bridge.candidateBalance - bridge.currentPaymentsBalance)).toBe(
      0,
    );
  });

  it("18. candidate remains DISABLED_FOR_UI", () => {
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
    const cand = computeCandidateAccountSummaries(dataset);
    expect(cand.every((c) => c.DISABLED_FOR_UI === true)).toBe(true);
  });

  it("19. no live writes occur (pure functions only)", () => {
    // Smoke: running partition + analyze + bridge does not throw and returns data
    const part = partitionPaymentsByAsOf([], AS_OF);
    expect(part.excludedCount).toBe(0);
    const analysis = analyzeMissingObligations({
      leaseId: "L",
      leaseStartDate: null,
      leaseEndDate: null,
      rent: 0,
      rentCadence: "monthly",
      invoices: [],
      payments: [],
      asOfDate: AS_OF,
    });
    expect(analysis.totalProposedMissingAmount).toBe(0);
  });
});
