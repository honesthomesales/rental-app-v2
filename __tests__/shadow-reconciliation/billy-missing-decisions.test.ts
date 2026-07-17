/**
 * Billy missing-obligation decision applicator — pure, no live writes.
 */
import { applyBillyMissingObligationDecision } from "@/lib/shadow-reconciliation";

describe("applyBillyMissingObligationDecision", () => {
  const proposed = [
    { dueDate: "2026-07-17", rentAmount: 300 },
    { dueDate: "2026-07-24", rentAmount: 300 },
  ];

  it("reject_all_proposed → approvedMissingAmount $0 and resolved", () => {
    const applied = applyBillyMissingObligationDecision({
      proposedMissing: proposed,
      decision: {
        action: "reject_all_proposed",
        retainPaymentsBalance: true,
        rejectedDueDates: ["2026-07-17", "2026-07-24"],
        confirmedRentAmount: 1275,
        confirmedCadence: "monthly",
        dataFlags: ["stored_cadence_incorrect_should_be_monthly"],
        billyDecision: "Reject proposed; missing $0.",
      },
    });
    expect(applied.resolved).toBe(true);
    expect(applied.approvedMissingAmount).toBe(0);
    expect(applied.approvedRows).toHaveLength(0);
    expect(applied.rejectedRows).toHaveLength(2);
    expect(applied.retainPaymentsBalance).toBe(true);
    expect(applied.confirmedRentAmount).toBe(1275);
    expect(applied.confirmedCadence).toBe("monthly");
    expect(applied.dataFlags).toContain(
      "stored_cadence_incorrect_should_be_monthly",
    );
  });

  it("single rejected due date leaves approvedMissingAmount at $0", () => {
    const applied = applyBillyMissingObligationDecision({
      proposedMissing: [{ dueDate: "2026-07-21", rentAmount: 785 }],
      decision: {
        action: "reject_all_proposed",
        rejectedDueDates: ["2026-07-21"],
        retainPaymentsBalance: true,
      },
    });
    expect(applied.approvedMissingAmount).toBe(0);
    expect(applied.resolved).toBe(true);
    expect(applied.rejectedRows[0].dueDate).toBe("2026-07-21");
  });

  it("without decision, proposed total remains outstanding (not auto-approved to queue resolution)", () => {
    const applied = applyBillyMissingObligationDecision({
      proposedMissing: proposed,
      decision: null,
    });
    expect(applied.resolved).toBe(false);
    expect(applied.approvedMissingAmount).toBe(600);
    expect(applied.rejectedRows).toHaveLength(0);
  });

  it("approve_listed only counts listed dues", () => {
    const applied = applyBillyMissingObligationDecision({
      proposedMissing: proposed,
      decision: {
        action: "approve_listed",
        approvedDueDates: ["2026-07-17"],
        retainPaymentsBalance: false,
      },
    });
    expect(applied.resolved).toBe(true);
    expect(applied.approvedMissingAmount).toBe(300);
    expect(applied.approvedRows).toHaveLength(1);
    expect(applied.rejectedRows).toHaveLength(1);
  });

  it("never mutates input proposed rows", () => {
    const copy = proposed.map((r) => ({ ...r }));
    applyBillyMissingObligationDecision({
      proposedMissing: copy,
      decision: { action: "reject_all_proposed" },
    });
    expect(copy).toEqual(proposed);
  });
});
