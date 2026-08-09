import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getBusinessDate } from "@/lib/business-date";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { canAllocatePaymentAsOf } from "@/lib/payment-eligibility";
import {
  allocationGroupNote,
  getDeferredSelectedInvoiceId,
  planNewestFirstAllocation,
  planSelectedInvoiceForwardAllocation,
  withoutDeferredSelectedInvoiceNote,
} from "@/lib/payments/post-allocated-payment";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

function toDateOnly(iso: string | null | undefined): string {
  return String(iso || "").split("T")[0];
}

function daysUntil(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00Z`).getTime();
  const b = new Date(`${to}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

/**
 * Future Payments Review.
 * GET — list payments whose effective date is after the NY business date.
 * POST { allocatePaymentId } — allocate one payment that has become eligible.
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiAuth(request, { ownerOnly: true });
  if (isAuthError(auth)) return auth;

  try {
    const url = new URL(request.url);
    const businessDate =
      url.searchParams.get("businessDate") || getBusinessDate();

    const { data: payments, error } = await supabaseServer
      .from("RENT_payments")
      .select(
        "id, lease_id, property_id, tenant_id, invoice_id, payment_date, amount, payment_method, payment_type, status, notes, created_at",
      )
      .order("payment_date", { ascending: true })
      .limit(2000);

    if (error) {
      return NextResponse.json(
        { error: "Failed to load payments", details: error.message },
        { status: 500 },
      );
    }

    const future = (payments || []).filter((p) => {
      const status = String(p.status || "").toLowerCase();
      if (
        status === "cancelled" ||
        status === "canceled" ||
        status === "reversed" ||
        status === "void"
      ) {
        return false;
      }
      const d = toDateOnly(p.payment_date);
      return Boolean(d && d > businessDate);
    });

    const tenantIds = [...new Set(future.map((p) => p.tenant_id).filter(Boolean))];
    const propertyIds = [
      ...new Set(future.map((p) => p.property_id).filter(Boolean)),
    ];
    const leaseIds = [...new Set(future.map((p) => p.lease_id).filter(Boolean))];

    const [{ data: tenants }, { data: properties }, { data: leases }] =
      await Promise.all([
        tenantIds.length
          ? supabaseServer
              .from("RENT_tenants")
              .select("id, full_name, first_name, last_name")
              .in("id", tenantIds)
          : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
        propertyIds.length
          ? supabaseServer
              .from("RENT_properties")
              .select("id, name, address")
              .in("id", propertyIds)
          : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
        leaseIds.length
          ? supabaseServer
              .from("RENT_leases")
              .select("id, rent_cadence, status")
              .in("id", leaseIds)
          : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      ]);

    const tenantById = new Map(
      (tenants || []).map((t) => [
        String(t.id),
        (t.full_name as string) ||
          [t.first_name, t.last_name].filter(Boolean).join(" ") ||
          String(t.id).slice(0, 8),
      ]),
    );
    const propertyById = new Map(
      (properties || []).map((p) => [
        String(p.id),
        (p.address as string) || (p.name as string) || String(p.id).slice(0, 8),
      ]),
    );
    const leaseById = new Map(
      (leases || []).map((l) => [String(l.id), l]),
    );

    const rows = future.map((p) => {
      const paymentDate = toDateOnly(p.payment_date);
      return {
        id: p.id,
        tenantId: p.tenant_id,
        tenantName: tenantById.get(String(p.tenant_id)) || "—",
        propertyId: p.property_id,
        propertyName: propertyById.get(String(p.property_id)) || "—",
        leaseId: p.lease_id,
        leaseStatus: leaseById.get(String(p.lease_id))?.status || null,
        amount: Number(p.amount || 0),
        paymentMethod: p.payment_method || "—",
        paymentDate,
        eligibleDate: paymentDate,
        daysUntilEligible: daysUntil(businessDate, paymentDate),
        status: p.status || "completed",
        allocationStatus: p.invoice_id ? "prematurely_linked" : "unallocated",
        invoiceId: p.invoice_id,
        reference: withoutDeferredSelectedInvoiceNote(p.notes) || null,
      };
    });

    return NextResponse.json({
      businessDate,
      count: rows.length,
      rows,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load future payments",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth(request, { ownerOnly: true, write: true });
  if (isAuthError(auth)) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const paymentId =
      typeof body.allocatePaymentId === "string" ? body.allocatePaymentId : null;
    if (!paymentId) {
      return NextResponse.json(
        { error: "allocatePaymentId is required" },
        { status: 400 },
      );
    }

    const businessDate = getBusinessDate();
    const { data: payment, error } = await supabaseServer
      .from("RENT_payments")
      .select("*")
      .eq("id", paymentId)
      .maybeSingle();

    if (error || !payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    if (!canAllocatePaymentAsOf(payment, businessDate)) {
      return NextResponse.json(
        {
          error: "Payment is still future-dated and must not allocate yet",
          businessDate,
          paymentDate: payment.payment_date,
        },
        { status: 409 },
      );
    }

    if (payment.invoice_id) {
      return NextResponse.json({
        ok: true,
        alreadyAllocated: true,
        payment,
      });
    }

    const { data: invoices, error: invErr } = await supabaseServer
      .from("RENT_invoices")
      .select(
        "id, due_date, period_start, period_end, balance_due, amount_total, amount_paid, status",
      )
      .eq("lease_id", payment.lease_id);

    if (invErr) {
      return NextResponse.json(
        { error: "Failed to load invoices", details: invErr.message },
        { status: 500 },
      );
    }

    const selectedInvoiceId = getDeferredSelectedInvoiceId(payment.notes);
    if (
      selectedInvoiceId &&
      !(invoices || []).some(
        (invoice) => String(invoice.id) === selectedInvoiceId,
      )
    ) {
      return NextResponse.json(
        { error: "Selected invoice no longer belongs to this lease" },
        { status: 409 },
      );
    }

    const allocationStrategy = selectedInvoiceId
      ? "selected_forward"
      : "newest_first";
    const plan = selectedInvoiceId
      ? planSelectedInvoiceForwardAllocation({
          paymentAmount: Number(payment.amount || 0),
          selectedInvoiceId,
          invoices: invoices || [],
        })
      : planNewestFirstAllocation({
          paymentAmount: Number(payment.amount || 0),
          paymentEffectiveDate: toDateOnly(payment.payment_date),
          invoices: invoices || [],
        });

    if (plan.splits.length === 0) {
      return NextResponse.json({
        ok: true,
        allocated: false,
        reason: "no_eligible_invoices",
        payment,
      });
    }

    // Convert the single deferred payment into allocation legs while retaining
    // any amount left after the available invoice balances are filled.
    const groupId = randomUUID();
    const primary = plan.splits[0];
    const legCount =
      plan.splits.length + (plan.unallocatedAmount > 0.009 ? 1 : 0);
    const originalNote = withoutDeferredSelectedInvoiceNote(payment.notes);
    const { error: updErr } = await supabaseServer
      .from("RENT_payments")
      .update({
        invoice_id: primary.invoiceId,
        amount: primary.amount,
        notes: [
          originalNote,
          allocationGroupNote(groupId, 1, legCount, allocationStrategy),
        ]
          .filter(Boolean)
          .join(" | "),
      })
      .eq("id", payment.id);

    if (updErr) {
      return NextResponse.json(
        { error: "Failed to allocate payment", details: updErr.message },
        { status: 500 },
      );
    }

    const extraRows: Array<Record<string, unknown>> = plan.splits
      .slice(1)
      .map((split, index) => ({
        tenant_id: payment.tenant_id,
        lease_id: payment.lease_id,
        property_id: payment.property_id,
        payment_date: payment.payment_date,
        amount: split.amount,
        payment_type: payment.payment_type || "Rent",
        payment_method: payment.payment_method || "Manual Entry",
        status: payment.status || "completed",
        invoice_id: split.invoiceId,
        notes: [
          originalNote,
          allocationGroupNote(groupId, index + 2, legCount, allocationStrategy),
        ]
          .filter(Boolean)
          .join(" | "),
      }));

    if (plan.unallocatedAmount > 0.009) {
      extraRows.push({
        tenant_id: payment.tenant_id,
        lease_id: payment.lease_id,
        property_id: payment.property_id,
        payment_date: payment.payment_date,
        amount: plan.unallocatedAmount,
        payment_type: payment.payment_type || "Rent",
        payment_method: payment.payment_method || "Manual Entry",
        status: payment.status || "completed",
        notes: [
          originalNote,
          allocationGroupNote(
            groupId,
            legCount,
            legCount,
            allocationStrategy,
          ),
          "unallocated_remainder",
        ]
          .filter(Boolean)
          .join(" | "),
      });
    }

    let extras: unknown[] = [];
    if (extraRows.length > 0) {
      const { data, error: insErr } = await supabaseServer
        .from("RENT_payments")
        .insert(extraRows)
        .select();
      if (insErr) {
        return NextResponse.json(
          { error: "Partial allocation failure", details: insErr.message },
          { status: 500 },
        );
      }
      extras = data || [];
    }

    return NextResponse.json({
      ok: true,
      allocated: true,
      allocationGroupId: groupId,
      allocationStrategy,
      splits: plan.splits,
      unallocatedAmount: plan.unallocatedAmount,
      extras,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to allocate future payment",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
