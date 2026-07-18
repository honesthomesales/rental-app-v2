import {
  invoiceCanBeCorrected,
  planInvoiceCorrection,
  type CorrectableInvoice,
} from "@/lib/invoice-correction";

function invoice(
  id: string,
  status = "OPEN",
  overrides: Partial<CorrectableInvoice> = {},
): CorrectableInvoice {
  return {
    id,
    lease_id: "lease-1",
    due_date: "2026-07-22",
    period_start: "2026-07-22",
    period_end: "2026-07-28",
    status,
    amount_rent: 160,
    amount_late: 0,
    amount_other: 0,
    amount_paid: 40,
    amount_total: 160,
    balance_due: 120,
    ...overrides,
  };
}

describe("one-invoice correction", () => {
  it("selects and plans the requested OPEN invoice", () => {
    const requested = invoice("requested");
    expect(planInvoiceCorrection({
      invoice: requested,
      amountRent: 170,
      amountLate: 10,
      amountOther: 5,
      eligiblePaidAmount: 40,
    }).invoiceId).toBe("requested");
  });

  it("changes only the selected invoice and leaves adjacent invoices unchanged", () => {
    const rows = [invoice("previous"), invoice("selected"), invoice("next")];
    const before = structuredClone(rows);
    const plan = planInvoiceCorrection({
      invoice: rows[1],
      amountRent: 170,
      amountLate: 10,
      amountOther: 5,
      eligiblePaidAmount: 40,
    });
    const after = rows.map((row) => row.id === plan.invoiceId ? plan.after : row);
    expect(after[0]).toEqual(before[0]);
    expect(after[2]).toEqual(before[2]);
    expect(after[1].amount_total).toBe(185);
  });

  it("preserves amount paid and identity/date fields", () => {
    const source = invoice("selected");
    const plan = planInvoiceCorrection({
      invoice: source,
      amountRent: 170,
      amountLate: 10,
      amountOther: 5,
      eligiblePaidAmount: 40,
    });
    expect(plan.after.amount_paid).toBe(40);
    expect(plan.after.id).toBe(source.id);
    expect(plan.after.lease_id).toBe(source.lease_id);
    expect(plan.after.due_date).toBe(source.due_date);
    expect(plan.after.period_start).toBe(source.period_start);
    expect(plan.after.period_end).toBe(source.period_end);
  });

  it("recalculates total, balance, and PARTIAL status", () => {
    const plan = planInvoiceCorrection({
      invoice: invoice("selected"),
      amountRent: 170,
      amountLate: 10,
      amountOther: 5,
      eligiblePaidAmount: 40,
    });
    expect(plan.after.amount_total).toBe(185);
    expect(plan.after.balance_due).toBe(145);
    expect(plan.after.status).toBe("PARTIAL");
  });

  it("rejects PAID and VOID invoice corrections", () => {
    expect(invoiceCanBeCorrected("PAID")).toBe(false);
    expect(invoiceCanBeCorrected("VOID")).toBe(false);
    for (const status of ["PAID", "VOID"]) {
      expect(() =>
        planInvoiceCorrection({
          invoice: invoice(status.toLowerCase(), status),
          amountRent: 170,
          amountLate: 0,
          amountOther: 0,
          eligiblePaidAmount: 0,
        }),
      ).toThrow("Only OPEN or PARTIAL");
    }
  });
});
