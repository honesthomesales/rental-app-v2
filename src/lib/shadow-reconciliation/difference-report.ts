/**
 * Difference report: baseline Payments vs candidate shadow.
 * Anonymized IDs only — no PII. Candidate remains DISABLED_FOR_UI.
 */

import {
  computeBaselineLeaseTotals,
  rollupBaselineByAccount,
} from "./baseline";
import { computeCandidateAccountSummaries } from "./candidate";
import type {
  AccountDifference,
  CandidateAccountSummary,
  DifferenceCategory,
  DifferenceReport,
  ShadowDataset,
} from "./types";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyCategoryCounts(): Record<DifferenceCategory, number> {
  return {
    overpayment_credit: 0,
    unlinked_payment: 0,
    missing_invoice: 0,
    partial_invoice_status: 0,
    payment_after_lease_end: 0,
    lease_not_extended: 0,
    holdover_candidate: 0,
    duplicate_invoice: 0,
    recorded_late_fee: 0,
    grace_period_change: 0,
    ambiguous_account: 0,
    historical_excess_payment_not_carried: 0,
    forward_credit: 0,
    credit_closeout_review: 0,
    other: 0,
  };
}

function anonymizeAccountKey(accountKey: string, index: number): string {
  // Stable anonymized token — no raw UUIDs in report if we hash lightly
  const short = accountKey.replace(/[^a-f0-9]/gi, "").slice(0, 8) || "acct";
  return `ACCT-${String(index + 1).padStart(3, "0")}-${short.slice(0, 4).toUpperCase()}`;
}

function anonymizeLeaseId(leaseId: string, index: number): string {
  const short = leaseId.replace(/[^a-f0-9]/gi, "").slice(0, 6) || "lease";
  return `LEASE-${String(index + 1).padStart(3, "0")}-${short.slice(0, 4).toUpperCase()}`;
}

function categorize(
  baselineTotal: number,
  candidate: CandidateAccountSummary | undefined,
  baselineLate: "late" | "current" | "n/a",
): DifferenceCategory[] {
  if (!candidate) {
    return ["other"];
  }
  const cats = new Set<DifferenceCategory>();
  const diff = round2(candidate.totalOwed - baselineTotal);

  if (candidate.unappliedCredit > 0.0001) cats.add("overpayment_credit");
  if (candidate.historicalExcessPayment > 0.0001) {
    cats.add("historical_excess_payment_not_carried");
    // Legacy category kept for prior report compatibility when excess existed as credit
    cats.add("overpayment_credit");
  }
  if (candidate.forwardCredit > 0.0001) cats.add("forward_credit");
  if (candidate.creditCloseoutReview > 0.0001) {
    cats.add("credit_closeout_review");
  }
  if (candidate.unlinkedPaymentsAmount > 0.0001) cats.add("unlinked_payment");
  if (candidate.missingExpectedObligations > 0) cats.add("missing_invoice");
  if (candidate.dataProblems.includes("partial_invoice_ignored_by_baseline")) {
    cats.add("partial_invoice_status");
  }
  if (candidate.dataProblems.includes("payment_after_lease_end")) {
    cats.add("payment_after_lease_end");
  }
  if (candidate.confirmedHoldover) {
    cats.add("holdover_candidate");
  } else if (candidate.holdoverCandidate) {
    cats.add("holdover_candidate");
    cats.add("lease_not_extended");
  }
  if (candidate.dataProblems.includes("duplicate_invoice")) {
    cats.add("duplicate_invoice");
  }
  if (candidate.recordedLateFees > 0.0001) cats.add("recorded_late_fee");
  if (candidate.dataProblems.includes("ambiguous_payment")) {
    cats.add("ambiguous_account");
  }

  const candidateLateLike =
    candidate.graceStatus === "late"
      ? "late"
      : candidate.graceStatus === "grace_period"
        ? "grace_period"
        : "current";

  if (
    baselineLate === "late" &&
    (candidateLateLike === "grace_period" || candidateLateLike === "current")
  ) {
    cats.add("grace_period_change");
  } else if (
    baselineLate === "current" &&
    candidateLateLike === "late"
  ) {
    cats.add("grace_period_change");
  } else if (
    baselineLate === "late" &&
    candidateLateLike === "late" &&
    candidate.graceStatus === "grace_period"
  ) {
    cats.add("grace_period_change");
  }

  // Explicit grace status change when baselinesays late but candidate grace_period
  if (baselineLate === "late" && candidate.graceStatus === "grace_period") {
    cats.add("grace_period_change");
  }
  if (baselineLate === "current" && candidate.graceStatus === "grace_period") {
    // candidate in grace with balance — baseline may still call it late if owed>0
    // Payments baseline marks late whenever unpaid OPEN balance exists
    if (candidate.totalOwed > 0) cats.add("grace_period_change");
  }

  if (Math.abs(diff) > 0.009 && cats.size === 0) cats.add("other");

  return [...cats];
}

