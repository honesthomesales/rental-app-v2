import { NextRequest, NextResponse } from "next/server";
import { getBusinessDate } from "@/lib/business-date";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function authorizeCron(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }
  const bearer = (request.headers.get("authorization") || "").match(
    /^Bearer\s+(.+)$/i,
  )?.[1];
  if (bearer !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** Authorized health/preview check. GET never performs financial writes. */
export async function GET(request: NextRequest) {
  const authError = authorizeCron(request);
  if (authError) return authError;

  const businessDate = getBusinessDate();
  const { data, error } = await supabaseServer.rpc("rent_reconcile_late_fees", {
    p_business_date: businessDate,
    p_invoice_ids: null,
    p_dry_run: true,
  });
  if (error) {
    return NextResponse.json({ error: "Reconcile preview failed" }, { status: 500 });
  }
  return NextResponse.json({
    ...(data && typeof data === "object" ? data : {}),
    previewOnly: true,
    writePerformed: false,
  });
}

/** Secure scheduler action. Disabled until owner approves the first valid-ID apply. */
export async function POST(request: NextRequest) {
  const authError = authorizeCron(request);
  if (authError) return authError;

  const automationEnabled =
    process.env.LATE_FEE_AUTOMATION_ENABLED?.toLowerCase() === "true";
  if (!automationEnabled) {
    return NextResponse.json({
      automationEnabled: false,
      writePerformed: false,
      reason: "owner_enablement_required",
    });
  }

  const businessDate = getBusinessDate();
  const { data, error } = await supabaseServer.rpc("rent_reconcile_late_fees", {
    p_business_date: businessDate,
    p_invoice_ids: null,
    p_dry_run: false,
  });
  if (error) {
    console.error("late-fee cron reconciliation failed");
    return NextResponse.json({ error: "Reconcile failed" }, { status: 500 });
  }

  const result =
    data && typeof data === "object"
      ? (data as Record<string, unknown>)
      : {};
  console.info("late-fee cron summary", {
    businessDate,
    applied: Number(result.applied || 0),
    feeTotal: Number(result.feeTotal || 0),
  });
  return NextResponse.json({
    businessDate,
    applied: Number(result.applied || 0),
    feeTotal: Number(result.feeTotal || 0),
    automationEnabled: true,
    writePerformed: true,
  });
}
