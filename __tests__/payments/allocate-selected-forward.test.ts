import fs from "node:fs";
import path from "node:path";
import { allocateSelectedInvoiceForward } from "@/lib/payments/allocate-selected-forward";
import {
  getDeferredSelectedInvoiceId,
  withDeferredSelectedInvoiceNote,
  withoutDeferredSelectedInvoiceNote,
} from "@/lib/payments/post-allocated-payment";

describe("allocateSelectedInvoiceForward", () => {
  const invoices = [
    {
      id: "january",
      dueDate: "2026-01-01",
      sequence: 1,
      balanceDue: 150,
      status: "OPEN",
    },
    {
      id: "february",
      dueDate: "2026-02-01",
      sequence: 2,
      balanceDue: 150,
      status: "OPEN",
    },
    {
      id: "march",
      dueDate: "2026-03-01",
      sequence: 3,
      balanceDue: 150,
      status: "OPEN",
    },
  ];

  it("applies to the selected older invoice before carrying excess forward", () => {
    const plan = allocateSelectedInvoiceForward({
      paymentAmount: 200,
      selectedInvoiceId: "january",
      invoices,
    });

    expect(plan.splits).toEqual([
      { invoiceId: "january", amount: 150, dueDate: "2026-01-01" },
      { invoiceId: "february", amount: 50, dueDate: "2026-02-01" },
    ]);
    expect(plan.allocatedAmount).toBe(200);
    expect(plan.unallocatedAmount).toBe(0);
  });

  it("does not backfill an invoice due before the selected invoice", () => {
    const plan = allocateSelectedInvoiceForward({
      paymentAmount: 200,
      selectedInvoiceId: "february",
      invoices,
    });

    expect(plan.splits).toEqual([
      { invoiceId: "february", amount: 150, dueDate: "2026-02-01" },
      { invoiceId: "march", amount: 50, dueDate: "2026-03-01" },
    ]);
    expect(plan.splits.some((split) => split.invoiceId === "january")).toBe(false);
  });

  it("keeps the remainder unallocated after all later balances are filled", () => {
    const plan = allocateSelectedInvoiceForward({
      paymentAmount: 500,
      selectedInvoiceId: "january",
      invoices,
    });

    expect(plan.splits).toEqual([
      { invoiceId: "january", amount: 150, dueDate: "2026-01-01" },
      { invoiceId: "february", amount: 150, dueDate: "2026-02-01" },
      { invoiceId: "march", amount: 150, dueDate: "2026-03-01" },
    ]);
    expect(plan.allocatedAmount).toBe(450);
    expect(plan.unallocatedAmount).toBe(50);
  });

  it("skips paid and void later invoices but allows the next future invoice", () => {
    const plan = allocateSelectedInvoiceForward({
      paymentAmount: 175,
      selectedInvoiceId: "selected",
      invoices: [
        {
          id: "selected",
          dueDate: "2026-07-01",
          balanceDue: 100,
          status: "OPEN",
        },
        {
          id: "paid",
          dueDate: "2026-08-01",
          balanceDue: 0,
          status: "PAID",
        },
        {
          id: "void",
          dueDate: "2026-09-01",
          balanceDue: 100,
          status: "VOID",
        },
        {
          id: "future",
          dueDate: "2026-10-01",
          balanceDue: 100,
          status: "OPEN",
        },
      ],
    });

    expect(plan.splits).toEqual([
      { invoiceId: "selected", amount: 100, dueDate: "2026-07-01" },
      { invoiceId: "future", amount: 75, dueDate: "2026-10-01" },
    ]);
    expect(plan.unallocatedAmount).toBe(0);
  });

  it("returns the full amount unallocated when the selected invoice is absent", () => {
    expect(
      allocateSelectedInvoiceForward({
        paymentAmount: 125,
        selectedInvoiceId: "missing",
        invoices,
      }),
    ).toEqual({
      splits: [],
      allocatedAmount: 0,
      unallocatedAmount: 125,
    });
  });
});

describe("deferred selected-invoice metadata", () => {
  it("retains the selected invoice internally and removes it from display notes", () => {
    const note = withDeferredSelectedInvoiceNote("Cash App", "invoice-123");

    expect(getDeferredSelectedInvoiceId(note)).toBe("invoice-123");
    expect(withoutDeferredSelectedInvoiceNote(note)).toBe("Cash App");
  });
});

describe("payment route wiring", () => {
  it("uses selected-forward allocation when the UI supplies an invoice", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/payments/route.ts"),
      "utf8",
    );
    const postBody = source.split("export async function GET")[0];

    expect(postBody).toContain("const plan = invoiceId");
    expect(postBody).toContain("planSelectedInvoiceForwardAllocation({");
    expect(postBody).toContain("requestedInvoiceId: invoiceId || null");
    expect(postBody).not.toContain("ignoredRequestedInvoiceId");
  });

  it("preserves a remainder when a deferred payment is allocated", () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/app/api/data-health/future-payments/route.ts",
      ),
      "utf8",
    );

    expect(source).toContain("if (plan.unallocatedAmount > 0.009)");
    expect(source).toContain('"unallocated_remainder"');
    expect(source).toContain("unallocatedAmount: plan.unallocatedAmount");
  });
});
