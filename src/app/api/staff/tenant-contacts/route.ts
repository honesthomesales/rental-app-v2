import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { supabaseServer } from "@/lib/supabase-server";
import {
  addContactPoint,
  inactivateContactPoint,
  listActiveContacts,
} from "@/lib/payments/contacts";

export const dynamic = "force-dynamic";

/** Staff: list contacts + history for a tenant. */
export async function GET(request: NextRequest) {
  const auth = await requireApiAuth(request, { write: false });
  if (isAuthError(auth)) return auth;

  const tenantId = new URL(request.url).searchParams.get("tenantId");
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }

  const contacts = await listActiveContacts(tenantId);
  const { data: all } = await supabaseServer
    .from("RENT_v3_tenant_contact_points")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(100);

  const { data: audit } = await supabaseServer
    .from("RENT_v3_contact_audit_events")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(100);

  return NextResponse.json({
    active: contacts,
    history: all || [],
    audit: audit || [],
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth(request, { write: true });
  if (isAuthError(auth)) return auth;

  const body = (await request.json().catch(() => ({}))) as {
    action?: "add" | "inactivate" | "reactivate";
    tenantId?: string;
    contactType?: "phone" | "email";
    value?: string;
    contactPointId?: string;
    reason?: string;
  };

  if (!body.tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }

  try {
    if (body.action === "add") {
      if (!body.contactType || !body.value) {
        return NextResponse.json({ error: "contactType and value required" }, { status: 400 });
      }
      const created = await addContactPoint({
        tenantId: body.tenantId,
        contactType: body.contactType,
        value: body.value,
        source: "staff",
        actor: "staff",
        actorAuthUserId: auth.user.id,
      });
      return NextResponse.json({ contact: created });
    }

    if (body.action === "inactivate") {
      if (!body.contactPointId) {
        return NextResponse.json({ error: "contactPointId required" }, { status: 400 });
      }
      await inactivateContactPoint({
        tenantId: body.tenantId,
        contactPointId: body.contactPointId,
        reason: body.reason,
        actor: "staff",
        actorAuthUserId: auth.user.id,
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "reactivate") {
      if (!body.contactPointId) {
        return NextResponse.json({ error: "contactPointId required" }, { status: 400 });
      }
      const { data, error } = await supabaseServer
        .from("RENT_v3_tenant_contact_points")
        .update({
          is_active: true,
          inactive_at: null,
          inactive_reason: null,
          updated_at: new Date().toISOString(),
          updated_by_auth_user_id: auth.user.id,
        })
        .eq("id", body.contactPointId)
        .eq("tenant_id", body.tenantId)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      await supabaseServer.from("RENT_v3_contact_audit_events").insert({
        contact_point_id: body.contactPointId,
        tenant_id: body.tenantId,
        action: "reactivated",
        actor: "staff",
        actor_auth_user_id: auth.user.id,
        detail: {},
      });
      return NextResponse.json({ contact: data });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "contact_failed";
    const status = message.includes("CANNOT_") || message.includes("INVALID_") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
