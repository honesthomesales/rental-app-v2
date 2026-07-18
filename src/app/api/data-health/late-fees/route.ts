import { NextRequest, NextResponse } from "next/server";
import { getBusinessDate } from "@/lib/business-date";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { supabaseServer } from "@/lib/supabase-server";
import { buildLateFeePreview } from "@/lib/late-fees/preview";
import { analyzeLeaseCadence } from "@/lib/invoice-cadence";
import {
  loadBillingLeases,
  loadInvoicesForLeases,
  loadPaymentsForLeases,
} from "@/lib/portfolio-ledger/repository";

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

    if (!invoiceIds || invoiceIds.length === 0) {
      return NextResponse.json(
        { error: "Explicit invoiceIds approval is required" },
        { status: 400 },
      );
    }
    const uniqueInvoiceIds = [...new Set(invoiceIds)];
    const validationPreview = await loadAppSidePreview(businessDate);
    const eligibleInvoiceIds = new Set(
      validationPreview.rows
        .filter((row) => row.eligible)
        .map((row) => row.invoiceId),
    );
    const invalidInvoiceIds = uniqueInvoiceIds.filter(
      (invoiceId) => !eligibleInvoiceIds.has(invoiceId),
    );
    if (invalidInvoiceIds.length > 0) {
      return NextResponse.json(
        {
          error:
            "One or more approved invoices are no longer eligible or require cadence review",
          invalidInvoiceIds,
          writePerformed: false,
        },
        { status: 409 },
      );
    }

    const { data, error } = await supabaseServer.rpc("rent_reconcile_late_fees", {
      p_business_date: businessDate,
      p_invoice_ids: uniqueInvoiceIds,
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
  const leases = await loadBillingLeases();
  const leaseIds = leases.map((lease) => lease.id);
  if (leaseIds.length === 0) {
    return buildLateFeePreview({
      businessDate,
      leases: [],
      invoices: [],
      payments: [],
    });
  }

  const [invoicesByLease, paymentsByLease] = await Promise.all([
    loadInvoicesForLeases(leaseIds),
    loadPaymentsForLeases(leaseIds),
  ]);
  const invoices = [...invoicesByLease.values()].flat();
  const payments = [...paymentsByLease.values()].flat();
  const excludedInvoiceIds = new Set<string>();
  for (const lease of leases) {
    const leasePayments = paymentsByLease.get(lease.id) || [];
    const paymentInvoiceIds = new Set(
      leasePayments
        .filter((payment) => payment.invoice_id)
        .map((payment) => String(payment.invoice_id)),
    );
    const audit = analyzeLeaseCadence({
      currentCadence: lease.rent_cadence,
      cadenceEffectiveDate: lease.cadence_effective_date,
      invoices: invoicesByLease.get(lease.id) || [],
      paymentInvoiceIds,
    });
    audit.excludedInvoiceIds.forEach((id) => excludedInvoiceIds.add(id));
  }

  return buildLateFeePreview({
    businessDate,
    leases: leases.map((lease) => ({
      id: lease.id,
      property_id: lease.property_id,
      tenant_id: lease.tenant_id,
      status: lease.status,
      rent_cadence: lease.rent_cadence,
      late_fee_amount: lease.late_fee_amount,
      grace_days: lease.grace_days,
      property_name: lease.property_name,
      tenant_name: lease.tenant_name,
    })),
    invoices: invoices.filter(
      (invoice) => String(invoice.due_date).split("T")[0] <= businessDate,
    ),
    payments,
    excludedInvoiceIds,
  });
}
