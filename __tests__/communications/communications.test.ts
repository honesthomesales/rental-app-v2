import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isWithinCommunicationWindow,
  nextCommunicationWindow,
  validateApprovalBeforeSend,
} from "@/lib/communications/approval";
import { buildAutomaticDraftCandidate } from "@/lib/communications/draft-generator";
import {
  isCommunicationDraftGeneratorEnabled,
  isCommunicationScheduledSendsEnabled,
  isCommunicationsProviderEnabled,
  isTenantCommunicationsEnabled,
  mayUseMockSmsProvider,
} from "@/lib/communications/feature-flag";
import {
  classifyInboundKeyword,
  isOptInKeyword,
  isOptOutKeyword,
} from "@/lib/communications/opt-out";
import { getSmsProvider } from "@/lib/communications/providers";
import { MockSmsProvider } from "@/lib/communications/providers/mock";
import {
  sendTenantSms,
  type CommunicationsStore,
} from "@/lib/communications/send-service";
import { MESSAGE_TEMPLATES, smsSegmentInfo } from "@/lib/communications/templates";
import type {
  CommunicationApproval,
  CommunicationPreference,
  CommunicationRow,
} from "@/lib/communications/types";
import { validateTwilioSignature } from "@/lib/communications/webhook-signature";
import { isApprovalDue } from "@/lib/communications/submission";
import { isExactE164, normalizeToE164 } from "@/lib/communications/phone";
import type { LedgerAccountSummary } from "@/lib/portfolio-ledger/service";

const root = join(__dirname, "../..");
const readSrc = (rel: string) => readFileSync(join(root, rel), "utf8");

function approval(
  partial: Partial<CommunicationApproval> = {},
): CommunicationApproval {
  return {
    id: "approval-1",
    tenant_id: "tenant-1",
    property_id: "property-1",
    lease_id: "lease-1",
    trigger_type: "late_day_6",
    template_key: "late_payment_reminder",
    body: "Please pay. Reply STOP to unsubscribe.",
    status: "pending_approval",
    generated_as_of_date: "2026-07-07",
    generated_ledger_version: "portfolio-ledger-v1",
    balance_snapshot: 160,
    days_late_snapshot: 6,
    generation_reason: "Day 6",
    idempotency_key: "delinquency:lease-1:2026-07-01:late_day_6",
    phone_snapshot: "+15551234567",
    not_before: null,
    created_by_auth_user_id: "owner-1",
    approved_by_auth_user_id: null,
    approved_at: null,
    rejected_at: null,
    cancelled_at: null,
    sent_communication_id: null,
    stale_reason: null,
    provider_error_code: null,
    provider_error_message: null,
    created_at: "2026-07-07T12:00:00Z",
    updated_at: "2026-07-07T12:00:00Z",
    ...partial,
  };
}

function account(
  partial: Partial<LedgerAccountSummary> = {},
): LedgerAccountSummary {
  return {
    ledgerVersion: "portfolio-ledger-v1",
    asOfDate: "2026-07-07",
    propertyId: "property-1",
    propertyName: "100 Main St",
    tenantId: "tenant-1",
    tenantName: "Test Tenant",
    leaseId: "lease-1",
    leaseStatus: "occupied",
    cadence: "weekly",
    currentRent: 160,
    rentEffectiveDate: null,
    priorRent: null,
    totalBalanceDue: 160,
    unpaidInvoiceCount: 1,
    pastDueInvoiceCount: 1,
    pastDueBalanceDue: 160,
    rentBalance: 160,
    lateFeeBalance: 0,
    otherChargeBalance: 0,
    futureScheduledCharges: 0,
    eligibleUnappliedCredit: 0,
    lastEligiblePositivePaymentDate: null,
    oldestUnpaidDueDate: "2026-07-01",
    daysLate: 6,
    collectionStatus: "past_due",
    invoices: [],
    payments: [],
    eligiblePayments: [],
    futureOrIneligiblePayments: [],
    allocatedPayments: [],
    unallocatedPayments: [],
    propertyTotalCollected: 0,
    exceptionFlags: [],
    ...partial,
  };
}

