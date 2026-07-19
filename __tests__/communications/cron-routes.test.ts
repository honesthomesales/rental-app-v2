import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Cron route GET/POST parity tests.
 * Vercel Cron invokes GET with Authorization: Bearer CRON_SECRET.
 */

const mockGenerate = jest.fn();
const mockListApproved = jest.fn();
const mockProcess = jest.fn();
const mockLoadAccounts = jest.fn();

jest.mock("@/lib/business-date", () => ({
  getBusinessDate: () => "2026-07-18",
}));

jest.mock("@/lib/communications/draft-generator", () => ({
  generateAutomaticCommunicationDrafts: (...args: unknown[]) =>
    mockGenerate(...args),
}));

jest.mock("@/lib/communications/approval-store", () => ({
  listApprovedOrScheduledForDelivery: (...args: unknown[]) =>
    mockListApproved(...args),
}));

jest.mock("@/lib/communications/ledger-facts", () => ({
  loadCommunicationLedgerAccounts: (...args: unknown[]) =>
    mockLoadAccounts(...args),
}));

jest.mock("@/lib/communications/submission", () => ({
  isApprovalDue: () => true,
  processApprovedCommunication: (...args: unknown[]) => mockProcess(...args),
}));

function requestWithAuth(secret: string | null) {
  const headers = new Headers();
  if (secret != null) headers.set("authorization", `Bearer ${secret}`);
  return new Request("https://example.test/api/cron", {
    method: "GET",
    headers,
  });
}

