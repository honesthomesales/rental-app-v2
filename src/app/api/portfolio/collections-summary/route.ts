import { NextResponse } from "next/server";
import { getBusinessDate } from "@/lib/business-date";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import {
  buildCollectionsSummary,
} from "@/lib/portfolio-ledger/service";
import {
  loadBillingLeases,
  loadInvoicesForLeases,
  loadPaymentsForLeases,
} from "@/lib/portfolio-ledger/repository";

export const dynamic = "force-dynamic";

/**
 * Batched portfolio collections summary — replaces Payments page N+1.
 * GET only; never writes.
 */
export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (isAuthError(auth)) return auth;

  try {
    const url = new URL(request.url);
    const asOf =
      url.searchParams.get("asOf") ||
      url.searchParams.get("businessDate") ||
      getBusinessDate();
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const status = (url.searchParams.get("status") || "").trim().toLowerCase();
    const cadence = (url.searchParams.get("cadence") || "").trim().toLowerCase();
    const propertyId = url.searchParams.get("propertyId");
    const tenantId = url.searchParams.get("tenantId");
    const leaseId = url.searchParams.get("leaseId");
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.min(
      200,
      Math.max(1, Number(url.searchParams.get("pageSize") || 100)),
    );
    const sort = url.searchParams.get("sort") || "totalOwed_desc";

    let leases = await loadBillingLeases();

    if (leaseId) leases = leases.filter((l) => l.id === leaseId);
    if (propertyId) leases = leases.filter((l) => l.property_id === propertyId);
    if (tenantId) leases = leases.filter((l) => l.tenant_id === tenantId);
    if (status) leases = leases.filter((l) => l.status.toLowerCase() === status);
    if (cadence) {
      leases = leases.filter((l) =>
        String(l.rent_cadence || "")
          .toLowerCase()
          .includes(cadence),
      );
    }
    if (q) {
      leases = leases.filter((l) => {
        const hay = `${l.property_name} ${l.tenant_name} ${l.id}`.toLowerCase();
        return hay.includes(q);
      });
    }

    const leaseIds = leases.map((l) => l.id);
    const [invoicesByLease, paymentsByLease] = await Promise.all([
      loadInvoicesForLeases(leaseIds),
      loadPaymentsForLeases(leaseIds),
    ]);

    const summary = buildCollectionsSummary({
      leases,
      invoicesByLease,
      paymentsByLease,
      asOfDate: asOf,
    });

    let rows = summary.rows;
    if (sort === "totalOwed_asc") {
      rows = [...rows].sort((a, b) => a.totalOwed - b.totalOwed);
    } else if (sort === "property") {
      rows = [...rows].sort((a, b) =>
        a.propertyName.localeCompare(b.propertyName),
      );
    } else if (sort === "tenant") {
      rows = [...rows].sort((a, b) => a.tenantName.localeCompare(b.tenantName));
    } else {
      rows = [...rows].sort((a, b) => b.totalOwed - a.totalOwed);
    }

    const leaseById = new Map(leases.map((lease) => [lease.id, lease]));
    const rowsWithLeaseFacts = rows.map((row) => {
      const sourceLease = leaseById.get(row.leaseId);
      const configuredDueDay = Number(sourceLease?.rent_due_day);
      const rentDueDay =
        Number.isFinite(configuredDueDay) && configuredDueDay > 0
          ? configuredDueDay
          : null;

      return {
        ...row,
        rentDueDay,
        rent_due_day: rentDueDay,
        lease: {
          ...row.lease,
          rent_due_day: rentDueDay,
        },
      };
    });

    const total = rowsWithLeaseFacts.length;
    const start = (page - 1) * pageSize;
    const pageRows = rowsWithLeaseFacts.slice(start, start + pageSize);

    return NextResponse.json({
      ledgerVersion: summary.ledgerVersion,
      asOfDate: summary.asOfDate,
      totalOwed: summary.totalOwed,
      total,
      page,
      pageSize,
      rows: pageRows,
      writePerformed: false,
    });
  } catch (error) {
    console.error("collections-summary error:", error);
    return NextResponse.json(
      {
        error: "Failed to load collections summary",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