function communicationRow(partial: Partial<CommunicationRow> = {}): CommunicationRow {
  return {
    id: "communication-1",
    tenant_id: "tenant-1",
    property_id: "property-1",
    lease_id: "lease-1",
    channel: "sms",
    direction: "outbound",
    body: "hello",
    template_key: null,
    status: "pending",
    provider: "mock",
    provider_message_id: null,
    from_number: null,
    to_number: "+15551234567",
    sent_by_auth_user_id: "owner-1",
    idempotency_key: "approval:approval-1",
    error_code: null,
    error_message: null,
    created_at: "2026-07-07T12:00:00Z",
    sent_at: null,
    delivered_at: null,
    failed_at: null,
    ...partial,
  };
}

function memoryStore(
  suppressed = false,
): CommunicationsStore & { rows: CommunicationRow[] } {
  const rows: CommunicationRow[] = [];
  const preference: CommunicationPreference = {
    id: "preference-1",
    tenant_id: "tenant-1",
    phone_number: "+15551234567",
    sms_consent_status: "opted_in",
    consent_recorded_at: "2026-07-01T12:00:00Z",
    consent_source: "signed_form",
    opted_out_at: null,
    opted_in_at: "2026-07-01T12:00:00Z",
    updated_at: "2026-07-01T12:00:00Z",
  };
  return {
    rows,
    async findByIdempotencyKey(key) {
      return rows.find((row) => row.idempotency_key === key) || null;
    },
    async getPreference() {
      return preference;
    },
    async isPhoneSuppressed() {
      return suppressed;
    },
    async insertPending(input) {
      const row = communicationRow({
        id: `communication-${rows.length + 1}`,
        tenant_id: input.tenant_id,
        property_id: input.property_id,
        lease_id: input.lease_id,
        body: input.body,
        template_key: input.template_key,
        to_number: input.to_number,
        sent_by_auth_user_id: input.sent_by_auth_user_id,
        idempotency_key: input.idempotency_key,
      });
      rows.push(row);
      return row;
    },
    async updateAfterSend(id, patch) {
      const index = rows.findIndex((row) => row.id === id);
      rows[index] = { ...rows[index], ...patch };
      return rows[index];
    },
  };
}

