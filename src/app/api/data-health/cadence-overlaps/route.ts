import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { analyzeLeaseCadence } from "@/lib/invoice-cadence";
import {
  loadBillingLeases,
  loadInvoicesForLeases,
  loadPaymentsForLeases,
} from "@/lib/portfolio-ledger/repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth(request, { ownerOnly: true });
  if (isAuthError(auth)) return auth;

  try {
    const page = Math.max(
      1,
      Number(new URL(request.url).searchParams.get("page")) || 1,
    );
    const pageSize = Math.min(
      250,
      Math.max(
        1,
        Number(new URL(request.url).searchParams.get("pageSize")) || 100,
      ),
    );
    const leases = await loadBillingLeases();
    const leaseIds = leases.map((lease) => lease.id);
    const [invoicesByLease, paymentsByLease] = await Promise.all([
      loadInvoicesForLeases(leaseIds),
      loadPaymentsForLeases(leaseIds),
    ]);

    const rows: Array<Record<string, unknown>> = [];
    const leasesWithOverlaps = new Set<string>();
    const leasesWithAnyException = new Set<string>();
    for (const lease of leases) {
      const invoices = invoicesByLease.get(lease.id) || [];
      const payments = paymentsByLease.get(lease.id) || [];
      const paymentInvoiceIds = new Set(
        payments
          .filter((payment) => payment.invoice_id)
          .map((payment) => String(payment.invoice_id)),
      );
      const { exceptions } = analyzeLeaseCadence({
        currentCadence: lease.rent_cadence,
        cadenceEffectiveDate: lease.cadence_effective_date,
        invoices,
        paymentInvoiceIds,
      });
      if (exceptions.length > 0) leasesWithAnyException.add(lease.id);

      const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
      for (const exception of exceptions) {
        const invoice = invoiceById.get(exception.invoiceId);
        if (!invoice) continue;
        if (
          exception.reasons.some((reason) =>
            [
              "duplicate_due_date",
              "identical_period",
              "overlapping_period",
              "weekly_and_biweekly_cover_same_days",
            ].includes(reason),
          )
        ) {
          leasesWithOverlaps.add(lease.id);
        }
        rows.push({
          property: lease.property_name || "",
          tenant: lease.tenant_name || "",
          leaseId: lease.id,
          currentCadence: lease.rent_cadence || "monthly",
          cadenceEffectiveDate: lease.cadence_effective_date || null,
          invoiceId: invoice.id,
          relatedInvoiceIds: exception.relatedInvoiceIds,
          dueDate: invoice.due_date,
          periodStart: invoice.period_start || null,
          periodEnd: invoice.period_end || null,
          inferredCadence: exception.inferredCadence,
          status: invoice.status,
          rent: invoice.amount_rent,
          paidAmount: invoice.amount_paid || 0,
          paymentsExist: paymentInvoiceIds.has(invoice.id),
          reasons: exception.reasons,
          recommendedCanonicalInvoiceId:
            exception.recommendedCanonicalInvoiceId,
          recommendedAction: exception.recommendedAction,
        });
      }
    }

    rows.sort(
      (a, b) =>
        String(a.property).localeCompare(String(b.property)) ||
        String(a.tenant).localeCompare(String(b.tenant)) ||
        String(a.dueDate).localeCompare(String(b.dueDate)) ||
        String(a.invoiceId).localeCompare(String(b.invoiceId)),
    );
    const offset = (page - 1) * pageSize;
    return NextResponse.json(
      {
        previewOnly: true,
        writePerformed: false,
        summary: {
          activeLeasesExamined: leases.length,
          leasesWithAnyCadenceException: leasesWithAnyException.size,
          leasesWithDuplicateOrOverlappingPeriods: leasesWithOverlaps.size,
          exceptionInvoiceCount: rows.length,
        },
        pagination: {
          page,
          pageSize,
          totalRows: rows.length,
          totalPages: Math.ceil(rows.length / pageSize),
        },
        rows: rows.slice(offset, offset + pageSize),
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to build cadence overlap preview",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
