import fs from "node:fs";
import path from "node:path";
import {
  buildAccountLedger,
  toCollectionsSummaryRow,
  type LedgerInvoice,
  type LedgerLease,
} from "@/lib/portfolio-ledger/service";

const lease: LedgerLease = {
  id: "lease",
  property_id: "property",
  tenant_id: "tenant",
  status: "occupied",
  rent: 200,
  rent_cadence: "weekly",
};

const beforeInvoice: LedgerInvoice = {
  id: "invoice",
  lease_id: "lease",
  due_date: "2026-07-01",
  period_start: "2026-07-01",
  period_end: "2026-07-07",
  status: "OPEN",
  amount_rent: 200,
  amount_late: 10,
  amount_other: 15,
  amount_total: 225,
  amount_paid: 0,
  balance_due: 225,
  late_fee_waived: false,
};

describe("transactional late-fee waiver", () => {
  it("removes only the late fee from shared ledger results", () => {
    const before = buildAccountLedger({
      lease,
      invoices: [beforeInvoice],
      payments: [],
      asOfDate: "2026-07-18",
    });
    const after = buildAccountLedger({
      lease,
      invoices: [
        {
          ...beforeInvoice,
          amount_late: 0,
          amount_total: 215,
          balance_due: 215,
          late_fee_waived: true,
        },
      ],
      payments: [],
      asOfDate: "2026-07-18",
    });
    expect(before.totalBalanceDue).toBe(225);
    expect(before.lateFeeBalance).toBe(10);
    expect(after.totalBalanceDue).toBe(215);
    expect(after.rentBalance).toBe(before.rentBalance);
    expect(after.otherChargeBalance).toBe(before.otherChargeBalance);
    expect(after.lateFeeBalance).toBe(0);
    expect(after.invoices[0].lateFeeWaived).toBe(true);
    expect(toCollectionsSummaryRow(after).totalOwed).toBe(215);
  });

  it("locks one invoice, preserves identity/payments, and returns before/after", () => {
    const sql = fs.readFileSync(
      path.join(
        process.cwd(),
        "migrations/20260718_cadence_safe_invoice_automation.sql",
      ),
      "utf8",
    );
    const waiver = sql
      .split("CREATE OR REPLACE FUNCTION public.rent_waive_late_fee")[1]
      .split("CREATE OR REPLACE FUNCTION public.rent_reconcile_late_fees")[0];
    expect(waiver).toContain("FOR UPDATE");
    expect(waiver).toContain("amount_late = 0");
    expect(waiver).toContain("late_fee_waived = true");
    expect(waiver).not.toContain('DELETE FROM "RENT_payments"');
    expect(waiver).toContain("'before'");
    expect(waiver).toContain("'after'");
  });

  it("removes every Add Fee path and renders only waiver states", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/app/payments/page.tsx"),
      "utf8",
    );
    expect(source).not.toContain("Add Fee");
    expect(source).not.toContain("handleToggleLateFee");
    expect(source).toContain("Waive Fee");
    expect(source).toContain("Waived");
    expect(source).toContain("/waive-late-fee");
    expect(source).toContain("window.confirm");

    const lateTenants = fs.readFileSync(
      path.join(process.cwd(), "src/app/late-tenants/page.tsx"),
      "utf8",
    );
    expect(lateTenants).not.toContain("/api/late-fees/waive");
    expect(lateTenants).toContain("/waive-late-fee");
    expect(lateTenants).toContain("amount_late");
    expect(lateTenants).toContain("late_fee_waived");
  });
});
