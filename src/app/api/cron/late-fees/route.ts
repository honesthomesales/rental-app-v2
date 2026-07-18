import { NextRequest, NextResponse } from "next/server";
import { getBusinessDate } from "@/lib/business-date";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * Cron-compatible daily late-fee reconciliation.
 * Requires Authorization: Bearer $CRON_SECRET (or ?secret=).
 * Never runs automatically without host scheduler configuration.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization") || "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  const urlSecret = new URL(request.url).searchParams.get("secret");
  if (bearer !== secret && urlSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Installing the release must not backfill existing invoices automatically.
  // Owner enables daily apply only after reviewing/applying the explicit preview.
  const automationEnabled =
    process.env.LATE_FEE_AUTOMATION_ENABLED?.toLowerCase() === "true";

  const businessDate =
    new URL(request.url).searchParams.get("businessDate") || getBusinessDate();
  const requestedDryRun =
    new URL(request.url).searchParams.get("dryRun") === "1" ||
    new URL(request.url).searchParams.get("preview") === "1";
  const dryRun = requestedDryRun || !automationEnabled;

  const { data, error } = await supabaseServer.rpc("rent_reconcile_late_fees", {
    p_business_date: businessDate,
    p_invoice_ids: null,
    p_dry_run: dryRun,
  });

  if (error) {
    console.error("cron late-fee reconcile failed:", error);
    return NextResponse.json(
      { error: "Reconcile failed", details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ...(typeof data === "object" && data !== null ? data : {}),
    writePerformed: !dryRun,
    automationEnabled,
    requiresOwnerEnablement: !automationEnabled,
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
