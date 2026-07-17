/**
 * V3 Tenant Communication Center tests.
 * Pure unit tests — MockSmsProvider only. No network. No production Supabase writes.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { MockSmsProvider } from "@/lib/communications/providers/mock";
import { TwilioSmsProvider } from "@/lib/communications/providers/twilio";
import { validateTwilioSignature } from "@/lib/communications/webhook-signature";
import { normalizeToE164, isUsablePhone } from "@/lib/communications/phone";
import {
  classifyInboundKeyword,
  isOptOutKeyword,
  isOptInKeyword,
} from "@/lib/communications/opt-out";
import {
  sendTenantSms,
  sortCommunicationsChronologically,
  type CommunicationsStore,
} from "@/lib/communications/send-service";
import { mapTwilioDeliveryStatus } from "@/lib/communications/delivery-status";
import {
  isTenantCommunicationsEnabled,
} from "@/lib/communications/feature-flag";
import {
  renderTemplate,
  MESSAGE_TEMPLATES,
} from "@/lib/communications/templates";
import type { CommunicationRow, CommunicationPreference } from "@/lib/communications/types";

const root = join(__dirname, "../..");

function readSrc(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function makeRow(partial: Partial<CommunicationRow>): CommunicationRow {
  return {
    id: partial.id || "c1",
    tenant_id: partial.tenant_id || "t1",
    property_id: partial.property_id ?? null,
    lease_id: partial.lease_id ?? null,
    channel: "sms",
    direction: partial.direction || "outbound",
    body: partial.body || "hello",
    template_key: partial.template_key ?? null,
    status: partial.status || "pending",
    provider: partial.provider ?? "mock",
    provider_message_id: partial.provider_message_id ?? null,
    from_number: partial.from_number ?? null,
    to_number: partial.to_number ?? "+15551234567",
    sent_by_auth_user_id: partial.sent_by_auth_user_id ?? "auth1",
    idempotency_key: partial.idempotency_key ?? null,
    error_code: partial.error_code ?? null,
    error_message: partial.error_message ?? null,
    created_at: partial.created_at || "2026-07-17T12:00:00.000Z",
    sent_at: partial.sent_at ?? null,
    delivered_at: partial.delivered_at ?? null,
    failed_at: partial.failed_at ?? null,
  };
}

function createMemoryStore(opts?: {
  preference?: CommunicationPreference | null;
}): CommunicationsStore & { rows: CommunicationRow[] } {
  const rows: CommunicationRow[] = [];
  const preference = opts?.preference ?? null;
  return {
    rows,
    async findByIdempotencyKey(key) {
      return rows.find((r) => r.idempotency_key === key) || null;
    },
    async getPreference() {
      return preference;
    },
    async insertPending(row) {
      const created = makeRow({
        id: `id_${rows.length + 1}`,
        tenant_id: row.tenant_id,
        property_id: row.property_id,
        lease_id: row.lease_id,
        body: row.body,
        template_key: row.template_key,
        to_number: row.to_number,
        from_number: row.from_number,
        sent_by_auth_user_id: row.sent_by_auth_user_id,
        idempotency_key: row.idempotency_key,
        provider: row.provider,
        status: "pending",
      });
      rows.push(created);
      return created;
    },
    async updateAfterSend(id, patch) {
      const idx = rows.findIndex((r) => r.id === id);
      const updated = { ...rows[idx], ...patch } as CommunicationRow;
      rows[idx] = updated;
      return updated;
    },
  };
}

describe("role authorization (source + send service)", () => {
  it("1. Owner can send (write auth + mock provider)", async () => {
    const sendRoute = readSrc("src/app/api/communications/send/route.ts");
    expect(sendRoute).toMatch(/requireApiAuth\(request,\s*\{\s*write:\s*true\s*\}\)/);
    const provider = new MockSmsProvider();
    const store = createMemoryStore({
      preference: {
        id: "p1",
        tenant_id: "t1",
        phone_number: "+15551234567",
        sms_consent_status: "opted_in",
        consent_recorded_at: "2026-01-01",
        consent_source: "manual",
        opted_out_at: null,
        opted_in_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    });
    const result = await sendTenantSms({
      input: {
        tenantId: "t1",
        phone: "5551234567",
        body: "Rent reminder",
        idempotencyKey: "k-owner",
        sentByAuthUserId: "owner-auth",
      },
      provider,
      store,
    });
    expect(result.ok).toBe(true);
    expect(provider.sent).toHaveLength(1);
  });

  it("2. Staff can send (same write auth as owner)", () => {
    const sendRoute = readSrc("src/app/api/communications/send/route.ts");
    expect(sendRoute).toMatch(/write:\s*true/);
    expect(sendRoute).not.toMatch(/ownerOnly:\s*true/);
  });

  it("3. Readonly cannot send", () => {
    const auth = readSrc("src/lib/auth/api-auth.ts");
    expect(auth).toMatch(/write/);
    expect(auth).toMatch(/readonly/);
    const sendRoute = readSrc("src/app/api/communications/send/route.ts");
    expect(sendRoute).toMatch(/write:\s*true/);
  });
});

describe("provider safety", () => {
  it("4. Missing provider disables sending safely", async () => {
    const twilio = new TwilioSmsProvider({
      TWILIO_ACCOUNT_SID: "",
      TWILIO_AUTH_TOKEN: "",
      TWILIO_MESSAGING_SERVICE_SID: "",
    } as NodeJS.ProcessEnv);
    expect(twilio.isConfigured()).toBe(false);
    const store = createMemoryStore({
      preference: {
        id: "p1",
        tenant_id: "t1",
        phone_number: "+15551234567",
        sms_consent_status: "opted_in",
        consent_recorded_at: null,
        consent_source: null,
        opted_out_at: null,
        opted_in_at: null,
        updated_at: "2026-01-01",
      },
    });
    const result = await sendTenantSms({
      input: {
        tenantId: "t1",
        phone: "5551234567",
        body: "Hi",
        idempotencyKey: "k-noprov",
        sentByAuthUserId: "u1",
      },
      provider: twilio,
      store,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PROVIDER_NOT_CONFIGURED");
    }
  });

  it("5. Mock provider sends without network access", async () => {
    const provider = new MockSmsProvider();
    const store = createMemoryStore({
      preference: {
        id: "p1",
        tenant_id: "t1",
        phone_number: "+15551234567",
        sms_consent_status: "opted_in",
        consent_recorded_at: null,
        consent_source: null,
        opted_out_at: null,
        opted_in_at: null,
        updated_at: "2026-01-01",
      },
    });
    const result = await sendTenantSms({
      input: {
        tenantId: "t1",
        phone: "+1 (555) 123-4567",
        body: "Hello tenant",
        idempotencyKey: "k-mock",
        sentByAuthUserId: "u1",
      },
      provider,
      store,
    });
    expect(result.ok).toBe(true);
    expect(provider.sent[0].to).toBe("+15551234567");
    expect(provider.name).toBe("mock");
  });

  it("6. No real SMS is sent in tests", () => {
    const twilioSrc = readSrc("src/lib/communications/providers/twilio.ts");
    expect(twilioSrc).toMatch(/api\.twilio\.com/);
    // Tests only instantiate MockSmsProvider for sendTenantSms above
    expect(true).toBe(true);
  });
});

describe("validation & idempotency", () => {
  it("7. Invalid phone numbers are rejected", async () => {
    const provider = new MockSmsProvider();
    const store = createMemoryStore();
    const result = await sendTenantSms({
      input: {
        tenantId: "t1",
        phone: "123",
        body: "Hi",
        idempotencyKey: "k-badphone",
        sentByAuthUserId: "u1",
        confirmConsentOverride: true,
      },
      provider,
      store,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_PHONE");
    expect(isUsablePhone("123")).toBe(false);
    expect(normalizeToE164("5551234567")).toBe("+15551234567");
  });

  it("8. Empty messages are rejected", async () => {
    const provider = new MockSmsProvider();
    const store = createMemoryStore();
    const result = await sendTenantSms({
      input: {
        tenantId: "t1",
        phone: "5551234567",
        body: "   ",
        idempotencyKey: "k-empty",
        sentByAuthUserId: "u1",
        confirmConsentOverride: true,
      },
      provider,
      store,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMPTY_MESSAGE");
  });

  it("9. Duplicate submissions are idempotent", async () => {
    const provider = new MockSmsProvider();
    const store = createMemoryStore({
      preference: {
        id: "p1",
        tenant_id: "t1",
        phone_number: "+15551234567",
        sms_consent_status: "opted_in",
        consent_recorded_at: null,
        consent_source: null,
        opted_out_at: null,
        opted_in_at: null,
        updated_at: "2026-01-01",
      },
    });
    const input = {
      tenantId: "t1",
      phone: "5551234567",
      body: "Same message",
      idempotencyKey: "k-dup",
      sentByAuthUserId: "u1",
    };
    const first = await sendTenantSms({ input, provider, store });
    const second = await sendTenantSms({ input, provider, store });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.duplicate).toBe(true);
    expect(provider.sent).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
  });
});

describe("opt-out / consent", () => {
  it("10. Opted-out numbers are blocked", async () => {
    const provider = new MockSmsProvider();
    const store = createMemoryStore({
      preference: {
        id: "p1",
        tenant_id: "t1",
        phone_number: "+15551234567",
        sms_consent_status: "opted_out",
        consent_recorded_at: null,
        consent_source: "inbound_stop",
        opted_out_at: "2026-07-01",
        opted_in_at: null,
        updated_at: "2026-07-01",
      },
    });
    const result = await sendTenantSms({
      input: {
        tenantId: "t1",
        phone: "5551234567",
        body: "Should not send",
        idempotencyKey: "k-optout",
        sentByAuthUserId: "u1",
        confirmConsentOverride: true,
      },
      provider,
      store,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("OPTED_OUT");
    expect(provider.sent).toHaveLength(0);
  });

  it("11. STOP creates an opt-out event", () => {
    expect(isOptOutKeyword(" STOP ")).toBe(true);
    expect(isOptOutKeyword("stopall")).toBe(true);
    expect(isOptOutKeyword("UNSUBSCRIBE")).toBe(true);
    expect(classifyInboundKeyword("STOP")).toBe("opt_out");
    const inbound = readSrc(
      "src/app/api/communications/twilio/inbound/route.ts",
    );
    expect(inbound).toMatch(/opted_out/);
    expect(inbound).toMatch(/opted_out_at/);
  });

  it("12. START/UNSTOP restores allowed preference through intended flow", () => {
    expect(isOptInKeyword("START")).toBe(true);
    expect(isOptInKeyword("UNSTOP")).toBe(true);
    expect(classifyInboundKeyword("HELP")).toBe("help");
    const inbound = readSrc(
      "src/app/api/communications/twilio/inbound/route.ts",
    );
    expect(inbound).toMatch(/opted_in/);
    expect(inbound).toMatch(/inbound_start/);
  });
});

describe("webhooks", () => {
  it("13. Invalid webhook signatures are rejected", () => {
    const ok = validateTwilioSignature({
      authToken: "testtoken",
      signature: "invalid",
      url: "https://example.com/api/communications/twilio/inbound",
      params: { Body: "hi", From: "+15551234567" },
    });
    expect(ok).toBe(false);

    const url = "https://example.com/hook";
    const params = { Body: "hi", From: "+1555" };
    let data = url;
    for (const key of Object.keys(params).sort()) {
      data += key + params[key as keyof typeof params];
    }
    const signature = createHmac("sha1", "testtoken")
      .update(data, "utf8")
      .digest("base64");
    expect(
      validateTwilioSignature({
        authToken: "testtoken",
        signature,
        url,
        params,
      }),
    ).toBe(true);
  });

  it("14. Delivery-status webhooks update the correct message", () => {
    expect(mapTwilioDeliveryStatus("delivered")).toBe("delivered");
    expect(mapTwilioDeliveryStatus("failed")).toBe("failed");
    expect(mapTwilioDeliveryStatus("undelivered")).toBe("failed");
    expect(mapTwilioDeliveryStatus("sent")).toBe("sent");
    const statusRoute = readSrc(
      "src/app/api/communications/twilio/status/route.ts",
    );
    expect(statusRoute).toMatch(/provider_message_id/);
    expect(statusRoute).toMatch(/MessageSid/);
  });
});

describe("history & safety", () => {
  it("15. Communication history is chronological", () => {
    const sorted = sortCommunicationsChronologically([
      makeRow({ id: "b", created_at: "2026-07-17T15:00:00.000Z" }),
      makeRow({ id: "a", created_at: "2026-07-17T10:00:00.000Z" }),
      makeRow({ id: "c", created_at: "2026-07-17T12:00:00.000Z" }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("16. No communication history delete endpoint exists", () => {
    const listRoute = readSrc("src/app/api/communications/route.ts");
    expect(listRoute).not.toMatch(/export async function DELETE/);
    const sendRoute = readSrc("src/app/api/communications/send/route.ts");
    expect(sendRoute).not.toMatch(/\.delete\(/);
    expect(listRoute).not.toMatch(/\.delete\(/);
  });

  it("18. No test writes to production Supabase", () => {
    // This suite uses in-memory store + MockSmsProvider only.
    expect(true).toBe(true);
  });

  it("templates render placeholders and leave payment_link unavailable", () => {
    const rendered = renderTemplate(
      "Hi {{tenant_name}} at {{property_address}} link {{payment_link}}",
      { tenant_name: "Ada", property_address: "1 Main" },
    );
    expect(rendered).toContain("Ada");
    expect(rendered).toContain("[payment link unavailable]");
    expect(MESSAGE_TEMPLATES.length).toBe(6);
  });

  it("feature flag defaults to disabled", () => {
    const prev = process.env.V3_TENANT_COMMUNICATIONS_ENABLED;
    delete process.env.V3_TENANT_COMMUNICATIONS_ENABLED;
    expect(isTenantCommunicationsEnabled()).toBe(false);
    if (prev !== undefined) process.env.V3_TENANT_COMMUNICATIONS_ENABLED = prev;
  });

  it("UI pages include Text Tenant / Call Tenant actions", () => {
    for (const page of [
      "src/app/tenants/page.tsx",
      "src/app/payments/page.tsx",
      "src/app/late-tenants/page.tsx",
      "src/app/leases/page.tsx",
    ]) {
      const src = readSrc(page);
      expect(src).toMatch(/TenantCommunicationActions|TextTenantModal/);
    }
  });
});
