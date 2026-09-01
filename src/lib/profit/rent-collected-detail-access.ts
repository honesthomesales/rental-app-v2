import { supabaseServer } from "@/lib/supabase-server";
import { profitCollectionQueryRange } from "@/lib/date-month";
import {
  buildProfitMonthCollectionFacts,
  fetchInvoiceMetaInRange,
  fetchProfitMonthPayments,
  filterEligiblePaymentsForProperty,
  type ProfitPaymentRow,
} from "@/lib/profit/rent-collected";

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

export async function listProfitRentCollectedPaymentsForProperty(args: {
  month: string;
  propertyId: string;
}): Promise<ProfitPaymentRow[]> {
  const { start: monthStart, end: monthEnd } = profitCollectionQueryRange(
    args.month,
  );

  const { data: property } = await supabaseServer
    .from("RENT_properties")
    .select("id")
    .eq("id", args.propertyId)
    .maybeSingle();

  if (!property) {
    throw new RentCollectedDetailAccessError("Property not found", 404);
  }

  const { data: leases } = await supabaseServer
    .from("RENT_leases")
    .select("id, property_id");

  const leasePropertyById = buildLeaseToPropertyMap(leases || []);
  const invoiceMetaById = await fetchInvoiceMetaInRange(monthStart, monthEnd);
  const monthPayments = await fetchProfitMonthPayments(monthStart, monthEnd);
  const collectionFacts = buildProfitMonthCollectionFacts({
    payments: monthPayments,
    leasePropertyById,
    monthStart,
    monthEnd,
  });

  return filterEligiblePaymentsForProperty(
    collectionFacts.eligiblePayments,
    args.propertyId,
    leasePropertyById,
    invoiceMetaById,
  );
}

export class RentCollectedDetailAccessError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Only payments visible in the profit rent-collected detail modal may be edited/deleted. */
export async function assertPaymentInProfitRentCollectedDetail(args: {
  paymentId: string;
  propertyId: string;
  month: string;
}): Promise<ProfitPaymentRow> {
  const propertyPayments = await listProfitRentCollectedPaymentsForProperty({
    month: args.month,
    propertyId: args.propertyId,
  });

  const payment = propertyPayments.find((row) => row.id === args.paymentId);
  if (!payment) {
    throw new RentCollectedDetailAccessError(
      "Payment is not part of rent collected for this property and month",
      404,
    );
  }

  return payment;
}
