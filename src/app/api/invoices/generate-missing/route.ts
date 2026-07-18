import { NextResponse } from "next/server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { getBusinessDate } from "@/lib/business-date";
import { generateMissingFutureInvoicesOnly } from "@/lib/invoice-scheduler";
import { isActiveBillingLease } from "@/lib/lease-status";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * Explicit authenticated scheduler action.
 * GET/page loads never invoke this route and this route never creates past rows.
 */
export async function POST(request: Request) {
  const auth = await requireApiAuth(request, { write: true });
  if (isAuthError(auth)) return auth;

  try {
    const { leaseId, scheduleStart } = await request.json();
    if (!leaseId) {
      return NextResponse.json(
        { error: "leaseId is required" },
        { status: 400 },
      );
    }

    const { data: lease, error } = await supabaseServer
      .from("RENT_leases")
      .select(
        "id, property_id, tenant_id, rent, rent_cadence, rent_due_day, lease_end_date, status, cadence_effective_date",
      )
      .eq("id", leaseId)
      .single();
    if (error || !lease) {
      return NextResponse.json({ error: "Lease not found" }, { status: 404 });
    }
    if (!isActiveBillingLease(lease.status)) {
      return NextResponse.json(
        { error: "Lease is not active for billing" },
        { status: 400 },
      );
    }

    const businessDate = getBusinessDate();
    const requestedStart = String(
      scheduleStart || lease.cadence_effective_date || businessDate,
    ).split("T")[0];
    if (requestedStart < businessDate) {
      return NextResponse.json(
        { error: "Scheduler cannot create historical invoices" },
        { status: 400 },
      );
    }

    const result = await generateMissingFutureInvoicesOnly({
      lease,
      scheduleStart: requestedStart,
    });
    return NextResponse.json({
      success: true,
      businessDate,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to generate future invoices",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
