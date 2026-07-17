/**
 * Pure prospective rent-change rules and regression fixtures
 * for 100 Willis Bell / Jayne Long style $140 → $160 weekly changes.
 */

import {
  buildRentChangePreview,
  invoiceEligibleForRentChange,
  rentAmountForDueDate,
  type InvoiceForRentChange,
} from "@/lib/rent-change";

function inv(
  partial: Partial<InvoiceForRentChange> &
    Pick<InvoiceForRentChange, "id" | "due_date" | "status">,
): InvoiceForRentChange {
  const amount_rent = partial.amount_rent ?? 140;
  const amount_late = partial.amount_late ?? 0;
  const amount_other = partial.amount_other ?? 0;
  const amount_paid = partial.amount_paid ?? 0;
  const amount_total =
    partial.amount_total ?? amount_rent + amount_late + amount_other;
  return {
    id: partial.id,
    due_date: partial.due_date,
    status: partial.status,
    amount_rent,
    amount_late,
    amount_other,
    amount_total,
    amount_paid,
    balance_due:
      partial.balance_due ?? Math.max(0, amount_total - amount_paid),
  };
}

describe("prospective rent change $140 → $160", () => {
  const oldRent = 140;
  const newRent = 160;
  const effectiveDate = "2026-07-17";
  const businessDate = "2026-07-17";

  const fixtures: InvoiceForRentChange[] = [
    inv({ id: "past-open", due_date: "2026-07-10", status: "OPEN" }),
    inv({ id: "on-effective", due_date: "2026-07-17", status: "OPEN" }),
    inv({ id: "future-open", due_date: "2026-07-24", status: "OPEN" }),
    inv({
      id: "future-partial",
      due_date: "2026-07-31",
      status: "PARTIAL",
      amount_paid: 40,
      amount_late: 12,
      amount_other: 5,
    }),
    inv({
      id: "paid-hist",
      due_date: "2026-07-03",
      status: "PAID",
      amount_paid: 140,
      balance_due: 0,
    }),
    inv({
      id: "paid-future",
      due_date: "2026-08-07",
      status: "PAID",
      amount_paid: 140,
      balance_due: 0,
    }),
    inv({ id: "voided", due_date: "2026-07-24", status: "VOID" }),
  ];

  it("invoice due before effective date remains ineligible ($140)", () => {
    expect(invoiceEligibleForRentChange(fixtures[0], effectiveDate)).toBe(
      false,
    );
    const preview = buildRentChangePreview({
      invoices: fixtures,
      oldRent,
      newRent,
      effectiveDate,
      businessDate,
    });
    expect(preview.patches.find((p) => p.id === "past-open")).toBeUndefined();
    expect(preview.skippedPast).toBeGreaterThanOrEqual(1);
  });

  it("OPEN invoice due on effective date becomes $160", () => {
    const preview = buildRentChangePreview({
      invoices: fixtures,
      oldRent,
      newRent,
      effectiveDate,
      businessDate,
    });
    const patch = preview.patches.find((p) => p.id === "on-effective");
    expect(patch?.new_amount_rent).toBe(160);
    expect(patch?.new_amount_total).toBe(160);
    expect(patch?.new_balance_due).toBe(160);
  });

  it("OPEN invoice due after effective date becomes $160", () => {
    const preview = buildRentChangePreview({
      invoices: fixtures,
      oldRent,
      newRent,
      effectiveDate,
      businessDate,
    });
    const patch = preview.patches.find((p) => p.id === "future-open");
    expect(patch?.new_amount_rent).toBe(160);
    expect(patch?.new_balance_due).toBe(160);
  });

  it("PARTIAL future invoice preserves paid amount and late/other", () => {
    const preview = buildRentChangePreview({
      invoices: fixtures,
      oldRent,
      newRent,
      effectiveDate,
      businessDate,
    });
    const patch = preview.patches.find((p) => p.id === "future-partial");
    // rent 160 + late 12 + other 5 = 177; paid 40; balance 137
    expect(patch?.new_amount_rent).toBe(160);
    expect(patch?.amount_paid).toBe(40);
    expect(patch?.new_amount_total).toBe(177);
    expect(patch?.new_balance_due).toBe(137);
    expect(patch?.new_status).toBe("PARTIAL");
  });

  it("PAID invoices remain unchanged (historical and future)", () => {
    const preview = buildRentChangePreview({
      invoices: fixtures,
      oldRent,
      newRent,
      effectiveDate,
      businessDate,
    });
    expect(preview.patches.find((p) => p.id === "paid-hist")).toBeUndefined();
    expect(preview.patches.find((p) => p.id === "paid-future")).toBeUndefined();
    expect(preview.skippedPaid).toBe(2);
  });

  it("VOID invoices remain unchanged", () => {
    const preview = buildRentChangePreview({
      invoices: fixtures,
      oldRent,
      newRent,
      effectiveDate,
      businessDate,
    });
    expect(preview.patches.find((p) => p.id === "voided")).toBeUndefined();
    expect(preview.skippedVoid).toBe(1);
  });

  it("new invoice generation uses rentAmountForDueDate split", () => {
    expect(
      rentAmountForDueDate({
        dueDate: "2026-07-10",
        newRent: 160,
        priorRent: 140,
        rentEffectiveDate: effectiveDate,
      }),
    ).toBe(140);
    expect(
      rentAmountForDueDate({
        dueDate: "2026-07-17",
        newRent: 160,
        priorRent: 140,
        rentEffectiveDate: effectiveDate,
      }),
    ).toBe(160);
    expect(
      rentAmountForDueDate({
        dueDate: "2026-07-24",
        newRent: 160,
        priorRent: 140,
        rentEffectiveDate: effectiveDate,
      }),
    ).toBe(160);
  });

  it("applying preview twice yields identical patch amounts (idempotent plan)", () => {
    const once = buildRentChangePreview({
      invoices: fixtures,
      oldRent,
      newRent,
      effectiveDate,
      businessDate,
    });
    const afterApply: InvoiceForRentChange[] = fixtures.map((row) => {
      const patch = once.patches.find((p) => p.id === row.id);
      if (!patch) return row;
      return {
        ...row,
        amount_rent: patch.new_amount_rent,
        amount_total: patch.new_amount_total,
        amount_paid: patch.amount_paid,
        balance_due: patch.new_balance_due,
        status: patch.new_status,
      };
    });
    const twice = buildRentChangePreview({
      invoices: afterApply,
      oldRent: newRent,
      newRent,
      effectiveDate,
      businessDate,
    });
    // Same rent → patches still rewrite totals but amounts stay $160
    for (const p of twice.patches) {
      expect(p.new_amount_rent).toBe(160);
      expect(p.previous_amount_rent).toBe(160);
    }
  });
});
