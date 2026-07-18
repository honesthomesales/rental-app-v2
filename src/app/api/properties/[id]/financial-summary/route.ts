import { NextResponse } from "next/server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { getBusinessDate } from "@/lib/business-date";
import {
  buildAccountLedger,
  roundMoney,
} from "@/lib/portfolio-ledger/service";
import {
  loadBillingLeases,
  loadInvoicesForLeases,
  loadPaymentsForLeases,
} from "@/lib/portfolio-ledger/repository";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth(request);
  if (isAuthError(auth)) return auth;

  const { id } = await context.params;
  const url = new URL(request.url);
  const asOf = url.searchParams.get("asOf") || getBusinessDate();
  const leases = (await loadBillingLeases()).filter(
    (lease) => lease.property_id === id,
  );
  const leaseIds = leases.map((lease) => lease.id);
  const [invoicesByLease, paymentsByLease] = await Promise.all([
    loadInvoicesForLeases(leaseIds),
    loadPaymentsForLeases(leaseIds),
  ]);
  const accounts = leases.map((lease) =>
    buildAccountLedger({
      lease,
      invoices: invoicesByLease.get(lease.id) || [],
      payments: paymentsByLease.get(lease.id) || [],
      asOfDate: asOf,
    }),
  );

  return NextResponse.json({
    asOfDate: asOf,
    propertyId: id,
    totalOwed: roundMoney(
      accounts.reduce((sum, account) => sum + account.totalBalanceDue, 0),
    ),
    totalCollected: roundMoney(
      accounts.reduce(
        (sum, account) => sum + account.propertyTotalCollected,
        0,
      ),
    ),
    accounts,
    writePerformed: false,
  });
}
