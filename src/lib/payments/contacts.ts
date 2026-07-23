import { supabaseServer } from "@/lib/supabase-server";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (value.trim().startsWith("+")) return value.trim();
  return value.trim();
}

export class ContactDuplicateError extends Error {
  readonly code = "DUPLICATE_CONTACT" as const;
  constructor(readonly contactType: "phone" | "email") {
    super("DUPLICATE_CONTACT");
    this.name = "ContactDuplicateError";
  }
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  const msg = (error.message || "").toLowerCase();
  return (
    msg.includes("duplicate key") ||
    msg.includes("unique constraint") ||
    msg.includes("idx_rent_v3_contacts_active_normalized")
  );
}

export async function listActiveContacts(tenantId: string) {
  const { data, error } = await supabaseServer
    .from("RENT_v3_tenant_contact_points")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function addContactPoint(args: {
  tenantId: string;
  contactType: "phone" | "email";
  value: string;
  label?: string;
  source: "tenant" | "staff" | "import" | "application";
  actor: string;
  actorAuthUserId?: string | null;
  makePrimary?: boolean;
}) {
  const normalized =
    args.contactType === "email"
      ? normalizeEmail(args.value)
      : normalizePhone(args.value);

  if (args.contactType === "email" && !normalized.includes("@")) {
    throw new Error("INVALID_EMAIL");
  }
  if (args.contactType === "phone" && normalized.replace(/\D/g, "").length < 10) {
    throw new Error("INVALID_PHONE");
  }

  // Soft pre-check (same tenant only). Do not probe other tenants.
  const { data: existingActive } = await supabaseServer
    .from("RENT_v3_tenant_contact_points")
    .select("id")
    .eq("tenant_id", args.tenantId)
    .eq("contact_type", args.contactType)
    .eq("normalized_value", normalized)
    .eq("is_active", true)
    .maybeSingle();
  if (existingActive) {
    throw new ContactDuplicateError(args.contactType);
  }

  const { data: inserted, error } = await supabaseServer
    .from("RENT_v3_tenant_contact_points")
    .insert({
      tenant_id: args.tenantId,
      contact_type: args.contactType,
      original_value: args.value.trim(),
      normalized_value: normalized,
      label: args.label || "other",
      is_active: true,
      is_primary: Boolean(args.makePrimary),
      verification_status: "unverified",
      source: args.source,
      created_by: args.actor,
      created_by_auth_user_id: args.actorAuthUserId || null,
    })
    .select("*")
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      throw new ContactDuplicateError(args.contactType);
    }
    throw new Error(error.message);
  }

  if (args.makePrimary) {
    await supabaseServer
      .from("RENT_v3_tenant_contact_points")
      .update({ is_primary: false, updated_at: new Date().toISOString() })
      .eq("tenant_id", args.tenantId)
      .eq("contact_type", args.contactType)
      .neq("id", inserted.id);
    await supabaseServer
      .from("RENT_v3_tenant_contact_points")
      .update({ is_primary: true, updated_at: new Date().toISOString() })
      .eq("id", inserted.id);
  }

  await supabaseServer.from("RENT_v3_contact_audit_events").insert({
    contact_point_id: inserted.id,
    tenant_id: args.tenantId,
    action: "created",
    actor: args.actor,
    actor_auth_user_id: args.actorAuthUserId || null,
    detail: { normalized },
  });

  return inserted;
}

export async function inactivateContactPoint(args: {
  tenantId: string;
  contactPointId: string;
  reason?: string;
  actor: string;
  actorAuthUserId?: string | null;
}) {
  const { data: contact } = await supabaseServer
    .from("RENT_v3_tenant_contact_points")
    .select("*")
    .eq("id", args.contactPointId)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();
  if (!contact) throw new Error("CONTACT_NOT_FOUND");

  const { data: activeSameType } = await supabaseServer
    .from("RENT_v3_tenant_contact_points")
    .select("id, verification_status")
    .eq("tenant_id", args.tenantId)
    .eq("contact_type", contact.contact_type)
    .eq("is_active", true);

  const others = (activeSameType || []).filter((c) => c.id !== contact.id);
  if (others.length === 0) {
    throw new Error("CANNOT_INACTIVATE_ONLY_CONTACT");
  }

  const { error } = await supabaseServer
    .from("RENT_v3_tenant_contact_points")
    .update({
      is_active: false,
      is_primary: false,
      inactive_at: new Date().toISOString(),
      inactive_reason: args.reason || null,
      updated_at: new Date().toISOString(),
      updated_by_auth_user_id: args.actorAuthUserId || null,
    })
    .eq("id", contact.id);

  if (error) throw new Error(error.message);

  await supabaseServer.from("RENT_v3_contact_audit_events").insert({
    contact_point_id: contact.id,
    tenant_id: args.tenantId,
    action: "inactivated",
    actor: args.actor,
    actor_auth_user_id: args.actorAuthUserId || null,
    detail: { reason: args.reason || null },
  });
}
