import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { getBusinessDate } from "@/lib/business-date";
import { profitCollectionQueryRange } from "@/lib/date-month";
import {
  buildProfitMonthCollectionFacts,
  fetchInvoiceMetaInRange,
  fetchProfitMonthPayments,
  filterEligiblePaymentsForProperty,
  type ProfitPaymentRow,
} from "@/lib/profit/rent-collected";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function buildLeaseToPropertyMap(
  leases: Array<{ id?: string; property_id?: string | null }>,
) {
  const map = new Map<string, string>();
  for (const lease of leases) {
    if (lease.id && lease.property_id) {
      map.set(String(lease.id), String(lease.property_id));
    }
  }
  return map;
}

function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export type ProfitRentCollectedDetailRow = {
  id: string;
  paymentDate: string;
  paymentDateLabel: string;
  amount: number;
  tenantName: string | null;
  invoiceDueDate: string | null;
  invoiceDueDateLabel: string | null;
  paymentType: string | null;
  paymentMethod: string | null;
  attribution: "invoice_due_month" | "payment_date";
  attributionLabel: string;
};

export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (isAuthError(auth)) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month") || getBusinessDate().slice(0, 7);
    const propertyId = searchParams.get("propertyId");

    if (!propertyId) {
      return NextResponse.json(
        { error: "propertyId is required" },
        { status: 400 },
      );
    }

    const { start: monthStart, end: monthEnd } =
      profitCollectionQueryRange(month);

    const [{ data: property }, { data: leases }] = await Promise.all([
      supabaseServer
        .from("RENT_properties")
        .select("id, name, address")
        .eq("id", propertyId)
        .maybeSingle(),
      supabaseServer.from("RENT_leases").select("id, property_id"),
    ]);

    if (!property) {
      return NextResponse.json(
        { error: "Property not found" },
        { status: 404 },
      );
    }

    const leasePropertyById = buildLeaseToPropertyMap(leases || []);
    const invoiceMetaById = await fetchInvoiceMetaInRange(
      monthStart,
      monthEnd,
    );
    const monthPayments = await fetchProfitMonthPayments(monthStart, monthEnd);
    const collectionFacts = buildProfitMonthCollectionFacts({
      payments: monthPayments,
      leasePropertyById,
      monthStart,
      monthEnd,
    });

    const propertyPayments = filterEligiblePaymentsForProperty(
      collectionFacts.eligiblePayments,
      propertyId,
      leasePropertyById,
      invoiceMetaById,
    );

    const paymentIds = propertyPayments.map((p) => p.id);
    const enrichedById = new Map<
      string,
      {
        payment_type?: string | null;
        payment_method?: string | null;
      }
    >();

    if (paymentIds.length > 0) {
      const { data: paymentRows } = await supabaseServer
        .from("RENT_payments")
        .select("id, payment_type, payment_method")
        .in("id", paymentIds);
      for (const row of paymentRows || []) {
        enrichedById.set(String(row.id), {
          payment_type: row.payment_type,
          payment_method: row.payment_method,
        });
      }
    }

    const tenantIds = [
      ...new Set(
        propertyPayments
          .map((p) => p.tenant_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const tenantNameById = new Map<string, string>();
    if (tenantIds.length > 0) {
      const { data: tenants } = await supabaseServer
        .from("RENT_tenants")
        .select("id, full_name")
        .in("id", tenantIds);
      for (const tenant of tenants || []) {
        if (tenant.id) {
          tenantNameById.set(String(tenant.id), String(tenant.full_name || ""));
        }
      }
    }

    const rows: ProfitRentCollectedDetailRow[] = propertyPayments
      .map((payment) => toDetailRow(payment, invoiceMetaById, tenantNameById, enrichedById, monthStart, monthEnd))
      .sort((a, b) => {
        const dateCmp = b.paymentDate.localeCompare(a.paymentDate);
        if (dateCmp !== 0) return dateCmp;
        return b.amount - a.amount;
      });

    const total = Math.round(
      rows.reduce((sum, row) => sum + row.amount, 0) * 100,
    ) / 100;

    return NextResponse.json(
      {
        month,
        monthLabel: formatMonthLabel(month),
        propertyId,
        propertyName: property.name,
        propertyAddress: property.address,
        total,
        payments: rows,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, must-revalidate",
        },
      },
    );
  } catch (error) {
    console.error("Error in profit rent-collected-detail API:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch rent collected detail",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

function formatMonthLabel(monthKey: string): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function toDetailRow(
  payment: ProfitPaymentRow,
  invoiceMetaById: Map<string, { due_date: string; property_id: string | null }>,
  tenantNameById: Map<string, string>,
  enrichedById: Map<
    string,
    { payment_type?: string | null; payment_method?: string | null }
  >,
  monthStart: string,
  monthEnd: string,
): ProfitRentCollectedDetailRow {
  const paymentDate = String(payment.payment_date || "").slice(0, 10);
  const invoiceMeta = payment.invoice_id
    ? invoiceMetaById.get(payment.invoice_id)
    : null;
  const invoiceDueDate = invoiceMeta?.due_date?.slice(0, 10) ?? null;
  const countsByInvoiceDue =
    Boolean(invoiceDueDate) &&
    invoiceDueDate! >= monthStart &&
    invoiceDueDate! <= monthEnd;
  const attribution: "invoice_due_month" | "payment_date" = countsByInvoiceDue
    ? "invoice_due_month"
    : "payment_date";
  const enriched = enrichedById.get(payment.id);

  return {
    id: payment.id,
    paymentDate,
    paymentDateLabel: paymentDate ? formatDateLabel(paymentDate) : "—",
    amount: Math.round(Number(payment.amount) * 100) / 100,
    tenantName: payment.tenant_id
      ? tenantNameById.get(payment.tenant_id) || null
      : null,
    invoiceDueDate,
    invoiceDueDateLabel: invoiceDueDate
      ? formatDateLabel(invoiceDueDate)
      : null,
    paymentType: enriched?.payment_type || null,
    paymentMethod: enriched?.payment_method || null,
    attribution,
    attributionLabel:
      attribution === "invoice_due_month" && invoiceDueDate
        ? `Invoice due ${formatDateLabel(invoiceDueDate)}`
        : "Payment date in month",
  };
}