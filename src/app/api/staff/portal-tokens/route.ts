import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { isTenantPaymentPortalEnabled } from "@/lib/payments/feature-flags";
import { generatePortalToken } from "@/lib/payments/tokens";
import { supabaseServer } from "@/lib/supabase-server";
import { ensurePaymentReference } from "@/lib/payments/portal-account";

export const dynamic = "force-dynamic";

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
  };

  if (!body.tenantId || !body.leaseId) {
    return NextResponse.json({ error: "tenantId and leaseId required" }, { status: 400 });
  }

  const { data: lease } = await supabaseServer
    .from("RENT_leases")
    .select("id, tenant_id, property_id")
    .eq("id", body.leaseId)
    .maybeSingle();

  if (!lease || lease.tenant_id !== body.tenantId) {
    return NextResponse.json({ error: "Lease/tenant mismatch" }, { status: 400 });
  }

  const { raw, hash } = generatePortalToken();
  const expiresAt =
    body.expiresInDays && body.expiresInDays > 0
      ? new Date(Date.now() + body.expiresInDays * 86400000).toISOString()
      : null;

  const { data: row, error } = await supabaseServer
    .from("RENT_v3_portal_access_tokens")
    .insert({
      tenant_id: body.tenantId,
      lease_id: body.leaseId,
      property_id: body.propertyId || lease.property_id,
      token_hash: hash,
      label: body.label || "staff_issued",
      expires_at: expiresAt,
      created_by_auth_user_id: auth.user.id,
    })
    .select("id, expires_at")
    .single();

  if (error || !row) {
    return NextResponse.json({ error: error?.message || "token_create_failed" }, { status: 500 });
  }

  const reference = await ensurePaymentReference(body.tenantId);
  const origin = new URL(request.url).origin;

  return NextResponse.json({
    tokenId: row.id,
    // Raw token returned once only — never stored.
    portalUrl: `${origin}/pay/${raw}`,
    expiresAt: row.expires_at,
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
