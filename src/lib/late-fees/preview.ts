/**
 * Read-only late-fee eligibility planning.
 * Writes happen only via rent_reconcile_late_fees RPC / apply API.
 */

import { calculateUnpaidInvoices } from "@/lib/invoice-calculations";
import {
  isPastGrace,
  resolveGraceDays,
  resolveLateFeeAmount,
  roundMoney,
} from "@/lib/late-fees/rules";

export type LateFeeInvoiceInput = {
  id: string;
  lease_id: string;
  due_date: string;
  status: string;
  amount_rent: number;
  amount_late: number;
  amount_other: number;
  amount_total: number;
  amount_paid?: number;
  balance_due?: number;
  late_fee_waived?: boolean | null;
};

export type LateFeeLeaseInput = {
  id: string;
  property_id: string;
  tenant_id: string;
  status?: string | null;
  rent_cadence?: string | null;
  late_fee_amount?: number | null;
  grace_days?: number | null;
  property_name?: string | null;
  tenant_name?: string | null;
};

export type LateFeePaymentInput = {
  id: string;
  invoice_id: string | null;
  lease_id: string;
  amount: number;
  payment_date: string;
  status?: string;
};

export type LateFeePreviewRow = {
  propertyId: string;
  propertyName: string;
  tenantId: string;
  tenantName: string;
  leaseId: string;
  invoiceId: string;
  dueDate: string;
  cadence: string;
  currentRentBalance: number;
  graceDays: number;
  existingLateFee: number;
  waived: boolean;
  proposedLateFee: number;
  currentTotal: number;
  resultingTotal: number;
  resultingBalance: number;
  eligible: boolean;
  reasonEligible: string | null;
  reasonSkipped: string | null;
};

export type LateFeePreviewResult = {
  businessDate: string;
  examined: number;
  eligibleCount: number;
  skippedCount: number;
  proposedFeeTotal: number;
  rows: LateFeePreviewRow[];
};

function toDateOnly(iso: string): string {
  return String(iso || "").split("T")[0];
}

function invoiceFullyPaidAsOf(
  inv: LateFeeInvoiceInput,
  payments: LateFeePaymentInput[],
  businessDate: string,
): { paid: number; balance: number; total: number } {
  const { unpaidInvoices } = calculateUnpaidInvoices(
    [inv as never],
    payments as never[],
    null,
    businessDate,
  );
  const total = roundMoney(
    Number(inv.amount_rent || 0) +
      Number(inv.amount_late || 0) +
      Number(inv.amount_other || 0),
  );
  // Prefer recalculated from payments through business date
  const paid = roundMoney(
    payments
      .filter((p) => p.invoice_id === inv.id)
      .filter((p) => {
        const st = String(p.status || "completed").toLowerCase();
        if (st !== "completed") return false;
        const pd = toDateOnly(p.payment_date);
        return pd && pd <= businessDate;
      })
      .reduce((s, p) => s + (Number(p.amount) || 0), 0),
  );
  const balance = roundMoney(Math.max(0, total - paid));
  void unpaidInvoices;
  return { paid, balance, total };
}

/**
 * Plan late fees for a set of invoices. Pure — no writes.
 */