describe("communication cron GET/POST handlers", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    mockGenerate.mockReset();
    mockListApproved.mockReset();
    mockProcess.mockReset();
    mockLoadAccounts.mockReset();
    process.env = { ...originalEnv };
    delete process.env.V3_TENANT_COMMUNICATIONS_ENABLED;
    delete process.env.V3_TENANT_COMMUNICATION_DRAFT_GENERATOR_ENABLED;
    delete process.env.V3_TENANT_COMMUNICATION_SCHEDULED_SENDS_ENABLED;
    delete process.env.COMMUNICATION_DRAFT_CRON_SECRET;
    delete process.env.COMMUNICATION_SEND_CRON_SECRET;
    delete process.env.CRON_SECRET;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("authenticated GET returns disabled no-op when flags are off", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    const { GET: draftsGet } = await import(
      "@/app/api/cron/communication-drafts/route"
    );
    const { GET: sendsGet } = await import(
      "@/app/api/cron/communication-sends/route"
    );

    const draftsRes = await draftsGet(requestWithAuth("test-cron-secret"));
    const draftsBody = await draftsRes.json();
    expect(draftsRes.status).toBe(200);
    expect(draftsBody).toMatchObject({
      ok: true,
      enabled: false,
      created: 0,
      sent: 0,
    });
    expect(mockGenerate).not.toHaveBeenCalled();

    const sendsRes = await sendsGet(requestWithAuth("test-cron-secret"));
    const sendsBody = await sendsRes.json();
    expect(sendsRes.status).toBe(200);
    expect(sendsBody).toMatchObject({
      ok: true,
      enabled: false,
      sent: 0,
    });
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it("unauthenticated GET returns 401", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    const { GET: draftsGet } = await import(
      "@/app/api/cron/communication-drafts/route"
    );
    const { GET: sendsGet } = await import(
      "@/app/api/cron/communication-sends/route"
    );

    const draftsRes = await draftsGet(requestWithAuth(null));
    expect(draftsRes.status).toBe(401);
    const sendsRes = await sendsGet(requestWithAuth(null));
    expect(sendsRes.status).toBe(401);
  });

  it("fails closed with 503 when no cron secret is configured", async () => {
    const { GET: draftsGet } = await import(
      "@/app/api/cron/communication-drafts/route"
    );
    const res = await draftsGet(requestWithAuth("anything"));
    expect(res.status).toBe(503);
  });

  it("authenticated POST still works for manual testing", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    const { POST: draftsPost } = await import(
      "@/app/api/cron/communication-drafts/route"
    );
    const { POST: sendsPost } = await import(
      "@/app/api/cron/communication-sends/route"
    );

    const draftsRes = await draftsPost(
      new Request("https://example.test/api/cron/communication-drafts", {
        method: "POST",
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );
    expect(draftsRes.status).toBe(200);
    expect(await draftsRes.json()).toMatchObject({ enabled: false, created: 0 });

    const sendsRes = await sendsPost(
      new Request("https://example.test/api/cron/communication-sends", {
        method: "POST",
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );
    expect(sendsRes.status).toBe(200);
    expect(await sendsRes.json()).toMatchObject({ enabled: false, sent: 0 });
  });

  it("Vercel-style GET generates drafts when enabled", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.V3_TENANT_COMMUNICATIONS_ENABLED = "true";
    process.env.V3_TENANT_COMMUNICATION_DRAFT_GENERATOR_ENABLED = "true";
    mockGenerate.mockResolvedValue({
      created: 2,
      duplicates: 1,
      eligible: 3,
    });

    const { GET } = await import(
      "@/app/api/cron/communication-drafts/route"
    );
    const res = await GET(requestWithAuth("test-cron-secret"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      created: 2,
      duplicates: 1,
      sent: 0,
    });
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("Vercel-style GET processes due approved sends when enabled", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.V3_TENANT_COMMUNICATIONS_ENABLED = "true";
    process.env.V3_TENANT_COMMUNICATION_SCHEDULED_SENDS_ENABLED = "true";
    mockListApproved.mockResolvedValue([
      {
        id: "a1",
        status: "approved",
        lease_id: null,
        approved_by_auth_user_id: "owner-1",
        approved_at: "2026-07-18T12:00:00Z",
      },
    ]);
    mockProcess.mockResolvedValue({
      kind: "sent",
      draft: { id: "a1", status: "sent" },
      duplicate: false,
    });

    const { GET } = await import(
      "@/app/api/cron/communication-sends/route"
    );
    const res = await GET(requestWithAuth("test-cron-secret"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.sent).toBe(1);
    expect(mockProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedFrom: ["approved", "scheduled"],
        requireExistingApproval: true,
      }),
    );
  });

  it("duplicate GET invocations send exactly once via already_claimed", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.V3_TENANT_COMMUNICATIONS_ENABLED = "true";
    process.env.V3_TENANT_COMMUNICATION_SCHEDULED_SENDS_ENABLED = "true";
    mockListApproved.mockResolvedValue([
      {
        id: "a1",
        status: "approved",
        lease_id: null,
        approved_by_auth_user_id: "owner-1",
        approved_at: "2026-07-18T12:00:00Z",
      },
    ]);
    mockProcess
      .mockResolvedValueOnce({
        kind: "sent",
        draft: { id: "a1", status: "sent" },
        duplicate: false,
      })
      .mockResolvedValueOnce({
        kind: "already_claimed",
        draft: { id: "a1", status: "sent" },
      });

    const { GET } = await import(
      "@/app/api/cron/communication-sends/route"
    );
    const first = await (await GET(requestWithAuth("test-cron-secret"))).json();
    const second = await (await GET(requestWithAuth("test-cron-secret"))).json();
    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(second.alreadyClaimed).toBe(1);
    expect(mockProcess).toHaveBeenCalledTimes(2);
  });

  it("GET never approves pending_approval records", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.V3_TENANT_COMMUNICATIONS_ENABLED = "true";
    process.env.V3_TENANT_COMMUNICATION_SCHEDULED_SENDS_ENABLED = "true";
    // listApprovedOrScheduledForDelivery never returns pending_approval
    mockListApproved.mockResolvedValue([]);

    const { GET } = await import(
      "@/app/api/cron/communication-sends/route"
    );
    const source = readFileSync(
      join(__dirname, "../../src/app/api/cron/communication-sends/route.ts"),
      "utf8",
    );
    expect(source).toContain('allowedFrom: ["approved", "scheduled"]');
    expect(source).toContain("requireExistingApproval: true");
    expect(source).not.toMatch(/allowedFrom:[\s\S]*pending_approval/);
    expect(source).toContain("Never self-approves pending_approval");

    const body = await (await GET(requestWithAuth("test-cron-secret"))).json();
    expect(body.sent).toBe(0);
    expect(mockProcess).not.toHaveBeenCalled();
  });
});

describe("Vercel communication cron schedule", () => {
  it("runs communication-sends daily at 13:00 UTC, not hourly", () => {
    const config = JSON.parse(
      readFileSync(join(__dirname, "../../vercel.json"), "utf8"),
    ) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const sendCron = config.crons.find(
      (cron) => cron.path === "/api/cron/communication-sends",
    );

    expect(sendCron).toEqual({
      path: "/api/cron/communication-sends",
      schedule: "0 13 * * *",
    });
    expect(sendCron?.schedule).not.toBe("0 * * * *");
  });
});
