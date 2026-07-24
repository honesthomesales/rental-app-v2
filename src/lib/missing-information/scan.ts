/**
 * Read-only scan for missing / inconsistent production data.
 * Detects real issues only; never auto-repairs.
 */

import { getBusinessDate } from "@/lib/business-date";
import { isUsablePhone } from "@/lib/communications/phone";
import { safeNumeric } from "@/lib/currency";
import { isActiveBillingLease, isPhysicallyOccupied } from "@/lib/lease-status";
import { supabaseServer } from "@/lib/supabase-server";

export type MissingInfoCategory =
  | "Tenant"
  | "Property"
  | "Lease"
  | "Financial"
  | "Insurance"
  | "Document"
  | "Other";

export type MissingInfoSeverity = "critical" | "warning" | "informational";

export type AffectedRecord = {
  type: string;
  id: string;
  label: string;
};

export type MissingInformationFinding = {
  id: string;
  category: MissingInfoCategory;
  severity: MissingInfoSeverity;
  problem: string;
  affectedRecord: AffectedRecord;
  explanation: string;
  href: string;
  blocking: boolean;
};

const PAGE = 1000;
const SOON_EXPIRE_DAYS = 30;
const KNOWN_PAYMENT_STATUSES = new Set([
  "completed",
  "pending",
  "failed",
  "paid",
  "partial",
  "unpaid",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function fetchAll<T>(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE - 1;
    const { data, error } = await build(from, to);
    if (error) throw new Error(error.message);
    const chunk = data || [];
    out.push(...chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

function tenantLabel(t: {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  id: string;
}): string {
  const name =
    (t.full_name || "").trim() ||
    [t.first_name, t.last_name].filter(Boolean).join(" ").trim();
  return name || `Tenant ${t.id.slice(0, 8)}`;
}

function propertyLabel(p: {
  name?: string | null;
  address?: string | null;
  id: string;
}): string {
  return (p.name || p.address || "").trim() || `Property ${p.id.slice(0, 8)}`;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function finding(partial: Omit<MissingInformationFinding, "id"> & { id?: string }): MissingInformationFinding {
  const id =
    partial.id ||
    `${partial.category}:${partial.affectedRecord.type}:${partial.affectedRecord.id}:${partial.problem}`
      .toLowerCase()
      .replace(/[^a-z0-9:._-]+/g, "-")
      .slice(0, 180);
  return { ...partial, id };
}

export async function scanMissingInformation(
  asOfDate?: string | null,
): Promise<MissingInformationFinding[]> {
  const businessDate = asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(asOfDate)
    ? asOfDate
    : getBusinessDate();
  const soonCutoff = addDays(businessDate, SOON_EXPIRE_DAYS);
  const findings: MissingInformationFinding[] = [];

  const [tenants, properties, leases, payments, invoices] = await Promise.all([
    fetchAll<Record<string, unknown>>((from, to) =>
      supabaseServer
        .from("RENT_tenants")
        .select("id, full_name, first_name, last_name, email, phone, is_active")
        .range(from, to),
    ),
    fetchAll<Record<string, unknown>>((from, to) =>
      supabaseServer
        .from("RENT_properties")
        .select(
          "id, name, address, city, state, zip_code, status, property_type, rent_value, insurance_policy_number, insurance_provider, insurance_premium",
        )
        .range(from, to),
    ),
    fetchAll<Record<string, unknown>>((from, to) =>
      supabaseServer
        .from("RENT_leases")
        .select(
          "id, property_id, tenant_id, status, rent, rent_cadence, rent_due_day, lease_start_date, lease_end_date, lease_pdf_url",
        )
        .range(from, to),
    ),
    fetchAll<Record<string, unknown>>((from, to) =>
      supabaseServer
        .from("RENT_payments")
        .select("id, lease_id, invoice_id, amount, status, payment_date, tenant_id, property_id")
        .range(from, to),
    ),
    fetchAll<Record<string, unknown>>((from, to) =>
      supabaseServer
        .from("RENT_invoices")
        .select("id, lease_id, due_date, status, amount_total, amount_paid")
        .range(from, to),
    ),
  ]);

  let allocations: Array<Record<string, unknown>> = [];
  try {
    allocations = await fetchAll<Record<string, unknown>>((from, to) =>
      supabaseServer
        .from("RENT_payment_allocations")
        .select("id, payment_id, invoice_id, amount, amount_to_rent, amount_to_late_fee")
        .range(from, to),
    );
  } catch {
    allocations = [];
  }

  let documents: Array<Record<string, unknown>> = [];
  try {
    documents = await fetchAll<Record<string, unknown>>((from, to) =>
      supabaseServer
        .from("RENT_documents")
        .select("id, title, file_url")
        .range(from, to),
    );
  } catch {
    documents = [];
  }

  const tenantById = new Map(tenants.map((t) => [String(t.id), t]));
  const propertyById = new Map(properties.map((p) => [String(p.id), p]));
  const leaseById = new Map(leases.map((l) => [String(l.id), l]));

  const activeLeasesByTenant = new Map<string, string[]>();
  const activeLeasesByProperty = new Map<string, string[]>();
  for (const lease of leases) {
    if (!isActiveBillingLease(String(lease.status || ""))) continue;
    const tid = lease.tenant_id ? String(lease.tenant_id) : "";
    const pid = lease.property_id ? String(lease.property_id) : "";
    if (tid) {
      const list = activeLeasesByTenant.get(tid) || [];
      list.push(String(lease.id));
      activeLeasesByTenant.set(tid, list);
    }
    if (pid) {
      const list = activeLeasesByProperty.get(pid) || [];
      list.push(String(lease.id));
      activeLeasesByProperty.set(pid, list);
    }
  }

  // --- Tenants ---
  for (const tenant of tenants) {
    const id = String(tenant.id);
    const label = tenantLabel({
      id,
      full_name: tenant.full_name as string | null,
      first_name: tenant.first_name as string | null,
      last_name: tenant.last_name as string | null,
    });
    const isActive = tenant.is_active !== false;
    const phone = (tenant.phone as string | null) || null;
    const email = (tenant.email as string | null) || null;

    if (isActive && !phone?.trim()) {
      findings.push(
        finding({
          category: "Tenant",
          severity: "warning",
          problem: "Missing phone number",
          affectedRecord: { type: "tenant", id, label },
          explanation: "Active tenant has no phone on file.",
          href: `/tenants?id=${id}&field=phone`,
          blocking: false,
        }),
      );
    } else if (isActive && phone?.trim() && !isUsablePhone(phone)) {
      findings.push(
        finding({
          category: "Tenant",
          severity: "warning",
          problem: "Invalid phone number",
          affectedRecord: { type: "tenant", id, label },
          explanation: `Phone "${phone}" cannot be normalized to a usable US number.`,
          href: `/tenants?id=${id}&field=phone`,
          blocking: false,
        }),
      );
    }

    if (isActive && email?.trim() && !EMAIL_RE.test(email.trim())) {
      findings.push(
        finding({
          category: "Tenant",
          severity: "warning",
          problem: "Invalid email address",
          affectedRecord: { type: "tenant", id, label },
          explanation: `Email "${email}" is not a valid address format.`,
          href: `/tenants?id=${id}&field=email`,
          blocking: false,
        }),
      );
    }

    if (isActive && !activeLeasesByTenant.has(id)) {
      findings.push(
        finding({
          category: "Tenant",
          severity: "informational",
          problem: "Tenant without active lease",
          affectedRecord: { type: "tenant", id, label },
          explanation:
            "Tenant is marked active but has no occupied/eviction lease.",
          href: `/tenants?id=${id}`,
          blocking: false,
        }),
      );
    }
  }

  // Duplicate tenants (same normalized name + phone)
  const tenantDupKey = new Map<string, string[]>();
  for (const tenant of tenants) {
    if (tenant.is_active === false) continue;
    const name = tenantLabel({
      id: String(tenant.id),
      full_name: tenant.full_name as string | null,
      first_name: tenant.first_name as string | null,
      last_name: tenant.last_name as string | null,
    })
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    const phoneDigits = String(tenant.phone || "").replace(/\D/g, "");
    if (!name || phoneDigits.length < 10) continue;
    const key = `${name}|${phoneDigits}`;
    const list = tenantDupKey.get(key) || [];
    list.push(String(tenant.id));
    tenantDupKey.set(key, list);
  }
  for (const [, ids] of tenantDupKey) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      const t = tenantById.get(id)!;
      findings.push(
        finding({
          category: "Tenant",
          severity: "warning",
          problem: "Possible duplicate tenant",
          affectedRecord: {
            type: "tenant",
            id,
            label: tenantLabel({
              id,
              full_name: t.full_name as string | null,
              first_name: t.first_name as string | null,
              last_name: t.last_name as string | null,
            }),
          },
          explanation: `Same name and phone appear on ${ids.length} tenant records.`,
          href: `/tenants?id=${id}`,
          blocking: false,
        }),
      );
    }
  }

  // --- Properties ---
  for (const property of properties) {
    const id = String(property.id);
    const label = propertyLabel({
      id,
      name: property.name as string | null,
      address: property.address as string | null,
    });
    const status = String(property.status || "active").toLowerCase();
    if (status === "retired") continue;

    const name = String(property.name || "").trim();
    const address = String(property.address || "").trim();
    if (!name || !address) {
      findings.push(
        finding({
          category: "Property",
          severity: "critical",
          problem: "Property missing required info",
          affectedRecord: { type: "property", id, label },
          explanation: !name
            ? "Property name is missing."
            : "Property address is missing.",
          href: `/properties?id=${id}`,
          blocking: true,
        }),
      );
    }

    const type = String(property.property_type || "").toLowerCase();
    const rentValue = safeNumeric(property.rent_value as string | number | null);
    const residential = ["house", "doublewide", "singlewide"].includes(type);
    if (
      residential &&
      rentValue > 1 &&
      !activeLeasesByProperty.has(id)
    ) {
      findings.push(
        finding({
          category: "Property",
          severity: "informational",
          problem: "Property without active tenant",
          affectedRecord: { type: "property", id, label },
          explanation:
            "Residential property with rent value has no occupied/eviction lease.",
          href: `/properties?id=${id}`,
          blocking: false,
        }),
      );
    }

    // Insurance: only when real policy fields exist
    const provider = String(property.insurance_provider || "").trim();
    const policy = String(property.insurance_policy_number || "").trim();
    const premium = safeNumeric(
      property.insurance_premium as string | number | null,
    );
    const hasRealInsurance =
      (provider && !/^(none|n\/a|null|-)$/i.test(provider)) ||
      (policy && !/^(none|n\/a|null|-)$/i.test(policy)) ||
      premium > 0;

    if (hasRealInsurance) {
      if (
        (provider && !policy) ||
        (policy && !provider) ||
        ((provider || policy) && premium <= 0)
      ) {
        findings.push(
          finding({
            category: "Insurance",
            severity: "warning",
            problem: "Incomplete insurance record",
            affectedRecord: { type: "property", id, label },
            explanation:
              "Insurance fields are partially filled (provider, policy number, or premium incomplete).",
            href: `/`,
            blocking: false,
          }),
        );
      }
    }
  }

  // --- Leases ---
  for (const lease of leases) {
    const id = String(lease.id);
    const status = String(lease.status || "");
    const prop = lease.property_id
      ? propertyById.get(String(lease.property_id))
      : null;
    const ten = lease.tenant_id
      ? tenantById.get(String(lease.tenant_id))
      : null;
    const labelParts = [
      prop
        ? propertyLabel({
            id: String(prop.id),
            name: prop.name as string | null,
            address: prop.address as string | null,
          })
        : null,
      ten
        ? tenantLabel({
            id: String(ten.id),
            full_name: ten.full_name as string | null,
            first_name: ten.first_name as string | null,
            last_name: ten.last_name as string | null,
          })
        : null,
    ].filter(Boolean);
    const label = labelParts.join(" · ") || `Lease ${id.slice(0, 8)}`;

    if (lease.property_id && !prop) {
      findings.push(
        finding({
          category: "Lease",
          severity: "critical",
          problem: "Broken property relationship",
          affectedRecord: { type: "lease", id, label },
          explanation: `Lease references missing property ${lease.property_id}.`,
          href: `/leases?id=${id}`,
          blocking: true,
        }),
      );
    }
    if (lease.tenant_id && !ten) {
      findings.push(
        finding({
          category: "Lease",
          severity: "critical",
          problem: "Broken tenant relationship",
          affectedRecord: { type: "lease", id, label },
          explanation: `Lease references missing tenant ${lease.tenant_id}.`,
          href: `/leases?id=${id}`,
          blocking: true,
        }),
      );
    }
    if (isPhysicallyOccupied(status) && !lease.tenant_id) {
      findings.push(
        finding({
          category: "Lease",
          severity: "critical",
          problem: "Occupied lease missing tenant",
          affectedRecord: { type: "lease", id, label },
          explanation: "Active/occupied lease has no tenant_id.",
          href: `/leases?id=${id}`,
          blocking: true,
        }),
      );
    }
    if (isPhysicallyOccupied(status) && !lease.property_id) {
      findings.push(
        finding({
          category: "Lease",
          severity: "critical",
          problem: "Occupied lease missing property",
          affectedRecord: { type: "lease", id, label },
          explanation: "Active/occupied lease has no property_id.",
          href: `/leases?id=${id}`,
          blocking: true,
        }),
      );
    }

    if (isActiveBillingLease(status)) {
      const rent = safeNumeric(lease.rent as string | number | null);
      const cadence = String(lease.rent_cadence || "").trim().toLowerCase();
      if (!cadence || rent <= 0) {
        findings.push(
          finding({
            category: "Lease",
            severity: "critical",
            problem: "Lease without billing term",
            affectedRecord: { type: "lease", id, label },
            explanation: !cadence
              ? "Active billing lease is missing rent_cadence."
              : "Active billing lease has missing or zero rent.",
            href: `/leases?id=${id}`,
            blocking: true,
          }),
        );
      }

      const end = lease.lease_end_date
        ? String(lease.lease_end_date).split("T")[0]
        : null;
      if (!end) {
        findings.push(
          finding({
            category: "Lease",
            severity: "informational",
            problem: "Lease missing end date",
            affectedRecord: { type: "lease", id, label },
            explanation:
              "Active lease has no lease_end_date (may be intentional open-ended).",
            href: `/leases?id=${id}`,
            blocking: false,
          }),
        );
      } else if (end < businessDate) {
        findings.push(
          finding({
            category: "Lease",
            severity: "informational",
            problem: "Lease end date passed (period-to-period)",
            affectedRecord: { type: "lease", id, label },
            explanation: `Lease ended ${end}; status remains ${status}.`,
            href: `/leases?id=${id}`,
            blocking: false,
          }),
        );
      } else if (end <= soonCutoff) {
        findings.push(
          finding({
            category: "Lease",
            severity: "warning",
            problem: "Lease expiring soon",
            affectedRecord: { type: "lease", id, label },
            explanation: `Lease ends on ${end} (within ${SOON_EXPIRE_DAYS} days).`,
            href: `/leases?id=${id}`,
            blocking: false,
          }),
        );
      }
    }

    const pdf = String(lease.lease_pdf_url || "").trim();
    if (pdf && !isValidHttpUrl(pdf)) {
      findings.push(
        finding({
          category: "Document",
          severity: "warning",
          problem: "Broken lease PDF link",
          affectedRecord: { type: "lease", id, label },
          explanation: "lease_pdf_url is present but is not a valid http(s) URL.",
          href: `/leases?id=${id}`,
          blocking: false,
        }),
      );
    }
  }

  // Multiple active leases on one property
  for (const [propertyId, leaseIds] of activeLeasesByProperty) {
    if (leaseIds.length < 2) continue;
    const prop = propertyById.get(propertyId);
    const label = prop
      ? propertyLabel({
          id: propertyId,
          name: prop.name as string | null,
          address: prop.address as string | null,
        })
      : propertyId;
    findings.push(
      finding({
        category: "Lease",
        severity: "warning",
        problem: "Multiple active leases on property",
        affectedRecord: { type: "property", id: propertyId, label },
        explanation: `${leaseIds.length} occupied/eviction leases share this property.`,
        href: `/leases?id=${leaseIds[0] || propertyId}`,
        blocking: false,
      }),
    );
  }

  // --- Financial: payments ---
  const allocatedByPayment = new Map<string, number>();
  for (const row of allocations) {
    const pid = String(row.payment_id || "");
    if (!pid) continue;
    const amt =
      row.amount != null
        ? safeNumeric(row.amount as string | number)
        : safeNumeric(row.amount_to_rent as string | number) +
          safeNumeric(row.amount_to_late_fee as string | number);
    allocatedByPayment.set(pid, (allocatedByPayment.get(pid) || 0) + amt);
  }

  for (const payment of payments) {
    const id = String(payment.id);
    const amount = safeNumeric(payment.amount as string | number | null);
    const statusRaw = payment.status == null ? "" : String(payment.status).trim();
    const status = statusRaw.toLowerCase();
    const label = `Payment ${id.slice(0, 8)} · $${amount.toFixed(2)}`;

    if (statusRaw && !KNOWN_PAYMENT_STATUSES.has(status)) {
      findings.push(
        finding({
          category: "Financial",
          severity: "warning",
          problem: "Unknown payment status",
          affectedRecord: { type: "payment", id, label },
          explanation: `Payment status "${statusRaw}" is not a recognized value.`,
          href: `/payments?id=${id}`,
          blocking: false,
        }),
      );
    }

    if (payment.lease_id && !leaseById.has(String(payment.lease_id))) {
      findings.push(
        finding({
          category: "Financial",
          severity: "critical",
          problem: "Payment broken lease relationship",
          affectedRecord: { type: "payment", id, label },
          explanation: `Payment references missing lease ${payment.lease_id}.`,
          href: `/payments?id=${id}`,
          blocking: true,
        }),
      );
    }

    if (amount > 0 && (status === "completed" || status === "paid" || !status)) {
      const allocated = allocatedByPayment.get(id);
      const hasInvoice = Boolean(payment.invoice_id);
      if (allocated != null) {
        const unapplied = Math.round((amount - allocated) * 100) / 100;
        if (unapplied > 0.009) {
          findings.push(
            finding({
              category: "Financial",
              severity: "warning",
              problem: "Unapplied payment amount",
              affectedRecord: { type: "payment", id, label },
              explanation: `$${unapplied.toFixed(2)} of $${amount.toFixed(2)} is not allocated.`,
              href: `/payments?id=${id}`,
              blocking: false,
            }),
          );
        }
      } else if (!hasInvoice) {
        findings.push(
          finding({
            category: "Financial",
            severity: "warning",
            problem: "Unapplied payment amount",
            affectedRecord: { type: "payment", id, label },
            explanation:
              "Completed payment has no invoice_id and no allocation rows.",
            href: `/payments?id=${id}`,
            blocking: false,
          }),
        );
      }
    }
  }

  // Duplicate invoices (same lease + due date, non-void)
  const invoiceDup = new Map<string, string[]>();
  for (const inv of invoices) {
    const status = String(inv.status || "").toUpperCase();
    if (status === "VOID" || status === "CANCELLED") continue;
    const leaseId = inv.lease_id ? String(inv.lease_id) : "";
    const due = inv.due_date ? String(inv.due_date).split("T")[0] : "";
    if (!leaseId || !due) continue;
    const key = `${leaseId}|${due}`;
    const list = invoiceDup.get(key) || [];
    list.push(String(inv.id));
    invoiceDup.set(key, list);
  }
  for (const [key, ids] of invoiceDup) {
    if (ids.length < 2) continue;
    const [leaseId, due] = key.split("|");
    const lease = leaseById.get(leaseId);
    const prop = lease?.property_id
      ? propertyById.get(String(lease.property_id))
      : null;
    const label = prop
      ? `${propertyLabel({
          id: String(prop.id),
          name: prop.name as string | null,
          address: prop.address as string | null,
        })} · due ${due}`
      : `Lease ${leaseId.slice(0, 8)} · due ${due}`;
    findings.push(
      finding({
        category: "Financial",
        severity: "critical",
        problem: "Duplicate invoices for period",
        affectedRecord: { type: "lease", id: leaseId, label },
        explanation: `${ids.length} non-void invoices share lease and due date ${due}.`,
        href: `/data-health`,
        blocking: true,
      }),
    );
  }

  // --- Documents with empty/malformed file_url ---
  for (const doc of documents) {
    const id = String(doc.id);
    const title = String(doc.title || `Document ${id.slice(0, 8)}`);
    const url = String(doc.file_url || "").trim();
    if (!url) {
      findings.push(
        finding({
          category: "Document",
          severity: "warning",
          problem: "Document missing file link",
          affectedRecord: { type: "document", id, label: title },
          explanation: "Document record has an empty file_url.",
          href: `/deals-docs?view=docs`,
          blocking: false,
        }),
      );
    } else if (!isValidHttpUrl(url)) {
      findings.push(
        finding({
          category: "Document",
          severity: "warning",
          problem: "Broken document link",
          affectedRecord: { type: "document", id, label: title },
          explanation: "file_url is not a valid http(s) URL.",
          href: `/deals-docs?view=docs`,
          blocking: false,
        }),
      );
    }
  }

  const severityRank: Record<MissingInfoSeverity, number> = {
    critical: 0,
    warning: 1,
    informational: 2,
  };
  findings.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      a.category.localeCompare(b.category) ||
      a.problem.localeCompare(b.problem) ||
      a.affectedRecord.label.localeCompare(b.affectedRecord.label),
  );

  return findings;
}
