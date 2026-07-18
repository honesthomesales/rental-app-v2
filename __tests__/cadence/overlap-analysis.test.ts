import { analyzeLeaseCadence } from "@/lib/invoice-cadence";
import { buildLateFeePreview } from "@/lib/late-fees/preview";

const biweekly = {
  id: "biweekly",
  due_date: "2026-07-15",
  period_start: "2026-07-15",
  period_end: "2026-07-28",
  status: "OPEN",
  amount_rent: 800,
  amount_paid: 0,
  created_at: "2025-09-26T00:17:21Z",
};

const weeklyInside = {
  id: "weekly",
  due_date: "2026-07-22",
  period_start: "2026-07-22",
  period_end: "2026-07-28",
  status: "OPEN",
  amount_rent: 850,
  amount_paid: 0,
  created_at: "2026-02-03T03:04:33Z",
};

describe("cadence overlap analysis", () => {
  it("detects Tenisha-style weekly periods nested in biweekly periods", () => {
    const result = analyzeLeaseCadence({
      currentCadence: "biweekly",
      invoices: [biweekly, weeklyInside],
      paymentInvoiceIds: new Set(),
    });
    expect(result.excludedInvoiceIds).toEqual(
      new Set(["biweekly", "weekly"]),
    );
    expect(result.exceptions.find((row) => row.invoiceId === "weekly")).toEqual(
      expect.objectContaining({
        reasons: expect.arrayContaining([
          "overlapping_period",
          "weekly_and_biweekly_cover_same_days",
          "period_inconsistent_with_current_cadence",
        ]),
        recommendedCanonicalInvoiceId: "biweekly",
        recommendedAction:
          "candidate_void_unpaid_duplicate_after_approval",
      }),
    );
  });

  it("never recommends voiding a paid or payment-linked invoice", () => {
    const result = analyzeLeaseCadence({
      currentCadence: "biweekly",
      invoices: [
        { ...biweekly, status: "PAID" },
        { ...weeklyInside, status: "PARTIAL" },
      ],
      paymentInvoiceIds: new Set(["biweekly", "weekly"]),
    });
    expect(
      result.exceptions.every(
        (row) => row.recommendedAction === "manual_review_leave_untouched",
      ),
    ).toBe(true);
  });

  it("does not judge historical periods by a later cadence", () => {
    const result = analyzeLeaseCadence({
      currentCadence: "biweekly",
      cadenceEffectiveDate: "2026-08-01",
      invoices: [
        {
          ...weeklyInside,
          id: "historical-weekly",
          due_date: "2026-07-22",
        },
      ],
    });
    expect(result.exceptions).toEqual([]);
  });

  it("excludes overlap/manual-review invoices from late-fee preview", () => {
    const excluded = analyzeLeaseCadence({
      currentCadence: "biweekly",
      invoices: [biweekly, weeklyInside],
    }).excludedInvoiceIds;
    const preview = buildLateFeePreview({
      businessDate: "2026-08-01",
      leases: [
        {
          id: "lease",
          property_id: "property",
          tenant_id: "tenant",
          status: "occupied",
          rent_cadence: "biweekly",
        },
      ],
      invoices: [biweekly, weeklyInside].map((invoice) => ({
        ...invoice,
        lease_id: "lease",
        amount_late: 0,
        amount_other: 0,
        amount_total: invoice.amount_rent,
        balance_due: invoice.amount_rent,
      })),
      payments: [],
      excludedInvoiceIds: excluded,
    });
    expect(preview.eligibleCount).toBe(0);
    expect(preview.rows.every((row) => row.reasonSkipped === "cadence_exception"))
      .toBe(true);
  });
});
