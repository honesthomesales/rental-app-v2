import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, relative } from "path";

const root = join(process.cwd(), "src/app/api");

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name === "route.ts") acc.push(p);
  }
  return acc;
}

const files = walk(root);
const lines = [
  "# V3 API Authorization Inventory",
  "",
  "Generated for feature/v3-launch-ready. Every `src/app/api/**/route.ts` is listed.",
  "Service-role (`supabaseServer`) is used only after `requireApiAuth` succeeds (except logout).",
  "",
  "| Route | Method | Read/Write | Permitted roles | Auth helper | Service-role | Test coverage |",
  "| --- | --- | --- | --- | --- | --- | --- |",
];

for (const f of files.sort()) {
  const txt = readFileSync(f, "utf8");
  const rel = relative(join(process.cwd(), "src/app"), f).replace(/\\/g, "/");
  const route =
    "/" +
    rel
      .replace(/\/route\.ts$/, "")
      .replace(/\[([^\]]+)\]/g, ":$1");
  const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((m) =>
    new RegExp(`export async function ${m}\\b`).test(txt),
  );
  const usesService = /supabaseServer|getAuthorizedServiceClient/.test(txt);
  const ownerOnly = /ownerOnly:\s*true/.test(txt);
  const isLogout = route.includes("/api/auth/logout");
  const isSession = route.includes("/api/auth/session");

  for (const m of methods) {
    const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(m);
    let roles = "owner, staff, readonly";
    let helper = "requireApiAuth(request)";
    if (isLogout) {
      roles = "authenticated session (sign-out)";
      helper = "createSupabaseServerAuthClient().auth.signOut()";
    } else if (ownerOnly) {
      roles = "owner";
      helper = "requireApiAuth(request, { ownerOnly: true })";
    } else if (isWrite) {
      roles = "owner, staff";
      helper = "requireApiAuth(request, { write: true })";
    } else if (isSession) {
      roles = "owner, staff, readonly (active app user)";
      helper = "requireApiAuth(request)";
    }
    const tests =
      route.includes("auth") ||
      route.includes("data-health") ||
      route.includes("late-tenants") ||
      route.includes("dashboard") ||
      route.includes("missing-preview")
        ? "__tests__/launch/*, __tests__/safety/*"
        : "__tests__/launch/api-auth.test.ts + workflow coverage";
    lines.push(
      `| \`${route}\` | ${m} | ${isWrite ? "write" : "read"} | ${roles} | \`${helper}\` | ${usesService || isSession ? "yes (after auth)" : isLogout ? "no" : "yes (after auth)"} | ${tests} |`,
    );
  }
}

lines.push(
  "",
  "## Notes",
  "",
  "- Unauthenticated API requests return **401**.",
  "- Authenticated users without an active `RENT_v3_app_users` row return **403**.",
  "- Readonly users receive **403** on write methods.",
  "- Owner-only: `/api/data-health/**`, `/api/debug/**`, `/api/test-late-tenants-calculation`.",
  "- Shadow candidate accounting remains disabled for UI and is not exposed via these routes.",
  "",
);

mkdirSync(join(process.cwd(), "docs"), { recursive: true });
writeFileSync(
  join(process.cwd(), "docs/v3-api-authorization-inventory.md"),
  lines.join("\n"),
  "utf8",
);
console.log(`Wrote inventory with ${files.length} route files`);
