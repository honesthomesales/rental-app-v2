/**
 * Launch workflow reachability + inventory completeness (no live writes).
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

const root = join(process.cwd());

function walkApi(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkApi(p, acc);
    else if (e.name === "route.ts") acc.push(p);
  }
  return acc;
}

describe("launch workflow + inventory", () => {
  it("21. every API route is in the inventory", () => {
    const inventory = readFileSync(
      join(root, "docs/v3-api-authorization-inventory.md"),
      "utf8",
    );
    const routes = walkApi(join(root, "src/app/api"));
    expect(routes.length).toBeGreaterThan(30);
    for (const f of routes) {
      const rel = f
        .replace(/\\/g, "/")
        .split("src/app")[1]
        .replace(/\/route\.ts$/, "")
        .replace(/\[([^\]]+)\]/g, ":$1");
      expect(inventory).toContain("`" + rel + "`");
    }
  });

  it("pages remain reachable (files exist)", () => {
    const pages = [
      "src/app/page.tsx",
      "src/app/properties/page.tsx",
      "src/app/tenants/page.tsx",
      "src/app/leases/page.tsx",
      "src/app/payments/page.tsx",
      "src/app/late-tenants/page.tsx",
      "src/app/expenses/page.tsx",
      "src/app/profit/page.tsx",
      "src/app/deals/page.tsx",
      "src/app/documents/page.tsx",
      "src/app/last-paid/page.tsx",
      "src/app/login/page.tsx",
      "src/app/data-health/future-payments/page.tsx",
    ];
    for (const p of pages) {
      expect(existsSync(join(root, p))).toBe(true);
    }
  });

  it("24. shadow candidate remains disabled for UI (export gate comment / DISABLED flag)", () => {
    const index = readFileSync(
      join(root, "src/lib/shadow-reconciliation/index.ts"),
      "utf8",
    );
    expect(index.toLowerCase()).toMatch(/disabled_for_ui|do not import/);
  });

  it("missing-invoice preview remains GET / PREVIEW only in payments UI", () => {
    const payments = readFileSync(join(root, "src/app/payments/page.tsx"), "utf8");
    expect(payments).toMatch(/PREVIEW — NOT SAVED|missing-preview/);
    expect(payments).toMatch(/never auto-POST generate-missing/i);
    expect(payments).not.toMatch(/create-approved/);
  });
});
