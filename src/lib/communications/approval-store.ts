import { supabaseServer } from "@/lib/supabase-server";
import type {
  CommunicationApproval,
  CommunicationApprovalStatus,
} from "./types";
import type { DraftInput } from "./approval";

function mapApproval(row: Record<string, unknown>): CommunicationApproval {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    property_id: (row.property_id as string) || null,
    lease_id: (row.lease_id as string) || null,
    trigger_type:
      row.trigger_type as CommunicationApproval["trigger_type"],
    template_key: (row.template_key as string) || null,
    body: String(row.body || ""),
    status: row.status as CommunicationApprovalStatus,
    generated_as_of_date: String(row.generated_as_of_date || ""),
    generated_ledger_version: String(row.generated_ledger_version || ""),
    balance_snapshot: Number(row.balance_snapshot) || 0,
    days_late_snapshot:
      row.days_late_snapshot == null ? null : Number(row.days_late_snapshot),
    generation_reason: String(row.generation_reason || ""),
    idempotency_key: String(row.idempotency_key || ""),
    phone_snapshot: (row.phone_snapshot as string) || null,
    not_before: (row.not_before as string) || null,
    created_by_auth_user_id:
      (row.created_by_auth_user_id as string) || null,
    approved_by_auth_user_id:
      (row.approved_by_auth_user_id as string) || null,
    approved_at: (row.approved_at as string) || null,
    rejected_at: (row.rejected_at as string) || null,
    cancelled_at: (row.cancelled_at as string) || null,
    sent_communication_id:
      (row.sent_communication_id as string) || null,
    stale_reason: (row.stale_reason as string) || null,
    provider_error_code: (row.provider_error_code as string) || null,
    provider_error_message: (row.provider_error_message as string) || null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  };
}

export async function createApprovalDraft(
  input: DraftInput,
): Promise<{ draft: CommunicationApproval; duplicate: boolean }> {
  const row = {
    tenant_id: input.tenantId,
    property_id: input.propertyId || null,
    lease_id: input.leaseId || null,
    trigger_type: input.triggerType,
    template_key: input.templateKey || null,
    body: input.body.trim(),
    status: "pending_approval",
    generated_as_of_date: input.generatedAsOfDate,
    generated_ledger_version: input.generatedLedgerVersion,
    balance_snapshot: input.balanceSnapshot,
    days_late_snapshot: input.daysLateSnapshot ?? null,
    generation_reason: input.generationReason,
    idempotency_key: input.idempotencyKey,
    phone_snapshot: input.phoneSnapshot || null,
    created_by_auth_user_id: input.createdByAuthUserId || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseServer
    .from("RENT_communication_approvals")
    .insert(row)
    .select("*")
    .single();

  if (!error && data) {
    return {
      draft: mapApproval(data as Record<string, unknown>),
      duplicate: false,
    };
  }

  // Idempotency collisions return the existing record.
  if (error?.code === "23505") {
    const { data: existing, error: existingError } = await supabaseServer
      .from("RENT_communication_approvals")
      .select("*")
      .eq("idempotency_key", input.idempotencyKey)
      .single();
    if (!existingError && existing) {
      return {
        draft: mapApproval(existing as Record<string, unknown>),
        duplicate: true,
      };
    }
  }
  throw new Error(error?.message || "Failed to create approval draft");
}

export async function getApprovalDraft(
  id: string,
): Promise<CommunicationApproval | null> {
  const { data, error } = await supabaseServer
    .from("RENT_communication_approvals")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapApproval(data as Record<string, unknown>) : null;
}

export async function listApprovalDrafts(options?: {
  status?: string | null;
  limit?: number;
}): Promise<CommunicationApproval[]> {
  let query = supabaseServer
    .from("RENT_communication_approvals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(options?.limit || 200, 500));
  if (options?.status) query = query.eq("status", options.status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((row) =>
    mapApproval(row as Record<string, unknown>),
  );
}

export async function listApprovedOrScheduledForDelivery(
  limit = 100,
): Promise<CommunicationApproval[]> {
  const { data, error } = await supabaseServer
    .from("RENT_communication_approvals")
    .select("*")
    .in("status", ["approved", "scheduled"])
    .not("approved_by_auth_user_id", "is", null)
    .not("approved_at", "is", null)
    .order("not_before", { ascending: true, nullsFirst: true })
    .limit(Math.min(limit, 500));
  if (error) throw new Error(error.message);
  return (data || []).map((row) =>
    mapApproval(row as Record<string, unknown>),
  );
}

export async function transitionApproval(
  id: string,
  allowedFrom: CommunicationApprovalStatus[],
  patch: Record<string, unknown>,
): Promise<CommunicationApproval | null> {
  const { data, error } = await supabaseServer
    .from("RENT_communication_approvals")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", allowedFrom)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapApproval(data as Record<string, unknown>) : null;
}

