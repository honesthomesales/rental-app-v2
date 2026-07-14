import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { buildMissingInvoicePreview } from "@/lib/missing-invoice-preview";

/**
 * Read-only missing-invoice schedule preview.
 * Never inserts or updates invoices.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const leaseId = searchParams.get("leaseId");
    if (!leaseId) {
      return NextResponse.json({ error: "leaseId is required" }, { status: 400 });
    }

    const { data: lease, error: leaseError } = await supabaseServer
      .from("RENT_leases")
      .select(
        "id, rent, rent_cadence, rent_due_day, lease_start_date, lease_end_date, status",
      )
      .eq("id", leaseId)
      .single();

    if (leaseError || !lease) {
      return NextResponse.json(
        { error: "Lease not found" },
        { status: 404 },
      );
    }

    if (!lease.lease_start_date) {
      return NextResponse.json(
        { error: "Lease has no start date" },
        { status: 400 },
      );
    }

    const asOf = new Date().toISOString().split("T")[0];
    let endDate = lease.lease_end_date as string | null;
    if (!endDate) {
      const threeMonthsAhead = new Date(asOf + "T00:00:00");
      threeMonthsAhead.setMonth(threeMonthsAhead.getMonth() + 3);
      endDate = threeMonthsAhead.toISOString().split("T")[0];
    }

    const { data: existingInvoices, error: invoicesError } = await supabaseServer
      .from("RENT_invoices")
      .select("due_date")
      .eq("lease_id", leaseId)
      .gte("due_date", lease.lease_start_date)
      .lte("due_date", endDate);

    if (invoicesError) {
      return NextResponse.json(
        { error: "Failed to fetch existing invoices" },
        { status: 500 },
      );
    }

    const rows = buildMissingInvoicePreview({
      leaseStartDate: lease.lease_start_date,
      leaseEndDate: lease.lease_end_date,
      rentCadence: lease.rent_cadence,
      rentDueDay: lease.rent_due_day,
      rentAmount: lease.rent,
      existingDueDates: (existingInvoices || []).map(
        (inv: { due_date: string }) => inv.due_date,
      ),
      asOfDate: asOf,
    });

    return NextResponse.json({
      leaseId,
      asOfDate: asOf,
      previewOnly: true,
      writePerformed: false,
      count: rows.length,
      rows,
    });
  } catch (error) {
    console.error("Error in missing-invoice preview API");
    return NextResponse.json(
      {
        error: "Failed to build missing-invoice preview",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
