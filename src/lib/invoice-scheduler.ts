import { getBusinessDate } from "@/lib/business-date";
import { buildInvoiceSchedule } from "@/lib/invoice-schedule";
import { resolveInvoiceScheduleEnd } from "@/lib/lease-status";
import { rentAmountForDueDate } from "@/lib/rent-change";
import { supabaseServer } from "@/lib/supabase-server";

export type InvoiceScheduleLease = {
  id: string;
  property_id: string;
  tenant_id: string;
  rent: number;
  rent_cadence?: string | null;
  rent_due_day?: number | null;
  lease_end_date?: string | null;
  status?: string | null;
};

export type InvoiceScheduleResult = {
  proposed: number;
  created: number;
  alreadyExists: number;
  blockedByOverlap: number;
  rows: Array<Record<string, unknown>>;
};

export async function generateMissingFutureInvoicesOnly(args: {
  lease: InvoiceScheduleLease;
  scheduleStart: string;
  rentEffectiveDate?: string | null;
  priorRent?: number | null;
}): Promise<InvoiceScheduleResult> {
  const businessDate = getBusinessDate();
  const scheduleStart =
    String(args.scheduleStart).split("T")[0] < businessDate
      ? businessDate
      : String(args.scheduleStart).split("T")[0];
  const scheduleEnd = resolveInvoiceScheduleEnd({
    status: args.lease.status,
    leaseEndDate: args.lease.lease_end_date,
    asOfDate: businessDate,
  });
  const periods = buildInvoiceSchedule({
    cadence: args.lease.rent_cadence,
    scheduleStart,
    scheduleEnd,
    rentDueDay: args.lease.rent_due_day,
  });
  const result: InvoiceScheduleResult = {
    proposed: periods.length,
    created: 0,
    alreadyExists: 0,
    blockedByOverlap: 0,
    rows: [],
  };

  for (const period of periods) {
    const amountRent = rentAmountForDueDate({
      dueDate: period.dueDate,
      newRent: Number(args.lease.rent) || 0,
      priorRent: args.priorRent ?? null,
      rentEffectiveDate: args.rentEffectiveDate
        ? String(args.rentEffectiveDate).split("T")[0]
        : null,
    });
    const { data, error } = await supabaseServer.rpc(
      "rent_create_invoice_if_period_available",
      {
        p_lease_id: args.lease.id,
        p_due_date: period.dueDate,
        p_period_start: period.periodStart,
        p_period_end: period.periodEnd,
        p_rent_cadence: period.cadence,
        p_amount_rent: amountRent,
      },
    );
    if (error) throw new Error(error.message);
    const row =
      data && typeof data === "object"
        ? (data as Record<string, unknown>)
        : {};
    result.rows.push(row);
    if (row.created === true) result.created += 1;
    else if (row.reason === "already_exists") result.alreadyExists += 1;
    else if (row.reason === "period_overlap") result.blockedByOverlap += 1;
  }

  return result;
}