export function buildLateFeePreview(args: {
  businessDate: string;
  leases: LateFeeLeaseInput[];
  invoices: LateFeeInvoiceInput[];
  payments: LateFeePaymentInput[];
}): LateFeePreviewResult {
  const businessDate = toDateOnly(args.businessDate);
  const leaseById = new Map(args.leases.map((l) => [l.id, l]));
  const paymentsByLease = new Map<string, LateFeePaymentInput[]>();
  for (const p of args.payments) {
    const list = paymentsByLease.get(p.lease_id) || [];
    list.push(p);
    paymentsByLease.set(p.lease_id, list);
  }

  const rows: LateFeePreviewRow[] = [];

  for (const inv of args.invoices) {
    const lease = leaseById.get(inv.lease_id);
    const status = String(inv.status || "").toUpperCase();
    const dueDate = toDateOnly(inv.due_date);
    const existingLate = roundMoney(Number(inv.amount_late) || 0);
    const graceDays = resolveGraceDays(lease?.grace_days);
    const proposed = lease
      ? resolveLateFeeAmount({
          cadence: lease.rent_cadence,
          leaseLateFeeAmount: lease.late_fee_amount,
        })
      : 0;

    const base = {
      propertyId: lease?.property_id || "",
      propertyName: lease?.property_name || "",
      tenantId: lease?.tenant_id || "",
      tenantName: lease?.tenant_name || "",
      leaseId: inv.lease_id,
      invoiceId: inv.id,
      dueDate,
      cadence: String(lease?.rent_cadence || "monthly"),
      graceDays,
      existingLateFee: existingLate,
      waived: Boolean(inv.late_fee_waived),
      proposedLateFee: 0,
      currentTotal: roundMoney(
        Number(inv.amount_rent || 0) +
          Number(inv.amount_late || 0) +
          Number(inv.amount_other || 0),
      ),
      resultingTotal: roundMoney(
        Number(inv.amount_rent || 0) +
          Number(inv.amount_late || 0) +
          Number(inv.amount_other || 0),
      ),
      currentRentBalance: 0,
      resultingBalance: 0,
      eligible: false,
      reasonEligible: null as string | null,
      reasonSkipped: null as string | null,
    };

    if (!lease) {
      rows.push({ ...base, reasonSkipped: "missing_lease" });
      continue;
    }

    const leaseStatus = String(lease.status || "").toLowerCase();
    if (leaseStatus !== "occupied" && leaseStatus !== "eviction") {
      rows.push({ ...base, reasonSkipped: "inactive_lease" });
      continue;
    }

    if (status === "VOID") {
      rows.push({ ...base, reasonSkipped: "void" });
      continue;
    }

    if (status === "PAID") {
      rows.push({ ...base, reasonSkipped: "paid_status" });
      continue;
    }

    if (inv.late_fee_waived) {
      rows.push({ ...base, reasonSkipped: "waived" });
      continue;
    }

    if (existingLate > 0.009) {
      rows.push({ ...base, reasonSkipped: "already_billed" });
      continue;
    }

    if (dueDate > businessDate) {
      rows.push({ ...base, reasonSkipped: "future_invoice" });
      continue;
    }

    if (!isPastGrace({ dueDate, graceDays, businessDate })) {
      rows.push({ ...base, reasonSkipped: "within_grace" });
      continue;
    }

    const leasePayments = paymentsByLease.get(inv.lease_id) || [];
    const { balance, total } = invoiceFullyPaidAsOf(
      inv,
      leasePayments,
      businessDate,
    );

    // Fully paid through business date (including when future payments exist later)
    if (balance <= 0.009) {
      rows.push({
        ...base,
        currentRentBalance: 0,
        resultingBalance: 0,
        reasonSkipped: "fully_paid_as_of_business_date",
      });
      continue;
    }

    const resultingTotal = roundMoney(total - existingLate + proposed);
    // total currently has amount_late=0 typically; resulting balance adds fee
    const resultingBalance = roundMoney(balance + proposed);

    rows.push({
      ...base,
      currentRentBalance: balance,
      proposedLateFee: proposed,
      resultingTotal,
      resultingBalance,
      eligible: true,
      reasonEligible: "past_grace_unpaid_no_existing_fee",
      reasonSkipped: null,
    });
    void resultingTotal;
  }

  const eligibleRows = rows.filter((r) => r.eligible);
  return {
    businessDate,
    examined: rows.length,
    eligibleCount: eligibleRows.length,
    skippedCount: rows.length - eligibleRows.length,
    proposedFeeTotal: roundMoney(
      eligibleRows.reduce((s, r) => s + r.proposedLateFee, 0),
    ),
    rows,
  };
}
