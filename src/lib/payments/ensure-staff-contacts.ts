/**
 * Idempotent mirror of RENT_tenants.phone / email into contact points.
 * Never overwrites tenant fields. Never hard-deletes. Never marks verified.
 */

import { supabaseServer } from "@/lib/supabase-server";
import { normalizeEmail, normalizePhone } from "@/lib/payments/contacts";

export async function ensureStaffRecordedContactsFromTenant(args: {
  tenantId: string;
  phone?: string | null;
  email?: string | null;
  actor?: string;
}): Promise<{ phoneAdded: boolean; emailAdded: boolean }> {
  const actor = args.actor || "staff_backfill";
  let phoneAdded = false;
  let emailAdded = false;

  const phone = (args.phone || "").trim();
  if (phone) {
    phoneAdded = await ensureOne({
      tenantId: args.tenantId,
      contactType: "phone",
      value: phone,
      normalized: normalizePhone(phone),
      actor,
    });
  }

  const email = (args.email || "").trim();
  if (email && email.includes("@")) {
    emailAdded = await ensureOne({
      tenantId: args.tenantId,
      contactType: "email",
      value: email,
      normalized: normalizeEmail(email),
      actor,
    });
  }

  return { phoneAdded, emailAdded };
}

async function ensureOne(args: {
  tenantId: string;
  contactType: "phone" | "email";
  value: string;
  normalized: string;
  actor: string;
}): Promise<boolean> {
  if (!args.normalized) return false;
  if (args.contactType === "phone" && args.normalized.replace(/\D/g, "").length < 10) {
    return false;
  }

  const { data: existing } = await supabaseServer
    .from("RENT_v3_tenant_contact_points")
    .select("id")
    .eq("tenant_id", args.tenantId)
    .eq("contact_type", args.contactType)
    .eq("normalized_value", args.normalized)
    .maybeSingle();

  if (existing?.id) return false;

  const { data: inserted, error } = await supabaseServer
    .from("RENT_v3_tenant_contact_points")
    .insert({
      tenant_id: args.tenantId,
      contact_type: args.contactType,
      original_value: args.value,
      normalized_value: args.normalized,
      label: "other",
      is_active: true,
      is_primary: true,
      verification_status: "unverified",
      source: "staff",
      created_by: args.actor,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // Unique race: treat as already present (idempotent).
    if (
      error.code === "23505" ||
      (error.message || "").toLowerCase().includes("duplicate")
    ) {
      return false;
    }
    throw new Error(error.message);
  }

  if (!inserted?.id) return false;

  await supabaseServer
    .from("RENT_v3_tenant_contact_points")
    .update({ is_primary: false, updated_at: new Date().toISOString() })
    .eq("tenant_id", args.tenantId)
    .eq("contact_type", args.contactType)
    .neq("id", inserted.id);

  await supabaseServer.from("RENT_v3_contact_audit_events").insert({
    contact_point_id: inserted.id,
    tenant_id: args.tenantId,
    action: "created",
    actor: args.actor,
    detail: { source: "staff_tenant_mirror", normalized: args.normalized },
  });

  return true;
}
