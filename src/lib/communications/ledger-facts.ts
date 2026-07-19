import { buildAccountLedger } from "@/lib/portfolio-ledger/service";
import {
  loadBillingLeases,
  loadInvoicesForLeases,
  loadPaymentsForLeases,
} from "@/lib/portfolio-ledger/repository";

export async function loadCommunicationLedgerAccounts(asOfDate: string) {
  const leases = await loadBillingLeases();
  const leaseIds = leases.map((lease) => lease.id);
  const [invoicesByLease, paymentsByLease] = await Promise.all([
    loadInvoicesForLeases(leaseIds),
    loadPaymentsForLeases(leaseIds),
  ]);
  return leases.map((lease) =>
    buildAccountLedger({
      lease,
      invoices: invoicesByLease.get(lease.id) || [],
      payments: paymentsByLease.get(lease.id) || [],
      asOfDate,
    }),
  );
}

