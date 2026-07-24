"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCents } from "@/lib/payments/money";

type PortalFlags = {
  portalEnabled: boolean;
  contactSelfServiceEnabled: boolean;
};

type Summary = {
  businessName: string;
  tenantName: string;
  propertyLabel: string;
  paymentReference: string;
  settledBalanceCents: number;
  pastDueCents: number;
  pendingCents: number;
  oldestUnpaidDueDate: string | null;
  nextUpcomingDueDate: string | null;
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

type Contact = {
  id: string;
  type: string;
  value: string;
  label: string;
  isPrimary: boolean;
  verificationStatus: string;
};

export default function TenantPayClient({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [flags, setFlags] = useState<PortalFlags | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [copiedRef, setCopiedRef] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Unable to load account");
        setSummary(null);
        return;
      }
      setSummary(data.summary);
      setContacts(data.contacts || []);
      setFlags(data.flags);
    } catch {
      setError("Unable to load account");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function copyReference() {
    if (!summary?.paymentReference) return;
    try {
      await navigator.clipboard.writeText(summary.paymentReference);
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 2000);
    } catch {
      setNotice("Could not copy reference — please copy it manually.");
    }
  }

  async function addContact(type: "phone" | "email", value: string) {
    if (!flags?.contactSelfServiceEnabled) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", contactType: type, value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice(data.error || "Could not add contact");
        return;
      }
      if (type === "phone") setNewPhone("");
      else setNewEmail("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function inactivateContact(contactPointId: string) {
    if (!flags?.contactSelfServiceEnabled) return;
    if (
      !confirm(
        "Mark this contact inactive? It will stay in history and is not deleted.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "inactivate",
          contactPointId,
          reason: "tenant_request",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice(data.error || "Could not update contact");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="mx-auto max-w-lg rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-sm">
          Loading your account…
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="mx-auto max-w-lg rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          {error || "Account information is not available."}
        </div>
      </div>
    );
  }

  const helpPhone = summary.helpPhone || "864-322-3432";
  const helpEmail = summary.helpEmail || "honesthomesales@gmail.com";
  const showPending = summary.pendingCents > 0;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {summary.businessName}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-gray-900">
              Tenant Account
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              {summary.tenantName} · {summary.propertyLabel}
            </p>
          </div>

          <div className="space-y-4 px-5 py-5 text-sm">
            <dl className="space-y-2">
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Current balance due</dt>
                <dd className="font-medium text-gray-900">
                  {formatCents(summary.settledBalanceCents)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Past-due balance</dt>
                <dd>{formatCents(summary.pastDueCents)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Oldest unpaid due date</dt>
                <dd>{summary.oldestUnpaidDueDate || "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Next upcoming due date</dt>
                <dd>
                  {summary.nextUpcomingDueDate ||
                    summary.nextDueDate ||
                    "—"}
                </dd>
              </div>
              {showPending && (
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Pending provider payment</dt>
                  <dd>{formatCents(summary.pendingCents)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Account reference</dt>
                <dd className="flex items-center gap-2 font-mono text-xs">
                  <span>{summary.paymentReference}</span>
                  <button
                    type="button"
                    onClick={() => void copyReference()}
                    className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] font-sans text-gray-700 hover:bg-gray-50"
                  >
                    {copiedRef ? "Copied" : "Copy"}
                  </button>
                </dd>
              </div>
            </dl>

            {summary.openCharges.length > 0 && (
              <section>
                <h2 className="font-semibold text-gray-800">Open invoices</h2>
                <ul className="mt-2 divide-y divide-gray-100 rounded-md border border-gray-200">
                  {summary.openCharges.map((c) => (
                    <li
                      key={c.invoiceId}
                      className="flex justify-between gap-3 px-3 py-2 text-xs sm:text-sm"
                    >
                      <span>
                        Due {c.dueDate} · {c.status}
                      </span>
                      <span>{formatCents(c.balanceDueCents)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900">
              <p>
                Online payments are not currently available. Please make payment
                using your normal payment method. Payments entered by Honest Home
                Sales will automatically appear in your account.
              </p>
              <p className="mt-3">
                Phone:{" "}
                <a className="underline" href={`tel:${helpPhone.replace(/\D/g, "")}`}>
                  {helpPhone}
                </a>
              </p>
              <p className="mt-1">
                Email:{" "}
                <a className="underline" href={`mailto:${helpEmail}`}>
                  {helpEmail}
                </a>
              </p>
            </section>

            {notice && (
              <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800">
                {notice}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-800">Recent payments</h2>
          {summary.recentPayments.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No recent payments.</p>
          ) : (
            <ul className="mt-2 divide-y divide-gray-100 text-sm">
              {summary.recentPayments.map((p) => (
                <li key={p.id} className="flex justify-between gap-3 py-2">
                  <span>
                    {p.paymentDate} · {p.method || "Payment"}
                  </span>
                  <span>{formatCents(p.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-800">Contact information</h2>
          <ul className="mt-2 space-y-1 text-sm text-gray-700">
            {contacts.length === 0 && (
              <li className="text-gray-500">No contacts on file yet.</li>
            )}
            {contacts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0 break-all">
                  {c.type}: {c.value}
                  {c.isPrimary ? " (primary)" : ""} · {c.verificationStatus}
                </span>
                {flags?.contactSelfServiceEnabled && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void inactivateContact(c.id)}
                    className="shrink-0 text-xs text-red-700 hover:underline disabled:opacity-50"
                  >
                    Mark inactive
                  </button>
                )}
              </li>
            ))}
          </ul>
          {flags?.contactSelfServiceEnabled && (
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                  placeholder="Add phone"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                />
                <button
                  type="button"
                  disabled={!newPhone || busy}
                  onClick={() => void addContact("phone", newPhone)}
                  className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                  placeholder="Add email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
                <button
                  type="button"
                  disabled={!newEmail || busy}
                  onClick={() => void addContact("email", newEmail)}
                  className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              <p className="text-xs text-gray-500">
                New contacts stay unverified until confirmed. History is never deleted.
              </p>
            </div>
          )}
        </div>

        <div className="px-1 pb-8 text-xs text-gray-500">
          Support: {helpPhone} · {helpEmail}
        </div>
      </div>
    </div>
  );
}
