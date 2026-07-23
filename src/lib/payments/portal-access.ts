import { supabaseServer } from "@/lib/supabase-server";
import { hashPortalToken } from "@/lib/payments/tokens";
import { isTenantPaymentPortalEnabled } from "@/lib/payments/feature-flags";

export type PortalAccess = {
  tokenId: string;
  tenantId: string;
  leaseId: string;
  propertyId: string | null;
};

export async function resolvePortalAccess(
  rawToken: string,
): Promise<PortalAccess | null> {
  if (!isTenantPaymentPortalEnabled()) return null;
  if (!rawToken || rawToken.length < 16) return null;

  const tokenHash = hashPortalToken(rawToken);
  const { data, error } = await supabaseServer
    .from("RENT_v3_portal_access_tokens")
    .select("id, tenant_id, lease_id, property_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) return null;
  if (data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
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
