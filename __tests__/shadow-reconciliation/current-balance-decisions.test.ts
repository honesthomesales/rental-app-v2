/**
 * Current-balance vs historical-only decision filter tests.
 * Synthetic only — no live writes.
 */

import {
  allocationMismatchImpact,
  buildImmediateDecisionQueue,
  classifyAccountReview,
  computeCandidateAccountSummaries,
  labelPreOccupancyPayment,
  leaseSegmentsForAccount,
  paymentsTransferToReplacement,
  preOccupancyWouldChangeCurrentBalance,
  reviewMissingInvoicePayment,
  type CandidateAccountSummary,
  type ImmediateDecisionRow,
  type ShadowDataset,
} from "@/lib/shadow-reconciliation";

function ds(
  partial: Partial<ShadowDataset> &
    Pick<ShadowDataset, "leases" | "invoices" | "payments">,
): ShadowDataset {
  return {
    asOfDate: "2026-06-15",
    defaultGraceDays: 5,
    tenants: [],
    ...partial,
  };
}

function emptyReasons(): CandidateAccountSummary["excessByReason"] {
  return {
    confirmed_payment_above_recorded_obligations: 0,
    missing_historical_obligations_not_approved: 0,
    lease_gap_obligations_not_approved: 0,
    payment_after_verified_account_closure: 0,
    payment_before_reliable_occupancy_start: 0,
    miscellaneous_or_non_rent_income: 0,
    payment_linked_to_missing_invoice: 0,
    payment_linked_to_void_invoice: 0,
    payment_linked_to_inactive_or_expired_lease: 0,
    payment_allocation_mismatch: 0,
    refund_reversal_not_represented: 0,
    account_mapping_problem: 0,
    data_cleanup_required: 0,
    other: 0,
  };
}

function stubCandidate(
  overrides: Partial<CandidateAccountSummary>,
): CandidateAccountSummary {
  return {
    accountKey: "T1::P1",
    propertyId: "P1",
    tenantId: "T1",
    currentLeaseIds: ["L1"],
    relatedLeaseIds: ["L1"],
    rentDue: 0,
    recordedLateFees: 0,
    paymentsReceived: 0,
    linkedPaymentsAmount: 0,
    unlinkedPaymentsAmount: 0,
    paymentAllocations: [],
    unappliedCredit: 0,
    historicalExcessPayment: 0,
    historicalCreditCarried: 0,
    forwardCredit: 0,
    creditCloseoutReview: 0,
    creditEffectiveDate: null,
    creditPolicyStatus: "no_effective_date_historical_excess_not_carried",
    decisionType: "current",
    continuityClassification: "current",
    obligationCutoffDate: null,
    obligationStartDate: "2026-01-01",
    continuityRuleDescription: "test",
    holdoverObligations: 0,
    historicalBalanceReview: 0,
    historicalPaymentReview: 0,
    excessByReason: emptyReasons(),
    rawCompletedPaymentTotal: 0,
    uniqueCompletedPaymentTotal: 0,
    realInvoiceObligationTotal: 0,
    approvedCandidateObligationTotal: 0,
    unapprovedMissingObligationTotal: 0,
    unapprovedHoldoverObligationTotal: 0,
    historicalExcessDiagnosticTotal: 0,
    duplicateCountedAmount: 0,
    unsupportedExcessAmount: 0,
    excessSupportClass: "supported_historical_excess",
    totalOwed: 0,
    oldestUnpaidDate: null,
    graceStatus: "current",
    daysLate: 0,
    lastPaymentDate: null,
    lastPaymentAmount: null,
    holdoverCandidate: false,
    confirmedHoldover: false,
    missingExpectedObligations: 0,
    dataProblems: [],
    explanation: "test",
    DISABLED_FOR_UI: true,
    ...overrides,
  };
}

