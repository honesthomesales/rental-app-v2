/**
 * READ-ONLY diagnosis for 100 Willis Bell / Jayne Long via anon key.
 * No writes.
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnv(file) {
  const envPath = path.join(__dirname, "..", file);
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        let v = l.slice(i + 1);
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        return [l.slice(0, i).trim(), v];
      }),
  );
}

const env = { ...loadEnv(".env.local"), ...loadEnv(".env.vercel.diagnosis") };
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const PROPERTY_ID = "85a4acdb-3bd3-4bbb-91d6-1603a336002b"; // 100 Willis Bell

async function main() {
  const { data: leases, error: le } = await sb
    .from("RENT_leases")
    .select(
      "id, rent, rent_cadence, status, lease_start_date, lease_end_date, tenant_id, property_id, updated_at, created_at, rent_effective_date, prior_rent",
    )
    .eq("property_id", PROPERTY_ID)
    .order("updated_at", { ascending: false });

  if (le) {
    // retry without optional columns
    const { data: leases2, error: le2 } = await sb
      .from("RENT_leases")
      .select(
        "id, rent, rent_cadence, status, lease_start_date, lease_end_date, tenant_id, property_id, updated_at, created_at",
      )
      .eq("property_id", PROPERTY_ID)
      .order("updated_at", { ascending: false });
    console.log(JSON.stringify({ leaseSelectNote: le.message, leases: leases2, leaseError2: le2 && le2.message }, null, 2));
    if (le2 || !(leases2 || []).length) return;
    await dumpLease(leases2);
    return;
  }

  console.log(JSON.stringify({ leases }, null, 2));
  await dumpLease(leases || []);
}

async function dumpLease(leases) {
  const tenantIds = [...new Set(leases.map((l) => l.tenant_id).filter(Boolean))];
  const { data: tenants, error: te } = await sb
    .from("RENT_tenants")
    .select("id, full_name, first_name, last_name")
    .in("id", tenantIds);
  console.log(JSON.stringify({ tenants, tenantError: te && te.message }, null, 2));

  const tmap = Object.fromEntries((tenants || []).map((t) => [t.id, t]));
  const enriched = leases.map((l) => ({ ...l, tenant: tmap[l.tenant_id] }));
  const jayne =
    enriched.find((l) =>
      `${l.tenant?.full_name || ""} ${l.tenant?.first_name || ""} ${l.tenant?.last_name || ""}`
        .toLowerCase()
        .includes("jayne"),
    ) ||
    enriched.find((l) => Number(l.rent) === 160) ||
    enriched.find((l) => String(l.status).toLowerCase() === "occupied") ||
    enriched[0];

  console.log(JSON.stringify({ selected: jayne }, null, 2));
  if (!jayne) return;

  const { data: invs, error: ie } = await sb
    .from("RENT_invoices")
    .select(
      "id, due_date, period_start, period_end, status, amount_rent, amount_late, amount_other, amount_total, amount_paid, balance_due, updated_at",
    )
    .eq("lease_id", jayne.id)
    .gte("due_date", "2026-06-01")
    .order("due_date");

  console.log(JSON.stringify({ invoiceError: ie && ie.message, invoices: invs }, null, 2));

  // Probe whether RPC exists (nonexistent lease — should not mutate real data)
  const { data: rpcData, error: rpcErr } = await sb.rpc("rent_apply_prospective_change", {
    p_lease_id: "00000000-0000-0000-0000-000000000000",
    p_new_rent: 0,
    p_effective_date: "2099-01-01",
    p_business_date: "2026-07-17",
  });
  console.log(
    JSON.stringify({
      rpcProbe: {
        data: rpcData,
        error: rpcErr
          ? { message: rpcErr.message, code: rpcErr.code, details: rpcErr.details, hint: rpcErr.hint }
          : null,
      },
    }, null, 2),
  );
}

main().catch((e) => {
  console.log(JSON.stringify({ fatal: e.message }));
  process.exit(1);
});
