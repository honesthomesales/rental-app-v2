import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import {
  BUSINESS_TIMEZONE,
  daysUntilPaymentEligible,
  getBusinessDate,
} from "@/lib/business-date";
import {
  FUTURE_DATED_COMPLETED_PAYMENT_EXCLUDED,
  partitionPaymentsByAsOf,
} from "@/lib/payment-eligibility";
import {
  PREVIEW_CADENCE_OVERRIDES,
  TYLER_LEASE_ID,
} from "@/lib/lease-preview-safety";

/**
 * Owner-only read-only future-payment data health.
 * Never edits, deletes, voids, or allocates payments.
 */
export async function GET(request: Request) {
  const auth = await requireApiAuth(request, { ownerOnly: true });
  if (isAuthError(auth)) return auth;

  try {
    const businessDate = getBusinessDate();

    const { data: payments, error } = await supabaseServer
      .from("RENT_payments")
      .select(
        `
        id,
        amount,
        payment_date,
        status,
        invoice_id,
        lease_id,
        tenant_id,
        property_id,
        RENT_tenants ( full_name, first_name, last_name ),
        RENT_properties ( name, address ),
        RENT_leases ( id, rent_cadence, rent )
      `,
      )
      .eq("status", "completed")
      .order("payment_date", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch payments" },
        { status: 500 },
      );
    }

    const partition = partitionPaymentsByAsOf(payments || [], businessDate);

    const rows = partition.excludedFuture.map((x) => {
      const p = x.payment as Record<string, unknown>;
      const tenant = p.RENT_tenants as
        | { full_name?: string; first_name?: string; last_name?: string }
        | null
        | undefined;
      const property = p.RENT_properties as
        | { name?: string; address?: string }
        | null
        | undefined;
      const tenantName =
        tenant?.full_name ||
        [tenant?.first_name, tenant?.last_name].filter(Boolean).join(" ") ||
        null;
      const paymentDate = String(p.payment_date || "").split("T")[0];
      return {
        paymentId: p.id,
        tenant: tenantName,
        property: property?.name || null,
        propertyAddress: property?.address || null,
        paymentDate,
        amount: Number(p.amount) || 0,
        status: p.status,
        linkedInvoice: p.invoice_id || null,
        leaseId: p.lease_id || null,
        businessDate,
        daysUntilEligible: daysUntilPaymentEligible(paymentDate, businessDate),
        classification: FUTURE_DATED_COMPLETED_PAYMENT_EXCLUDED,
      };
    });

    const cadenceWarnings = PREVIEW_CADENCE_OVERRIDES.map((o) => ({
      leaseId: o.leaseId,
      reason: o.reason,
      warning: o.dataHealthWarning,
      isTyler: o.leaseId === TYLER_LEASE_ID,
    }));

    return NextResponse.json({
      businessDate,
      timezone: BUSINESS_TIMEZONE,
      classification: FUTURE_DATED_COMPLETED_PAYMENT_EXCLUDED,
      count: partition.excludedCount,
      total: partition.excludedAmount,
      rows,
      cadenceWarnings,
      readOnly: true,
      actionsEnabled: false,
    });
  } catch (error) {
    console.error("Error in future-payments data-health:", error);
    return NextResponse.json(
      { error: "Failed to load future payments" },
      { status: 500 },
    );
  }
}
