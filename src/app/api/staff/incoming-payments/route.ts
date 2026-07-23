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

  const { data: exceptions } = await supabaseServer
    .from("RENT_v3_staff_exceptions")
    .select("*")
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({
    matches: matches || [],
    awaitingVerification: awaiting || [],
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
    action?: "confirm_attempt" | "reject_attempt" | "post_match" | "reject_match" | "mark_duplicate";
    attemptId?: string;
    matchId?: string;
  };

  try {
    if (body.action === "confirm_attempt" && body.attemptId) {
      await transitionAttempt({
        attemptId: body.attemptId,
        toStatus: "settled",
        source: "staff_confirm",
        detail: { userId: auth.user.id },
      });
      const posted = await postSettledRentOnce(body.attemptId);
      return NextResponse.json({ ok: true, posted });
    }
    if (body.action === "reject_attempt" && body.attemptId) {
      await transitionAttempt({
        attemptId: body.attemptId,
        toStatus: "rejected_match",
        source: "staff_reject",
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
