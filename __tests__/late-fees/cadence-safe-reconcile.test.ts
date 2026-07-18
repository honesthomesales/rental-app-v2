import fs from "node:fs";
import path from "node:path";

describe("cadence-safe late-fee reconciliation and automation", () => {
  const migration = fs.readFileSync(
    path.join(
      process.cwd(),
      "migrations/20260718_cadence_safe_invoice_automation.sql",
    ),
    "utf8",
  );

  it("skips overlaps both during preview and immediately before update", () => {
    const reconcile = migration.split(
      "CREATE OR REPLACE FUNCTION public.rent_reconcile_late_fees",
    )[1];
    expect(reconcile).toContain("AS cadence_exception");
    expect(reconcile).toContain("v_reason := 'cadence_exception'");
    expect(reconcile).toContain("AND NOT EXISTS");
    expect(reconcile).toContain("x.period_start <= i.period_end");
  });

  it("uses invoice-period cadence before the current lease cadence", () => {
    const reconcile = migration.split(
      "CREATE OR REPLACE FUNCTION public.rent_reconcile_late_fees",
    )[1];
    expect(reconcile).toContain("i.rent_cadence");
    expect(reconcile).toContain("(i.period_end - i.period_start + 1) = 7");
    expect(reconcile).toContain("(i.period_end - i.period_start + 1) = 14");
    expect(reconcile).toContain("v_fee := 10");
    expect(reconcile).toContain("v_fee := 25");
    expect(reconcile).toContain("v_fee := 45");
  });

  it("keeps GET read-only and reserves apply for secret-authenticated POST", () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/cron/late-fees/route.ts"),
      "utf8",
    );
    const getBody = route.split("export async function POST")[0];
    const postBody = route.split("export async function POST")[1];
    expect(getBody).toContain("p_dry_run: true");
    expect(getBody).not.toContain("p_dry_run: false");
    expect(route).not.toContain('searchParams.get("secret")');
    expect(route).toContain('headers.get("authorization")');
    expect(postBody).toContain("LATE_FEE_AUTOMATION_ENABLED");
    expect(postBody).toContain("LATE_FEE_AUTOMATION_START_DATE");
    expect(postBody).toContain("firstEligibleDueDate");
    expect(postBody).toContain("candidateInvoiceIds");
    expect(postBody).toContain("p_invoice_ids: candidateInvoiceIds");
    expect(postBody).not.toContain("p_invoice_ids: null");
    expect(postBody).toContain("p_dry_run: false");
    expect(postBody).toContain("late-fee cron summary");
  });

  it("runs the scheduler once daily through POST", () => {
    const workflow = fs.readFileSync(
      path.join(process.cwd(), ".github/workflows/daily-late-fees.yml"),
      "utf8",
    );
    expect(workflow).toContain('cron: "15 10 * * *"');
    expect(workflow).toContain("--request POST");
    expect(workflow).toContain("LATE_FEE_CRON_SECRET");
  });
});