describe("current-balance decision filter", () => {
  it("1. Historical excess with no current impact is excluded from decisions", () => {
    const c = stubCandidate({
      historicalExcessPayment: 500,
      excessByReason: {
        ...emptyReasons(),
        confirmed_payment_above_recorded_obligations: 500,
      },
      totalOwed: 100,
    });
    const review = classifyAccountReview({
      candidate: c,
      baseline: { totalOwed: 100, lateOrCurrent: "current" },
      isOccupied: true,
    });
    expect(review.classification).toBe("HISTORICAL_ONLY_NO_CURRENT_EFFECT");
    expect(review.immediateDecision).toBeNull();
  });

  it("2. Payment before a newer lease but during an older valid lease is prior lease history", () => {
    const label = labelPreOccupancyPayment({
      paymentDate: "2025-06-01",
      segments: [
        { id: "L1", start: "2025-01-01", end: "2025-12-31" },
        { id: "L2", start: "2026-01-01", end: null },
      ],
      obligationStartDate: "2026-01-01",
      newestSegmentStart: "2026-01-01",
    });
    expect(label).toBe("prior_lease_history");
  });

  it("3. Pre-occupancy payment does not become credit", () => {
    const [c] = computeCandidateAccountSummaries(
      ds({
        asOfDate: "2026-03-15",
        leases: [
          {
            id: "L1",
            tenant_id: "T1",
            property_id: "P1",
            lease_start_date: "2026-02-01",
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
            tenant_id: "T1",
            property_id: "P1",
            amount: 50,
            payment_date: "2026-01-15",
            status: "completed",
          },
        ],
      }),
      {
        decisions: [
          {
            tenantId: "T1",
            propertyId: "P1",
            decisionType: "current_new_tenant",
            occupancyStartDate: "2026-02-01",
          },
        ],
      },
    );
    expect(c.forwardCredit).toBe(0);
    expect(c.historicalCreditCarried).toBe(0);
    expect(c.unappliedCredit).toBe(0);
  });

  it("4. Closed-account issues do not enter the current decision queue", () => {
    const c = stubCandidate({
      continuityClassification: "closed",
      decisionType: "sold_closed",
      historicalExcessPayment: 200,
      excessByReason: {
        ...emptyReasons(),
        payment_allocation_mismatch: 200,
      },
      totalOwed: 0,
    });
    const review = classifyAccountReview({
      candidate: c,
      baseline: null,
      isOccupied: false,
      allocationNeedsDecision: true,
    });
    expect(review.classification).toBe("HISTORICAL_ONLY_NO_CURRENT_EFFECT");
    expect(review.immediateDecision).toBeNull();
  });

  it("5. Missing historical invoice with zero current impact is excluded", () => {
    const review = reviewMissingInvoicePayment({
      payment: {
        id: "PAY1",
        amount: 100,
        payment_date: "2024-01-05",
        invoice_id: "MISSING",
        status: "completed",
      },
      accountKey: "T1::P1",
      invoices: [],
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2026-01-01",
          status: "occupied",
        },
      ],
      baselineTotal: 50,
      candidateTotal: 50,
      isOccupied: true,
      continuityClassification: "current",
      asOf: "2026-06-15",
    });
    expect(review.wouldChangeCurrentBalance).toBe(false);
    expect(review.proposedAction).toBe("no_current_action_retain_as_history");
  });

  it("6. Missing current invoice with balance impact is included", () => {
    const review = reviewMissingInvoicePayment({
      payment: {
        id: "PAY1",
        amount: 100,
        payment_date: "2026-03-05",
        invoice_id: "MISSING",
        status: "completed",
      },
      accountKey: "T1::P1",
      invoices: [
        {
          id: "I1",
          lease_id: "L1",
          due_date: "2026-03-01",
          status: "OPEN",
          amount_total: 100,
          amount_rent: 100,
          amount_late: 0,
        },
      ],
      leases: [
        {
          id: "L1",
          tenant_id: "T1",
          property_id: "P1",
          lease_start_date: "2026-01-01",
          status: "occupied",
        },
      ],
      baselineTotal: 100,
      candidateTotal: 0,
      isOccupied: true,
      continuityClassification: "current",
      asOf: "2026-06-15",
    });
    expect(review.wouldChangeCurrentBalance).toBe(true);
    expect(review.samePeriodInvoiceExists).toBe(true);
  });

  it("7. Allocation mismatch with zero impact is excluded", () => {
    expect(
      allocationMismatchImpact({
        baselineTotal: 200,
        candidateTotal: 200,
        allocationMismatchAmount: 150,
      }),
    ).toBe(0);
  });

  it("8. Allocation mismatch with current balance impact is included", () => {
    expect(
      allocationMismatchImpact({
        baselineTotal: 200,
        candidateTotal: 50,
        allocationMismatchAmount: 150,
      }),
    ).toBe(-150);
  });

  it("9. One account appearing in multiple categories produces one decision row", () => {
    const rows: ImmediateDecisionRow[] = [
      {
        accountKey: "T1::P1",
        tenantId: "T1",
        propertyId: "P1",
        baselineTotal: 100,
        candidateTotal: 200,
        difference: 100,
        currentStatus: "current",
        proposedStatus: "late",
        issueType: "payment_allocation",
        amountInvolved: 50,
        decisionBillyMustMake: "alloc",
        recommendedAction: "a",
        groupOrder: 1,
      },
      {
        accountKey: "T1::P1",
        tenantId: "T1",
        propertyId: "P1",
        baselineTotal: 100,
        candidateTotal: 200,
        difference: 100,
        currentStatus: "current",
        proposedStatus: "late",
        issueType: "missing_current_obligation",
        amountInvolved: 80,
        decisionBillyMustMake: "miss",
        recommendedAction: "b",
        groupOrder: 2,
      },
    ];
    const q = buildImmediateDecisionQueue(rows);
    expect(q).toHaveLength(1);
    expect(q[0].issueType).toBe("payment_allocation");
  });

  it("10. Historical payment cannot transfer to a replacement tenant", () => {
    const transferred = paymentsTransferToReplacement({
      predecessorPayments: [
        {
          id: "PAY_PETER",
          amount: 100,
          payment_date: "2025-01-01",
          status: "completed",
        },
      ],
      replacementAccountPayments: [
        {
          id: "PAY_LUIS",
          amount: 100,
          payment_date: "2026-01-01",
          status: "completed",
        },
      ],
    });
    expect(transferred).toBe(false);
  });

  it("11. Candidate remains disabled for UI", () => {
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

  it("12. No live writes occur", () => {
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
    classifyAccountReview({
      candidate: stubCandidate({}),
      baseline: { totalOwed: 0, lateOrCurrent: "current" },
      isOccupied: true,
    });
    labelPreOccupancyPayment({
      paymentDate: "2025-01-01",
      segments: [],
      obligationStartDate: "2026-01-01",
      newestSegmentStart: "2026-01-01",
    });
    leaseSegmentsForAccount(dataset.leases, "T1", "P1");
    preOccupancyWouldChangeCurrentBalance({
      label: "prior_lease_history",
      baselineTotal: 0,
      candidateTotal: 0,
      isOccupied: true,
      continuityClassification: "current",
    });
    expect(JSON.stringify(dataset)).toBe(before);
  });
});