describe("approval-first authorization and sending", () => {
  it("requires owner authorization to create and approve drafts", () => {
    expect(readSrc("src/app/api/communications/approvals/route.ts")).toMatch(
      /ownerOnly:\s*true/,
    );
    expect(
      readSrc("src/app/api/communications/approvals/[id]/route.ts"),
    ).toMatch(/ownerOnly:\s*true/);
  });

  it("never sends from the composer or direct-send route", () => {
    const modal = readSrc(
      "src/components/communications/TextTenantModal.tsx",
    );
    expect(modal).toContain("/api/communications/approvals");
    expect(modal).not.toContain("/api/communications/send");
    const direct = readSrc("src/app/api/communications/send/route.ts");
    expect(direct).toContain("APPROVAL_REQUIRED");
    expect(direct).not.toContain("sendTenantSms");
  });

  it("submits duplicate approved messages only once", async () => {
    const provider = new MockSmsProvider();
    const store = memoryStore();
    const input = {
      tenantId: "tenant-1",
      propertyId: "property-1",
      leaseId: "lease-1",
      phone: "+15551234567",
      body: "Approved message",
      idempotencyKey: "approval:approval-1",
      sentByAuthUserId: "owner-1",
    };
    const first = await sendTenantSms({ input, provider, store });
    const second = await sendTenantSms({ input, provider, store });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(provider.sent).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
  });

  it.each([
    ["unknown", "blocked"],
    ["opted_out", "blocked"],
  ] as const)("blocks %s consent before provider submission", (consent, expected) => {
    const result = validateApprovalBeforeSend(approval(), {
      account: account(),
      consentStatus: consent,
      normalizedPhone: "+15551234567",
      phoneSuppressed: false,
      lastEligiblePaymentDate: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(expected);
  });

  it("blocks a globally suppressed phone before provider submission", async () => {
    const provider = new MockSmsProvider();
    const store = memoryStore(true);
    const result = await sendTenantSms({
      input: {
        tenantId: "tenant-1",
        phone: "+15551234567",
        body: "Must not send",
        idempotencyKey: "suppressed-phone",
        sentByAuthUserId: "owner-1",
      },
      provider,
      store,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PHONE_SUPPRESSED");
    expect(provider.sent).toHaveLength(0);
  });

  it("marks a paid-after-generation draft stale", () => {
    const result = validateApprovalBeforeSend(approval(), {
      account: account({ lastEligiblePositivePaymentDate: "2026-07-08" }),
      consentStatus: "opted_in",
      normalizedPhone: "+15551234567",
      phoneSuppressed: false,
      lastEligiblePaymentDate: "2026-07-08",
    });
    expect(result).toEqual({
      ok: false,
      status: "stale",
      reason: "Tenant paid after draft generation",
    });
  });
});
describe("automatic approval drafts", () => {
  it("creates the day-6 late reminder candidate", () => {
    const candidate = buildAutomaticDraftCandidate({
      account: account({ daysLate: 6 }),
      phone: "+15551234567",
      consentStatus: "opted_in",
    });
    expect(candidate?.triggerType).toBe("late_day_6");
    expect(candidate?.body).toContain("Reply STOP");
  });

  it("creates the day-15 eviction-risk candidate without claiming notice service", () => {
    const candidate = buildAutomaticDraftCandidate({
      account: account({ daysLate: 15, asOfDate: "2026-07-16" }),
      phone: "+15551234567",
      consentStatus: "opted_in",
    });
    expect(candidate?.triggerType).toBe("eviction_risk_day_15");
    expect(candidate?.body).toContain("may be referred for eviction");
    expect(candidate?.body).not.toContain("notice has been served");
  });

  it("uses a stable episode/milestone key to prevent duplicate daily drafts", () => {
    const args = {
      account: account({ daysLate: 6 }),
      phone: "+15551234567",
      consentStatus: "unknown",
    };
    const first = buildAutomaticDraftCandidate(args);
    const second = buildAutomaticDraftCandidate(args);
    expect(first?.idempotencyKey).toBe(second?.idempotencyKey);
  });

  it("does not draft paid, exception, no-phone, or opted-out accounts", () => {
    const cases = [
      { account: account({ collectionStatus: "current", pastDueBalanceDue: 0 }), phone: "+15551234567", consentStatus: "opted_in" },
      { account: account({ exceptionFlags: ["cadence_review_required"] }), phone: "+15551234567", consentStatus: "opted_in" },
      { account: account(), phone: null, consentStatus: "opted_in" },
      { account: account(), phone: "+15551234567", consentStatus: "opted_out" },
    ];
    for (const input of cases) {
      expect(buildAutomaticDraftCandidate(input)).toBeNull();
    }
  });

  it("never sends from the daily generator", () => {
    const generator = readSrc(
      "src/lib/communications/draft-generator.ts",
    );
    const cron = readSrc(
      "src/app/api/cron/communication-drafts/route.ts",
    );
    expect(generator).not.toContain("sendTenantSms");
    expect(cron).not.toContain("sendTenantSms");
    expect(cron).toContain("sent: 0");
  });
});

describe("scheduled approved delivery", () => {
  it("is due only after not_before", () => {
    const scheduled = approval({
      status: "scheduled",
      approved_by_auth_user_id: "owner-1",
      approved_at: "2026-07-18T12:00:00Z",
      not_before: "2026-07-18T13:00:00Z",
    });
    expect(isApprovalDue(scheduled, new Date("2026-07-18T12:59:59Z"))).toBe(
      false,
    );
    expect(isApprovalDue(scheduled, new Date("2026-07-18T13:00:00Z"))).toBe(
      true,
    );
  });

  it("cron can process only already-approved or scheduled rows", () => {
    const route = readSrc(
      "src/app/api/cron/communication-sends/route.ts",
    );
    expect(route).toContain('allowedFrom: ["approved", "scheduled"]');
    expect(route).toContain("requireExistingApproval: true");
    expect(route).not.toContain('"pending_approval"');
    expect(route).not.toContain("approved_by_auth_user_id:");
  });

  it("allows day-15 drafts at or beyond day 15 but stales below day 15", () => {
    const draft = approval({
      trigger_type: "eviction_risk_day_15",
      days_late_snapshot: 15,
    });
    const valid = validateApprovalBeforeSend(draft, {
      account: account({ daysLate: 16 }),
      consentStatus: "opted_in",
      normalizedPhone: "+15551234567",
      phoneSuppressed: false,
      lastEligiblePaymentDate: null,
    });
    expect(valid.ok).toBe(true);

    const stale = validateApprovalBeforeSend(draft, {
      account: account({ daysLate: 14 }),
      consentStatus: "opted_in",
      normalizedPhone: "+15551234567",
      phoneSuppressed: false,
      lastEligiblePaymentDate: null,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.status).toBe("stale");
  });

  it("uses an atomic status claim for cron and concurrent owner requests", () => {
    const submission = readSrc("src/lib/communications/submission.ts");
    expect(submission).toContain("Atomic compare-and-set claim");
    expect(submission).toContain('status: "sending"');
    expect(submission).toContain("transitionApproval");
    const store = readSrc("src/lib/communications/approval-store.ts");
    expect(store).toContain(".in(\"status\", allowedFrom)");
  });

  it("provider-disabled configuration cannot fall back to mock", () => {
    const previous = process.env.V3_TENANT_COMMUNICATIONS_PROVIDER_ENABLED;
    delete process.env.V3_TENANT_COMMUNICATIONS_PROVIDER_ENABLED;
    const provider = getSmsProvider({
      NODE_ENV: "production",
      SMS_PROVIDER: "mock",
    } as NodeJS.ProcessEnv);
    expect(provider.name).toBe("twilio");
    expect(provider.isConfigured()).toBe(false);
    if (previous !== undefined) {
      process.env.V3_TENANT_COMMUNICATIONS_PROVIDER_ENABLED = previous;
    }
  });
});

describe("quiet hours, consent webhooks, and flags", () => {
  it("schedules outside 8am–8pm New York instead of warning only", () => {
    const outside = new Date("2026-07-18T01:00:00Z"); // 9pm NY
    expect(
      isWithinCommunicationWindow(outside, "America/New_York"),
    ).toBe(false);
    const next = new Date(
      nextCommunicationWindow(outside, "America/New_York"),
    );
    expect(
      isWithinCommunicationWindow(next, "America/New_York"),
    ).toBe(true);
    expect(
      readSrc("src/lib/communications/submission.ts"),
    ).toContain('status: "scheduled"');
  });

  it("classifies STOP and START and records audited consent events", () => {
    expect(isOptOutKeyword(" STOP ")).toBe(true);
    expect(classifyInboundKeyword("STOP")).toBe("opt_out");
    expect(isOptInKeyword("START")).toBe(true);
    expect(classifyInboundKeyword("UNSTOP")).toBe("opt_in");
    const inbound = readSrc(
      "src/app/api/communications/twilio/inbound/route.ts",
    );
    expect(inbound).toContain("recordPhoneSuppression");
    expect(inbound).toContain("inbound_stop");
    expect(inbound).toContain("inbound_start");
  });

  it("normalizes only valid exact E.164 or US local numbers", () => {
    expect(normalizeToE164("(555) 123-4567")).toBe("+15551234567");
    expect(normalizeToE164("+15551234567")).toBe("+15551234567");
    expect(isExactE164("+15551234567")).toBe(true);
    expect(normalizeToE164("001234567890")).toBeNull();
    expect(normalizeToE164("+01234567890")).toBeNull();
    expect(isExactE164("5551234567")).toBe(false);
  });

  it("shared-phone inbound is linked to all exact matches, never assigned arbitrarily", () => {
    const inbound = readSrc(
      "src/app/api/communications/twilio/inbound/route.ts",
    );
    expect(inbound).toContain("const tenantIds = new Set<string>()");
    expect(inbound).toContain("matchedTenantIds.length === 1");
    expect(inbound).toContain("RENT_communication_tenant_links");
    expect(inbound).not.toMatch(/\.limit\(1\)\s*\.maybeSingle\(\)/);
  });

  it("START preserves history and restores consent only with prior evidence", () => {
    const migration = readSrc(
      "migrations/20260719_tenant_communications_approval_center.sql",
    );
    expect(migration).toContain("RENT_sms_phone_suppression_events");
    expect(migration).toMatch(
      /new_status = 'opted_in'[\s\S]+THEN 'opted_in' ELSE 'unknown'/,
    );
    expect(migration).toContain("Communication audit events are append-only");
  });

  it("verifies provider signatures", () => {
    const url = "https://example.com/hook";
    const params = { Body: "STOP", From: "+15551234567" };
    let signed = url;
    for (const key of Object.keys(params).sort()) {
      signed += key + params[key as keyof typeof params];
    }
    const signature = createHmac("sha1", "token")
      .update(signed, "utf8")
      .digest("base64");
    expect(
      validateTwilioSignature({
        authToken: "token",
        signature,
        url,
        params,
      }),
    ).toBe(true);
    expect(
      validateTwilioSignature({
        authToken: "token",
        signature: "invalid",
        url,
        params,
      }),
    ).toBe(false);
  });

  it("keeps callbacks idempotent", () => {
    const inbound = readSrc(
      "src/app/api/communications/twilio/inbound/route.ts",
    );
    const status = readSrc(
      "src/app/api/communications/twilio/status/route.ts",
    );
    expect(inbound).toContain("provider_message_id");
    expect(inbound).toContain('insertError.code === "23505"');
    expect(status).toContain('existing.status === "delivered"');
  });

  it("defaults all four feature flags off and mock to non-production only", () => {
    const keys = [
      "V3_TENANT_COMMUNICATIONS_ENABLED",
      "V3_TENANT_COMMUNICATIONS_PROVIDER_ENABLED",
      "V3_TENANT_COMMUNICATION_DRAFT_GENERATOR_ENABLED",
      "V3_TENANT_COMMUNICATION_SCHEDULED_SENDS_ENABLED",
    ] as const;
    const old = keys.map((key) => process.env[key]);
    keys.forEach((key) => delete process.env[key]);
    expect(isTenantCommunicationsEnabled()).toBe(false);
    expect(isCommunicationsProviderEnabled()).toBe(false);
    expect(isCommunicationDraftGeneratorEnabled()).toBe(false);
    expect(isCommunicationScheduledSendsEnabled()).toBe(false);
    expect(
      mayUseMockSmsProvider({
        NODE_ENV: "production",
        SMS_PROVIDER: "mock",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    keys.forEach((key, index) => {
      if (old[index] !== undefined) process.env[key] = old[index];
    });
  });
});

describe("schema, UI, and financial isolation", () => {
  it("has six templates, including the reviewed eviction-risk wording", () => {
    expect(MESSAGE_TEMPLATES).toHaveLength(6);
    expect(
      MESSAGE_TEMPLATES.find((template) => template.key === "eviction_process_notice")
        ?.body,
    ).toContain("may be referred for eviction");
    expect(smsSegmentInfo("hello")).toEqual({ characters: 5, segments: 1 });
  });

  it("ports composer integrations to all four requested screens", () => {
    for (const page of [
      "src/app/tenants/page.tsx",
      "src/app/leases/page.tsx",
      "src/app/late-tenants/page.tsx",
      "src/app/payments/page.tsx",
    ]) {
      expect(readSrc(page)).toMatch(
        /TenantCommunicationActions|TextTenantModal/,
      );
    }
  });

  it("creates an owner consent UI and immutable event history", () => {
    expect(
      readSrc("src/components/communications/TenantConsentModal.tsx"),
    ).toContain("Audit history");
    const migration = readSrc(
      "migrations/20260719_tenant_communications_approval_center.sql",
    );
    expect(migration).toContain("RENT_communication_consent_events");
    expect(migration).toContain("rent_record_communication_consent");
  });

  it("contains no invoice or payment writes", () => {
    const files = [
      "migrations/20260719_tenant_communications_approval_center.sql",
      "src/lib/communications/draft-generator.ts",
      "src/app/api/communications/approvals/route.ts",
      "src/app/api/communications/approvals/[id]/route.ts",
      "src/lib/communications/submission.ts",
      "src/lib/communications/suppression.ts",
      "src/app/api/cron/communication-drafts/route.ts",
      "src/app/api/cron/communication-sends/route.ts",
    ].map(readSrc);
    for (const source of files) {
      expect(source).not.toMatch(
        /(update|delete\s+from|insert\s+into)\s+(public\.)?"RENT_(invoices|payments)"/i,
      );
      expect(source).not.toMatch(
        /\.from\(["']RENT_(invoices|payments)["']\)\s*\.(update|insert|delete)/,
      );
    }
  });

  it("documents the exact clean-baseline comparison", () => {
    const verification = readSrc(
      "docs/communications-baseline-verification.md",
    );
    expect(verification).toContain("0d0661b");
    expect(verification).toContain("265 errors");
    expect(verification).toContain("10 failed");
    expect(verification).toContain("11 failed tests");
  });
});

