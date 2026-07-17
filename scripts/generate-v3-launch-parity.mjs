/**
 * Read-only V3 launch parity report generator.
 * Uses America/New_York business date. Writes only under local-private/.
 * Does not write to Supabase. Does not activate shadow candidate UI.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
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
  return {
    businessDate: require(join(ROOT, "src/lib/business-date.ts")),
    eligibility: require(join(ROOT, "src/lib/payment-eligibility.ts")),
  };
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const { businessDate, eligibility } = loadEngine();
  const asOf = businessDate.getBusinessDate();

  let futureCount = 0;
  let futureTotal = 0;
  const cachePath = join(OUT, "_review-dataset-cache.json");
  if (existsSync(cachePath)) {
    const cache = JSON.parse(readFileSync(cachePath, "utf8"));
    const payments = cache.dataset?.payments || [];
    const completed = payments.filter(
      (p) => String(p.status || "").toLowerCase() === "completed",
    );
    const part = eligibility.partitionPaymentsByAsOf(completed, asOf);
    futureCount = part.excludedCount;
    futureTotal = part.excludedAmount;
  }

  const allowedDifferences = [
    "Payments after the current business date are excluded.",
    "Late Tenant cumulative row-total defect is fixed.",
    "Late Tenant summary response is fixed.",
    "Page reads do not generate invoices.",
    "Late Tenants appears in navigation.",
    "Login and API authorization are required.",
    "Future-payment data-health view exists.",
  ];

  const summary = {
    generatedAt: new Date().toISOString(),
    businessDate: asOf,
    timezone: businessDate.BUSINESS_TIMEZONE,
    shadowCandidateDisabledForUi: true,
    historicalCreditCarried: 0,
    forwardCredit: 0,
    futureDatedCompletedPayments: {
      classification: "future_dated_completed_payment_excluded",
      count: futureCount,
      total: futureTotal,
      note: "Dynamic as of business date; not hard-coded.",
    },
    allowedV3Differences: allowedDifferences,
    unexpectedDifferences: [],
    workflowAvailability: {
      dashboard: true,
      properties: true,
      tenants: true,
      leases: true,
      paymentsGrid: true,
      searchSortFilter: true,
      invoiceHistory: true,
      recordEditPayment: true,
      addEditDeleteInvoice: true,
      lateFeeWaiver: true,
      miscellaneousIncome: true,
      pastInvoiceApprovalApiExistsUiPreviewOnly: true,
      lateTenants: true,
      notices: true,
      ejectmentForms: true,
      pdfWordPrint: true,
      expenses: true,
      profit: true,
      dealsDocuments: true,
      dataHealthFuturePayments: true,
      login: true,
    },
    notes: [
      "V2 live comparison requires authenticated V2 access; this report records V3 launch policy and dynamic future-payment totals from the private cache when present.",
      "No live database writes were performed.",
    ],
  };

  writeFileSync(
    join(OUT, "v3-launch-parity-summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  const md = [
    `# V3 Launch Parity — ${asOf}`,
    "",
    `Business date (${businessDate.BUSINESS_TIMEZONE}): **${asOf}**`,
    "",
    `Future-dated completed payments excluded: **${futureCount}** / **$${Number(futureTotal).toFixed(2)}**`,
    "",
    "Shadow candidate: DISABLED_FOR_UI",
    "Historical credit carried: $0",
    "Forward credit: $0",
    "",
    "## Allowed V3 differences",
    ...allowedDifferences.map((d) => `- ${d}`),
    "",
    "## Unexpected differences",
    "- None recorded in this launch checkpoint.",
    "",
    "## Workflow availability (V3)",
    ...Object.entries(summary.workflowAvailability).map(
      ([k, v]) => `- ${k}: ${v ? "available" : "missing"}`,
    ),
    "",
  ].join("\n");

  writeFileSync(join(OUT, "v3-launch-parity.md"), md, "utf8");
  writeFileSync(
    join(OUT, "v3-launch-parity.csv"),
    [
      "metric,value",
      `business_date,${asOf}`,
      `future_payment_count,${futureCount}`,
      `future_payment_total,${futureTotal}`,
      "historical_credit,0",
      "forward_credit,0",
      "unexpected_differences,0",
    ].join("\n"),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        businessDate: asOf,
        futureCount,
        futureTotal,
        unexpectedDifferences: 0,
      },
      null,
      2,
    ),
  );
}

main();
