/**
 * Generates anonymized comparison artifact (fixture + optional live GET).
 * Never POSTs. Never imports into UI screens.
 */

import fs from "fs";
import path from "path";
import {
  runShadowReconciliation,
  type ShadowDataset,
} from "@/lib/shadow-reconciliation";

const OUT = path.join(
  process.cwd(),
  "docs",
  "_discovery",
  "shadow-reconciliation-diff.fixture.json",
);

function fixtureDataset(): ShadowDataset {
  return {
    asOfDate: "2026-03-15",
    defaultGraceDays: 5,
    leases: [
      {
        id: "L1",
        tenant_id: "T1",
        property_id: "P1",
        lease_start_date: "2026-01-01",
        lease_end_date: "2026-12-31",
        rent: 500,
        rent_cadence: "monthly",
        rent_due_day: 1,
        status: "occupied",
      },
      {
        id: "L2",
        tenant_id: "T2",
        property_id: "P2",
        lease_start_date: "2025-01-01",
        lease_end_date: "2025-06-01",
        rent: 400,
        rent_cadence: "monthly",
        rent_due_day: 1,
        status: "occupied",
      },
    ],
    tenants: [
      { id: "T1", is_active: true },
      { id: "T2", is_active: true },
    ],
    invoices: [
      {
        id: "I1",
        lease_id: "L1",
        due_date: "2026-01-01",
        status: "OPEN",
        amount_total: 500,
        amount_rent: 500,
        amount_late: 0,
      },
      {
        id: "I2",
        lease_id: "L1",
        due_date: "2026-02-01",
        status: "OPEN",
        amount_total: 500,
        amount_rent: 500,
        amount_late: 0,
      },
    ],
    payments: [
      {
        id: "PAY1",
        lease_id: "L1",
        invoice_id: "I2",
        amount: 200,
        payment_date: "2026-02-05",
        status: "completed",
        tenant_id: "T1",
        property_id: "P1",
      },
      {
        id: "PAY2",
        lease_id: "L2",
        invoice_id: null,
        amount: 50,
        payment_date: "2025-08-01",
        status: "completed",
        tenant_id: "T2",
        property_id: "P2",
      },
    ],
    leaseTerms: [],
  };
}

describe("shadow reconciliation artifact", () => {
  it("writes anonymized detailed comparison file", () => {
    const { report, baselineLeaseCount, candidateAccountCount } =
      runShadowReconciliation(fixtureDataset());

    const payload = {
      generatedAt: new Date().toISOString(),
      mode: "fixture",
      writeMethodsUsed: [] as string[],
      liveWrites: 0,
      databaseWrites: 0,
      visibleScreensUnchanged: true,
      candidateDisabledForUi: true,
      baselineLeaseCount,
      candidateAccountCount,
      summary: {
        baselineAccountCount: report.baselineAccountCount,
        baselineExactMatchCount: report.baselineExactMatchCount,
        candidateDifferenceCount: report.candidateDifferenceCount,
        countsByCategory: report.countsByCategory,
        totalUnlinkedPaymentAmount: report.totalUnlinkedPaymentAmount,
        totalCandidateCredit: report.totalCandidateCredit,
        holdoverCandidateCount: report.holdoverCandidateCount,
        ambiguousAccountCount: report.ambiguousAccountCount,
        gracePeriodStatusChangeCount: report.gracePeriodStatusChangeCount,
      },
      report,
    };

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");

    expect(fs.existsSync(OUT)).toBe(true);
    const text = fs.readFileSync(OUT, "utf8");
    expect(text).not.toMatch(/@gmail|@yahoo|phone|street|avenue/i);
    expect(payload.summary.baselineAccountCount).toBeGreaterThan(0);
  });
});
