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

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
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
  const automationStartDate = String(
    process.env.LATE_FEE_AUTOMATION_START_DATE || "",
  ).split("T")[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(automationStartDate)) {
    return NextResponse.json(
      {
        error: "LATE_FEE_AUTOMATION_START_DATE is not configured",
        writePerformed: false,
      },
      { status: 503 },
    );
  }
  if (businessDate < automationStartDate) {
    return NextResponse.json({
      automationEnabled: true,
      automationStartDate,
      businessDate,
      writePerformed: false,
      reason: "automation_start_date_not_reached",
    });
  }

  // Never backfill invoices that became late before automation activation.
  // Catch up safely after scheduler downtime only within the post-activation window.
  const firstEligibleDueDate = addDays(automationStartDate, -6);
  const latestEligibleDueDate = addDays(businessDate, -6);
  const { data: candidateInvoices, error: candidateError } =
    await supabaseServer
      .from("RENT_invoices")
      .select("id")
      .in("status", ["OPEN", "PARTIAL"])
      .gte("due_date", firstEligibleDueDate)
      .lte("due_date", latestEligibleDueDate);
  if (candidateError) {
    console.error("late-fee cron candidate selection failed");
    return NextResponse.json(
      { error: "Candidate selection failed", writePerformed: false },
      { status: 500 },
    );
  }
  const candidateInvoiceIds = (candidateInvoices || []).map((invoice) =>
    String(invoice.id),
  );
  if (candidateInvoiceIds.length === 0) {
    return NextResponse.json({
      businessDate,
      automationStartDate,
      applied: 0,
      feeTotal: 0,
      writePerformed: false,
    });
  }

  const { data, error } = await supabaseServer.rpc("rent_reconcile_late_fees", {
    p_business_date: businessDate,
    p_invoice_ids: candidateInvoiceIds,
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
    automationStartDate,
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
