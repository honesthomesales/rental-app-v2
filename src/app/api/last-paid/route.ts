import { NextResponse } from "next/server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { getBusinessDate } from "@/lib/business-date";
import { buildAccountLedger } from "@/lib/portfolio-ledger/service";
import {
  loadBillingLeases,
  loadInvoicesForLeases,
  loadPaymentsForLeases,
} from "@/lib/portfolio-ledger/repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Last Paid view backed only by the authoritative batched portfolio ledger. */
export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (isAuthError(auth)) return auth;

  try {
    const businessDate = getBusinessDate();
    const leases = await loadBillingLeases();
    const leaseIds = leases.map((lease) => lease.id);
    const [invoicesByLease, paymentsByLease] = await Promise.all([
      loadInvoicesForLeases(leaseIds),
      loadPaymentsForLeases(leaseIds),
    ]);

    const result = leases.map((lease) => {
      const account = buildAccountLedger({
        lease,
        invoices: invoicesByLease.get(lease.id) || [],
        payments: paymentsByLease.get(lease.id) || [],
        asOfDate: businessDate,
      });
      const invoiceById = new Map(
        account.invoices.map((invoice) => [invoice.invoiceId, invoice]),
      );
      const paymentRows = account.payments
        .filter((payment) => payment.eligible && payment.amount > 0)
        .map((payment) => {
          const invoice = payment.invoiceId
            ? invoiceById.get(payment.invoiceId)
            : null;
          return {
            id: payment.paymentId,
            payment_date: payment.paymentDate,
            amount: payment.amount,
            payment_type: payment.paymentMethod || "Payment",
            notes: "",
            tenant_name: account.tenantName,
            invoice: invoice
              ? {
                  id: invoice.invoiceId,
                  due_date: invoice.dueDate,
                  period_start: invoice.periodStart,
                  period_end: invoice.periodEnd,
                  amount_total: invoice.calculatedTotal,
                  amount_rent: invoice.storedRent,
                  amount_late: invoice.storedLateFee,
                  status: invoice.collectionStatus === "paid" ? "PAID" : invoice.storedStatus,
                  recalculated_balance: Math.max(0, invoice.calculatedBalance),
                }
              : null,
          };
        });

      const invoiceIdsWithPayments = new Set(
        paymentRows.map((row) => row.invoice?.id).filter(Boolean),
      );
      for (const invoice of account.invoices) {
        if (invoiceIdsWithPayments.has(invoice.invoiceId)) continue;
        paymentRows.push({
          id: `invoice-${invoice.invoiceId}`,
          payment_date: "",
          amount: 0,
          payment_type: "Invoice",
          notes: "",
          tenant_name: account.tenantName,
          invoice: {
            id: invoice.invoiceId,
            due_date: invoice.dueDate,
            period_start: invoice.periodStart,
            period_end: invoice.periodEnd,
            amount_total: invoice.calculatedTotal,
            amount_rent: invoice.storedRent,
            amount_late: invoice.storedLateFee,
            status: invoice.collectionStatus === "paid" ? "PAID" : invoice.storedStatus,
            recalculated_balance: Math.max(0, invoice.calculatedBalance),
          },
        });
      }

      paymentRows.sort((a, b) =>
        String(b.payment_date || "").localeCompare(String(a.payment_date || "")),
      );
      const property = lease.property || {};
      const tenant = (lease.tenant || {}) as Record<string, unknown>;
      return {
        property_id: account.propertyId,
        property_name: account.propertyName,
        property_address: String(property.address || account.propertyName),
        property_type: String(property.property_type || ""),
        cadence: account.cadence,
        rent: account.currentRent,
        rent_due_day: lease.rent_due_day || null,
        lease_id: account.leaseId,
        tenant_id: account.tenantId,
        tenant_name: account.tenantName,
        tenant_phone:
          tenant.phone != null && String(tenant.phone).trim()
            ? String(tenant.phone)
            : null,
        totalOwed: account.totalBalanceDue,
        lastPaidDate: account.lastEligiblePositivePaymentDate,
        oldestUnpaidDueDate: account.oldestUnpaidDueDate,
        daysLate: account.daysLate,
        collectionStatus: account.collectionStatus,
        ledgerVersion: account.ledgerVersion,
        payments: paymentRows,
      };
    });

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch last paid data",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
