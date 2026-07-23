import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import {
  isBankReconciliationEnabled,
  isTenantPaymentPortalEnabled,
} from "@/lib/payments/feature-flags";
import { supabaseServer } from "@/lib/supabase-server";
import {
  postSettledRentOnce,
  transitionAttempt,
} from "@/lib/payments/attempt-lifecycle";
import { generateIdempotencyKey } from "@/lib/payments/tokens";
import { getBusinessDate } from "@/lib/business-date";
import { dollarsToCents } from "@/lib/payments/money";

export const dynamic = "force-dynamic";

/** Staff Incoming Payments Review queue. */
export async function GET(request: NextRequest) {
  const auth = await requireApiAuth(request);
  if (isAuthError(auth)) return auth;
  if (!isTenantPaymentPortalEnabled() && !isBankReconciliationEnabled()) {
    return NextResponse.json({ error: "Feature disabled" }, { status: 503 });
  }

  const { data: matches } = await supabaseServer
    .from("RENT_v3_payment_match_candidates")
    .select(
      "*, bank_transaction:RENT_v3_bank_transactions(*), tenant:RENT_tenants(id, full_name, first_name, last_name)",
    )
    .eq("status", "needs_review")
    .order("created_at", { ascending: false })
    .limit(100);

  const { data: awaiting } = await supabaseServer
    .from("RENT_v3_payment_attempts")
    .select("*")
    .in("status", [
      "awaiting_verification",
      "pending",
      "processing",
      "manual_review",
      "awaiting_customer",
    ])
    .order("created_at", { ascending: false })
    .limit(100);

  const tenantIds = Array.from(
    new Set((awaiting || []).map((a) => a.tenant_id).filter(Boolean)),
  );
  const propertyIds = Array.from(
    new Set((awaiting || []).map((a) => a.property_id).filter(Boolean)),
  );
  const leaseIds = Array.from(
    new Set((awaiting || []).map((a) => a.lease_id).filter(Boolean)),
  );
  const attemptIds = (awaiting || []).map((a) => a.id);

  const [{ data: tenants }, { data: properties }, { data: events }] = await Promise.all([
    tenantIds.length
      ? supabaseServer
          .from("RENT_tenants")
          .select("id, full_name, first_name, last_name")
          .in("id", tenantIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    propertyIds.length
      ? supabaseServer
          .from("RENT_properties")
          .select("id, name, address")
          .in("id", propertyIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    attemptIds.length
      ? supabaseServer
          .from("RENT_v3_payment_attempt_events")
          .select("attempt_id, detail, created_at")
          .in("attempt_id", attemptIds)
          .eq("source", "portal_checkout")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ]);

  const tenantMap = new Map((tenants || []).map((t) => [t.id, t]));
  const propertyMap = new Map((properties || []).map((p) => [p.id, p]));
  const eventMap = new Map<string, { sender_name?: string; payment_note?: string }>();
  for (const ev of events || []) {
    if (eventMap.has(String(ev.attempt_id))) continue;
    const detail = (ev.detail || {}) as {
      sender_name?: string;
      payment_note?: string;
    };
    eventMap.set(String(ev.attempt_id), detail);
  }

  const awaitingEnriched = (awaiting || []).map((row) => {
    const tenant = tenantMap.get(row.tenant_id);
    const property = row.property_id ? propertyMap.get(row.property_id) : null;
    const ev = eventMap.get(row.id) || {};
    return {
      ...row,
      tenant_name:
        tenant?.full_name ||
        [tenant?.first_name, tenant?.last_name].filter(Boolean).join(" ") ||
        null,
      property_label: property?.address || property?.name || null,
      lease_id: row.lease_id,
      sender_name: ev.sender_name || null,
      payment_note: ev.payment_note || null,
      // Links for staff (paths only — no secrets)
      tenant_href: row.tenant_id ? `/tenants?highlight=${row.tenant_id}` : null,
      lease_href: row.lease_id ? `/leases?highlight=${row.lease_id}` : null,
      // leaseIds reserved for future balance join
      _leaseIdsCount: leaseIds.length,
    };
  }).map(({ _leaseIdsCount, ...rest }) => {
    void _leaseIdsCount;
    return rest;
  });

  const { data: exceptions } = await supabaseServer
    .from("RENT_v3_staff_exceptions")
    .select("*")
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({
    matches: matches || [],
    awaitingVerification: awaitingEnriched,
    exceptions: exceptions || [],
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth(request, { write: true });
  if (isAuthError(auth)) return auth;
  if (!isTenantPaymentPortalEnabled()) {
    return NextResponse.json({ error: "Feature disabled" }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?:
      | "confirm_attempt"
      | "reject_attempt"
      | "post_match"
      | "reject_match"
      | "mark_duplicate"
      | "mark_attempt_duplicate"
      | "leave_awaiting";
    attemptId?: string;
    matchId?: string;
    confirmedAmountCents?: number;
    receivedDate?: string;
    confirmedMethod?: string;
    reason?: string;
  };

  try {
    if (body.action === "confirm_attempt" && body.attemptId) {
      const { data: attempt } = await supabaseServer
        .from("RENT_v3_payment_attempts")
        .select("*")
        .eq("id", body.attemptId)
        .maybeSingle();
      if (!attempt) {
        return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
      }
      if (attempt.status !== "awaiting_verification") {
        return NextResponse.json(
          { error: "Attempt is not awaiting verification", status: attempt.status },
          { status: 409 },
        );
      }
      if (
        body.confirmedAmountCents != null &&
        Number(body.confirmedAmountCents) !== Number(attempt.rent_amount_cents)
      ) {
        return NextResponse.json(
          { error: "Confirmed amount must match the submitted amount" },
          { status: 400 },
        );
      }
      if (
        body.confirmedMethod &&
        body.confirmedMethod !== attempt.method
      ) {
        return NextResponse.json(
          { error: "Confirmed method must match the submitted method" },
          { status: 400 },
        );
      }

      await transitionAttempt({
        attemptId: body.attemptId,
        toStatus: "settled",
        source: "staff_confirm",
        detail: {
          userId: auth.user.id,
          receivedDate: body.receivedDate || getBusinessDate(),
          confirmedAmountCents: attempt.rent_amount_cents,
          confirmedMethod: attempt.method,
        },
      });
      const posted = await postSettledRentOnce(body.attemptId);
      return NextResponse.json({ ok: true, posted });
    }
    if (body.action === "reject_attempt" && body.attemptId) {
      await transitionAttempt({
        attemptId: body.attemptId,
        toStatus: "rejected_match",
        source: "staff_reject",
        detail: { userId: auth.user.id, reason: body.reason || null },
      });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "mark_attempt_duplicate" && body.attemptId) {
      await transitionAttempt({
        attemptId: body.attemptId,
        toStatus: "rejected_match",
        source: "staff_mark_duplicate",
        detail: {
          userId: auth.user.id,
          reason: body.reason || null,
          duplicate: true,
        },
      });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "leave_awaiting" && body.attemptId) {
      // No-op audit breadcrumb — remains awaiting_verification.
      await supabaseServer.from("RENT_v3_payment_attempt_events").insert({
        attempt_id: body.attemptId,
        from_status: "awaiting_verification",
        to_status: "awaiting_verification",
        source: "staff_leave_awaiting",
        detail: { userId: auth.user.id },
      });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "post_match" && body.matchId) {
      const { data: match } = await supabaseServer
        .from("RENT_v3_payment_match_candidates")
        .select("*, bank_transaction:RENT_v3_bank_transactions(*)")
        .eq("id", body.matchId)
        .single();
      if (!match?.tenant_id || !match?.lease_id) {
        return NextResponse.json({ error: "Match missing tenant/lease" }, { status: 400 });
      }
      const tx = match.bank_transaction as {
        amount_cents: number;
        is_pending: boolean;
        removed: boolean;
        provider_transaction_id: string;
        id: string;
      };
      if (tx.is_pending || tx.removed) {
        return NextResponse.json({ error: "Cannot post pending/removed deposit" }, { status: 400 });
      }

      const idempotencyKey = generateIdempotencyKey(`bank_${tx.provider_transaction_id}`);
      const { data: attempt, error } = await supabaseServer
        .from("RENT_v3_payment_attempts")
        .insert({
          tenant_id: match.tenant_id,
          lease_id: match.lease_id,
          property_id: match.property_id,
          method:
            String((tx as { classification?: string }).classification || "").includes("cash")
              ? "existing_cash_app"
              : "zelle",
          channel: "bank_import",
          status: "settled",
          rent_amount_cents: Math.abs(Number(tx.amount_cents)),
          fee_amount_cents: 0,
          total_charged_cents: Math.abs(Number(tx.amount_cents)),
          institution_transaction_id: tx.provider_transaction_id,
          idempotency_key: idempotencyKey,
          as_of_date: getBusinessDate(),
          settled_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (error || !attempt) {
        return NextResponse.json({ error: error?.message || "attempt_failed" }, { status: 500 });
      }

      const posted = await postSettledRentOnce(attempt.id);
      await supabaseServer
        .from("RENT_v3_payment_match_candidates")
        .update({
          status: "posted",
          posted_attempt_id: attempt.id,
          reviewed_by_auth_user_id: auth.user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", match.id);

      await supabaseServer
        .from("RENT_v3_bank_transactions")
        .update({ classification: "confirmed_tenant_payment" })
        .eq("id", tx.id);

      return NextResponse.json({ ok: true, posted, attemptId: attempt.id });
    }
    if (
      (body.action === "reject_match" || body.action === "mark_duplicate") &&
      body.matchId
    ) {
      await supabaseServer
        .from("RENT_v3_payment_match_candidates")
        .update({
          status: body.action === "mark_duplicate" ? "duplicate" : "rejected",
          reviewed_by_auth_user_id: auth.user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", body.matchId);
      return NextResponse.json({ ok: true });
    }

    void dollarsToCents;
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed" },
      { status: 500 },
    );
  }
}
