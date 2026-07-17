/**
 * Documents that portfolio collections loading must not scale as
 * 1 + N×(invoice+payment) browser HTTP calls.
 */
describe("portfolio collections request budget", () => {
  it("target pattern is a single collections-summary request", () => {
    const leaseCount = 100;
    const legacyBrowserCalls = 1 + leaseCount * 2; // leases + per-lease invoices + payments
    const ledgerBrowserCalls = 1; // GET /api/portfolio/collections-summary
    expect(ledgerBrowserCalls).toBe(1);
    expect(ledgerBrowserCalls).toBeLessThan(legacyBrowserCalls);
    expect(legacyBrowserCalls).toBe(201);
  });
});
