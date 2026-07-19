import { NextResponse } from "next/server";
import { getBusinessDate } from "@/lib/business-date";
import { authorizeCommunicationCron } from "@/lib/communications/cron-auth";
import {
  isCommunicationDraftGeneratorEnabled,
  isTenantCommunicationsEnabled,
} from "@/lib/communications/feature-flag";
import { generateAutomaticCommunicationDrafts } from "@/lib/communications/draft-generator";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Secure draft generator. Creates approval drafts only and never sends SMS.
 * Vercel Cron invokes GET; POST remains available for manual testing.
 */
async function handler(request: Request) {
  const authError = authorizeCommunicationCron(request, [
    "COMMUNICATION_DRAFT_CRON_SECRET",
    "CRON_SECRET",
  ]);
  if (authError) return authError;

  if (
    !isTenantCommunicationsEnabled() ||
    !isCommunicationDraftGeneratorEnabled()
  ) {
    return NextResponse.json({
      ok: true,
      enabled: false,
      created: 0,
      duplicates: 0,
      sent: 0,
    });
  }

  try {
    const result = await generateAutomaticCommunicationDrafts(
      getBusinessDate(),
    );
    console.info("communication draft generation complete", {
      created: result.created,
      duplicates: result.duplicates,
      eligible: result.eligible,
    });
    return NextResponse.json({ ok: true, ...result, sent: 0 });
  } catch {
    console.error("communication draft generation failed");
    return NextResponse.json(
      { error: "Draft generation failed" },
      { status: 500 },
    );
  }
}

export const GET = handler;
export const POST = handler;
