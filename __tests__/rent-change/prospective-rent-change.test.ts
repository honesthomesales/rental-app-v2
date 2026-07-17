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

/** In-memory transactional apply mirroring RPC eligibility + money math. */
function applyProspectiveRentChangeTransactional(args: {
  leaseRent: number;
  newRent: number;
  effectiveDate: string;
  invoices: InvoiceForRentChange[];
  failOnInvoiceId?: string;
}): {
  leaseRent: number;
  invoices: InvoiceForRentChange[];
  updatedIds: string[];
  rolledBack: boolean;
} {
  const snapshot = {
    leaseRent: args.leaseRent,
    invoices: args.invoices.map((i) => ({ ...i })),
  };
  try {
    const nextInvoices = args.invoices.map((i) => ({ ...i }));
    const updatedIds: string[] = [];
    for (const row of nextInvoices) {
      if (!invoiceEligibleForRentChange(row, args.effectiveDate)) continue;
      if (args.failOnInvoiceId && row.id === args.failOnInvoiceId) {
        throw new Error(`invoice update failed: ${row.id}`);
      }
      const amount_late = row.amount_late;
      const amount_other = row.amount_other;
      const amount_paid = row.amount_paid;
      const amount_rent = Math.round((args.newRent + Number.EPSILON) * 100) / 100;
      const amount_total =
        Math.round((amount_rent + amount_late + amount_other + Number.EPSILON) * 100) /
        100;
      const balance_due = Math.max(
        0,
        Math.round((amount_total - amount_paid + Number.EPSILON) * 100) / 100,
      );
      const status =
        balance_due <= 0.009 ? "PAID" : amount_paid > 0.009 ? "PARTIAL" : "OPEN";
      Object.assign(row, {
        amount_rent,
        amount_total,
        amount_paid,
        balance_due,
        status,
      });
      updatedIds.push(row.id);
    }
    return {
      leaseRent: args.newRent,
      invoices: nextInvoices,
      updatedIds,
      rolledBack: false,
    };
  } catch {
    return {
      leaseRent: snapshot.leaseRent,
      invoices: snapshot.invoices,
      updatedIds: [],
      rolledBack: true,
    };
  }
}

