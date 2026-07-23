import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { isTenantPaymentPortalEnabled } from "@/lib/payments/feature-flags";
import { generatePortalToken } from "@/lib/payments/tokens";
import { supabaseServer } from "@/lib/supabase-server";
import { ensurePaymentReference } from "@/lib/payments/portal-account";

export const dynamic = "force-dynamic";

const DEFAULT_EXPIRES_DAYS = 90;

async function resolveLeaseForTenant(tenantId: string, leaseId?: string | null) {
  if (leaseId) {
    const { data: lease } = await supabaseServer
      .from("RENT_leases")
      .select("id, tenant_id, property_id, status")
      .eq("id", leaseId)
      .maybeSingle();
    if (!lease || lease.tenant_id !== tenantId) return null;
    return lease;
  }

  const { data: leases } = await supabaseServer
    .from("RENT_leases")
    .select("id, tenant_id, property_id, status, lease_start_date, lease_end_date")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (!leases?.length) return null;
  const occupied = leases.find((l) => String(l.status || "").toLowerCase() === "occupied");
  return occupied || leases[0];
}

/** List portal tokens for a tenant (never includes raw token). */
export async function GET(request: NextRequest) {
  const auth = await requireApiAuth(request, { write: false });
  if (isAuthError(auth)) return auth;

  const tenantId = new URL(request.url).searchParams.get("tenantId");
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("RENT_v3_portal_access_tokens")
    .select(
      "id, tenant_id, lease_id, property_id, label, expires_at, revoked_at, revoked_reason, last_used_at, created_at, created_by_auth_user_id",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = Date.now();
  const tokens = (data || []).map((row) => {
    const expired =
      !!row.expires_at && new Date(row.expires_at).getTime() < now;
    const active = !row.revoked_at && !expired;
    return {
      ...row,
      status: row.revoked_at ? "revoked" : expired ? "expired" : "active",
      active,
    };
  });

  return NextResponse.json({
    portalEnabled: isTenantPaymentPortalEnabled(),
    tokens,
  });
}

/** Staff: mint a revocable portal access token for one tenant/lease. */
export async function POST(request: NextRequest) {
  const auth = await requireApiAuth(request, { write: true });
  if (isAuthError(auth)) return auth;
  if (!isTenantPaymentPortalEnabled()) {
    return NextResponse.json({ error: "Portal flag disabled" }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    tenantId?: string;
    leaseId?: string;
    propertyId?: string | null;
    expiresInDays?: number;
    label?: string;
    regenerate?: boolean;
  };

  if (!body.tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }

  const lease = await resolveLeaseForTenant(body.tenantId, body.leaseId);
  if (!lease) {
    return NextResponse.json({ error: "No matching lease for tenant" }, { status: 400 });
  }

  const expiresDays =
    body.expiresInDays && body.expiresInDays > 0
      ? body.expiresInDays
      : DEFAULT_EXPIRES_DAYS;
  const expiresAt = new Date(Date.now() + expiresDays * 86400000).toISOString();

  // Regenerate (default for mint): revoke prior active tokens for this lease.
  if (body.regenerate !== false) {
    await supabaseServer
      .from("RENT_v3_portal_access_tokens")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_reason: "replaced_by_regeneration",
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", body.tenantId)
      .eq("lease_id", lease.id)
      .is("revoked_at", null);
  }

  const { raw, hash } = generatePortalToken();

  const { data: row, error } = await supabaseServer
    .from("RENT_v3_portal_access_tokens")
    .insert({
      tenant_id: body.tenantId,
      lease_id: lease.id,
      property_id: body.propertyId || lease.property_id,
      token_hash: hash,
      label: body.label || (body.regenerate === false ? "staff_issued" : "staff_regenerated"),
      expires_at: expiresAt,
      created_by_auth_user_id: auth.user.id,
    })
    .select("id, expires_at, lease_id, property_id, created_at")
    .single();

  if (error || !row) {
    return NextResponse.json({ error: error?.message || "token_create_failed" }, { status: 500 });
  }

  const reference = await ensurePaymentReference(body.tenantId);
  const origin = new URL(request.url).origin;

  return NextResponse.json({
    tokenId: row.id,
    leaseId: row.lease_id,
    propertyId: row.property_id,
    // Raw token returned once only — never stored / never re-fetched.
    portalUrl: `${origin}/pay/${raw}`,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    paymentReference: reference,
  });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireApiAuth(request, { write: true });
  if (isAuthError(auth)) return auth;

  const body = (await request.json().catch(() => ({}))) as {
    tokenId?: string;
    reason?: string;
  };
  if (!body.tokenId) {
    return NextResponse.json({ error: "tokenId required" }, { status: 400 });
  }

  const { error } = await supabaseServer
    .from("RENT_v3_portal_access_tokens")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_reason: body.reason || "staff_revoke",
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.tokenId)
    .is("revoked_at", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
