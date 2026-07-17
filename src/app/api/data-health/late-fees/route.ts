import { NextRequest, NextResponse } from "next/server";
import { getBusinessDate } from "@/lib/business-date";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { supabaseServer } from "@/lib/supabase-server";
import { buildLateFeePreview } from "@/lib/late-fees/preview";

export const dynamic = "force-dynamic";

/**
 * Late-fee reconciliation.
 * GET / previewOnly=true → read-only preview (no writes).
 * POST body { apply: true, invoiceIds?: string[] } → transactional apply via RPC.
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiAuth(request, { ownerOnly: true });
  if (isAuthError(auth)) return auth;

  try {
    const url = new URL(request.url);
    const businessDate =
      url.searchParams.get("businessDate") || getBusinessDate();

    const preview = await loadAppSidePreview(businessDate);
    return NextResponse.json({
      ...preview,
      previewOnly: true,
      writePerformed: false,
    });
  } catch (error) {
    console.error("late-fee preview error:", error);
    return NextResponse.json(
      {
        error: "Failed to preview late fees",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth(request, { ownerOnly: true });
  if (isAuthError(auth)) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const businessDate =
      (typeof body.businessDate === "string" && body.businessDate) ||
      getBusinessDate();
    const apply = body.apply === true;
    const invoiceIds: string[] | null = Array.isArray(body.invoiceIds)
      ? body.invoiceIds
      : null;

    if (!apply) {
      const preview = await loadAppSidePreview(businessDate);
      return NextResponse.json({
        ...preview,
        previewOnly: true,
        writePerformed: false,
      });
    }

    const { data, error } = await supabaseServer.rpc("rent_reconcile_late_fees", {
      p_business_date: businessDate,
      p_invoice_ids: invoiceIds,
      p_dry_run: false,
    });

    if (error) {
      console.error("rent_reconcile_late_fees failed:", error);
      return NextResponse.json(
        {
          error: "Late-fee apply failed; no partial batch left applied",
          details: error.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ...(typeof data === "object" && data !== null ? data : {}),
      previewOnly: false,
      writePerformed: true,
    });
  } catch (error) {
    console.error("late-fee apply error:", error);
    return NextResponse.json(
      {
        error: "Failed to apply late fees",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

async function loadAppSidePreview(businessDate: string) {
  const { data: leases, error: leaseError } = await supabaseServer
    .from("RENT_leases")
    .select(
      `
      id, property_id, tenant_id, status, rent_cadence, late_fee_amount, grace_days,
      RENT_properties(name, address),
      RENT_tenants(full_name, first_name, last_name)
    `,
    )
    .in("status", ["occupied", "eviction"]);

  if (leaseError) throw new Error(leaseError.message);

  const leaseInputs = (leases || []).map((l: Record<string, unknown>) => {
    const prop = (l.RENT_properties || {}) as Record<string, unknown>;
    const ten = (l.RENT_tenants || {}) as Record<string, unknown>;
    return {
      id: String(l.id),
      property_id: String(l.property_id),
      tenant_id: String(l.tenant_id),
      status: String(l.status || ""),
      rent_cadence: (l.rent_cadence as string) || "monthly",
      late_fee_amount: l.late_fee_amount != null ? Number(l.late_fee_amount) : null,
      grace_days: l.grace_days != null ? Number(l.grace_days) : null,
      property_name: (prop.name as string) || (prop.address as string) || "",
      tenant_name:
        (ten.full_name as string) ||
        [ten.first_name, ten.last_name].filter(Boolean).join(" ") ||
        "",
    };
  });

  const leaseIds = leaseInputs.map((l) => l.id);
  if (leaseIds.length === 0) {
    return buildLateFeePreview({
      businessDate,
      leases: [],
      invoices: [],
      payments: [],
    });
  }

  const { data: invoices, error: invError } = await supabaseServer
    .from("RENT_invoices")
    .select(
      "id, lease_id, due_date, status, amount_rent, amount_late, amount_other, amount_total, amount_paid, balance_due",
    )
    .in("lease_id", leaseIds)
    .lte("due_date", businessDate);

  if (invError) throw new Error(invError.message);

  // late_fee_waived is optional until migration is applied
  const invoicesWithWaiver = (invoices || []).map((inv: Record<string, unknown>) => ({
    ...inv,
    late_fee_waived: Boolean(inv.late_fee_waived),
  }));

  const { data: payments, error: payError } = await supabaseServer
    .from("RENT_payments")
    .select("id, lease_id, invoice_id, amount, payment_date, status")
    .in("lease_id", leaseIds);

  if (payError) throw new Error(payError.message);

  return buildLateFeePreview({
    businessDate,
    leases: leaseInputs,
    invoices: invoicesWithWaiver as never[],
    payments: (payments || []) as never[],
  });
}
