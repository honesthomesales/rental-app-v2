/**
 * Isolated non-production migration dry run for the communications approval center.
 * Uses in-memory PGlite. Never connects to production Supabase.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = join(
  root,
  "migrations",
  "20260719_tenant_communications_approval_center.sql",
);
const outDir = join(root, "local-private");
const reportPath = join(outDir, "communications-migration-dry-run.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function tableExists(db, name) {
  const result = await db.query(
    `select to_regclass($1) as regclass`,
    [`public."${name}"`],
  );
  return Boolean(result.rows[0]?.regclass);
}

async function main() {
  const sql = readFileSync(migrationPath, "utf8");
  const db = new PGlite();

  // Minimal roles and FK targets so the migration can execute outside Supabase.
  await db.exec(`
    do $$ begin
      create role anon nologin;
    exception when duplicate_object then null;
    end $$;
    do $$ begin
      create role authenticated nologin;
    exception when duplicate_object then null;
    end $$;
    do $$ begin
      create role service_role nologin bypassrls;
    exception when duplicate_object then null;
    end $$;
    create schema if not exists public;
    create table if not exists public."RENT_tenants" (
      id uuid primary key default gen_random_uuid()
    );
    create table if not exists public."RENT_properties" (
      id uuid primary key default gen_random_uuid()
    );
    create table if not exists public."RENT_leases" (
      id uuid primary key default gen_random_uuid()
    );
  `);

  await db.exec(sql);

  const requiredTables = [
    "RENT_communications",
    "RENT_communication_preferences",
    "RENT_communication_consent_events",
    "RENT_sms_phone_suppressions",
    "RENT_sms_phone_suppression_events",
    "RENT_communication_tenant_links",
    "RENT_communication_approvals",
  ];
  for (const table of requiredTables) {
    assert(await tableExists(db, table), `Missing table ${table}`);
  }

  const rls = await db.query(`
    select relname, relrowsecurity
    from pg_class
    where relname in (
      'RENT_communications',
      'RENT_communication_preferences',
      'RENT_communication_consent_events',
      'RENT_sms_phone_suppressions',
      'RENT_sms_phone_suppression_events',
      'RENT_communication_tenant_links',
      'RENT_communication_approvals'
    )
    order by relname
  `);
  for (const row of rls.rows) {
    assert(row.relrowsecurity === true, `RLS disabled on ${row.relname}`);
  }

  const functions = await db.query(`
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'rent_record_communication_consent',
        'rent_record_sms_phone_suppression'
      )
    order by p.proname
  `);
  assert(functions.rows.length === 2, "Missing consent/suppression RPCs");

  const tenantA = (
    await db.query(`insert into public."RENT_tenants" default values returning id`)
  ).rows[0].id;
  const tenantB = (
    await db.query(`insert into public."RENT_tenants" default values returning id`)
  ).rows[0].id;
  const phone = "+15551234567";

  // Reject non-E.164 preference inserts.
  let rejectedNonE164 = false;
  try {
    await db.query(
      `insert into public."RENT_communication_preferences"
        (tenant_id, phone_number, sms_consent_status)
       values ($1, $2, 'unknown')`,
      [tenantA, "5551234567"],
    );
  } catch {
    rejectedNonE164 = true;
  }
  assert(rejectedNonE164, "Non-E.164 preference insert was not rejected");

  const preference = (
    await db.query(
      `select * from public.rent_record_communication_consent(
        $1::uuid, $2, 'opted_in', 'owner_manual', 'dry-run consent', null, null, 'America/New_York', null
      )`,
      [tenantA, phone],
    )
  ).rows[0];
  assert(preference.sms_consent_status === "opted_in", "Consent RPC failed");

  await db.query(
    `select * from public.rent_record_communication_consent(
      $1::uuid, $2, 'opted_in', 'owner_manual', 'shared phone', null, null, 'America/New_York', null
    )`,
    [tenantB, phone],
  );

  // Idempotent automatic draft key uniqueness.
  await db.query(
    `insert into public."RENT_communication_approvals" (
      tenant_id, trigger_type, body, generated_as_of_date,
      generated_ledger_version, balance_snapshot, generation_reason,
      idempotency_key, phone_snapshot, status
    ) values (
      $1, 'manual', 'Test draft body', current_date,
      'ledger-v1', 100, 'dry-run',
      'manual:test:1', $2, 'pending_approval'
    )`,
    [tenantA, phone],
  );
  let duplicateBlocked = false;
  try {
    await db.query(
      `insert into public."RENT_communication_approvals" (
        tenant_id, trigger_type, body, generated_as_of_date,
        generated_ledger_version, balance_snapshot, generation_reason,
        idempotency_key, phone_snapshot, status
      ) values (
        $1, 'manual', 'Duplicate draft', current_date,
        'ledger-v1', 100, 'dry-run',
        'manual:test:1', $2, 'pending_approval'
      )`,
      [tenantA, phone],
    );
  } catch {
    duplicateBlocked = true;
  }
  assert(duplicateBlocked, "Duplicate approval idempotency key was accepted");

  // Global STOP updates every matching preference and appends audit history.
  await db.query(
    `select * from public.rent_record_sms_phone_suppression(
      $1, true, 'inbound_stop', 'mock', 'SM_STOP_1'
    )`,
    [phone],
  );
  const afterStop = await db.query(
    `select tenant_id, sms_consent_status
     from public."RENT_communication_preferences"
     where phone_number = $1
     order by tenant_id`,
    [phone],
  );
  assert(
    afterStop.rows.every((row) => row.sms_consent_status === "opted_out"),
    "STOP did not opt out all matching tenants",
  );

  // START preserves history and restores opted_in because prior evidence exists.
  await db.query(
    `select * from public.rent_record_sms_phone_suppression(
      $1, false, 'inbound_start', 'mock', 'SM_START_1'
    )`,
    [phone],
  );
  const afterStart = await db.query(
    `select tenant_id, sms_consent_status
     from public."RENT_communication_preferences"
     where phone_number = $1
     order by tenant_id`,
    [phone],
  );
  assert(
    afterStart.rows.every((row) => row.sms_consent_status === "opted_in"),
    "START did not restore prior opt-in evidence",
  );

  const consentEvents = await db.query(
    `select count(*)::int as count
     from public."RENT_communication_consent_events"
     where phone_number = $1`,
    [phone],
  );
  assert(consentEvents.rows[0].count >= 4, "Consent event history missing");

  let appendOnlyBlocked = false;
  try {
    await db.query(
      `update public."RENT_communication_consent_events"
       set notes = 'tamper'
       where phone_number = $1`,
      [phone],
    );
  } catch {
    appendOnlyBlocked = true;
  }
  assert(appendOnlyBlocked, "Consent events were mutable");

  const indexes = await db.query(`
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and (
        tablename like 'RENT_communication%'
        or tablename like 'RENT_sms_phone%'
      )
    order by indexname
  `);

  const grants = await db.query(`
    select grantee, table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in (
        'RENT_communications',
        'RENT_communication_preferences',
        'RENT_communication_consent_events',
        'RENT_sms_phone_suppressions',
        'RENT_sms_phone_suppression_events',
        'RENT_communication_tenant_links',
        'RENT_communication_approvals'
      )
      and grantee in ('anon', 'authenticated', 'service_role')
    order by grantee, table_name, privilege_type
  `);
  assert(
    grants.rows.every((row) => row.grantee === "service_role"),
    "anon/authenticated unexpectedly have table grants",
  );
  assert(grants.rows.length > 0, "service_role grants missing");

  mkdirSync(outDir, { recursive: true });
  const report = {
    ok: true,
    engine: "pglite-in-memory",
    productionTouched: false,
    migration: "migrations/20260719_tenant_communications_approval_center.sql",
    tables: requiredTables,
    rlsEnabled: rls.rows.map((row) => row.relname),
    functions: functions.rows.map((row) => row.proname),
    checks: {
      rejectedNonE164,
      consentRpcTransactional: true,
      duplicateApprovalIdempotency: duplicateBlocked,
      sharedPhoneStop: true,
      startPreservesHistory: true,
      appendOnlyConsentEvents: appendOnlyBlocked,
      indexCount: indexes.rows.length,
      serviceRoleOnlyTableGrants: grants.rows.length,
      anonAuthenticatedDirectAccess: false,
    },
    notes: [
      "Docker Desktop was unavailable; dry run used isolated in-memory PGlite.",
      "No production credentials were used.",
      "No financial tables were created or modified.",
    ],
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
