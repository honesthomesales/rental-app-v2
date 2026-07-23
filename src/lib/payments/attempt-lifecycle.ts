import { supabaseServer } from "@/lib/supabase-server";
import {
  canTransition,
  isTerminalAttemptState,
  type PaymentAttemptState,
} from "@/lib/payments/types";
import { generateReceiptNumber } from "@/lib/payments/tokens";
import { getBusinessDate } from "@/lib/business-date";

export async function transitionAttempt(args: {
  attemptId: string;
  toStatus: PaymentAttemptState;
  source: string;
  detail?: Record<string, unknown>;
}): Promise<{ ok: boolean; status?: string; error?: string }> {
  const { data: attempt, error } = await supabaseServer
    .from("RENT_v3_payment_attempts")
    .select("*")
    .eq("id", args.attemptId)
    .single();

  if (error || !attempt) return { ok: false, error: "ATTEMPT_NOT_FOUND" };

  const from = attempt.status as PaymentAttemptState;
  if (from === args.toStatus) return { ok: true, status: from };

  if (
    isTerminalAttemptState(from) &&
    !canTransition(from, args.toStatus)
  ) {
    return { ok: false, error: "TERMINAL_STATE", status: from };
  }
  if (!canTransition(from, args.toStatus)) {
    return { ok: false, error: "INVALID_TRANSITION", status: from };
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: args.toStatus,
    updated_at: now,
  };
  if (args.toStatus === "submitted") patch.submitted_at = now;
  if (args.toStatus === "pending" || args.toStatus === "processing") {
    patch.pending_at = now;
  }
  if (args.toStatus === "settled") patch.settled_at = now;
  if (args.toStatus === "failed") patch.failed_at = now;
  if (args.toStatus === "returned") patch.returned_at = now;
  if (args.toStatus === "refunded") patch.refunded_at = now;
  if (args.toStatus === "disputed") patch.disputed_at = now;
  if (args.toStatus === "canceled") patch.canceled_at = now;
  if (args.toStatus === "expired") patch.expired_at = now;

  const { error: updErr } = await supabaseServer
    .from("RENT_v3_payment_attempts")
    .update(patch)
    .eq("id", args.attemptId)
    .eq("status", from);

  if (updErr) return { ok: false, error: updErr.message };

  await supabaseServer.from("RENT_v3_payment_attempt_events").insert({
    attempt_id: args.attemptId,
    from_status: from,
    to_status: args.toStatus,
    source: args.source,
    detail: args.detail || {},
  });

  return { ok: true, status: args.toStatus };
}

/**
 * Post rent portion once via existing RENT_payments path (triggers update invoices).
 * Fee is NOT inserted as rent.
 */
export async function postSettledRentOnce(attemptId: string): Promise<{
  ok: boolean;
  paymentId?: string;
  receiptId?: string;
  error?: string;
}> {
  const { data: attempt, error } = await supabaseServer
    .from("RENT_v3_payment_attempts")
    .select("*")
    .eq("id", attemptId)
    .single();

  if (error || !attempt) return { ok: false, error: "ATTEMPT_NOT_FOUND" };
  if (attempt.posted_payment_id) {
    return { ok: true, paymentId: attempt.posted_payment_id, receiptId: attempt.receipt_id };
  }
  if (attempt.status !== "settled") {
    return { ok: false, error: "NOT_SETTLED" };
  }

  const rentDollars = Number(attempt.rent_amount_cents) / 100;
  const paymentDate = attempt.as_of_date || getBusinessDate();

  // Oldest open invoice (same approach as staff POST)
  const { data: invoices } = await supabaseServer
    .from("RENT_invoices")
    .select("id, balance_due, status, due_date")
    .eq("lease_id", attempt.lease_id)
    .in("status", ["OPEN", "PARTIAL"])
    .gt("balance_due", 0)
    .order("due_date", { ascending: true })
    .limit(1);

  const invoiceId = invoices?.[0]?.id || null;

  const methodLabel =
    attempt.method === "ach"
      ? "ACH (Portal)"
      : attempt.method === "cash_app_pay"
        ? "Cash App Pay (Portal)"
        : attempt.method === "existing_cash_app"
          ? "Cash App (Verified)"
          : attempt.method === "zelle"
            ? "Zelle (Verified)"
            : "Card (Portal)";

  const { data: payment, error: payErr } = await supabaseServer
    .from("RENT_payments")
    .insert({
      tenant_id: attempt.tenant_id,
      lease_id: attempt.lease_id,
      property_id: attempt.property_id,
      amount: rentDollars,
      payment_date: paymentDate,
      payment_method: methodLabel,
      payment_type: "Rent",
      status: "completed",
      notes: `Portal attempt ${attempt.id}`,
      invoice_id: invoiceId,
    })
    .select("id")
    .single();

  if (payErr || !payment) {
    return { ok: false, error: payErr?.message || "PAYMENT_INSERT_FAILED" };
  }

  const receiptNumber = generateReceiptNumber();
  const { data: receipt, error: recErr } = await supabaseServer
    .from("RENT_v3_payment_receipts")
    .insert({
      receipt_number: receiptNumber,
      attempt_id: attempt.id,
      tenant_id: attempt.tenant_id,
      lease_id: attempt.lease_id,
      property_id: attempt.property_id,
      rent_amount_cents: attempt.rent_amount_cents,
      fee_amount_cents: attempt.fee_amount_cents,
      total_charged_cents: attempt.total_charged_cents,
      amount_applied_cents: attempt.rent_amount_cents,
      pending_amount_cents: 0,
      method: attempt.method,
      status: "settled",
      provider_reference: attempt.provider_payment_id,
      submitted_at: attempt.submitted_at || attempt.created_at,
    })
    .select("id")
    .single();

  if (recErr || !receipt) {
    // Payment already posted — record exception, do not double-insert payment.
    await supabaseServer.from("RENT_v3_staff_exceptions").insert({
      kind: "receipt_create_failed",
      severity: "high",
      tenant_id: attempt.tenant_id,
      attempt_id: attempt.id,
      detail: { error: recErr?.message, paymentId: payment.id },
    });
  }

  await supabaseServer
    .from("RENT_v3_payment_attempts")
    .update({
      posted_payment_id: payment.id,
      receipt_id: receipt?.id || null,
      amount_applied_to_rent_cents: attempt.rent_amount_cents,
      updated_at: new Date().toISOString(),
    })
    .eq("id", attempt.id)
    .is("posted_payment_id", null);

  return {
    ok: true,
    paymentId: payment.id,
    receiptId: receipt?.id,
  };
}
