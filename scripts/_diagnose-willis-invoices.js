/**
 * READ-ONLY: invoice dump for Jayne Long / 100 Willis Bell
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

const LEASE_ID = "78b4a6a5-4e17-436c-9c7c-e6abae6ecb94";

async function main() {
  const { data: invs, error } = await sb
    .from("RENT_invoices")
    .select(
      "id, due_date, period_start, period_end, status, amount_rent, amount_late, amount_other, amount_total, amount_paid, balance_due",
    )
    .eq("lease_id", LEASE_ID)
    .gte("due_date", "2026-06-01")
    .order("due_date");

  console.log(JSON.stringify({ error: error && error.message, invoices: invs }, null, 2));

  const future140 = (invs || []).filter(
    (i) => Number(i.amount_rent) === 140 && i.due_date >= "2026-07-17",
  );
  const future160 = (invs || []).filter(
    (i) => Number(i.amount_rent) === 160 && i.due_date >= "2026-07-17",
  );
  console.log(
    JSON.stringify(
      {
        summary: {
          totalFromJun: (invs || []).length,
          futureOrOnEffectiveStill140: future140.length,
          futureOrOnEffectiveAlready160: future160.length,
          sampleFuture140: future140.slice(0, 5),
          julAugRows: (invs || []).filter(
            (i) => i.due_date >= "2026-07-15" && i.due_date <= "2026-08-15",
          ),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.log(JSON.stringify({ fatal: e.message }));
  process.exit(1);
});
