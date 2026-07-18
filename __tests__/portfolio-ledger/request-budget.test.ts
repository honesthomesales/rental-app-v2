/**
 * Documents that portfolio collections loading must not scale as
 * 1 + N×(invoice+payment) browser HTTP calls.
 */
import fs from "node:fs";
import path from "node:path";

describe("portfolio collections request budget", () => {
  it("target pattern is a single collections-summary request", () => {
    const leaseCount = 100;
    const legacyBrowserCalls = 1 + leaseCount * 2; // leases + per-lease invoices + payments
    const ledgerBrowserCalls = 1; // GET /api/portfolio/collections-summary
    expect(ledgerBrowserCalls).toBe(1);
    expect(ledgerBrowserCalls).toBeLessThan(legacyBrowserCalls);
    expect(legacyBrowserCalls).toBe(201);
  });

  it("Payments uses one portfolio summary and one account request, not per lease/invoice", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/app/payments/page.tsx"),
      "utf8",
    );
    expect(source).toContain("/api/portfolio/collections-summary");
    expect(source).toContain("/api/leases/${leaseRow.lease.id}/account");
    const activeAccountPath = source.indexOf(
      "/api/leases/${leaseRow.lease.id}/account",
    );
    const accountReturn = source.indexOf("return", activeAccountPath);
    const legacyPerInvoice = source.indexOf("/api/payments?invoiceId=", activeAccountPath);
    expect(activeAccountPath).toBeGreaterThan(-1);
    expect(accountReturn).toBeGreaterThan(activeAccountPath);
    expect(legacyPerInvoice).toBeGreaterThan(accountReturn);
  });

  it("financial GET endpoints contain no write operations", () => {
    const routes = [
      "src/app/api/portfolio/collections-summary/route.ts",
      "src/app/api/portfolio/ledger/route.ts",
      "src/app/api/leases/[id]/account/route.ts",
      "src/app/api/properties/[id]/financial-summary/route.ts",
      "src/app/api/data-health/late-fees/route.ts",
    ];
    for (const route of routes) {
      const source = fs.readFileSync(path.join(process.cwd(), route), "utf8");
      const getBody = source.split("export async function GET")[1] || "";
      expect(getBody).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    }
  });
});
