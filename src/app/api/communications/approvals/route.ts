import { NextResponse } from "next/server";
import { getBusinessDate } from "@/lib/business-date";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { supabaseServer } from "@/lib/supabase-server";
import {
  communicationsDisabledResponse,
  communicationsNotConfiguredResponse,
  isCommunicationsProviderEnabled,
  isTenantCommunicationsEnabled,
} from "@/lib/communications/feature-flag";
import { areCommunicationTablesReady } from "@/lib/communications/schema";
import {
  createApprovalDraft,
  listApprovalDrafts,
} from "@/lib/communications/approval-store";
import { loadCommunicationLedgerAccounts } from "@/lib/communications/ledger-facts";
import { normalizeToE164 } from "@/lib/communications/phone";
import { PORTFOLIO_LEDGER_VERSION } from "@/lib/portfolio-ledger/service";
import type { TemplateKey } from "@/lib/communications/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (isAuthError(auth)) return auth;
  if (!isTenantCommunicationsEnabled()) {
    return NextResponse.json(communicationsDisabledResponse(), { status: 403 });
  }
  if (!(await areCommunicationTablesReady())) {
    return NextResponse.json(communicationsNotConfiguredResponse(), {
      status: 503,
    });
  }

  try {
    const url = new URL(request.url);
    const drafts = await listApprovalDrafts({
      status: url.searchParams.get("status"),
      limit: Number(url.searchParams.get("limit")) || 200,
    });
    const tenantIds = [...new Set(drafts.map((draft) => draft.tenant_id))];
    const propertyIds = [
      ...new Set(
        drafts
          .map((draft) => draft.property_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const [{ data: tenants }, { data: properties }] = await Promise.all([
      tenantIds.length
        ? supabaseServer
            .from("RENT_tenants")
            .select("id, full_name, first_name, last_name, phone")
            .in("id", tenantIds)
        : Promise.resolve({ data: [] }),
      propertyIds.length
        ? supabaseServer
            .from("RENT_properties")
            .select("id, name, address")
            .in("id", propertyIds)
        : Promise.resolve({ data: [] }),
    ]);
    const tenantById = new Map((tenants || []).map((row) => [row.id, row]));
    const propertyById = new Map(
      (properties || []).map((row) => [row.id, row]),
    );

    return NextResponse.json({
      role: auth.role,
      canApprove: auth.role === "owner",
      providerEnabled: isCommunicationsProviderEnabled(),
      drafts: drafts.map((draft) => {
        const tenant = tenantById.get(draft.tenant_id);
        const property = draft.property_id
          ? propertyById.get(draft.property_id)
          : null;
        return {
          ...draft,
          tenant_name:
            tenant?.full_name ||
            [tenant?.first_name, tenant?.last_name]
              .filter(Boolean)
              .join(" ") ||
            "Unknown tenant",
          tenant_phone: tenant?.phone || null,
          property_name: property?.name || property?.address || null,
        };
      }),
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to load communication approvals" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireApiAuth(request, { ownerOnly: true });
  if (isAuthError(auth)) return auth;
  if (!isTenantCommunicationsEnabled()) {
    return NextResponse.json(communicationsDisabledResponse(), { status: 403 });
  }
  if (!(await areCommunicationTablesReady())) {
    return NextResponse.json(communicationsNotConfiguredResponse(), {
      status: 503,
    });
  }

  try {
    const body = await request.json();
    const tenantId = String(body.tenantId || "");
    const leaseId = body.leaseId ? String(body.leaseId) : null;
    const propertyId = body.propertyId ? String(body.propertyId) : null;
    const message = String(body.message || "").trim();
    const idempotencyKey = String(body.idempotencyKey || "").trim();
    if (!tenantId || !message || !idempotencyKey) {
      return NextResponse.json(
        { error: "tenantId, message, and idempotencyKey are required" },
        { status: 400 },
      );
    }
    if (message.length > 1600) {
      return NextResponse.json(
        { error: "Message exceeds 1600 characters" },
        { status: 400 },
      );
    }

    const { data: tenant, error: tenantError } = await supabaseServer
      .from("RENT_tenants")
      .select("id, phone")
      .eq("id", tenantId)
      .maybeSingle();
    if (tenantError || !tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }
    const phone = normalizeToE164(tenant.phone);
    const businessDate = getBusinessDate();
    const accounts = leaseId
      ? await loadCommunicationLedgerAccounts(businessDate)
      : [];
    const account = leaseId
      ? accounts.find(
          (candidate) =>
            candidate.leaseId === leaseId &&
            candidate.tenantId === tenantId &&
            (!propertyId || candidate.propertyId === propertyId),
        )
      : null;
    if (leaseId && !account) {
      return NextResponse.json(
        { error: "Lease does not belong to tenant/property" },
        { status: 400 },
      );
    }

    const result = await createApprovalDraft({
      tenantId,
      propertyId: account?.propertyId || propertyId,
      leaseId,
      triggerType: "manual",
      templateKey: (body.templateKey as TemplateKey) || "custom",
      body: message,
      generatedAsOfDate: businessDate,
      generatedLedgerVersion:
        account?.ledgerVersion || PORTFOLIO_LEDGER_VERSION,
      balanceSnapshot: account?.pastDueBalanceDue || 0,
      daysLateSnapshot: account?.daysLate ?? null,
      generationReason: "Owner added message to approval list",
      idempotencyKey,
      phoneSnapshot: phone,
      createdByAuthUserId: auth.user.id,
    });

    return NextResponse.json(
      {
        ok: true,
        duplicate: result.duplicate,
        sent: false,
        draft: result.draft,
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to create communication draft" },
      { status: 500 },
    );
  }
}

