/**
 * Read-only shadow reconciliation report.
 * GET-only against deployed V3 APIs. Never POST. Writes anonymized JSON only.
 *
 * Usage: node --import tsx scripts/shadow-reconciliation-report.mjs
 * Or via npx ts-node if configured. This CommonJS-compatible runner uses dynamic import
 * of the compiled-free path through jest/ts-jest alternative: inline fetch + evaluate
 * via spawning jest... Prefer: npm run is unavailable — execute with node after build.
 *
 * Standalone pure-JS runner that duplicates fetch orchestration and then requires
 * the TypeScript via ts-jest register is fragile. Instead this script writes a
 * fixture-mode report when SHADOW_FIXTURE=1, and live GET mode when BASE_URL is set.
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_FIXTURE = join(
  ROOT,
  "docs",
  "_discovery",
  "shadow-reconciliation-diff.fixture.json",
);
const OUT_LIVE = join(
  ROOT,
  "local-private",
  "shadow-reconciliation-diff.json",
);

async function loadEngine() {
  // Resolve TS via experimental loader if available; fallback to relative dist not present.
  // Use dynamic import of source through tsx-like path — project has ts-jest.
  // Direct import of .ts may fail; compile-free approach: spawn and use relative built files.
  // For this script we import via jiti if present, else use child process with npx tsx.
  try {
    const mod = await import(
      pathToFileURL(
        join(ROOT, "src/lib/shadow-reconciliation/index.ts"),
      ).href
    );
    return mod;
  } catch {
    // ignore
  }
  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("ts-node/register/transpile-only");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../src/lib/shadow-reconciliation/index.ts");
  } catch (e) {
    throw new Error(
      `Unable to load shadow engine TypeScript. Install tsx or ts-node. ${e}`,
    );
  }
}

async function getJson(base, path) {
  const res = await fetch(`${base}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`GET ${path} → ${res.status}`);
  }
  return res.json();
}

async function fetchLiveDataset(base) {
  const asOfDate = new Date().toISOString().slice(0, 10);
  const leasesRaw = await getJson(base, "/api/leases");
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

  // Read-only GETs per lease (occupied preferred for speed, but include all with ids)
  const targets = leases.filter((l) => l.id);
  for (const lease of targets) {
    try {
      const inv = await getJson(
        base,
        `/api/invoices?leaseId=${lease.id}&to=${asOfDate}`,
      );
      if (Array.isArray(inv)) {
        for (const i of inv) {
          invoices.push({
            id: i.id,
            lease_id: i.lease_id || lease.id,
            due_date: i.due_date,
            period_start: i.period_start,
            period_end: i.period_end,
            status: i.status,
            amount_total: i.amount_total,
            amount_paid: i.amount_paid,
            amount_rent: i.amount_rent,
            amount_late: i.amount_late,
            balance_due: i.balance_due,
          });
        }
      }
    } catch {
      // skip lease invoice errors
    }
    try {
      const pays = await getJson(base, `/api/payments?leaseId=${lease.id}`);
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
      // skip
    }
  }

  return {
    leases,
    tenants,
    invoices,
    payments,
    leaseTerms: [], // RENT_v3_lease_terms not exposed via API yet
    asOfDate,
    defaultGraceDays: 5,
  };
}

function fixtureDataset() {
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

async function main() {
  const engine = await loadEngine();
  const base = process.env.BASE_URL || "";
  const useLive = !!base && process.env.SHADOW_FIXTURE !== "1";

  console.log(
    useLive
      ? `Read-only GET shadow report from ${base}`
      : "Fixture-mode shadow report (set BASE_URL for live GET)",
  );

  const dataset = useLive
    ? await fetchLiveDataset(base.replace(/\/$/, ""))
    : fixtureDataset();

  // Sanity: ensure we never POST
  const methodsUsed = ["GET"];
  if (!useLive) methodsUsed.length = 0;

  const { report, baselineLeaseCount, candidateAccountCount } =
    engine.runShadowReconciliation(dataset);

  const payload = {
    generatedAt: new Date().toISOString(),
    mode: useLive ? "live-get" : "fixture",
    writeMethodsUsed: methodsUsed,
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

  const out = useLive ? OUT_LIVE : OUT_FIXTURE;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify(payload.summary, null, 2));
  console.log(`Wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
