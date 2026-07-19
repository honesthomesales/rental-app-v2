import type { LedgerAccountSummary } from "@/lib/portfolio-ledger/service";
import { supabaseServer } from "@/lib/supabase-server";
import {
  isWithinCommunicationWindow,
  nextCommunicationWindow,
  validateApprovalBeforeSend,
} from "./approval";
import {
  getApprovalDraft,
  transitionApproval,
} from "./approval-store";
import { getTenantPreference } from "./consent";
import {
  isCommunicationsProviderEnabled,
  mayUseMockSmsProvider,
} from "./feature-flag";
import { loadCommunicationLedgerAccounts } from "./ledger-facts";
import { normalizeToE164 } from "./phone";
import { getSmsProvider } from "./providers";
import { sendTenantSms } from "./send-service";
import { createSupabaseCommunicationsStore } from "./store";
import { isPhoneGloballySuppressed } from "./suppression";
import type {
  CommunicationApproval,
  CommunicationApprovalStatus,
  TemplateKey,
} from "./types";

export type SubmissionResult =
  | { kind: "sent"; draft: CommunicationApproval; duplicate: boolean }
  | { kind: "scheduled"; draft: CommunicationApproval }
  | { kind: "stale" | "blocked"; draft: CommunicationApproval | null; reason: string }
  | { kind: "provider_disabled"; reason: string }
  | { kind: "not_due" | "not_approved" | "already_claimed"; draft: CommunicationApproval | null }
  | { kind: "failed"; draft: CommunicationApproval | null };

export function isApprovalDue(
  draft: CommunicationApproval,
  now: Date,
): boolean {
  return !draft.not_before || new Date(draft.not_before).getTime() <= now.getTime();
}

export async function processApprovedCommunication(args: {
  draft: CommunicationApproval;
  businessDate: string;
  allowedFrom: CommunicationApprovalStatus[];
  now?: Date;
  approvedByAuthUserId?: string | null;
  requireExistingApproval: boolean;
  accounts?: LedgerAccountSummary[];
}): Promise<SubmissionResult> {
  const now = args.now || new Date();
  const draft = args.draft;

  if (
    args.requireExistingApproval &&
    (!draft.approved_by_auth_user_id || !draft.approved_at)
  ) {
    return { kind: "not_approved", draft };
  }
  if (!isApprovalDue(draft, now)) {
    return { kind: "not_due", draft };
  }

  const { data: tenant, error: tenantError } = await supabaseServer
    .from("RENT_tenants")
    .select("id, phone")
    .eq("id", draft.tenant_id)
    .maybeSingle();
  if (tenantError || !tenant) {
    const stale = await transitionApproval(draft.id, args.allowedFrom, {
      status: "stale",
      stale_reason: "Tenant no longer exists",
    });
    return {
      kind: "stale",
      draft: stale,
      reason: "Tenant no longer exists",
    };
  }

  const normalizedPhone = normalizeToE164(tenant.phone);
  const [preference, phoneSuppressed] = normalizedPhone
    ? await Promise.all([
        getTenantPreference(draft.tenant_id, normalizedPhone),
        isPhoneGloballySuppressed(normalizedPhone),
      ])
    : [null, false];
  const accounts =
    args.accounts ||
    (draft.lease_id
      ? await loadCommunicationLedgerAccounts(args.businessDate)
      : []);
  const account = draft.lease_id
    ? accounts.find(
        (candidate) =>
          candidate.leaseId === draft.lease_id &&
          candidate.tenantId === draft.tenant_id,
      ) || null
    : null;

  const validation = validateApprovalBeforeSend(draft, {
    account,
    consentStatus: preference?.sms_consent_status || "unknown",
    normalizedPhone,
    phoneSuppressed,
    lastEligiblePaymentDate:
      account?.lastEligiblePositivePaymentDate || null,
  });
  if (!validation.ok) {
    const updated = await transitionApproval(draft.id, args.allowedFrom, {
      status: validation.status,
      stale_reason: validation.reason,
    });
    return {
      kind: validation.status,
      draft: updated,
      reason: validation.reason,
    };
  }

  const timezone = preference?.tenant_timezone || "America/New_York";
  const approvalPatch = args.approvedByAuthUserId
    ? {
        approved_by_auth_user_id: args.approvedByAuthUserId,
        approved_at: draft.approved_at || now.toISOString(),
      }
    : {};

  if (!isWithinCommunicationWindow(now, timezone)) {
    const scheduled = await transitionApproval(draft.id, args.allowedFrom, {
      status: "scheduled",
      ...approvalPatch,
      not_before: nextCommunicationWindow(now, timezone),
      stale_reason: null,
    });
    return scheduled
      ? { kind: "scheduled", draft: scheduled }
      : { kind: "already_claimed", draft: await getApprovalDraft(draft.id) };
  }

  if (!isCommunicationsProviderEnabled()) {
    return {
      kind: "provider_disabled",
      reason: "SMS provider submission is disabled",
    };
  }
  const allowMock = mayUseMockSmsProvider();
  const provider = getSmsProvider(process.env, { forceMock: allowMock });
  if (!provider.isConfigured() && !allowMock) {
    return {
      kind: "provider_disabled",
      reason: "SMS provider is not configured",
    };
  }

  // Atomic compare-and-set claim. Concurrent owner/cron calls cannot both win.
  const sending = await transitionApproval(draft.id, args.allowedFrom, {
    status: "sending",
    ...approvalPatch,
    not_before: null,
    stale_reason: null,
  });
  if (!sending) {
    return { kind: "already_claimed", draft: await getApprovalDraft(draft.id) };
  }

  const result = await sendTenantSms({
    input: {
      tenantId: sending.tenant_id,
      propertyId: sending.property_id,
      leaseId: sending.lease_id,
      phone: normalizedPhone as string,
      body: sending.body,
      templateKey: (sending.template_key as TemplateKey | null) || null,
      idempotencyKey: `approval:${sending.id}`,
      sentByAuthUserId:
        sending.approved_by_auth_user_id ||
        (args.approvedByAuthUserId as string),
    },
    provider,
    store: createSupabaseCommunicationsStore(),
    allowSendWithoutProvider: allowMock,
  });

  if (!result.ok) {
    const failed = await transitionApproval(draft.id, ["sending"], {
      status: "failed",
      provider_error_code: result.code,
      provider_error_message: result.error.slice(0, 500),
    });
    return { kind: "failed", draft: failed };
  }

  const sent = await transitionApproval(draft.id, ["sending"], {
    status: "sent",
    sent_communication_id: result.communication.id,
    provider_error_code: null,
    provider_error_message: null,
  });
  if (!sent) {
    return { kind: "already_claimed", draft: await getApprovalDraft(draft.id) };
  }
  return { kind: "sent", draft: sent, duplicate: Boolean(result.duplicate) };
}
