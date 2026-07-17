import { NextResponse } from "next/server";
import { getBusinessDate } from "@/lib/business-date";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { buildAccountLedger } from "@/lib/portfolio-ledger/service";
import {
  loadBillingLeases,
  loadInvoicesForLeases,
  loadPaymentsForLeases,
} from "@/lib/portfolio-ledger/repository";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Ctx) {
  const auth = await requireApiAuth(request);
  if (isAuthError(auth)) return auth;

  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const asOf =
      url.searchParams.get("asOf") ||
      url.searchParams.get("businessDate") ||
      getBusinessDate();

    const leases = (await loadBillingLeases()).filter((l) => l.id === id);
    if (leases.length === 0) {
      // May be non-billing; try direct fetch via collections of one id
      return NextResponse.json({ error: "Lease not found" }, { status: 404 });
    }

    const lease = leases[0];
    const [invoicesByLease, paymentsByLease] = await Promise.all([
      loadInvoicesForLeases([id]),
      loadPaymentsForLeases([id]),
    ]);

    const account = buildAccountLedger({
      lease,
      invoices: invoicesByLease.get(id) || [],
      payments: paymentsByLease.get(id) || [],
      asOfDate: asOf,
    });

    return NextResponse.json({ ...account, writePerformed: false });
  } catch (error) {
    console.error("lease account error:", error);
    return NextResponse.json(
      {
        error: "Failed to load lease account",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
