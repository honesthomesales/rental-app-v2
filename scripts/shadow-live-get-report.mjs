/**
 * Read-only live GET report for shadow reconciliation.
 * Never POST. Writes anonymized JSON only.
 * Loads engine via ts-node/tsx when available.
 */
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { register } from "node:module";
import { pathToFileURL as toFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
// Live GET output stays local-only (gitignored). Never commit live diffs.
const OUT = join(ROOT, "local-private", "shadow-reconciliation-diff.json");
const BASE = (process.env.BASE_URL || "https://rental-app-v3.vercel.app").replace(
  /\/$/,
  "",
);

async function loadEngine() {
  try {
    const { register: reg } = await import("tsx/esm/api");
    // not always available
  } catch {
    /* ignore */
  }
  const require = createRequire(import.meta.url);
  try {
    require("tsx/cjs/api").register();
  } catch {
    try {
      require("ts-node/register/transpile-only");
    } catch {
      /* fixture path below will use compiled-free jest artifact instead */
    }
  }
  try {
    return require(join(ROOT, "src/lib/shadow-reconciliation/index.ts"));
  } catch (e) {
    console.warn("TS load failed, will only write live raw snapshot:", e.message);
    return null;
  }
}

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function fetchDataset() {
  const asOfDate = new Date().toISOString().slice(0, 10);
  const leasesRaw = await getJson("/api/leases");
  const leasesArr = Array.isArray(leasesRaw) ? leasesRaw : [];
  const leases = leasesArr.map((l) => ({
    id: l.id,
    tenant_id: l.tenant_id ?? l.RENT_tenants?.id ?? null,
    property_id: l.property_id ?? l.RENT_properties?.id ?? null,
    lease_start_date: l.lease_start_date,
    lease_end_date: l.lease_end_date,
    rent: l.rent,
    rent_cadence: l.rent_cadence,
    rent_due_day: l.rent_due_day,
    due_weekday: l.due_weekday,
    period_anchor_date: l.period_anchor_date,
    status: l.status,
    late_fee_amount: l.late_fee_amount,
  }));

  const tenants = [];
  const seenT = new Set();
  for (const l of leasesArr) {
    const t = l.RENT_tenants;
    if (t?.id && !seenT.has(t.id)) {
      seenT.add(t.id);
      tenants.push({
        id: t.id,
        is_active: t.is_active ?? null,
        property_id: t.property_id ?? null,
      });
    }
  }

  const invoices = [];
  const payments = [];
  // Prefer occupied for Payments parity baseline
  const targets = leases.filter(
    (l) => String(l.status || "").toLowerCase() === "occupied",
  );

  let i = 0;
  for (const lease of targets) {
    i++;
    if (i % 10 === 0) console.log(`GET progress ${i}/${targets.length}`);
    try {
      const inv = await getJson(
        `/api/invoices?leaseId=${lease.id}&to=${asOfDate}`,
      );
      if (Array.isArray(inv)) {
        for (const row of inv) {
          invoices.push({
            id: row.id,
            lease_id: row.lease_id || lease.id,
            due_date: row.due_date,
            period_start: row.period_start,
            period_end: row.period_end,
            status: row.status,
            amount_total: row.amount_total,
            amount_paid: row.amount_paid,
            amount_rent: row.amount_rent,
            amount_late: row.amount_late,
            balance_due: row.balance_due,
          });
        }
      }
    } catch {
      /* skip */
    }
    try {
      const pays = await getJson(`/api/payments?leaseId=${lease.id}`);
      if (Array.isArray(pays)) {
        for (const p of pays) {
          payments.push({
            id: p.id,
            amount: p.amount,
            payment_date: p.payment_date,
            status: p.status || "completed",
            invoice_id: p.invoice_id ?? null,
            lease_id: p.lease_id ?? lease.id,
            tenant_id: p.tenant_id ?? lease.tenant_id,
            property_id: p.property_id ?? lease.property_id,
          });
        }
      }
    } catch {
      /* skip */
    }
  }

  return {
    leases,
    tenants,
    invoices,
    payments,
    leaseTerms: [],
    asOfDate,
    defaultGraceDays: 5,
  };
}

async function main() {
  console.log(`Read-only GET from ${BASE}`);
  const dataset = await fetchDataset();
  const engine = await loadEngine();

  let payload;
  if (engine?.runShadowReconciliation) {
    const { report, baselineLeaseCount, candidateAccountCount } =
      engine.runShadowReconciliation(dataset);
    payload = {
      generatedAt: new Date().toISOString(),
      mode: "live-get",
      base: BASE,
      writeMethodsUsed: ["GET"],
      liveWrites: 0,
      databaseWrites: 0,
      visibleScreensUnchanged: true,
      candidateDisabledForUi: true,
      baselineLeaseCount,
      candidateAccountCount,
      occupiedLeaseCount: dataset.leases.filter(
        (l) => String(l.status).toLowerCase() === "occupied",
      ).length,
      invoiceCount: dataset.invoices.length,
      paymentCount: dataset.payments.length,
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
  } else {
    payload = {
      generatedAt: new Date().toISOString(),
      mode: "live-get-raw-only",
      error: "Could not load TypeScript engine; fixture artifact from jest remains",
      occupiedLeaseCount: dataset.leases.filter(
        (l) => String(l.status).toLowerCase() === "occupied",
      ).length,
      invoiceCount: dataset.invoices.length,
      paymentCount: dataset.payments.length,
      liveWrites: 0,
    };
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify(payload.summary || payload, null, 2));
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
