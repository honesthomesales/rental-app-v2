import { supabaseServer } from "@/lib/supabase-server";
import {
  loadBillingLeases,
  loadInvoicesForLeases,
  loadPaymentsForLeases,
} from "@/lib/portfolio-ledger/repository";
import { buildAccountLedger } from "@/lib/portfolio-ledger/service";
import { getBusinessDate } from "@/lib/business-date";
import { derivePaymentReference } from "@/lib/payments/tokens";
import { dollarsToCents } from "@/lib/payments/money";

export type PortalAccountSummary = {
  businessName: string;
  tenantName: string;
  propertyLabel: string;
  paymentReference: string;
  settledBalanceCents: number;
  pastDueCents: number;
  pendingCents: number;
  nextDueDate: string | null;
  openCharges: Array<{
    invoiceId: string;
    dueDate: string;
    balanceDueCents: number;
    status: string;
  }>;
  recentPayments: Array<{
    id: string;
    paymentDate: string;
    amountCents: number;
    method: string | null;
    status: string;
  }>;
  helpEmail: string | null;
  helpPhone: string | null;
};

export async function ensurePaymentReference(tenantId: string): Promise<string> {
  const { data: existing } = await supabaseServer
    .from("RENT_v3_tenant_payment_references")
    .select("reference_code")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .maybeSingle();
  if (existing?.reference_code) return existing.reference_code;

  let code = derivePaymentReference(tenantId);
  // Collision retry
  for (let i = 0; i < 5; i++) {
    const { error } = await supabaseServer
      .from("RENT_v3_tenant_payment_references")
      .insert({ tenant_id: tenantId, reference_code: code, active: true });
    if (!error) return code;
    code = derivePaymentReference(`${tenantId}:${i}:${Date.now()}`);
  }
  return code;
}

export async function buildPortalAccountSummary(args: {
  tenantId: string;
  leaseId: string;
  propertyId: string | null;
}): Promise<PortalAccountSummary> {
  const asOf = getBusinessDate();
  const leases = (await loadBillingLeases()).filter((l) => l.id === args.leaseId);
  const lease = leases[0];
  const [invoicesByLease, paymentsByLease] = await Promise.all([
    loadInvoicesForLeases(leases.map((l) => l.id)),
    loadPaymentsForLeases(leases.map((l) => l.id)),
  ]);
  const account = lease
    ? buildAccountLedger({
        lease,
        invoices: invoicesByLease.get(lease.id) || [],
        payments: paymentsByLease.get(lease.id) || [],
        asOfDate: asOf,
      })
    : null;

  const { data: tenant } = await supabaseServer
    .from("RENT_tenants")
    .select("id, full_name, first_name, last_name, email, phone")
    .eq("id", args.tenantId)
    .maybeSingle();

  const { data: property } = args.propertyId
    ? await supabaseServer
        .from("RENT_properties")
        .select("id, name, address, city, state")
        .eq("id", args.propertyId)
        .maybeSingle()
    : { data: null };

  const tenantName =
    tenant?.full_name ||
    [tenant?.first_name, tenant?.last_name].filter(Boolean).join(" ") ||
    "Tenant";

  const propertyLabel =
    property?.address ||
    property?.name ||
    [property?.city, property?.state].filter(Boolean).join(", ") ||
    "Property";

  const paymentReference = await ensurePaymentReference(args.tenantId);

  const openCharges =
    account?.invoices
      .filter((inv) => inv.calculatedBalance > 0.009 && !inv.isFuture)
      .map((inv) => ({
        invoiceId: inv.invoiceId,
        dueDate: inv.dueDate,
        balanceDueCents: dollarsToCents(inv.calculatedBalance),
        status: inv.collectionStatus,
      })) || [];

  const { data: recent } = await supabaseServer
    .from("RENT_payments")
    .select("id, payment_date, amount, payment_method, status")
    .eq("lease_id", args.leaseId)
    .order("payment_date", { ascending: false })
    .limit(8);

  const { data: pendingAttempts } = await supabaseServer
    .from("RENT_v3_payment_attempts")
    .select("rent_amount_cents, status")
    .eq("lease_id", args.leaseId)
    .in("status", ["awaiting_customer", "submitted", "processing", "pending", "awaiting_verification"]);

  const pendingCents = (pendingAttempts || []).reduce(
    (sum, row) => sum + Number(row.rent_amount_cents || 0),
    0,
  );

  return {
    businessName: "Honest Home Sales",
    tenantName,
    propertyLabel,
    paymentReference,
    settledBalanceCents: dollarsToCents(account?.totalBalanceDue || 0),
    pastDueCents: dollarsToCents(account?.pastDueBalanceDue || 0),
    pendingCents,
    nextDueDate: openCharges[0]?.dueDate || null,
    openCharges,
    recentPayments: (recent || []).map((p) => ({
      id: p.id,
      paymentDate: p.payment_date,
      amountCents: dollarsToCents(Number(p.amount || 0)),
      method: p.payment_method,
      status: p.status || "completed",
    })),
    helpEmail: process.env.TENANT_PORTAL_SUPPORT_EMAIL || null,
    helpPhone: process.env.TENANT_PORTAL_SUPPORT_PHONE || null,
  };
}
