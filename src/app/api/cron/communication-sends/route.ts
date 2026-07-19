import { NextResponse } from "next/server";
import { getBusinessDate } from "@/lib/business-date";
import { listApprovedOrScheduledForDelivery } from "@/lib/communications/approval-store";
import {
  isCommunicationScheduledSendsEnabled,
  isTenantCommunicationsEnabled,
} from "@/lib/communications/feature-flag";
import { loadCommunicationLedgerAccounts } from "@/lib/communications/ledger-facts";
import {
  isApprovalDue,
  processApprovedCommunication,
} from "@/lib/communications/submission";

function authorized(request: Request): boolean {
  const configured = String(
    process.env.COMMUNICATION_SEND_CRON_SECRET ||
      process.env.COMMUNICATION_DRAFT_CRON_SECRET ||
      process.env.CRON_SECRET ||
      "",
  ).trim();
  return Boolean(
    configured &&
      request.headers.get("authorization") === `Bearer ${configured}`,
  );
}

/**
 * Delivers only owner-approved records. This endpoint never transitions a
 * pending_approval record and never creates an approval.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    !isTenantCommunicationsEnabled() ||
    !isCommunicationScheduledSendsEnabled()
  ) {
    return NextResponse.json({
      ok: true,
      enabled: false,
      sent: 0,
      scheduled: 0,
      stale: 0,
      blocked: 0,
      failed: 0,
    });
  }

  try {
    const now = new Date();
    const businessDate = getBusinessDate();
    const drafts = (await listApprovedOrScheduledForDelivery()).filter(
      (draft) => isApprovalDue(draft, now),
    );
    const accounts = drafts.some((draft) => draft.lease_id)
      ? await loadCommunicationLedgerAccounts(businessDate)
      : [];
    const counts = {
      sent: 0,
      scheduled: 0,
      stale: 0,
      blocked: 0,
      failed: 0,
      providerDisabled: 0,
      alreadyClaimed: 0,
    };

    for (const draft of drafts) {
      const result = await processApprovedCommunication({
        draft,
        businessDate,
        allowedFrom: ["approved", "scheduled"],
        requireExistingApproval: true,
        now,
        accounts,
      });
      if (result.kind === "sent") counts.sent += 1;
      else if (result.kind === "scheduled") counts.scheduled += 1;
      else if (result.kind === "stale") counts.stale += 1;
      else if (result.kind === "blocked") counts.blocked += 1;
      else if (result.kind === "failed") counts.failed += 1;
      else if (result.kind === "provider_disabled") counts.providerDisabled += 1;
      else if (result.kind === "already_claimed") counts.alreadyClaimed += 1;
    }

    console.info("scheduled communication processing complete", {
      candidates: drafts.length,
      ...counts,
    });
    return NextResponse.json({
      ok: true,
      candidates: drafts.length,
      ...counts,
    });
  } catch {
    console.error("scheduled communication processing failed");
    return NextResponse.json(
      { error: "Scheduled communication processing failed" },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
