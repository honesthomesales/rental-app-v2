import { NextResponse } from "next/server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { getBusinessDate } from "@/lib/business-date";
import { isTenantCommunicationsEnabled } from "@/lib/communications/feature-flag";
import {
  getApprovalDraft,
  transitionApproval,
} from "@/lib/communications/approval-store";
import { processApprovedCommunication } from "@/lib/communications/submission";
import type { CommunicationApprovalStatus } from "@/lib/communications/types";

const ACTIONABLE: CommunicationApprovalStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "scheduled",
];

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth(request, { ownerOnly: true });
  if (isAuthError(auth)) return auth;
  if (!isTenantCommunicationsEnabled()) {
    return NextResponse.json(
      { error: "Tenant Communication Center is disabled" },
      { status: 403 },
    );
  }

  try {
    const { id } = await context.params;
    const body = await request.json();
    const action = String(body.action || "");
    const draft = await getApprovalDraft(id);
    if (!draft) {
      return NextResponse.json({ error: "Approval not found" }, { status: 404 });
    }

    if (action === "reject" || action === "cancel") {
      const now = new Date().toISOString();
      const updated = await transitionApproval(id, ACTIONABLE, {
        status: action === "reject" ? "rejected" : "cancelled",
        rejected_at: action === "reject" ? now : null,
        cancelled_at: action === "cancel" ? now : null,
      });
      if (!updated) {
        return NextResponse.json(
          { error: "Approval is no longer actionable" },
          { status: 409 },
        );
      }
      return NextResponse.json({ ok: true, draft: updated, sent: false });
    }

    if (action !== "approve_send") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    if (draft.status === "sent" || draft.status === "delivered") {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        sent: true,
        draft,
      });
    }

    const result = await processApprovedCommunication({
      draft,
      businessDate: getBusinessDate(),
      allowedFrom: ACTIONABLE,
      approvedByAuthUserId: auth.user.id,
      requireExistingApproval: false,
    });

    if (result.kind === "scheduled") {
      return NextResponse.json({
        ok: true,
        sent: false,
        scheduled: true,
        draft: result.draft,
      });
    }
    if (result.kind === "sent") {
      return NextResponse.json({
        ok: true,
        sent: true,
        duplicate: result.duplicate,
        draft: result.draft,
      });
    }
    if (result.kind === "provider_disabled") {
      return NextResponse.json(
        {
          error: result.reason,
          code: "PROVIDER_DISABLED",
          sent: false,
        },
        { status: 503 },
      );
    }
    if (result.kind === "stale" || result.kind === "blocked") {
      return NextResponse.json(
        { error: result.reason, sent: false, draft: result.draft },
        { status: 409 },
      );
    }
    if (result.kind === "failed") {
      return NextResponse.json(
        { error: "Provider submission failed", sent: false, draft: result.draft },
        { status: 502 },
      );
    }
    const latest = result.draft || (await getApprovalDraft(id));
    return NextResponse.json(
      {
        ok: latest?.status === "sent" || latest?.status === "delivered",
        duplicate: true,
        sent: latest?.status === "sent" || latest?.status === "delivered",
        draft: latest,
      },
      { status: latest?.status === "sending" ? 202 : 409 },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to process communication approval" },
      { status: 500 },
    );
  }
}

