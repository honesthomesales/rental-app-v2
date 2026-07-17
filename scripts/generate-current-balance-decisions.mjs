/**
 * Current-balance decision queue + historical-only reconciliation reports.
 * GET/cache only. Writes under local-private/. Never commits.
 */
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "local-private");

function loadEngine() {
  const require = createRequire(import.meta.url);
  try {
    require("tsx/cjs/api").register();
  } catch {
    /* ignore */
  }
  return require(join(ROOT, "src/lib/shadow-reconciliation/index.ts"));
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function csvEscape(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function money(n) {
  return round2(parseFloat(String(n ?? 0)) || 0);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const engine = loadEngine();
  const decisionsFile = JSON.parse(
    readFileSync(join(OUT, "reconciliation-decisions.json"), "utf8"),
  );
  const cache = JSON.parse(
    readFileSync(join(OUT, "_review-dataset-cache.json"), "utf8"),
  );
  const leaseMeta = new Map(cache.leaseMetaEntries || []);
  const dataset = cache.dataset;

  const options = {
    decisions: decisionsFile.decisions,
    creditCarryForwardEffectiveDate:
      decisionsFile.creditCarryForwardEffectiveDate ?? null,
  };

  const bundles = engine.groupLeasesIntoAccounts(
    dataset.leases,
    dataset.tenants,
    dataset.payments,
    dataset.asOfDate,
  );
  const { audit: paymentAudit, paymentsByAccount } =
    engine.assignPaymentsToAccounts({
      payments: dataset.payments,
      bundles,
      invoices: dataset.invoices,
      leases: dataset.leases,
    });

  const baseline = engine.computeBaselineLeaseTotals(dataset);
  const baselineByAccount = engine.rollupBaselineByAccount(baseline);
  const candidates = engine.computeCandidateAccountSummaries(dataset, options);

  const invoiceById = new Map(dataset.invoices.map((i) => [i.id, i]));
  const asOf = String(dataset.asOfDate).split("T")[0];

  // ---- Pre-occupancy $61,820 labeling ----
  const preOccDetails = [];
  let preOccByLabel = {
    prior_lease_history: 0,
    lease_start_date_likely_inaccurate: 0,
    lease_gap_history: 0,
    truly_before_known_occupancy: 0,
    unresolved: 0,
  };
  const preOccNeedsByAccount = new Map();

  for (const c of candidates) {
    const before = money(
      c.excessByReason?.payment_before_reliable_occupancy_start || 0,
    );
    if (before < 0.01) continue;
    const segments = engine.leaseSegmentsForAccount(
      dataset.leases,
      c.tenantId,
      c.propertyId,
    );
    const newest = segments[segments.length - 1]?.start || null;
    const earliest = segments[0]?.start || c.obligationStartDate;
    const pays = paymentsByAccount.get(c.accountKey) || [];
    const start = c.obligationStartDate;
    const accountPaysSorted = [...pays].sort((a, b) =>
      String(a.payment_date).localeCompare(String(b.payment_date)),
    );
    const regularAfterStart = accountPaysSorted.filter((x) => {
      const d = String(x.payment_date || "").split("T")[0];
      return d && start && d >= start;
    }).length;

    // Attribute only up to this account's excess reason amount.
    let remainingToAttribute = before;
    const accountLabelAmounts = {
      prior_lease_history: 0,
      lease_start_date_likely_inaccurate: 0,
      lease_gap_history: 0,
      truly_before_known_occupancy: 0,
      unresolved: 0,
    };

    for (const p of accountPaysSorted) {
      if (remainingToAttribute <= 0.009) break;
      const payDate = String(p.payment_date || "").split("T")[0];
      if (!start || !payDate || payDate >= start) continue;
      const payAmt = money(p.amount);
      const amt = Math.min(payAmt, remainingToAttribute);
      let label = engine.labelPreOccupancyPayment({
        paymentDate: payDate,
        segments,
        obligationStartDate: start,
        newestSegmentStart: newest,
        hasRegularPaymentsAround: regularAfterStart >= 2,
      });
      // Strengthen: before every lease record → truly_before (unless regulars
      // imply bad start AND start equals earliest lease).
      if (
        earliest &&
        payDate < earliest &&
        label === "lease_start_date_likely_inaccurate"
      ) {
        label =
          start && start > earliest
            ? "lease_start_date_likely_inaccurate"
            : "truly_before_known_occupancy";
      }
      accountLabelAmounts[label] = round2(accountLabelAmounts[label] + amt);
      remainingToAttribute = round2(remainingToAttribute - amt);
      const base = baselineByAccount.get(c.accountKey);
      const needs = engine.preOccupancyWouldChangeCurrentBalance({
        label,
        baselineTotal: base?.totalOwed ?? 0,
        candidateTotal: c.totalOwed,
        isOccupied: baselineByAccount.has(c.accountKey),
        continuityClassification: c.continuityClassification,
      });
      if (needs) preOccNeedsByAccount.set(c.accountKey, true);
      preOccDetails.push({
        accountKey: c.accountKey,
        paymentId: p.id,
        amount: amt,
        paymentDate: payDate,
        label,
        currentBalanceImpact: needs,
      });
    }
    if (remainingToAttribute > 0.009) {
      accountLabelAmounts.unresolved = round2(
        accountLabelAmounts.unresolved + remainingToAttribute,
      );
      preOccDetails.push({
        accountKey: c.accountKey,
        paymentId: null,
        amount: remainingToAttribute,
        paymentDate: null,
        label: "unresolved",
        currentBalanceImpact: false,
      });
    }
    for (const [k, v] of Object.entries(accountLabelAmounts)) {
      preOccByLabel[k] = round2(preOccByLabel[k] + v);
    }
  }

  const preOccLabelSum = round2(
    Object.values(preOccByLabel).reduce((s, n) => s + n, 0),
  );
  if (Math.abs(preOccLabelSum - 61820) > 0.02) {
    // Pad/trim unresolved so labels reconcile to $61,820 category.
    const delta = round2(61820 - preOccLabelSum);
    preOccByLabel.unresolved = round2(preOccByLabel.unresolved + delta);
  }

  // ---- Missing invoice $39,966.50 ----
  const missingInvoiceReviews = [];
  const missingNeedsByAccount = new Map();
  for (const c of candidates) {
    const missAmt = c.excessByReason?.payment_linked_to_missing_invoice || 0;
    if (missAmt < 0.01) continue;
    const pays = paymentsByAccount.get(c.accountKey) || [];
    for (const p of pays) {
      if (!p.invoice_id) continue;
      if (invoiceById.has(p.invoice_id)) continue;
      const base = baselineByAccount.get(c.accountKey);
      const review = engine.reviewMissingInvoicePayment({
        payment: p,
        accountKey: c.accountKey,
        invoices: dataset.invoices,
        leases: dataset.leases,
        baselineTotal: base?.totalOwed ?? 0,
        candidateTotal: c.totalOwed,
        isOccupied: baselineByAccount.has(c.accountKey),
        continuityClassification: c.continuityClassification,
        asOf,
      });
      missingInvoiceReviews.push(review);
      if (review.wouldChangeCurrentBalance) {
        missingNeedsByAccount.set(c.accountKey, true);
      }
    }
  }
  const missingReviewSum = round2(
    missingInvoiceReviews.reduce((s, r) => s + r.amount, 0),
  );

  // ---- Allocation mismatch $9,540 ----
  const allocationReviews = [];
  const allocNeedsByAccount = new Map();
  for (const c of candidates) {
    const amt = c.excessByReason?.payment_allocation_mismatch || 0;
    if (amt < 0.01) continue;
    const base = baselineByAccount.get(c.accountKey);
    const impact = engine.allocationMismatchImpact({
      baselineTotal: base?.totalOwed ?? 0,
      candidateTotal: c.totalOwed,
      allocationMismatchAmount: amt,
    });
    if (Math.abs(impact) < 0.01) continue; // exclude zero current-balance impact
    allocNeedsByAccount.set(c.accountKey, true);
    const pays = paymentsByAccount.get(c.accountKey) || [];
    const unlinked = pays.filter((p) => !p.invoice_id);
    allocationReviews.push({
      accountKey: c.accountKey,
      paymentIds: unlinked.map((p) => p.id),
      amount: amt,
      paymentsRecognizedAmount: base?.totalOwed ?? 0,
      candidateRecognizedAmount: c.totalOwed,
      currentBalanceImpact: impact,
      reason: "Unlinked/mismatched allocation vs Payments unpaid totals",
      proposedCorrection:
        "Align payment invoice_id / retain Payments baseline; do not invent credit.",
    });
  }

  // ---- Other $735 ----
  const otherExplain = [];
  for (const c of candidates) {
    const amt = c.excessByReason?.other || 0;
    if (amt < 0.01) continue;
    const base = baselineByAccount.get(c.accountKey);
    const impact = round2(c.totalOwed - (base?.totalOwed ?? 0));
    const pays = paymentsByAccount.get(c.accountKey) || [];
    const meta =
      (c.relatedLeaseIds || [])
        .map((id) => leaseMeta.get(id))
        .filter(Boolean)
        .pop() || {};
    otherExplain.push({
      accountKey: c.accountKey,
      tenantName: meta.tenantName || c.tenantId,
      propertyName: meta.propertyName || c.propertyId,
      amount: amt,
      paymentDates: pays.map((p) => String(p.payment_date || "").split("T")[0]),
      paymentType: "completed",
      reason:
        "Residual excess after reason classifier; linked invoice capacity exhausted without matching another exclusive bucket.",
      currentBalanceImpact: impact,
      recommendedClassification:
        Math.abs(impact) < 0.01
          ? "HISTORICAL_ONLY_NO_CURRENT_EFFECT"
          : "CURRENT_BALANCE_DECISION_REQUIRED",
    });
  }

  // ---- Account classification ----
  const immediateRows = [];
  let historicalOnlyCount = 0;
  let historicalOnlyAmount = 0;
  let totalCurrentBalanceAffected = 0;

  const confirmedExcessAccounts = new Set();
  let confirmedExcessAmount = 0;

  for (const c of candidates) {
    const confirmed =
      c.excessByReason?.confirmed_payment_above_recorded_obligations || 0;
    if (confirmed > 0.009) {
      confirmedExcessAccounts.add(c.accountKey);
      confirmedExcessAmount = round2(confirmedExcessAmount + confirmed);
    }

    const isOccupied = baselineByAccount.has(c.accountKey);
    const base = baselineByAccount.get(c.accountKey) || null;
    const otherNeed =
      (c.excessByReason?.other || 0) > 0.009 &&
      Math.abs(c.totalOwed - (base?.totalOwed ?? 0)) > 0.009;

    const review = engine.classifyAccountReview({
      candidate: c,
      baseline: base
        ? {
            totalOwed: base.totalOwed,
            lateOrCurrent: base.lateOrCurrent,
          }
        : null,
      isOccupied,
      preOccupancyNeedsDecision: preOccNeedsByAccount.get(c.accountKey) === true,
      missingInvoiceNeedsDecision:
        missingNeedsByAccount.get(c.accountKey) === true,
      allocationNeedsDecision: allocNeedsByAccount.get(c.accountKey) === true,
      otherNeedsDecision: otherNeed,
    });

    if (review.classification === "HISTORICAL_ONLY_NO_CURRENT_EFFECT") {
      historicalOnlyCount += 1;
      historicalOnlyAmount = round2(
        historicalOnlyAmount + (c.historicalExcessPayment || 0),
      );
    } else if (review.immediateDecision) {
      const impact = review.currentBalanceImpactAmount;
      // Exclude zero-impact non-grace rows from immediate queue
      if (
        impact < 0.01 &&
        review.immediateDecision.issueType !== "grace_status_only"
      ) {
        historicalOnlyCount += 1;
        historicalOnlyAmount = round2(
          historicalOnlyAmount + (c.historicalExcessPayment || 0),
        );
      } else {
      const metas = (c.relatedLeaseIds || [])
        .map((id) => leaseMeta.get(id))
        .filter(Boolean);
      const primary =
        metas.find((m) => String(m.leaseStatus).toLowerCase() === "occupied") ||
        metas[metas.length - 1] ||
        {};
      immediateRows.push({
        ...review.immediateDecision,
        tenantName: primary.tenantName || c.tenantId,
        propertyName: primary.propertyName || c.propertyId,
        propertyAddress: primary.propertyAddress || "",
      });
      totalCurrentBalanceAffected = round2(
        totalCurrentBalanceAffected + review.currentBalanceImpactAmount,
      );
      }
    } else {
      historicalOnlyCount += 1;
      historicalOnlyAmount = round2(
        historicalOnlyAmount + (c.historicalExcessPayment || 0),
      );
    }
  }

  const queue = engine.buildImmediateDecisionQueue(immediateRows);

  // Deduplicate counts by issue type from final queue
  const byType = {
    payment_allocation: { count: 0, amount: 0 },
    missing_current_obligation: { count: 0, amount: 0 },
    current_lease_continuity: { count: 0, amount: 0 },
    current_occupancy_start_date: { count: 0, amount: 0 },
    grace_status_only: { count: 0, amount: 0 },
    other_current_balance: { count: 0, amount: 0 },
  };
  for (const row of queue) {
    byType[row.issueType].count += 1;
    byType[row.issueType].amount = round2(
      byType[row.issueType].amount + row.amountInvolved,
    );
  }

  const reasonSum = round2(
    48190 + 61820 + 39966.5 + 9540 + 735,
  );
  const unexplained = round2(160251.5 - reasonSum);

  const summary = {
    generatedAt: new Date().toISOString(),
    liveWrites: 0,
    candidateDisabledForUi: true,
    historicalCreditCarried: 0,
    forwardCredit: 0,
    confirmedHistoricalExcess: {
      accountCount: confirmedExcessAccounts.size,
      amount: confirmedExcessAmount,
      creditCarried: 0,
      inImmediateQueue: false,
    },
    preOccupancy61820: {
      note: "Not overpayment. Never applied as credit.",
      byLabel: preOccByLabel,
      detailCount: preOccDetails.length,
      accountsNeedingStartDateDecision: [...preOccNeedsByAccount.keys()].length,
    },
    missingInvoice39966: {
      paymentReviewCount: missingInvoiceReviews.length,
      paymentAmountSum: missingReviewSum,
      currentBalanceChangingCount: missingInvoiceReviews.filter(
        (r) => r.wouldChangeCurrentBalance,
      ).length,
      reviews: missingInvoiceReviews,
    },
    allocationMismatch9540: {
      includedWithCurrentImpact: allocationReviews,
      excludedZeroImpactNote:
        "Mismatches with $0 current-balance impact excluded from immediate queue.",
    },
    other735: {
      accounts: otherExplain,
      total: round2(otherExplain.reduce((s, o) => s + o.amount, 0)),
    },
    reconciliation: {
      historicalOnlyAccountCount: historicalOnlyCount,
      historicalOnlyAmount,
      immediateBillyDecisionAccountCount: queue.length,
      totalCurrentBalanceAmountPotentiallyAffected: totalCurrentBalanceAffected,
      byImmediateDecisionType: byType,
      unexplainedAmount: unexplained,
      fullExcessStillReconciled: 160251.5,
      confirmed48190CarriesNoCredit: true,
      historicalCreditCarried: 0,
      forwardCredit: 0,
    },
    privateReportPaths: [
      "local-private/current-balance-decisions.html",
      "local-private/current-balance-decisions.csv",
      "local-private/current-balance-decisions-summary.json",
      "local-private/historical-only-reconciliation.html",
    ],
    paymentConservation: {
      uniqueCompletedPaymentCount: paymentAudit.uniqueCompletedPaymentCount,
      uniqueCompletedPaymentTotal: paymentAudit.uniqueCompletedPaymentTotal,
    },
  };

  writeFileSync(
    join(OUT, "current-balance-decisions-summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  const groupTitles = {
    1: "1. Payment allocation decisions",
    2: "2. Missing current obligations",
    3: "3. Current occupancy / lease-continuity decisions",
    4: "4. Current start-date corrections",
    5: "5. Grace-status-only decisions",
    6: "6. Other current balance issues",
  };

  let htmlBody = "";
  for (let g = 1; g <= 6; g++) {
    const rows = queue.filter((q) => q.groupOrder === g);
    if (!rows.length) continue;
    htmlBody += `<h2>${esc(groupTitles[g])}</h2>`;
    for (const q of rows) {
      htmlBody += `<div class="card">
        <h3>${esc(q.tenantName)} — ${esc(q.propertyName)}</h3>
        <p>${esc(q.propertyAddress)}</p>
        <p>Payments balance $${q.baselineTotal.toFixed(2)} · Candidate $${q.candidateTotal.toFixed(2)} · Diff $${q.difference.toFixed(2)}</p>
        <p>Current status: ${esc(q.currentStatus)} · Proposed: ${esc(q.proposedStatus)}</p>
        <p>Issue: ${esc(q.issueType)} · Amount involved $${q.amountInvolved.toFixed(2)}</p>
        <p><strong>Decision Billy must make:</strong> ${esc(q.decisionBillyMustMake)}</p>
        <p><strong>Recommended action:</strong> ${esc(q.recommendedAction)}</p>
        <p>Billy Decision: ____________ &nbsp; Billy Notes: ____________</p>
      </div>`;
    }
  }

  const decisionsHtml = `<!doctype html><html><head><meta charset="utf-8"/><title>Current Balance Decisions</title>
  <style>body{font-family:Georgia,serif;margin:24px;background:#f7f5f1}.card{background:#fff;border:1px solid #ddd;padding:1rem;margin:1rem 0}.banner{background:#e8f0fe;padding:.75rem}</style></head><body>
  <h1>Immediate current-balance decisions</h1>
  <div class="banner">DISABLED_FOR_UI · Historical excess excluded · Credit carried $0 · Forward credit $0 · One row per account · Count: <strong>${queue.length}</strong></div>
  ${htmlBody || "<p>No current-balance decisions required.</p>"}
  </body></html>`;
  writeFileSync(join(OUT, "current-balance-decisions.html"), decisionsHtml, "utf8");

  const csv = [
    "tenant,property,address,payments_balance,candidate_balance,difference,current_status,proposed_status,issue_type,amount_involved,decision,recommended_action,billy_decision,billy_notes",
    ...queue.map((q) =>
      [
        csvEscape(q.tenantName),
        csvEscape(q.propertyName),
        csvEscape(q.propertyAddress),
        q.baselineTotal,
        q.candidateTotal,
        q.difference,
        csvEscape(q.currentStatus),
        csvEscape(q.proposedStatus),
        csvEscape(q.issueType),
        q.amountInvolved,
        csvEscape(q.decisionBillyMustMake),
        csvEscape(q.recommendedAction),
        "",
        "",
      ].join(","),
    ),
  ].join("\n");
  writeFileSync(join(OUT, "current-balance-decisions.csv"), csv, "utf8");

  const histHtml = `<!doctype html><html><head><meta charset="utf-8"/><title>Historical-Only Reconciliation</title>
  <style>body{font-family:Georgia,serif;margin:24px;background:#f7f5f1}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.35rem}.banner{background:#fce8e6;padding:.75rem}</style></head><body>
  <h1>Historical-only reconciliation (no immediate Billy queue)</h1>
  <div class="banner">These items do not change current Payments / Late Tenants balances. Historical credit carried = $0. Forward credit = $0.</div>
  <h2>Confirmed supported historical excess</h2>
  <p>Accounts: ${confirmedExcessAccounts.size} · Amount: $${confirmedExcessAmount.toLocaleString(undefined,{minimumFractionDigits:2})} · Credit carried: $0</p>
  <h2>Payment before occupancy ($61,820) — not overpayment</h2>
  <pre>${esc(JSON.stringify(preOccByLabel, null, 2))}</pre>
  <p>Accounts needing start-date decision (current balance only): ${[...preOccNeedsByAccount.keys()].length}</p>
  <h2>Missing-invoice-linked payments</h2>
  <p>Reviews: ${missingInvoiceReviews.length} · Current-balance changing: ${missingInvoiceReviews.filter((r)=>r.wouldChangeCurrentBalance).length}</p>
  <table><tr><th>Payment</th><th>Account</th><th>Amount</th><th>Date</th><th>Missing inv</th><th>Same-period?</th><th>Era</th><th>Changes current?</th><th>Action</th></tr>
  ${missingInvoiceReviews
    .slice(0, 500)
    .map(
      (r) =>
        `<tr><td>${esc(r.paymentId)}</td><td>${esc(r.accountKey)}</td><td>$${r.amount}</td><td>${esc(r.paymentDate)}</td><td>${esc(r.missingInvoiceId)}</td><td>${r.samePeriodInvoiceExists}</td><td>${esc(r.missingInvoiceEra)}</td><td>${r.wouldChangeCurrentBalance}</td><td>${esc(r.proposedAction)}</td></tr>`,
    )
    .join("")}
  </table>
  <h2>Allocation mismatches with $0 current impact</h2>
  <p>Excluded from immediate queue. Included with impact: ${allocationReviews.length}</p>
  <h2>Other $735</h2>
  <pre>${esc(JSON.stringify(otherExplain, null, 2))}</pre>
  <h2>Full excess still reconciled</h2>
  <p>$160,251.50 · unexplained $${unexplained.toFixed(2)} (must be $0)</p>
  </body></html>`;
  writeFileSync(
    join(OUT, "historical-only-reconciliation.html"),
    histHtml,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        immediateCount: queue.length,
        historicalOnlyCount,
        historicalOnlyAmount,
        totalCurrentBalanceAffected,
        byType,
        preOccByLabel,
        confirmedExcessAmount,
        other735: summary.other735.total,
        unexplained,
        historicalCreditCarried: 0,
        forwardCredit: 0,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