describe("prospective rent change $140 → $160", () => {
  const oldRent = 140;
  const newRent = 160;
  const effectiveDate = "2026-07-17";
  const businessDate = "2026-07-17";

  const fixtures: InvoiceForRentChange[] = [
    inv({ id: "past-open", due_date: "2026-07-10", status: "OPEN" }),
    inv({
      id: "past-partial",
      due_date: "2026-07-15",
      status: "PARTIAL",
      amount_paid: 40,
    }),
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

  it("1. past OPEN invoice is unchanged", () => {
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
  });

  it("2. past PARTIAL invoice is unchanged", () => {
    expect(invoiceEligibleForRentChange(fixtures[1], effectiveDate)).toBe(
      false,
    );
    const preview = buildRentChangePreview({
      invoices: fixtures,
      oldRent,
      newRent,
      effectiveDate,
      businessDate,
    });
    expect(preview.patches.find((p) => p.id === "past-partial")).toBeUndefined();
  });

  it("3. future OPEN invoice updates", () => {
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

  it("4. future PARTIAL invoice updates and preserves paid amount", () => {
    const preview = buildRentChangePreview({
      invoices: fixtures,
      oldRent,
      newRent,
      effectiveDate,
      businessDate,
    });
    const patch = preview.patches.find((p) => p.id === "future-partial");
    expect(patch?.new_amount_rent).toBe(160);
    expect(patch?.amount_paid).toBe(40);
    expect(patch?.new_amount_total).toBe(177);
    expect(patch?.new_balance_due).toBe(137);
    expect(patch?.new_status).toBe("PARTIAL");
  });

  it("5. invoice exactly on effective date updates", () => {
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

  it("6. PAID invoice does not update", () => {
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

  it("7. VOID invoice does not update", () => {
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

  it("8. late fee remains unchanged on patched invoice", () => {
    const preview = buildRentChangePreview({
      invoices: fixtures,
      oldRent,
      newRent,
      effectiveDate,
      businessDate,
    });
    const patch = preview.patches.find((p) => p.id === "future-partial");
    expect(patch?.new_amount_total).toBe(160 + 12 + 5);
  });

  it("9. other charges remain unchanged on patched invoice", () => {
    const row = fixtures.find((i) => i.id === "future-partial")!;
    expect(row.amount_other).toBe(5);
    const preview = buildRentChangePreview({
      invoices: fixtures,
      oldRent,
      newRent,
      effectiveDate,
      businessDate,
    });
    const patch = preview.patches.find((p) => p.id === "future-partial");
    expect(patch!.new_amount_total - patch!.new_amount_rent - 12).toBe(5);
  });

  it("10. payments are not edited — amount_paid preserved from invoice row", () => {
    const preview = buildRentChangePreview({
      invoices: fixtures,
      oldRent,
      newRent,
      effectiveDate,
      businessDate,
    });
    const patch = preview.patches.find((p) => p.id === "future-partial");
    expect(patch?.amount_paid).toBe(40);
  });

  it("11. invoice IDs and due dates remain unchanged", () => {
    const preview = buildRentChangePreview({
      invoices: fixtures,
      oldRent,
      newRent,
      effectiveDate,
      businessDate,
    });
    for (const patch of preview.patches) {
      const original = fixtures.find((i) => i.id === patch.id)!;
      expect(patch.id).toBe(original.id);
      expect(patch.due_date).toBe(original.due_date.split("T")[0]);
    }
  });

  it("12. new invoices after effective date use $160", () => {
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

  it("13. failed invoice update rolls back the lease update", () => {
    const result = applyProspectiveRentChangeTransactional({
      leaseRent: 140,
      newRent: 160,
      effectiveDate,
      invoices: fixtures,
      failOnInvoiceId: "future-open",
    });
    expect(result.rolledBack).toBe(true);
    expect(result.leaseRent).toBe(140);
    expect(result.updatedIds).toEqual([]);
    expect(result.invoices.find((i) => i.id === "on-effective")?.amount_rent).toBe(
      140,
    );
  });

  it("14. reopening Payments uses server stored amounts after apply (preview→state)", () => {
    const preview = buildRentChangePreview({
      invoices: fixtures,
      oldRent,
      newRent,
      effectiveDate,
      businessDate,
    });
    const serverRows = fixtures.map((row) => {
      const patch = preview.patches.find((p) => p.id === row.id);
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
    // Modal must display amount_rent from refetch, not lease.rent alone.
    expect(serverRows.find((i) => i.id === "future-open")?.amount_rent).toBe(160);
    expect(serverRows.find((i) => i.id === "past-open")?.amount_rent).toBe(140);
  });

  it("15. 100 Willis Bell regression: Jul 22 / Jul 29 / Aug 5 OPEN rows update; Jul 15 stays $140", () => {
    const leaseId = "78b4a6a5-4e17-436c-9c7c-e6abae6ecb94";
    const willis: InvoiceForRentChange[] = [
      inv({
        id: "8f424c59-d342-426f-8853-0f7385481d91",
        due_date: "2026-07-15",
        status: "OPEN",
        amount_late: 0,
        amount_other: 0,
        amount_paid: 0,
      }),
      inv({
        id: "836f077f-7395-4526-99f7-535590a13f0d",
        due_date: "2026-07-22",
        status: "OPEN",
        amount_late: 0,
        amount_other: 0,
        amount_paid: 0,
      }),
      inv({
        id: "c4a74863-29df-4c42-aa43-80e75c8788cd",
        due_date: "2026-07-29",
        status: "OPEN",
        amount_late: 0,
        amount_other: 0,
        amount_paid: 0,
      }),
      inv({
        id: "117ec2b2-5f06-4ef3-a55d-c857a14b3560",
        due_date: "2026-08-05",
        status: "OPEN",
        amount_late: 0,
        amount_other: 0,
        amount_paid: 0,
      }),
    ];
    // Lease already at $160 with stale $140 invoices (live defect shape).
    const preview = buildRentChangePreview({
      invoices: willis,
      oldRent: 160,
      newRent: 160,
      effectiveDate,
      businessDate,
    });

    expect(preview.effectiveDate).toBe("2026-07-17");
    expect(preview.patches.find((p) => p.id === willis[0].id)).toBeUndefined();

    const changed = [
      willis[1].id,
      willis[2].id,
      willis[3].id,
    ].map((id) => {
      const patch = preview.patches.find((p) => p.id === id)!;
      expect(patch).toBeDefined();
      expect(patch.previous_amount_rent).toBe(140);
      expect(patch.new_amount_rent).toBe(160);
      expect(patch.previous_amount_total).toBe(140);
      expect(patch.new_amount_total).toBe(160);
      expect(patch.amount_paid).toBe(0);
      expect(patch.previous_balance_due).toBe(140);
      expect(patch.new_balance_due).toBe(160);
      expect(patch.due_date).toBe(willis.find((w) => w.id === id)!.due_date);
      return {
        id,
        due_date: patch.due_date,
        before: patch.previous_amount_rent,
        after: patch.new_amount_rent,
      };
    });

    expect(changed).toEqual([
      {
        id: "836f077f-7395-4526-99f7-535590a13f0d",
        due_date: "2026-07-22",
        before: 140,
        after: 160,
      },
      {
        id: "c4a74863-29df-4c42-aa43-80e75c8788cd",
        due_date: "2026-07-29",
        before: 140,
        after: 160,
      },
      {
        id: "117ec2b2-5f06-4ef3-a55d-c857a14b3560",
        due_date: "2026-08-05",
        before: 140,
        after: 160,
      },
    ]);

    const applied = applyProspectiveRentChangeTransactional({
      leaseRent: 160,
      newRent: 160,
      effectiveDate,
      invoices: willis,
    });
    expect(applied.rolledBack).toBe(false);
    expect(applied.leaseRent).toBe(160);
    expect(applied.updatedIds).toEqual([
      "836f077f-7395-4526-99f7-535590a13f0d",
      "c4a74863-29df-4c42-aa43-80e75c8788cd",
      "117ec2b2-5f06-4ef3-a55d-c857a14b3560",
    ]);
    // Historical invoice unchanged (due before effective date)
    expect(applied.invoices.find((i) => i.id === willis[0].id)?.amount_rent).toBe(
      140,
    );
    expect(applied.invoices.find((i) => i.id === willis[0].id)?.amount_paid).toBe(
      0,
    );
    // Payments / paid amounts on changed rows preserved
    for (const id of applied.updatedIds) {
      expect(applied.invoices.find((i) => i.id === id)?.amount_paid).toBe(0);
      expect(applied.invoices.find((i) => i.id === id)?.amount_late).toBe(0);
      expect(applied.invoices.find((i) => i.id === id)?.amount_rent).toBe(160);
    }
    // lease id documented for operator report (fixture lease)
    expect(leaseId).toBe("78b4a6a5-4e17-436c-9c7c-e6abae6ecb94");
  });

  it("eligibility uses stored due_date not period label", () => {
    // Period Jul 22–28 is labeled by period_start/end; eligibility is due_date only.
    const row = inv({
      id: "836f077f-7395-4526-99f7-535590a13f0d",
      due_date: "2026-07-22",
      status: "OPEN",
    });
    expect(invoiceEligibleForRentChange(row, "2026-07-17")).toBe(true);
    expect(invoiceEligibleForRentChange(row, "2026-07-23")).toBe(false);
  });

  it("PARTIAL $140 total / $40 paid → $160 total / $40 paid / $120 balance", () => {
    const row = inv({
      id: "partial-40",
      due_date: "2026-07-22",
      status: "PARTIAL",
      amount_rent: 140,
      amount_total: 140,
      amount_paid: 40,
      balance_due: 100,
    });
    const preview = buildRentChangePreview({
      invoices: [row],
      oldRent: 140,
      newRent: 160,
      effectiveDate,
      businessDate,
    });
    const patch = preview.patches[0];
    expect(patch.new_amount_rent).toBe(160);
    expect(patch.amount_paid).toBe(40);
    expect(patch.new_amount_total).toBe(160);
    expect(patch.new_balance_due).toBe(120);
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
    for (const p of twice.patches) {
      expect(p.new_amount_rent).toBe(160);
      expect(p.previous_amount_rent).toBe(160);
    }
  });
});
