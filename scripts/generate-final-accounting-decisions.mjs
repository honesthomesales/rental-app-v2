/**
 * Final V3 accounting decisions package (as-of 2026-07-26).
 * Read-only. No live writes / UI activation / commit.
 */
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "local-private");
const CONFIG_PATH = join(OUT, "final-accounting-config.json");

function loadConfig() {
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  return {
    asOf: cfg.asOfDate || "2026-07-26",
    queueCompleteBanner:
      cfg.queueCompleteBanner ||
      "ACCOUNTING DECISION QUEUE COMPLETE — 0 OUTSTANDING ACCOUNTS",
    PRIOR_ALLOCATION: cfg.allocationCohort || [],
    PRIOR_MISSING: cfg.missingCohort || [],
    PRIOR_ACTIVE_24: cfg.activeThrough2030Cohort || [],
    billyMissingDecisions: cfg.billyFinalMissingObligationDecisions || [],
  };
}
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
function money(n) {
  return round2(parseFloat(String(n ?? 0)) || 0);
}
function toDate(iso) {
  if (!iso) return null;
  return String(iso).split("T")[0];
}
function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
function matchPair(tenant, property, list) {
  const t = norm(tenant);
  const p = norm(property);
  return list.some(
    (a) =>
      (t === norm(a.tenant) || t.includes(norm(a.tenant)) || norm(a.tenant).includes(t)) &&
      (p.includes(norm(a.property)) || norm(a.property).includes(p.slice(0, 12))),
  );
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

async function main() {
  mkdirSync(OUT, { recursive: true });
  const {
    asOf: AS_OF,
    queueCompleteBanner,
    PRIOR_ALLOCATION,
    PRIOR_MISSING,
    PRIOR_ACTIVE_24,
    billyMissingDecisions,
  } = loadConfig();
  const engine = loadEngine();
  const decisionsFile = JSON.parse(
    readFileSync(join(OUT, "reconciliation-decisions.json"), "utf8"),
  );
  const cache = JSON.parse(
    readFileSync(join(OUT, "_review-dataset-cache.json"), "utf8"),
  );
  const leaseMeta = new Map(cache.leaseMetaEntries || []);
  const raw = cache.dataset;

  const partitioned = engine.partitionPaymentsByAsOf(raw.payments || [], AS_OF);
  engine.assertFuturePaymentInvariants({
    asOfDate: AS_OF,
    eligiblePayments: partitioned.eligible,
    excludedFuture: partitioned.excludedFuture,
  });

  const dataset = {
    ...raw,
    asOfDate: AS_OF,
    payments: partitioned.eligible,
  };

  const options = {
    decisions: decisionsFile.decisions,
    creditCarryForwardEffectiveDate:
      decisionsFile.creditCarryForwardEffectiveDate ?? null,
  };

  const bundles = engine.groupLeasesIntoAccounts(
    dataset.leases,
    dataset.tenants,
    dataset.payments,
    AS_OF,
  );
  const { paymentsByAccount, audit: paymentAudit } =
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

  function metaPrimary(c) {
    const metas = (c.relatedLeaseIds || [])
      .map((id) => leaseMeta.get(id))
      .filter(Boolean);
    return (
      metas.find((m) => String(m.leaseStatus).toLowerCase() === "occupied") ||
      metas[metas.length - 1] ||
      {}
    );
  }

  const allocationHealth = [];
  const missingReviews = [];
  const active24 = [];
  const genuineDecisions = [];
  let totalHistExcessAudit = 0;

  for (const c of candidates) {
    totalHistExcessAudit = round2(
      totalHistExcessAudit + money(c.historicalExcessPayment),
    );
    if (money(c.historicalCreditCarried) !== 0) {
      throw new Error(`historicalCreditCarried must be 0 for ${c.accountKey}`);
    }
    if (money(c.forwardCredit) !== 0 && !options.creditCarryForwardEffectiveDate) {
      throw new Error(`forwardCredit must be 0 without effective date: ${c.accountKey}`);
    }
    if (c.DISABLED_FOR_UI !== true) {
      throw new Error(`DISABLED_FOR_UI missing on ${c.accountKey}`);
    }

    const primary = metaPrimary(c);
    const tenantName = primary.tenantName || c.tenantId;
    const propertyName = primary.propertyName || c.propertyId;
    const propertyAddress = primary.propertyAddress || "";
    const base = baselineByAccount.get(c.accountKey);
    const paymentsBalance = round2(base?.totalOwed ?? 0);
    const candidateBalance = round2(c.totalOwed);
    // Policy: hist excess never lowers current — candidate already enforces;
    // corrected candidate for display = candidate (no hist credit applied).
    const correctedCandidate = candidateBalance;
    const net = round2(correctedCandidate - paymentsBalance);

    const lease =
      dataset.leases.find(
        (l) =>
          l.tenant_id === c.tenantId &&
          l.property_id === c.propertyId &&
          String(l.status || "").toLowerCase() === "occupied",
      ) ||
      dataset.leases
        .filter(
          (l) => l.tenant_id === c.tenantId && l.property_id === c.propertyId,
        )
        .pop();

    const leaseIds = c.relatedLeaseIds || (lease ? [lease.id] : []);
    const pays = paymentsByAccount.get(c.accountKey) || [];
    const futureForAccount = partitioned.excludedFuture.filter(
      (x) =>
        x.payment.tenant_id === c.tenantId ||
        (x.payment.lease_id && leaseIds.includes(x.payment.lease_id)),
    );
    const futureAmt = round2(
      futureForAccount.reduce((s, x) => s + money(x.payment.amount), 0),
    );

    // --- Allocation five ---
    if (matchPair(tenantName, propertyName, PRIOR_ALLOCATION)) {
      const eligibleProblem = pays.filter(
        (p) =>
          (!p.invoice_id || !invoiceById.has(String(p.invoice_id))) &&
          toDate(p.payment_date) &&
          toDate(p.payment_date) <= AS_OF,
      );
      const genuineAlloc =
        eligibleProblem.length > 0 &&
        Math.abs(net) > 0.009 &&
        futureAmt < 0.01;
      const entry = {
        tenantName,
        propertyName,
        propertyAddress,
        accountKey: c.accountKey,
        paymentsBalance,
        correctedCandidate,
        net,
        futureExcluded: futureForAccount.map((x) => ({
          id: x.payment.id,
          date: toDate(x.payment.payment_date),
          amount: money(x.payment.amount),
          class: x.exclusionClass,
        })),
        remainAtPaymentsBaseline: !genuineAlloc,
        recommendation: genuineAlloc
          ? "allocate an eligible payment dated on or before 2026-07-26"
          : "retain current Payments result",
        decisionType: genuineAlloc
          ? "allocate_eligible_payment"
          : "retain_payments",
      };
      allocationHealth.push(entry);
      if (genuineAlloc) {
        genuineDecisions.push({
          ...entry,
          why: "Eligible ≤ as-of payment still needs allocation decision.",
          dollarBridge: engine.buildDollarBridge({
            currentPaymentsBalance: paymentsBalance,
            candidateBalance: correctedCandidate,
            eligiblePaymentAllocationCorrections: Math.abs(net),
            causeCodes: ["payment_linked_to_wrong_invoice"],
            otherExplanation: "Eligible payment allocation correction",
            requirePerfect: true,
          }),
          billyDecision: "",
          billyNotes: "",
        });
      }
      continue;
    }

    // --- Missing cohort ---
    if (matchPair(tenantName, propertyName, PRIOR_MISSING) && lease) {
      const invs = dataset.invoices.filter((i) => i.lease_id === lease.id);
      const analysis = engine.analyzeMissingObligations({
        leaseId: lease.id,
        leaseStartDate: lease.lease_start_date,
        leaseEndDate: lease.lease_end_date,
        rent: lease.rent,
        rentCadence: lease.rent_cadence,
        rentDueDay: lease.rent_due_day,
        invoices: invs,
        payments: pays,
        asOfDate: AS_OF,
      });

      if (
        analysis.totalProposedMissingAmount > 0.009 &&
        analysis.proposedMissing.length === 0
      ) {
        throw new Error(
          `Invalid missing report for ${tenantName}: nonzero total with empty rows`,
        );
      }
      const rowSum = round2(
        analysis.proposedMissing.reduce((s, r) => s + r.rentAmount, 0),
      );
      if (Math.abs(rowSum - analysis.totalProposedMissingAmount) > 0.009) {
        throw new Error(
          `Missing row sum mismatch ${tenantName}: ${rowSum} vs ${analysis.totalProposedMissingAmount}`,
        );
      }

      const billyCfg =
        billyMissingDecisions.find((d) =>
          matchPair(tenantName, propertyName, [
            { tenant: d.tenant, property: d.property },
          ]),
        ) || null;
      const applied = engine.applyBillyMissingObligationDecision({
        proposedMissing: analysis.proposedMissing,
        decision: billyCfg,
      });

      // After Billy decision: approved missing drives balance impact; Payments retained.
      const approvedMissing = applied.approvedMissingAmount;
      const correctedAfterBilly = applied.retainPaymentsBalance
        ? paymentsBalance
        : round2(paymentsBalance + approvedMissing);
      const netAfterBilly = round2(correctedAfterBilly - paymentsBalance);

      const bridge = engine.buildDollarBridge({
        currentPaymentsBalance: paymentsBalance,
        candidateBalance: correctedAfterBilly,
        missingObligationsDueByAsOf: approvedMissing,
        causeCodes: applied.resolved
          ? ["no_valid_candidate_difference_after_policy"]
          : approvedMissing > 0.009
            ? ["missing_current_obligation"]
            : ["no_valid_candidate_difference_after_policy"],
        notes: [
          ...analysis.sanityNotes,
          ...(applied.dataFlags || []),
          applied.resolved
            ? `Billy resolved: approved missing $${approvedMissing.toFixed(2)}`
            : "Awaiting Billy missing-obligation decision",
        ],
        requirePerfect: true,
      });

      const review = {
        tenantName,
        propertyName,
        propertyAddress,
        accountKey: c.accountKey,
        leaseId: lease.id,
        storedRent: analysis.storedRent,
        storedCadence: analysis.storedCadence,
        rentDueDay: analysis.rentDueDay,
        confirmedRentAmount: applied.confirmedRentAmount,
        confirmedCadence: applied.confirmedCadence,
        lastRealInvoiceDate: analysis.lastRealInvoiceDate,
        lastRealInvoiceId: analysis.lastRealInvoiceId,
        sanityNotes: analysis.sanityNotes,
        proposedMissing: analysis.proposedMissing,
        totalProposedMissingAmount: analysis.totalProposedMissingAmount,
        approvedMissingAmount: approvedMissing,
        rejectedRows: applied.rejectedRows,
        dataFlags: applied.dataFlags,
        futurePreview: analysis.futurePreview,
        balanceAfterEach: analysis.balanceAfterEach,
        paymentsBalance,
        approvedRecordedObligationsThroughCutoff: paymentsBalance,
        eligiblePaymentsThroughCutoff: round2(
          pays.reduce((s, p) => s + money(p.amount), 0),
        ),
        candidateBalance: correctedAfterBilly,
        netDifference: netAfterBilly,
        dollarBridge: bridge,
        recommendation: applied.resolved
          ? "retain current Payments result"
          : analysis.totalProposedMissingAmount > 0.009
            ? "approve specific listed missing obligations OR retain current Payments result"
            : "retain current Payments result",
        decisionType: applied.resolved
          ? "resolved_retain_payments"
          : analysis.totalProposedMissingAmount > 0.009
            ? "approve_or_reject_missing_obligations"
            : "retain_payments",
        status: applied.resolved
          ? "resolved"
          : analysis.totalProposedMissingAmount < 0.01
            ? "no_gap_through_as_of"
            : "outstanding",
        billyDecision: applied.billyDecision,
        billyNotes: applied.billyNotes,
      };
      missingReviews.push(review);

      // Only unresolved (not Billy-resolved) enter the decision queue
      if (!applied.resolved && approvedMissing > 0.009) {
        genuineDecisions.push({
          tenantName,
          propertyName,
          propertyAddress,
          accountKey: c.accountKey,
          paymentsBalance,
          correctedCandidate: correctedAfterBilly,
          net: netAfterBilly,
          decisionType: review.decisionType,
          recommendation: review.recommendation,
          why: "Forward missing obligations due on or before as-of.",
          proposedMissing: analysis.proposedMissing,
          totalProposedMissingAmount: analysis.totalProposedMissingAmount,
          dollarBridge: bridge,
          dueDates: analysis.proposedMissing.map((r) => r.dueDate),
          billyDecision: "",
          billyNotes: "",
        });
      }
      continue;
    }

    // --- Active 24 ---
    if (matchPair(tenantName, propertyName, PRIOR_ACTIVE_24)) {
      const histExcess = money(c.historicalExcessPayment);
      const missingOnActive = lease
        ? engine.analyzeMissingObligations({
            leaseId: lease.id,
            leaseStartDate: lease.lease_start_date,
            leaseEndDate: lease.lease_end_date,
            rent: lease.rent,
            rentCadence: lease.rent_cadence,
            rentDueDay: lease.rent_due_day,
            invoices: dataset.invoices.filter((i) => i.lease_id === lease.id),
            payments: pays,
            asOfDate: AS_OF,
          })
        : { proposedMissing: [], totalProposedMissingAmount: 0 };

      const keepPayments = true; // Part 5: retain Payments after no-retro-credit; not continuity decisions
      const causeCandidate = keepPayments
        ? paymentsBalance
        : round2(paymentsBalance + missingOnActive.totalProposedMissingAmount);
      const causeNet = round2(causeCandidate - paymentsBalance);
      const formerCandidateDelta = round2(correctedCandidate - paymentsBalance);

      const bridge = engine.buildDollarBridge({
        currentPaymentsBalance: paymentsBalance,
        candidateBalance: causeCandidate,
        missingObligationsDueByAsOf: keepPayments
          ? 0
          : missingOnActive.totalProposedMissingAmount,
        causeCodes: keepPayments
          ? ["no_valid_candidate_difference_after_policy"]
          : ["missing_current_obligation"],
        notes: [
          "Lease classified current_active_lease (end in 2030) — not continuity/holdover.",
          `Historical excess $${histExcess.toFixed(2)} retained for audit only; does not reduce current balance.`,
          keepPayments
            ? `Former candidate delta $${formerCandidateDelta.toFixed(2)} eliminated by no-retro-credit / retain-Payments policy.`
            : "Forward missing obligations remain for Billy decision.",
        ],
        requirePerfect: true,
      });

      const reportClass = keepPayments
        ? "no_current_correction_after_policy"
        : "decision";

      const row = {
        tenantName,
        propertyName,
        propertyAddress,
        accountKey: c.accountKey,
        leaseStart: toDate(lease?.lease_start_date),
        leaseEnd: toDate(lease?.lease_end_date),
        leaseStatus: lease?.status || null,
        classification: "current_active_lease",
        monetaryCause: keepPayments
          ? formerCandidateDelta < -0.009
            ? "historical_excess_incorrectly_carried"
            : Math.abs(formerCandidateDelta) < 0.01
              ? "no_valid_candidate_difference_after_policy"
              : "calculation_defect"
          : "missing_current_obligation",
        reportClass,
        paymentsBalance,
        correctedCandidate: causeCandidate,
        formerCandidateBalance: correctedCandidate,
        formerNet: formerCandidateDelta,
        net: causeNet,
        historicalExcessAuditOnly: histExcess,
        historicalCreditCarried: 0,
        forwardCredit: 0,
        dollarBridge: bridge,
        genuineBusinessDecision: !keepPayments,
      };
      active24.push(row);

      if (row.genuineBusinessDecision) {
        genuineDecisions.push({
          tenantName,
          propertyName,
          propertyAddress,
          accountKey: c.accountKey,
          paymentsBalance,
          correctedCandidate: causeCandidate,
          net: causeNet,
          decisionType: "approve_or_reject_missing_obligations",
          recommendation:
            "approve specific listed missing obligations OR retain current Payments result",
          why: "Active lease; forward missing obligations due by as-of.",
          proposedMissing: missingOnActive.proposedMissing,
          totalProposedMissingAmount: missingOnActive.totalProposedMissingAmount,
          dollarBridge: bridge,
          billyDecision: "",
          billyNotes: "",
        });
      }
    }
  }

  // Deduplicate genuine decisions
  const gdMap = new Map();
  for (const d of genuineDecisions) {
    if (!gdMap.has(d.accountKey)) gdMap.set(d.accountKey, d);
  }
  const genuineQueue = [...gdMap.values()].sort(
    (a, b) => Math.abs(b.net) - Math.abs(a.net),
  );

  // Verify no unexplained in queue
  let unexplainedTotal = 0;
  for (const d of genuineQueue) {
    if (d.dollarBridge && Math.abs(d.dollarBridge.unexplainedAmount) > 0.009) {
      unexplainedTotal = round2(
        unexplainedTotal + d.dollarBridge.unexplainedAmount,
      );
    }
  }
  if (Math.abs(unexplainedTotal) > 0.009) {
    throw new Error(`Unexplained amount in decision queue: ${unexplainedTotal}`);
  }

  const byType = {};
  for (const d of genuineQueue) {
    const t = d.decisionType || "other";
    if (!byType[t]) byType[t] = { count: 0, netImpact: 0 };
    byType[t].count += 1;
    byType[t].netImpact = round2(byType[t].netImpact + d.net);
  }

  const approvedMissingTotal = round2(
    missingReviews.reduce((s, m) => s + (m.approvedMissingAmount || 0), 0),
  );
  const resolvedMissing = missingReviews.filter((m) => m.status === "resolved");

  const summary = {
    generatedAt: new Date().toISOString(),
    asOfDate: AS_OF,
    queueStatus: queueCompleteBanner,
    outstandingDecisionAccounts: genuineQueue.length,
    approvedMissingObligationsTotal: approvedMissingTotal,
    liveWrites: 0,
    candidateDisabledForUi: true,
    historicalCreditCarried: 0,
    forwardCredit: 0,
    unexplainedAmount: unexplainedTotal,
    paymentsSourceOfTruth: "Current Payments (as-of filtered) — Billy approved",
    futureDatedCompletedPayments: {
      class: "future_dated_completed_payment_excluded",
      count: partitioned.excludedCount,
      total: partitioned.excludedAmount,
      permanentlyDeleted: false,
      excludedFromEveryAsOfCalculation: true,
      sample: partitioned.excludedFuture.slice(0, 20).map((x) => ({
        id: x.payment.id,
        date: toDate(x.payment.payment_date),
        amount: money(x.payment.amount),
      })),
    },
    paymentConservation: {
      uniqueCompletedPaymentCount: paymentAudit.uniqueCompletedPaymentCount,
      uniqueCompletedPaymentTotal: paymentAudit.uniqueCompletedPaymentTotal,
    },
    allocationFive: {
      count: allocationHealth.length,
      remainAtBaseline: allocationHealth.filter((a) => a.remainAtPaymentsBaseline)
        .length,
      accounts: allocationHealth,
    },
    missingObligationAccounts: {
      proposedGapAccounts: missingReviews.filter(
        (m) => m.totalProposedMissingAmount > 0.009,
      ).length,
      approvedMissingTotal: approvedMissingTotal,
      resolvedCount: resolvedMissing.length,
      outstandingCount: missingReviews.filter((m) => m.status !== "resolved")
        .length,
      accounts: missingReviews,
    },
    activeThrough2030: {
      count: active24.length,
      classification: "current_active_lease",
      returnedToPaymentsParity: active24.filter(
        (a) => a.reportClass === "no_current_correction_after_policy",
      ).length,
      genuineRemainingDifference: active24.filter(
        (a) => a.genuineBusinessDecision,
      ).length,
      accounts: active24,
    },
    finalDecisionQueue: {
      count: genuineQueue.length,
      banner: queueCompleteBanner,
      totalNetBalanceImpact: round2(
        genuineQueue.reduce((s, d) => s + d.net, 0),
      ),
      byDecisionType: byType,
      rows: genuineQueue,
      resolvedMissingAccounts: resolvedMissing.map((m) => ({
        tenant: m.tenantName,
        property: m.propertyName,
        approvedMissingAmount: m.approvedMissingAmount,
        billyDecision: m.billyDecision,
        dataFlags: m.dataFlags,
        rejectedDueDates: (m.rejectedRows || []).map((r) => r.dueDate),
      })),
    },
    historicalExcessRetainedForAuditOnly: totalHistExcessAudit,
    privateReportPaths: [
      "local-private/final-accounting-decisions.html",
      "local-private/final-accounting-decisions.csv",
      "local-private/final-accounting-decisions-copy-paste.txt",
      "local-private/final-accounting-decisions-summary.json",
    ],
  };

  writeFileSync(
    join(OUT, "final-accounting-decisions-summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  // CSV
  const csvRows = [
    [
      "section",
      "tenant",
      "property",
      "address",
      "decision_type",
      "payments_balance",
      "candidate_balance",
      "net",
      "amount_involved",
      "recommendation",
      "billy_decision",
      "billy_notes",
    ].join(","),
  ];
  for (const d of genuineQueue) {
    csvRows.push(
      [
        "genuine_decision",
        csvEscape(d.tenantName),
        csvEscape(d.propertyName),
        csvEscape(d.propertyAddress),
        csvEscape(d.decisionType),
        d.paymentsBalance,
        d.correctedCandidate,
        d.net,
        d.totalProposedMissingAmount ?? Math.abs(d.net),
        csvEscape(d.recommendation),
        "",
        "",
      ].join(","),
    );
  }
  for (const a of active24.filter(
    (x) => x.reportClass === "no_current_correction_after_policy",
  )) {
    csvRows.push(
      [
        "active_parity_no_decision",
        csvEscape(a.tenantName),
        csvEscape(a.propertyName),
        csvEscape(a.propertyAddress),
        "no_current_correction_after_policy",
        a.paymentsBalance,
        a.correctedCandidate,
        a.net,
        "",
        "retain current Payments result",
        "",
        "",
      ].join(","),
    );
  }
  for (const m of resolvedMissing) {
    csvRows.push(
      [
        "resolved_missing_obligation",
        csvEscape(m.tenantName),
        csvEscape(m.propertyName),
        csvEscape(m.propertyAddress),
        "resolved_retain_payments",
        m.paymentsBalance,
        m.candidateBalance,
        m.netDifference,
        m.approvedMissingAmount,
        "retain current Payments result",
        csvEscape(m.billyDecision),
        csvEscape(m.billyNotes),
      ].join(","),
    );
  }
  writeFileSync(
    join(OUT, "final-accounting-decisions.csv"),
    csvRows.join("\n"),
    "utf8",
  );

  // Copy-paste
  const txt = [];
  txt.push(
    queueCompleteBanner,
    `FINAL ACCOUNTING DECISIONS — as-of ${AS_OF}`,
    `Outstanding decision accounts: ${genuineQueue.length}`,
    `Approved missing obligations total: $${approvedMissingTotal.toFixed(2)}`,
    `Future-dated completed payments excluded: ${partitioned.excludedCount} / $${partitioned.excludedAmount.toFixed(2)}`,
    `Active-24 parity: ${active24.filter((a) => a.reportClass === "no_current_correction_after_policy").length}`,
    `Historical credit carried: $0`,
    `Forward credit: $0`,
    `Unexplained: $${unexplainedTotal.toFixed(2)}`,
    "",
  );
  if (genuineQueue.length === 0) {
    txt.push(
      "No unresolved accounts remain. Billy-resolved missing-obligation accounts are not in the decision queue.",
      "",
    );
  }
  genuineQueue.forEach((d, i) => {
    txt.push(
      `DECISION ${i + 1} OF ${genuineQueue.length}`,
      `Tenant: ${d.tenantName}`,
      `Property: ${d.propertyName}`,
      `Address: ${d.propertyAddress || ""}`,
      `Current Payments balance: $${Number(d.paymentsBalance).toFixed(2)}`,
      `Corrected candidate balance: $${Number(d.correctedCandidate).toFixed(2)}`,
      `Net difference: $${Number(d.net).toFixed(2)}`,
      `Decision type: ${d.decisionType}`,
      `Cursor recommendation: ${d.recommendation}`,
      `Why: ${d.why || ""}`,
      d.dueDates ? `Due dates: ${d.dueDates.join(", ")}` : null,
      d.proposedMissing
        ? `Missing rows:\n${d.proposedMissing
            .map(
              (r) =>
                `  - ${r.dueDate} | ${r.periodStart}→${r.periodEnd} | $${r.rentAmount} | ${r.cadence} | ${r.reason}`,
            )
            .join("\n")}`
        : null,
      `Dollar bridge: ${JSON.stringify(d.dollarBridge?.lines || d.dollarBridge, null, 2)}`,
      `Billy Decision:`,
      `Billy Notes:`,
      "",
      "----------------------------------------",
      "",
    );
  });
  txt.push("", "=== RESOLVED MISSING OBLIGATIONS (not in queue) ===", "");
  for (const m of resolvedMissing) {
    txt.push(
      `${m.tenantName} — ${m.propertyName}`,
      `Status: resolved · approvedMissingAmount: $${Number(m.approvedMissingAmount).toFixed(2)}`,
      `Billy Decision: ${m.billyDecision}`,
      `Billy Notes: ${m.billyNotes || "(none)"}`,
      `Data flags: ${(m.dataFlags || []).join("; ") || "(none)"}`,
      `Rejected dues: ${(m.rejectedRows || []).map((r) => r.dueDate).join(", ") || "(none)"}`,
      `Payments retained: $${m.paymentsBalance.toFixed(2)}`,
      "",
    );
  }
  txt.push("", "=== MISSING OBLIGATION DETAIL ===", "");
  for (const m of missingReviews) {
    txt.push(
      `${m.tenantName} — ${m.propertyName}`,
      `Status: ${m.status}`,
      `Stored rent/cadence: $${m.storedRent} / ${m.storedCadence} due_day=${m.rentDueDay}`,
      `Last real invoice: ${m.lastRealInvoiceDate}`,
      `Sanity: ${m.sanityNotes.join("; ") || "(none)"}`,
      `totalProposedMissingAmount: $${m.totalProposedMissingAmount.toFixed(2)}`,
      `approvedMissingAmount: $${Number(m.approvedMissingAmount).toFixed(2)}`,
      `Payments balance: $${m.paymentsBalance.toFixed(2)} | candidate: $${m.candidateBalance.toFixed(2)} | net: $${m.netDifference.toFixed(2)}`,
      m.billyDecision ? `Billy Decision: ${m.billyDecision}` : null,
    );
    for (const r of m.proposedMissing) {
      txt.push(
        `  - lease ${r.leaseId} due ${r.dueDate} period ${r.periodStart}→${r.periodEnd} amt $${r.rentAmount} ${r.cadence} rule=${r.periodAnchorOrDueDayRule} class=${r.periodClass} affects=${r.affectsBalanceAsOf} reason=${r.reason}`,
      );
    }
    if (!m.proposedMissing.length) txt.push("  (no current missing obligations)");
    txt.push("");
  }
  writeFileSync(
    join(OUT, "final-accounting-decisions-copy-paste.txt"),
    txt.filter((x) => x != null).join("\n"),
    "utf8",
  );

  // HTML
  const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>Final Accounting Decisions — ${AS_OF}</title>
<style>
 body{font-family:Georgia,serif;margin:0;background:#f7f5f0;color:#1a1a1a}
 header{background:#1e3a5f;color:#fff;padding:1.25rem 1.75rem}
 .wrap{max-width:1000px;margin:0 auto;padding:1.25rem}
 .card{background:#fff;border:1px solid #c8c2b6;padding:1rem;margin:1rem 0}
 .banner{background:#e8f0fe;padding:.75rem;margin:1rem 0}
 table{border-collapse:collapse;width:100%;margin:.5rem 0;font-size:.9rem}
 th,td{border:1px solid #ddd;padding:.35rem .5rem;text-align:left}
 .boxes{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin:.75rem 0}
 .boxes label{background:#fff;border:1px solid #ccc;padding:.5rem;min-height:2.5rem}
</style></head><body>
<header><h1>Final Accounting Decisions</h1>
<p>As-of ${AS_OF} · Payments source of truth · Candidate DISABLED_FOR_UI · No live writes</p></header>
<div class="wrap">
<div class="banner" style="background:${genuineQueue.length === 0 ? "#d4edda" : "#e8f0fe"};border:1px solid ${genuineQueue.length === 0 ? "#28a745" : "#90b4e0"}">
 <strong>${esc(queueCompleteBanner)}</strong><br/>
 Outstanding decision accounts: <strong>${genuineQueue.length}</strong> ·
 Approved missing obligations: <strong>$${approvedMissingTotal.toFixed(2)}</strong><br/>
 Future-dated completed payments excluded: <strong>${partitioned.excludedCount}</strong> / $${partitioned.excludedAmount.toFixed(2)}
 (class <code>future_dated_completed_payment_excluded</code>)<br/>
 Active-24 parity: <strong>${active24.filter((a) => a.reportClass === "no_current_correction_after_policy").length}</strong> ·
 Historical credit carried: <strong>$0</strong> · Forward credit: <strong>$0</strong> ·
 Unexplained: <strong>$${unexplainedTotal.toFixed(2)}</strong>
</div>

<h2>1. Genuine decision queue (${genuineQueue.length})</h2>
${
  genuineQueue.length === 0
    ? `<p><strong>${esc(queueCompleteBanner)}</strong></p>
       <p>No remaining genuine business decisions. Billy-resolved missing-obligation accounts are not listed as unresolved.</p>`
    : genuineQueue
        .map(
          (d, i) => `<div class="card">
 <h3>${i + 1}. ${esc(d.tenantName)} — ${esc(d.propertyName)}</h3>
 <p>${esc(d.propertyAddress)}</p>
 <p>Payments <strong>$${Number(d.paymentsBalance).toFixed(2)}</strong> →
    Candidate <strong>$${Number(d.correctedCandidate).toFixed(2)}</strong>
    (net $${Number(d.net).toFixed(2)})</p>
 <p>Decision: <code>${esc(d.decisionType)}</code></p>
 <p>Recommendation: ${esc(d.recommendation)}</p>
 <p>${esc(d.why || "")}</p>
 ${
   d.proposedMissing?.length
     ? `<table><tr><th>Due</th><th>Period</th><th>Amount</th><th>Cadence</th><th>Reason</th></tr>
        ${d.proposedMissing
          .map(
            (r) =>
              `<tr><td>${esc(r.dueDate)}</td><td>${esc(r.periodStart)}→${esc(r.periodEnd)}</td><td>$${r.rentAmount.toFixed(2)}</td><td>${esc(r.cadence)}</td><td>${esc(r.reason)}</td></tr>`,
          )
          .join("")}
        <tr><th colspan="2">totalProposedMissingAmount</th><th>$${Number(d.totalProposedMissingAmount).toFixed(2)}</th><th colspan="2"></th></tr>
      </table>`
     : ""
 }
 <pre>${esc(JSON.stringify(d.dollarBridge?.lines || d.dollarBridge, null, 2))}</pre>
 <div class="boxes"><label>Billy Decision:</label><label>Billy Notes:</label></div>
</div>`,
        )
        .join("")
}

<h2>2. Resolved missing-obligation accounts (${resolvedMissing.length})</h2>
${
  resolvedMissing.length === 0
    ? "<p>None.</p>"
    : resolvedMissing
        .map(
          (m) => `<div class="card">
 <h3>${esc(m.tenantName)} — ${esc(m.propertyName)} <em>(resolved — not in queue)</em></h3>
 <p>Approved missing: <strong>$${Number(m.approvedMissingAmount).toFixed(2)}</strong> · Payments retained: $${m.paymentsBalance.toFixed(2)}</p>
 <p>${esc(m.billyDecision || "")}</p>
 <p>Flags: ${(m.dataFlags || []).map(esc).join(" · ") || "(none)"}</p>
 <p>Rejected: ${(m.rejectedRows || []).map((r) => esc(r.dueDate)).join(", ") || "(none)"}</p>
</div>`,
        )
        .join("")
}

<h2>3. Missing-obligation reviews</h2>
${missingReviews
  .map(
    (m) => `<div class="card">
 <h3>${esc(m.tenantName)} — ${esc(m.propertyName)} · <code>${esc(m.status)}</code></h3>
 <p>Stored: $${m.storedRent} / ${esc(m.storedCadence)} due_day=${m.rentDueDay}
    · Last invoice: ${esc(m.lastRealInvoiceDate)}</p>
 <p>${m.sanityNotes.map(esc).join(" · ") || ""}</p>
 <p>Payments $${m.paymentsBalance.toFixed(2)} · Candidate $${m.candidateBalance.toFixed(2)} · Net $${m.netDifference.toFixed(2)}</p>
 <p>Proposed: <strong>$${m.totalProposedMissingAmount.toFixed(2)}</strong> · Approved: <strong>$${Number(m.approvedMissingAmount).toFixed(2)}</strong></p>
 ${m.billyDecision ? `<p>Billy: ${esc(m.billyDecision)}</p>` : ""}
 ${
   m.proposedMissing.length
     ? `<table><tr><th>Lease</th><th>Due</th><th>Period</th><th>Amt</th><th>Cadence</th><th>Rule</th><th>Class</th><th>Affects</th></tr>
        ${m.proposedMissing
          .map(
            (r) =>
              `<tr><td>${esc(r.leaseId.slice(0, 8))}…</td><td>${esc(r.dueDate)}</td><td>${esc(r.periodStart)}→${esc(r.periodEnd)}</td><td>$${r.rentAmount.toFixed(2)}</td><td>${esc(r.cadence)}</td><td>${esc(r.periodAnchorOrDueDayRule)}</td><td>${esc(r.periodClass)}</td><td>${r.affectsBalanceAsOf}</td></tr>`,
          )
          .join("")}
      </table>`
     : "<p><em>No current missing obligations through as-of.</em></p>"
 }
</div>`,
  )
  .join("")}

<h2>4. Active leases through 2030 (${active24.length}) — current_active_lease</h2>
${active24
  .map(
    (a) => `<div class="card">
 <h3>${esc(a.tenantName)} — ${esc(a.propertyName)}</h3>
 <p>Lease ${esc(a.leaseStart)} → ${esc(a.leaseEnd)} · <code>${esc(a.classification)}</code></p>
 <p>Cause: <code>${esc(a.monetaryCause)}</code> · Report: <code>${esc(a.reportClass)}</code></p>
 <p>Payments $${a.paymentsBalance.toFixed(2)} → Candidate $${a.correctedCandidate.toFixed(2)} (net $${a.net.toFixed(2)})</p>
 <p>Hist excess (audit only): $${a.historicalExcessAuditOnly.toFixed(2)} · credit carried $0 · forward $0</p>
 <pre>${esc(JSON.stringify(a.dollarBridge.lines, null, 2))}</pre>
</div>`,
  )
  .join("")}

<h2>5. Allocation five (data health / retain Payments)</h2>
${allocationHealth
  .map(
    (a) => `<div class="card">
 <h3>${esc(a.tenantName)} — ${esc(a.propertyName)}</h3>
 <p>${a.remainAtPaymentsBaseline ? "Keep Payments baseline" : "Eligible allocation decision"} — ${esc(a.recommendation)}</p>
 <p>Future excluded: ${a.futureExcluded.length} payments</p>
 <pre>${esc(JSON.stringify(a.futureExcluded, null, 2))}</pre>
</div>`,
  )
  .join("")}
</div></body></html>`;

  writeFileSync(join(OUT, "final-accounting-decisions.html"), html, "utf8");

  console.log(
    JSON.stringify(
      {
        asOf: AS_OF,
        queueStatus: queueCompleteBanner,
        outstandingDecisionAccounts: genuineQueue.length,
        approvedMissingObligationsTotal: approvedMissingTotal,
        futureExcluded: {
          count: partitioned.excludedCount,
          total: partitioned.excludedAmount,
        },
        resolvedMissingCount: resolvedMissing.length,
        missingAccountsWithGaps: missingReviews.filter(
          (m) => m.totalProposedMissingAmount > 0.009,
        ).length,
        missingDetail: missingReviews.map((m) => ({
          tenant: m.tenantName,
          status: m.status,
          rows: m.proposedMissing.length,
          proposed: m.totalProposedMissingAmount,
          approved: m.approvedMissingAmount,
          dues: m.proposedMissing.map((r) => r.dueDate),
          lastInv: m.lastRealInvoiceDate,
        })),
        active24Parity: active24.filter(
          (a) => a.reportClass === "no_current_correction_after_policy",
        ).length,
        active24RemainingDiff: active24.filter((a) => a.genuineBusinessDecision)
          .length,
        genuineDecisions: genuineQueue.length,
        totalNetImpact: summary.finalDecisionQueue.totalNetBalanceImpact,
        histCredit: 0,
        forwardCredit: 0,
        unexplained: unexplainedTotal,
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
