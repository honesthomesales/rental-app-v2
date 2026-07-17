import {
  defaultLateFeeForCadence,
  isPastGrace,
  resolveLateFeeAmount,
} from "@/lib/late-fees/rules";
import { buildLateFeePreview } from "@/lib/late-fees/preview";

describe("late fee rules", () => {
  it("uses weekly $12 / biweekly $25 / monthly $45 defaults", () => {
    expect(defaultLateFeeForCadence("weekly")).toBe(12);
    expect(defaultLateFeeForCadence("biweekly")).toBe(25);
    expect(defaultLateFeeForCadence("monthly")).toBe(45);
  });

  it("lease-specific positive late fee overrides cadence default", () => {
    expect(
      resolveLateFeeAmount({ cadence: "weekly", leaseLateFeeAmount: 20 }),
    ).toBe(20);
    expect(
      resolveLateFeeAmount({ cadence: "weekly", leaseLateFeeAmount: 0 }),
    ).toBe(12);
  });

  it("respects grace period", () => {
    expect(
      isPastGrace({
        dueDate: "2026-07-10",
        graceDays: 5,
        businessDate: "2026-07-15",
      }),
    ).toBe(false);
    expect(
      isPastGrace({
        dueDate: "2026-07-10",
        graceDays: 5,
        businessDate: "2026-07-16",
      }),
    ).toBe(true);
  });
});

describe("late fee preview eligibility", () => {
  const businessDate = "2026-07-17";
  const lease = {
    id: "lease-1",
    property_id: "p1",
    tenant_id: "t1",
    status: "occupied",
    rent_cadence: "weekly",
    late_fee_amount: null,
    grace_days: 0,
    property_name: "100 Willis Bell",
    tenant_name: "Jayne Long",
  };

  const baseInv = {
    lease_id: "lease-1",
    status: "OPEN",
    amount_rent: 160,
    amount_late: 0,
    amount_other: 0,
    amount_total: 160,
    amount_paid: 0,
    late_fee_waived: false,
  };

  it("assesses one fee on existing overdue unpaid invoice", () => {
    const preview = buildLateFeePreview({
      businessDate,
      leases: [lease],
      invoices: [
        {
          ...baseInv,
          id: "inv-overdue",
          due_date: "2026-07-10",
        },
      ],
      payments: [],
    });
    const row = preview.rows.find((r) => r.invoiceId === "inv-overdue");
    expect(row?.eligible).toBe(true);
    expect(row?.proposedLateFee).toBe(12);
  });

  it("skips future invoice, within grace, paid, void, waived, already billed", () => {
    const preview = buildLateFeePreview({
      businessDate,
      leases: [{ ...lease, grace_days: 5 }],
      invoices: [
        { ...baseInv, id: "future", due_date: "2026-07-24" },
        { ...baseInv, id: "grace", due_date: "2026-07-14" },
        { ...baseInv, id: "paid", due_date: "2026-07-03", status: "PAID" },
        { ...baseInv, id: "void", due_date: "2026-07-03", status: "VOID" },
        {
          ...baseInv,
          id: "waived",
          due_date: "2026-07-03",
          late_fee_waived: true,
        },
        {
          ...baseInv,
          id: "billed",
          due_date: "2026-07-03",
          amount_late: 12,
          amount_total: 172,
        },
      ],
      payments: [],
    });
    expect(preview.rows.find((r) => r.invoiceId === "future")?.reasonSkipped).toBe(
      "future_invoice",
    );
    expect(preview.rows.find((r) => r.invoiceId === "grace")?.reasonSkipped).toBe(
      "within_grace",
    );
    expect(preview.rows.find((r) => r.invoiceId === "paid")?.reasonSkipped).toBe(
      "paid_status",
    );
    expect(preview.rows.find((r) => r.invoiceId === "void")?.reasonSkipped).toBe(
      "void",
    );
    expect(preview.rows.find((r) => r.invoiceId === "waived")?.reasonSkipped).toBe(
      "waived",
    );
    expect(preview.rows.find((r) => r.invoiceId === "billed")?.reasonSkipped).toBe(
      "already_billed",
    );
  });

  it("future-dated payment does not prevent currently eligible fee", () => {
    const preview = buildLateFeePreview({
      businessDate,
      leases: [lease],
      invoices: [{ ...baseInv, id: "inv-1", due_date: "2026-07-10" }],
      payments: [
        {
          id: "pay-future",
          lease_id: "lease-1",
          invoice_id: "inv-1",
          amount: 160,
          payment_date: "2026-07-20",
          status: "completed",
        },
      ],
    });
    expect(preview.rows.find((r) => r.invoiceId === "inv-1")?.eligible).toBe(
      true,
    );
  });

  it("running preview twice is identical and write-free", () => {
    const args = {
      businessDate,
      leases: [lease],
      invoices: [{ ...baseInv, id: "inv-1", due_date: "2026-07-10" }],
      payments: [],
    };
    const a = buildLateFeePreview(args);
    const b = buildLateFeePreview(args);
    expect(a).toEqual(b);
    expect(a.eligibleCount).toBe(1);
  });
});
