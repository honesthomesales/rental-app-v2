import { NextResponse } from "next/server";
import { getBusinessDate } from "@/lib/business-date";
import {
  isCommunicationDraftGeneratorEnabled,
  isTenantCommunicationsEnabled,
} from "@/lib/communications/feature-flag";
import { generateAutomaticCommunicationDrafts } from "@/lib/communications/draft-generator";

function authorized(request: Request): boolean {
  const configured = String(
    process.env.COMMUNICATION_DRAFT_CRON_SECRET ||
      process.env.CRON_SECRET ||
      "",
  ).trim();
  if (!configured) return false;
  return request.headers.get("authorization") === `Bearer ${configured}`;
}

/** Secure daily generator. It creates approval drafts and never sends SMS. */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

