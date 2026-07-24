/**
 * Midnight / business-date boundary helpers for future-payment eligibility.
 */

import {
  canAllocatePaymentAsOf,
  isPaymentEligibleAsOf,
  partitionPaymentsByAsOf,
} from "@/lib/payment-eligibility";

describe("future payment NY business-date boundaries", () => {
  it("excludes payments dated after as-of, includes same-day", () => {
    const asOf = "2026-07-23";
    const payments = [
      { id: "today", payment_date: "2026-07-23", amount: 100, status: "completed" },
      { id: "future", payment_date: "2026-07-24", amount: 50, status: "completed" },
      {
        id: "future_ts",
        payment_date: "2026-07-24T04:00:00.000Z",
        amount: 25,
        status: "completed",
      },
    ];
    const { eligible, excludedFuture } = partitionPaymentsByAsOf(payments, asOf);
    expect(eligible.map((p) => p.id)).toEqual(["today"]);
    expect(excludedFuture.map((x) => x.payment.id).sort()).toEqual([
      "future",
      "future_ts",
    ]);
    expect(canAllocatePaymentAsOf(payments[0], asOf)).toBe(true);
    expect(canAllocatePaymentAsOf(payments[1], asOf)).toBe(false);
    expect(isPaymentEligibleAsOf(payments[2], asOf)).toBe(false);
  });

  it("treats midnight-crossing ISO timestamps by calendar date only", () => {
    // A payment stamped late evening UTC on the 22nd is still date 2026-07-22.
    expect(
      isPaymentEligibleAsOf(
        { payment_date: "2026-07-22T23:30:00.000Z" },
        "2026-07-22",
      ),
    ).toBe(true);
    expect(
      isPaymentEligibleAsOf(
        { payment_date: "2026-07-23T00:30:00.000-04:00" },
        "2026-07-22",
      ),
    ).toBe(false);
  });
});
