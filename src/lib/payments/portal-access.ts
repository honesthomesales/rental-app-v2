import { supabaseServer } from "@/lib/supabase-server";
import { hashPortalToken, safeEqualHex } from "@/lib/payments/tokens";
import { isTenantPaymentPortalEnabled } from "@/lib/payments/feature-flags";
import {
  isPortalProbeBlocked,
  recordInvalidPortalProbe,
} from "@/lib/payments/portal-rate-limit";

export type PortalAccess = {
  tokenId: string;
  tenantId: string;
  leaseId: string;
  propertyId: string | null;
};

export async function resolvePortalAccess(
  rawToken: string,
  probeKey?: string,
): Promise<PortalAccess | null> {
  if (!isTenantPaymentPortalEnabled()) return null;
  if (!rawToken || rawToken.length < 16) return null;

  const rateKey = probeKey || `tok:${rawToken.slice(0, 12)}`;
  if (isPortalProbeBlocked(rateKey)) return null;

  const tokenHash = hashPortalToken(rawToken);
  const { data, error } = await supabaseServer
    .from("RENT_v3_portal_access_tokens")
    .select("id, tenant_id, lease_id, property_id, expires_at, revoked_at, token_hash")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) {
    recordInvalidPortalProbe(rateKey);
    return null;
  }
  if (!safeEqualHex(data.token_hash, tokenHash)) {
    recordInvalidPortalProbe(rateKey);
    return null;
  }
  if (data.revoked_at) {
    recordInvalidPortalProbe(rateKey);
    return null;
  }
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    recordInvalidPortalProbe(rateKey);
    return null;
  }

  await supabaseServer
    .from("RENT_v3_portal_access_tokens")
    .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", data.id);

  return {
    tokenId: data.id,
    tenantId: data.tenant_id,
    leaseId: data.lease_id,
    propertyId: data.property_id,
  };
}

export async function assertPortalTenantScope(
  access: PortalAccess,
  claimed: { tenantId?: string; leaseId?: string; propertyId?: string },
): Promise<boolean> {
  if (claimed.tenantId && claimed.tenantId !== access.tenantId) return false;
  if (claimed.leaseId && claimed.leaseId !== access.leaseId) return false;
  if (
    claimed.propertyId &&
    access.propertyId &&
    claimed.propertyId !== access.propertyId
  ) {
    return false;
  }
  return true;
}
