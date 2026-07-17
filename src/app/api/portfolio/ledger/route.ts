import { NextResponse } from "next/server";
import { getBusinessDate } from "@/lib/business-date";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import {
  buildAccountLedger,
  buildCollectionsSummary,
  PORTFOLIO_LEDGER_VERSION,
} from "@/lib/portfolio-ledger/service";
import {
  loadBillingLeases,
  loadInvoicesForLeases,
  loadPaymentsForLeases,
} from "@/lib/portfolio-ledger/repository";

export const dynamic = "force-dynamic";

/** Full portfolio ledger (accounts). GET only. */
export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (isAuthError(auth)) return auth;

  try {
    const url = new URL(request.url);
    const asOf =
      url.searchParams.get("asOf") ||
      url.searchParams.get("businessDate") ||
      getBusinessDate();
    const leaseId = url.searchParams.get("leaseId");
    const includeDetails = url.searchParams.get("details") !== "0";

    let leases = await loadBillingLeases();
    if (leaseId) leases = leases.filter((l) => l.id === leaseId);

    const leaseIds = leases.map((l) => l.id);
    const [invoicesByLease, paymentsByLease] = await Promise.all([
      loadInvoicesForLeases(leaseIds),
      loadPaymentsForLeases(leaseIds),
    ]);

    if (!includeDetails) {
      const summary = buildCollectionsSummary({
        leases,
        invoicesByLease,
        paymentsByLease,
        asOfDate: asOf,
      });
      return NextResponse.json({
        ledgerVersion: summary.ledgerVersion,
        asOfDate: summary.asOfDate,
        accounts: summary.rows,
        writePerformed: false,
      });
    }

    const accounts = leases.map((lease) =>
      buildAccountLedger({
        lease,
        invoices: invoicesByLease.get(lease.id) || [],
        payments: paymentsByLease.get(lease.id) || [],
        asOfDate: asOf,
      }),
    );

    return NextResponse.json({
      ledgerVersion: PORTFOLIO_LEDGER_VERSION,
      asOfDate: asOf,
      accounts,
      writePerformed: false,
    });
  } catch (error) {
    console.error("portfolio ledger error:", error);
    return NextResponse.json(
      {
        error: "Failed to load portfolio ledger",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
