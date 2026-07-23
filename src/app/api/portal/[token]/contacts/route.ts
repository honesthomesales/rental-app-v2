import { NextRequest, NextResponse } from "next/server";
import {
  isTenantContactSelfServiceEnabled,
  isTenantPaymentPortalEnabled,
  portalDisabledResponse,
} from "@/lib/payments/feature-flags";
import { resolvePortalAccess } from "@/lib/payments/portal-access";
import {
  addContactPoint,
  ContactDuplicateError,
  inactivateContactPoint,
  listActiveContacts,
} from "@/lib/payments/contacts";

export const dynamic = "force-dynamic";

function duplicateMessage(contactType: "phone" | "email") {
  return contactType === "email"
    ? "That email address is already on this account."
    : "That phone number is already on this account.";
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  if (!isTenantPaymentPortalEnabled()) {
    return NextResponse.json(portalDisabledResponse(), { status: 503 });
  }
  const { token } = await context.params;
  const access = await resolvePortalAccess(token);
  if (!access) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 401 });
  }
  const contacts = await listActiveContacts(access.tenantId);
  return NextResponse.json({ contacts });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  if (!isTenantPaymentPortalEnabled() || !isTenantContactSelfServiceEnabled()) {
    return NextResponse.json(
      { error: "Contact self-service is not activated" },
      { status: 503 },
    );
  }
  const { token } = await context.params;
  const access = await resolvePortalAccess(token);
  if (!access) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: "add" | "inactivate";
    contactType?: "phone" | "email";
    value?: string;
    label?: string;
    contactPointId?: string;
    reason?: string;
    makePrimary?: boolean;
  };

  try {
    if (body.action === "add") {
      if (!body.contactType || !body.value) {
        return NextResponse.json({ error: "contactType and value required" }, { status: 400 });
      }
      const created = await addContactPoint({
        tenantId: access.tenantId,
        contactType: body.contactType,
        value: body.value,
        label: body.label,
        source: "tenant",
        actor: "tenant_portal",
        makePrimary: body.makePrimary,
      });
      return NextResponse.json({ contact: created });
    }
    if (body.action === "inactivate") {
      if (!body.contactPointId) {
        return NextResponse.json({ error: "contactPointId required" }, { status: 400 });
      }
      await inactivateContactPoint({
        tenantId: access.tenantId,
        contactPointId: body.contactPointId,
        reason: body.reason,
        actor: "tenant_portal",
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    if (error instanceof ContactDuplicateError) {
      return NextResponse.json(
        { error: duplicateMessage(error.contactType), code: "DUPLICATE_CONTACT" },
        { status: 409 },
      );
    }
    const message = error instanceof Error ? error.message : "contact_failed";
    const status = message.includes("CANNOT_") || message.includes("INVALID_") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
