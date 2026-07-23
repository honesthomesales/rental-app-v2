"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCents } from "@/lib/payments/money";

type PortalFlags = {
  portalEnabled: boolean;
  achEnabled: boolean;
  cardEnabled: boolean;
  cashAppPayEnabled: boolean;
  existingCashAppEnabled: boolean;
  zelleEnabled: boolean;
  contactSelfServiceEnabled: boolean;
  feeEngineEnabled: boolean;
};

type Summary = {
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
  const [destinations, setDestinations] = useState<{
    cashApp: string | null;
    zelle: string | null;
  }>({ cashApp: null, zelle: null });
  const [method, setMethod] = useState<string>("");
  const [choice, setChoice] = useState<"full" | "past_due">("full");
  const [confirmTotal, setConfirmTotal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [awaitingVerification, setAwaitingVerification] = useState(false);
  const [senderName, setSenderName] = useState("");
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
      setDestinations(data.destinations || { cashApp: null, zelle: null });
    } catch {
      setError("Unable to load account");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function startPayment() {
    if (!method || !confirmTotal) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          choice,
          senderName: senderName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice(data.error || "Payment could not start");
        return;
      }
      if (data.mode === "stripe_checkout" && data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      if (data.mode === "awaiting_verification") {
        setAwaitingVerification(true);
        setNotice(
          data.message ||
            "Awaiting Verification — your balance will not change until staff confirms receipt.",
        );
      } else {
        setNotice(data.message || "Payment submitted.");
      }
      await load();
    } catch {
      setNotice("Payment could not start");
    } finally {
      setBusy(false);
    }
  }

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
          {error || "Online payments are not available."}
        </div>
      </div>
    );
  }

  const payAmount =
    choice === "past_due" ? summary.pastDueCents : summary.settledBalanceCents;

  const methods: Array<{ id: string; label: string; enabled: boolean; note?: string }> = [
    { id: "ach", label: "Bank account (ACH)", enabled: !!flags?.achEnabled },
    { id: "card", label: "Credit / debit card", enabled: !!flags?.cardEnabled },
    {
      id: "cash_app_pay",
      label: "Cash App Pay (automatic)",
      enabled: !!flags?.cashAppPayEnabled,
    },
    {
      id: "existing_cash_app",
      label: "Cash App",
      enabled: !!flags?.existingCashAppEnabled && !!destinations.cashApp,
      note: "Manual transfer — verified by staff before balance updates",
    },
    {
      id: "zelle",
      label: "Zelle",
      enabled: !!flags?.zelleEnabled && !!destinations.zelle,
      note: "Manual transfer — verified by staff before balance updates",
    },
  ];

  const anyMethodEnabled = methods.some((m) => m.enabled);
  const isManualMethod =
    method === "existing_cash_app" || method === "zelle";

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {summary.businessName}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-gray-900">Pay Rent</h1>
            <p className="mt-1 text-sm text-gray-600">
              {summary.tenantName} · {summary.propertyLabel}
            </p>
          </div>

          <div className="space-y-4 px-5 py-5 text-sm">
            <dl className="space-y-2">
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Current settled balance</dt>
                <dd className="font-medium text-gray-900">
                  {formatCents(summary.settledBalanceCents)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Past due</dt>
                <dd>{formatCents(summary.pastDueCents)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Pending / awaiting verification</dt>
                <dd>{formatCents(summary.pendingCents)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Next due</dt>
                <dd>{summary.nextDueDate || "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Payment reference</dt>
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
                <h2 className="font-semibold text-gray-800">Open charges</h2>
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

            <section>
              <h2 className="font-semibold text-gray-800">Amount</h2>
              <div className="mt-2 space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="choice"
                    checked={choice === "full"}
                    onChange={() => setChoice("full")}
                  />
                  Full current amount ({formatCents(summary.settledBalanceCents)})
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="choice"
                    checked={choice === "past_due"}
                    onChange={() => setChoice("past_due")}
                    disabled={summary.pastDueCents <= 0}
                  />
                  Past-due amount ({formatCents(summary.pastDueCents)})
                </label>
              </div>
            </section>

            <section>
              <h2 className="font-semibold text-gray-800">Payment method</h2>
              {!anyMethodEnabled ? (
                <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
                  Online payment methods are being configured.
                </p>
              ) : (
              <ul className="mt-2 space-y-2">
                {methods.map((m) => (
                  <li key={m.id}>
                    <label
                      className={`flex cursor-pointer flex-col rounded-md border px-3 py-2 ${
                        m.enabled
                          ? "border-gray-300 bg-white"
                          : "border-gray-200 bg-gray-50 text-gray-400"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="method"
                          disabled={!m.enabled || payAmount <= 0}
                          checked={method === m.id}
                          onChange={() => {
                            setMethod(m.id);
                            setConfirmTotal(false);
                          }}
                        />
                        {m.label}
                        {!m.enabled ? " — unavailable" : null}
                      </span>
                      {m.note && m.enabled ? (
                        <span className="ml-6 text-xs text-gray-500">{m.note}</span>
                      ) : null}
                    </label>
                  </li>
                ))}
              </ul>
              )}
              {anyMethodEnabled && isManualMethod && (
                <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-3 text-xs text-blue-950">
                  <p>
                    <strong>Payment method:</strong>{" "}
                    {method === "existing_cash_app" ? "Cash App" : "Zelle"}
                  </p>
                  <p className="mt-2">
                    <strong>Send to:</strong>{" "}
                    {method === "existing_cash_app"
                      ? destinations.cashApp || "(destination pending setup)"
                      : destinations.zelle || "(destination pending setup)"}
                  </p>
                  <p className="mt-2">
                    <strong>Amount:</strong> {formatCents(payAmount)}
                  </p>
                  <p className="mt-2 flex flex-wrap items-center gap-2">
                    <span>
                      <strong>Payment reference:</strong>{" "}
                      <span className="font-mono">{summary.paymentReference}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void copyReference()}
                      className="rounded border border-blue-300 bg-white px-1.5 py-0.5 text-[10px] text-blue-900"
                    >
                      {copiedRef ? "Copied" : "Copy reference"}
                    </button>
                  </p>
                  <p className="mt-2">
                    Include the payment reference in the Cash App / Zelle note or memo
                    where possible.
                  </p>
                  <p className="mt-2 font-medium">
                    Your account will not be credited until receipt is verified by
                    staff. This is not automatic Cash App Pay.
                  </p>
                  <label className="mt-3 block">
                    <span className="text-blue-900">Sender name (optional)</span>
                    <input
                      className="mt-1 w-full rounded border border-blue-200 bg-white px-2 py-1.5 text-sm text-gray-900"
                      value={senderName}
                      onChange={(e) => setSenderName(e.target.value)}
                      placeholder="Name shown on the transfer"
                      maxLength={120}
                    />
                  </label>
                </div>
              )}
            </section>

            {awaitingVerification && (
              <div
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950"
                role="status"
              >
                <p className="font-semibold">Awaiting Verification</p>
                <p className="mt-1 text-xs">
                  We recorded your payment report. Your settled balance is unchanged
                  until authorized staff confirms the transfer arrived.
                </p>
                {(summary.helpPhone || summary.helpEmail) && (
                  <p className="mt-2 text-xs">
                    Need help?{" "}
                    {[summary.helpPhone, summary.helpEmail].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            )}

            {anyMethodEnabled && (
            <>
            <label className="flex items-start gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confirmTotal}
                onChange={(e) => setConfirmTotal(e.target.checked)}
                disabled={!method || payAmount <= 0}
              />
              <span>
                I confirm I am paying {formatCents(payAmount)}
                {flags?.feeEngineEnabled
                  ? " plus any disclosed payment-service fee calculated at checkout"
                  : ""}
                {isManualMethod
                  ? ". I understand the balance updates only after staff verification."
                  : ". Fees are separate from rent."}
              </span>
            </label>

            <button
              type="button"
              disabled={!method || !confirmTotal || busy || payAmount <= 0}
              onClick={() => void startPayment()}
              className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy
                ? "Working…"
                : isManualMethod
                  ? "I Sent This Payment"
                  : "Continue"}
            </button>
            </>
            )}

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
          Help: {summary.helpEmail || "support email pending"}
          {summary.helpPhone ? ` · ${summary.helpPhone}` : ""}
        </div>
      </div>
    </div>
  );
}
