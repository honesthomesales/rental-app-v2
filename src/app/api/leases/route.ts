import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { normalizeCadence } from "@/lib/rent/cadence";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { getBusinessDate } from "@/lib/business-date";
import {
  isActiveBillingLease,
  normalizeLeaseStatus,
  resolveInvoiceScheduleEnd,
} from "@/lib/lease-status";
import {
  buildRentChangePreview,
  rentAmountForDueDate,
  type InvoiceForRentChange,
} from "@/lib/rent-change";
import { partitionPaymentsByAsOf } from "@/lib/payment-eligibility";

// Cache leases for 60 seconds - they don't change frequently
export const revalidate = 60;

export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (isAuthError(auth)) return auth;
  // Accept query parameters (like cache-busting timestamps) but ignore them
  try {
    const { data: leases, error } = await supabaseServer
      .from("RENT_leases")
      .select(
        `
        *,
        RENT_properties(*),
        RENT_tenants(*)
      `,
      )
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Error fetching leases: ${error.message}`);
    }

    // Read-only: never auto-expire or write on GET.
    // Occupied/eviction leases past lease_end_date remain period-to-period.
    return NextResponse.json(leases || []);
  } catch (error) {
    console.error("Error in leases API:", error);
    return NextResponse.json(
      { error: "Failed to fetch leases" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireApiAuth(request, { write: true });
  if (isAuthError(auth)) return auth;
  try {
    const leaseData = await request.json();

    if (!leaseData.status) {
      leaseData.status = "occupied";
    }
    leaseData.status = normalizeLeaseStatus(leaseData.status);

    // Do not auto-expire on create. Status is authoritative.

    const { data: insertedLease, error: insertError } = await supabaseServer
      .from("RENT_leases")
      .insert(leaseData)
      .select()
      .single();

    if (insertError) {
      console.error("Error creating lease:", insertError);
      return NextResponse.json(
        {
          error: "Failed to create lease",
          details: insertError.message,
          hint: insertError.hint,
          code: insertError.code,
        },
        { status: 500 },
      );
    }

    if (!insertedLease) {
      return NextResponse.json(
        {
          error: "Failed to create lease",
          details: "Insert succeeded but no data returned",
        },
        { status: 500 },
      );
    }

    const { data: fullLease, error: fetchError } = await supabaseServer
      .from("RENT_leases")
      .select(
        `
        *,
        RENT_properties(*),
        RENT_tenants(*)
      `,
      )
      .eq("id", insertedLease.id)
      .single();

    if (fetchError) {
      return NextResponse.json(insertedLease);
    }

    return NextResponse.json(fullLease || insertedLease);
  } catch (error) {
    console.error("Error in lease creation API:", error);
    return NextResponse.json(
      {
        error: "Failed to create lease",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const auth = await requireApiAuth(request, { write: true });
  if (isAuthError(auth)) return auth;
  try {
    const body = await request.json();
    const { id, rentEffectiveDate, previewOnly, ...rawUpdate } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Lease ID is required" },
        { status: 400 },
      );
    }

    const { data: currentLease, error: fetchError } = await supabaseServer
      .from("RENT_leases")
      .select(
        "lease_start_date, lease_end_date, rent, rent_cadence, rent_due_day, property_id, tenant_id, status",
      )
      .eq("id", id)
      .single();

    if (fetchError || !currentLease) {
      return NextResponse.json({ error: "Lease not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = { ...rawUpdate };
    if (updateData.status != null) {
      updateData.status = normalizeLeaseStatus(String(updateData.status));
    }

    const businessDate = getBusinessDate();
    const newRent =
      updateData.rent !== undefined
        ? Number(updateData.rent)
        : Number(currentLease.rent);
    const rentChanged =
      updateData.rent !== undefined &&
      Number(updateData.rent) !== Number(currentLease.rent);

    const cadenceChanged =
      updateData.rent_cadence != null &&
      updateData.rent_cadence !== currentLease.rent_cadence;
    const dueDayChanged =
      updateData.rent_due_day !== undefined &&
      updateData.rent_due_day !== currentLease.rent_due_day;
    const startChanged =
      updateData.lease_start_date != null &&
      updateData.lease_start_date !== currentLease.lease_start_date;

    const effectiveDate =
      rentEffectiveDate != null && String(rentEffectiveDate).trim() !== ""
        ? String(rentEffectiveDate).split("T")[0]
        : businessDate;

    if (rentChanged && !effectiveDate) {
      return NextResponse.json(
        { error: "rentEffectiveDate is required when rent changes" },
        { status: 400 },
      );
    }

    // Ending Empty/Sold: lease_end_date should be set by client (actual ending date).
    // Never auto-force status from dates.

    if (previewOnly) {
      const { data: invoices } = await supabaseServer
        .from("RENT_invoices")
        .select(
          "id, due_date, status, amount_rent, amount_late, amount_other, amount_total, amount_paid, balance_due",
        )
        .eq("lease_id", id);

      const preview = await buildLeaseRentPreview({
        leaseId: id,
        invoices: invoices || [],
        oldRent: Number(currentLease.rent),
        newRent,
        effectiveDate,
        businessDate,
      });

      return NextResponse.json({
        previewOnly: true,
        writePerformed: false,
        leaseId: id,
        currentRent: currentLease.rent,
        ...preview,
      });
    }

    // Persist lease row first (terms / status)
    const { data: updatedLease, error: updateError } = await supabaseServer
      .from("RENT_leases")
      .update(updateData)
      .eq("id", id)
      .select(
        `
        *,
        RENT_properties(*),
        RENT_tenants(*)
      `,
      )
      .single();

    if (updateError) {
      console.error("Error updating lease:", updateError);
      throw new Error(`Supabase error: ${updateError.message}`);
    }

    let rentApplyResult: unknown = null;

    // Prospective rent updates on OPEN/PARTIAL invoices due on or after effective date
    if (rentChanged) {
      const { data: invoices } = await supabaseServer
        .from("RENT_invoices")
        .select(
          "id, due_date, status, amount_rent, amount_late, amount_other, amount_total, amount_paid, balance_due",
        )
        .eq("lease_id", id);

      const preview = await buildLeaseRentPreview({
        leaseId: id,
        invoices: invoices || [],
        oldRent: Number(currentLease.rent),
        newRent,
        effectiveDate,
        businessDate,
      });

      for (const patch of preview.patches) {
        const { error: patchError } = await supabaseServer
          .from("RENT_invoices")
          .update({
            amount_rent: patch.new_amount_rent,
            amount_total: patch.new_amount_total,
            amount_paid: patch.amount_paid,
            balance_due: patch.new_balance_due,
            status: patch.new_status,
            paid_in_full_at:
              patch.new_status === "PAID"
                ? new Date().toISOString()
                : null,
          })
          .eq("id", patch.id)
          .in("status", ["OPEN", "PARTIAL"]);

        if (patchError) {
          console.error("Error patching invoice rent:", patch.id, patchError);
        }
      }

      rentApplyResult = {
        effectiveDate,
        affectedInvoiceCount: preview.affectedInvoiceCount,
        totalBalanceChange: preview.totalBalanceChange,
        skippedPast: preview.skippedPast,
      };
    }

    // Cadence / due-day / start changes: never delete invoices with payments.
    // Only create missing future invoices at new terms when billing is active.
    if (
      (cadenceChanged || dueDayChanged || startChanged || rentChanged) &&
      isActiveBillingLease(updatedLease.status)
    ) {
      const scheduleStart =
        (updateData.lease_start_date as string) ||
        currentLease.lease_start_date ||
        businessDate;
      await generateMissingFutureInvoicesOnly(updatedLease, scheduleStart, {
        rentEffectiveDate: rentChanged ? effectiveDate : null,
        priorRent: rentChanged ? Number(currentLease.rent) : null,
      });
    }

    return NextResponse.json({
      ...updatedLease,
      rentApplyResult,
      writePerformed: true,
    });
  } catch (error) {
    console.error("Error in lease update API:", error);
    return NextResponse.json(
      {
        error: "Failed to update lease",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

async function buildLeaseRentPreview(args: {
  leaseId: string;
  invoices: Array<{
    id: string;
    due_date: string;
    status: string;
    amount_rent: number;
    amount_late: number;
    amount_other: number;
    amount_total: number;
    amount_paid: number;
    balance_due: number;
  }>;
  oldRent: number;
  newRent: number;
  effectiveDate: string;
  businessDate: string;
}) {
  const { data: payments } = await supabaseServer
    .from("RENT_payments")
    .select("invoice_id, amount, payment_date, status")
    .eq("lease_id", args.leaseId)
    .eq("status", "completed")
    .not("invoice_id", "is", null);

  const { eligible } = partitionPaymentsByAsOf(
    (payments || []) as Array<{
      invoice_id: string;
      amount: number;
      payment_date: string;
      status: string;
    }>,
    args.businessDate,
  );

  const paidByInvoice = new Map<string, number>();
  for (const p of eligible) {
    if (!p.invoice_id) continue;
    paidByInvoice.set(
      p.invoice_id,
      (paidByInvoice.get(p.invoice_id) || 0) +
        (parseFloat(String(p.amount)) || 0),
    );
  }

  const invoiceRows: InvoiceForRentChange[] = args.invoices.map((inv) => ({
    id: inv.id,
    due_date: inv.due_date,
    status: inv.status,
    amount_rent: Number(inv.amount_rent) || 0,
    amount_late: Number(inv.amount_late) || 0,
    amount_other: Number(inv.amount_other) || 0,
    amount_total: Number(inv.amount_total) || 0,
    amount_paid: paidByInvoice.has(inv.id)
      ? paidByInvoice.get(inv.id)!
      : Number(inv.amount_paid) || 0,
    balance_due: Number(inv.balance_due) || 0,
  }));

  return buildRentChangePreview({
    invoices: invoiceRows,
    oldRent: args.oldRent,
    newRent: args.newRent,
    effectiveDate: args.effectiveDate,
    businessDate: args.businessDate,
  });
}

/**
 * Create missing future/current invoices only. Never deletes existing rows.
 */
async function generateMissingFutureInvoicesOnly(
  lease: {
    id: string;
    property_id: string;
    tenant_id: string;
    rent: number;
    rent_cadence?: string;
    rent_due_day?: number;
    lease_end_date?: string | null;
    status?: string;
  },
  startDate: string,
  rentOpts?: {
    rentEffectiveDate?: string | null;
    priorRent?: number | null;
  },
) {
  const cadence = normalizeCadence(lease.rent_cadence || "monthly");
  const rentDueDay = lease.rent_due_day || 1;
  const rentAmount = lease.rent || 0;
  const rentEffectiveDate = rentOpts?.rentEffectiveDate
    ? String(rentOpts.rentEffectiveDate).split("T")[0]
    : null;
  const priorRent = rentOpts?.priorRent ?? null;
  const todayStr = getBusinessDate();
  const todayDate = new Date(todayStr + "T00:00:00");

  const endDate = resolveInvoiceScheduleEnd({
    status: lease.status,
    leaseEndDate: lease.lease_end_date,
    asOfDate: todayStr,
  });

  const invoicesToCreate: Array<Record<string, unknown>> = [];

  const pushIfMissing = async (
    dueDate: string,
    periodStart: string,
    periodEnd: string,
  ) => {
    if (dueDate < startDate || dueDate > endDate) return;
    const dueDateObj = new Date(dueDate + "T00:00:00");
    if (dueDateObj < todayDate) return;

    const { data: existing } = await supabaseServer
      .from("RENT_invoices")
      .select("id")
      .eq("lease_id", lease.id)
      .eq("due_date", dueDate)
      .maybeSingle();

    if (existing) return;

    const amountRent = rentAmountForDueDate({
      dueDate,
      newRent: rentAmount,
      priorRent,
      rentEffectiveDate,
    });

    invoicesToCreate.push({
      lease_id: lease.id,
      property_id: lease.property_id,
      tenant_id: lease.tenant_id,
      due_date: dueDate,
      period_start: periodStart,
      period_end: periodEnd,
      amount_rent: amountRent,
      amount_late: 0,
      amount_other: 0,
      amount_total: amountRent,
      amount_paid: 0,
      balance_due: amountRent,
      status: "OPEN",
    });
  };

  if (cadence === "weekly") {
    const start = new Date(startDate + "T00:00:00");
    const endDateObj = new Date(endDate + "T00:00:00");
    const current = new Date(start);
    while (current <= endDateObj) {
      const dueDate = current.toISOString().split("T")[0];
      const periodEndDate = new Date(current);
      periodEndDate.setDate(periodEndDate.getDate() + 6);
      await pushIfMissing(
        dueDate,
        dueDate,
        periodEndDate.toISOString().split("T")[0],
      );
      current.setDate(current.getDate() + 7);
    }
  } else if (cadence === "biweekly") {
    const start = new Date(startDate + "T00:00:00");
    const endDateObj = new Date(endDate + "T00:00:00");
    const current = new Date(start);
    while (current <= endDateObj) {
      const dueDate = current.toISOString().split("T")[0];
      const periodEndDate = new Date(current);
      periodEndDate.setDate(periodEndDate.getDate() + 13);
      await pushIfMissing(
        dueDate,
        dueDate,
        periodEndDate.toISOString().split("T")[0],
      );
      current.setDate(current.getDate() + 14);
    }
  } else if (cadence === "monthly") {
    const start = new Date(startDate + "T00:00:00");
    const current = new Date(start.getFullYear(), start.getMonth(), 1);
    const endDateObj = new Date(endDate + "T00:00:00");
    while (current <= endDateObj) {
      const year = current.getFullYear();
      const month = current.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const dueDay = Math.min(rentDueDay, daysInMonth);
      const dueDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`;
      const periodStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const periodEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
      await pushIfMissing(dueDate, periodStart, periodEnd);
      current.setMonth(current.getMonth() + 1);
    }
  }

  if (invoicesToCreate.length > 0) {
    const { error: insertError } = await supabaseServer
      .from("RENT_invoices")
      .insert(invoicesToCreate);
    if (insertError) {
      console.error("Error creating missing future invoices:", insertError);
    }
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiAuth(request, { write: true });
  if (isAuthError(auth)) return auth;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Lease ID is required" },
        { status: 400 },
      );
    }

    const { error } = await supabaseServer
      .from("RENT_leases")
      .delete()
      .eq("id", id);

    if (error) {
      throw new Error(`Supabase error: ${error.message}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in lease delete API:", error);
    return NextResponse.json(
      {
        error: "Failed to delete lease",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