export function buildDifferenceReport(
  dataset: ShadowDataset,
  options?: import("./types").CandidateEngineOptions,
): DifferenceReport {
  const baseline = computeBaselineLeaseTotals(dataset);
  const baselineByAccount = rollupBaselineByAccount(baseline);
  const candidates = computeCandidateAccountSummaries(dataset, options);
  const candidateByKey = new Map(candidates.map((c) => [c.accountKey, c]));

  const allKeys = new Set<string>([
    ...baselineByAccount.keys(),
    ...candidateByKey.keys(),
  ]);

  const countsByCategory = emptyCategoryCounts();
  const differences: AccountDifference[] = [];
  let exactMatch = 0;
  let gracePeriodStatusChangeCount = 0;
  let index = 0;

  for (const accountKey of [...allKeys].sort()) {
    const base = baselineByAccount.get(accountKey);
    const cand = candidateByKey.get(accountKey);
    const baselineTotal = round2(base?.totalOwed ?? 0);
    const candidateTotal = round2(cand?.totalOwed ?? 0);
    const numericDifference = round2(candidateTotal - baselineTotal);
    const baselineLateOrCurrent = base?.lateOrCurrent ?? "n/a";
    const categories = categorize(baselineTotal, cand, baselineLateOrCurrent);

    // Exact match = totals equal (Payments parity). Soft flags still noted separately.
    const totalsMatch = Math.abs(numericDifference) < 0.01 && !!base && !!cand;
    if (totalsMatch) exactMatch++;

    if (categories.includes("grace_period_change")) {
      gracePeriodStatusChangeCount++;
    }

    for (const c of categories) countsByCategory[c]++;

    const hasMaterialDiff =
      !totalsMatch ||
      categories.some((c) =>
        [
          "overpayment_credit",
          "unlinked_payment",
          "missing_invoice",
          "holdover_candidate",
          "ambiguous_account",
          "grace_period_change",
          "partial_invoice_status",
          "duplicate_invoice",
          "payment_after_lease_end",
          "lease_not_extended",
          "historical_excess_payment_not_carried",
          "forward_credit",
          "credit_closeout_review",
          "other",
        ].includes(c),
      );

    if (hasMaterialDiff || !totalsMatch) {
      const leaseIds = [
        ...(base?.leaseIds || []),
        ...(cand?.relatedLeaseIds || []),
      ];
      const uniqueLeases = [...new Set(leaseIds)];

      differences.push({
        accountKey: `redacted:${index}`,
        anonymizedAccountId: anonymizeAccountKey(accountKey, index),
        anonymizedLeaseIds: uniqueLeases.map((id, i) => anonymizeLeaseId(id, i)),
        baselineTotal,
        candidateTotal,
        numericDifference,
        baselineLateOrCurrent,
        candidateGraceStatus: cand?.graceStatus ?? "n/a",
        linkedPaymentsAmount: cand?.linkedPaymentsAmount ?? 0,
        unlinkedPaymentsAmount: cand?.unlinkedPaymentsAmount ?? 0,
        carriedCredit: round2(
          (cand?.historicalExcessPayment ?? 0) + (cand?.forwardCredit ?? 0),
        ),
        missingExpectedObligations: cand?.missingExpectedObligations ?? 0,
        holdoverCandidate:
          (cand?.confirmedHoldover || cand?.holdoverCandidate) ?? false,
        categories,
        dataProblems: cand?.dataProblems ?? [],
      });
    }
    index++;
  }

  // Recompute exact match more cleanly: accounts where baseline exists and totals equal
  exactMatch = 0;
  for (const accountKey of baselineByAccount.keys()) {
    const base = baselineByAccount.get(accountKey)!;
    const cand = candidateByKey.get(accountKey);
    if (cand && Math.abs(round2(cand.totalOwed) - round2(base.totalOwed)) < 0.01) {
      exactMatch++;
    }
  }

  const candidateDifferenceCount = Math.max(
    0,
    baselineByAccount.size - exactMatch,
  );

  return {
    asOfDate: dataset.asOfDate,
    baselineAccountCount: baseline.length,
    baselineExactMatchCount: exactMatch,
    candidateDifferenceCount,
    countsByCategory,
    totalUnlinkedPaymentAmount: round2(
      candidates.reduce((s, c) => s + c.unlinkedPaymentsAmount, 0),
    ),
    totalCandidateCredit: round2(
      candidates.reduce(
        (s, c) => s + c.historicalExcessPayment + c.forwardCredit,
        0,
      ),
    ),
    holdoverCandidateCount: candidates.filter(
      (c) => c.confirmedHoldover || c.holdoverCandidate,
    ).length,
    ambiguousAccountCount: candidates.filter((c) =>
      c.dataProblems.includes("ambiguous_payment"),
    ).length,
    gracePeriodStatusChangeCount,
    differences,
    note:
      "Candidate is DISABLED_FOR_UI. Payments page remains source of truth until Billy approves. totalLateOwed semantics unchanged on visible screens. Forward credit requires creditCarryForwardEffectiveDate; unset means historical excess is not carried.",
  };
}

/** Public runner used by scripts/tests — pure, no I/O. */
export function runShadowReconciliation(
  dataset: ShadowDataset,
  options?: import("./types").CandidateEngineOptions,
): {
  report: DifferenceReport;
  baselineLeaseCount: number;
  candidateAccountCount: number;
} {
  const baseline = computeBaselineLeaseTotals(dataset);
  const candidates = computeCandidateAccountSummaries(dataset, options);
  const report = buildDifferenceReport(dataset, options);
  return {
    report,
    baselineLeaseCount: baseline.length,
    candidateAccountCount: candidates.length,
  };
}
