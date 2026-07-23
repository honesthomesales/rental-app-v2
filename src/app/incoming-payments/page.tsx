"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCents } from "@/lib/payments/money";
import { getBusinessDate } from "@/lib/business-date";

type QueuePayload = {
  matches: Array<{
    id: string;
    confidence_score: number;
    evidence: Record<string, unknown>;
    tenant_id: string | null;
    lease_id: string | null;
    bank_transaction?: {
      amount_cents: number;
      description: string | null;
      posted_date: string | null;
      classification: string;
      is_pending: boolean;
    };
    tenant?: { full_name?: string; first_name?: string; last_name?: string } | null;
  }>;
  awaitingVerification: Array<{
    id: string;
    method: string;
    status: string;
    rent_amount_cents: number;
    tenant_id: string;
    lease_id: string;
    property_id?: string | null;
    tenant_reference_code: string | null;
    created_at: string;
    tenant_name?: string | null;
    property_label?: string | null;
    sender_name?: string | null;
    payment_note?: string | null;
    tenant_href?: string | null;
    lease_href?: string | null;
  }>;
  exceptions: Array<{
    id: string;
    kind: string;
    severity: string;
    created_at: string;
  }>;
};

export default function IncomingPaymentsPage() {
  const [data, setData] = useState<QueuePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/staff/incoming-payments", {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Unable to load queue");
        setData(null);
        return;
      }
      setData(json);
    } catch {
      setError("Unable to load queue");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(body: Record<string, string | number>) {
    setBusy(String(body.attemptId || body.matchId || "x"));
    try {
      const res = await fetch("/api/staff/incoming-payments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Action failed");
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  function confirmReceived(row: QueuePayload["awaitingVerification"][0]) {
    const amount = formatCents(row.rent_amount_cents);
    const receivedDate = getBusinessDate();
    const ok = window.confirm(
      [
        "Confirm Received?",
        "",
        `Tenant: ${row.tenant_name || row.tenant_id}`,
        `Property: ${row.property_label || "—"}`,
        `Method: ${row.method}`,
        `Amount received: ${amount}`,
        `Date received: ${receivedDate}`,
        `Reference: ${row.tenant_reference_code || "—"}`,
        `Sender: ${row.sender_name || "—"}`,
        "",
        "This will create exactly one settled payment and update the balance.",
      ].join("\n"),
    );
    if (!ok) return;
    void act({
      action: "confirm_attempt",
      attemptId: row.id,
      confirmedAmountCents: row.rent_amount_cents,
      receivedDate,
      confirmedMethod: row.method,
    });
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-xl font-semibold text-gray-900">Incoming Payments Review</h1>
      <p className="mt-1 text-sm text-gray-600">
        Confirm Cash App / Zelle reports and bank-match candidates. Auto-post stays off
        until separately approved.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {error}
        </div>
      )}

      <section className="mt-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800">
          Awaiting verification / pending
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b text-xs text-gray-500">
              <tr>
                <th className="py-2 pr-3">Submitted</th>
                <th className="py-2 pr-3">Tenant / Property</th>
                <th className="py-2 pr-3">Method</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2 pr-3">Reference / Sender</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.awaitingVerification || []).map((row) => (
                <tr key={row.id} className="border-b border-gray-100 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="font-medium text-gray-900">
                      {row.tenant_name || "Tenant"}
                    </div>
                    <div className="text-xs text-gray-500 break-words">
                      {row.property_label || "—"}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      {row.tenant_href && (
                        <a className="text-blue-700 hover:underline" href={row.tenant_href}>
                          Open Tenant
                        </a>
                      )}
                      {row.lease_href && (
                        <a className="text-blue-700 hover:underline" href={row.lease_href}>
                          Open Lease
                        </a>
                      )}
                      <a
                        className="text-blue-700 hover:underline"
                        href={`/payments?leaseId=${encodeURIComponent(row.lease_id)}`}
                      >
                        Payment History
                      </a>
                    </div>
                  </td>
                  <td className="py-2 pr-3">{row.method}</td>
                  <td className="py-2 pr-3">{formatCents(row.rent_amount_cents)}</td>
                  <td className="py-2 pr-3">
                    <div className="font-mono text-xs">
                      {row.tenant_reference_code || "—"}
                    </div>
                    <div className="text-xs text-gray-500 break-words">
                      {row.sender_name || "—"}
                      {row.payment_note ? ` · ${row.payment_note}` : ""}
                    </div>
                  </td>
                  <td className="py-2 pr-3">{row.status}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy === row.id || row.status !== "awaiting_verification"}
                        className="rounded bg-green-600 px-2 py-1 text-xs text-white disabled:opacity-50"
                        onClick={() => confirmReceived(row)}
                      >
                        Confirm Received
                      </button>
                      <button
                        type="button"
                        disabled={busy === row.id}
                        className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-800 disabled:opacity-50"
                        onClick={() => {
                          const reason =
                            window.prompt("Reject reason (optional):") || "";
                          void act({
                            action: "reject_attempt",
                            attemptId: row.id,
                            reason,
                          });
                        }}
                      >
                        Reject / Not Received
                      </button>
                      <button
                        type="button"
                        disabled={busy === row.id}
                        className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-800 disabled:opacity-50"
                        onClick={() =>
                          void act({
                            action: "mark_attempt_duplicate",
                            attemptId: row.id,
                          })
                        }
                      >
                        Mark Duplicate
                      </button>
                      <button
                        type="button"
                        disabled={busy === row.id}
                        className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 disabled:opacity-50"
                        onClick={() =>
                          void act({ action: "leave_awaiting", attemptId: row.id })
                        }
                      >
                        Leave Awaiting
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {(data?.awaitingVerification || []).length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-gray-500">
                    No pending portal attempts.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800">Bank match candidates</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b text-xs text-gray-500">
              <tr>
                <th className="py-2 pr-3">Deposit</th>
                <th className="py-2 pr-3">Class</th>
                <th className="py-2 pr-3">Suggested tenant</th>
                <th className="py-2 pr-3">Score</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.matches || []).map((m) => {
                const name =
                  m.tenant?.full_name ||
                  [m.tenant?.first_name, m.tenant?.last_name]
                    .filter(Boolean)
                    .join(" ") ||
                  "—";
                return (
                  <tr key={m.id} className="border-b border-gray-100">
                    <td className="py-2 pr-3">
                      {formatCents(m.bank_transaction?.amount_cents || 0)} ·{" "}
                      {m.bank_transaction?.posted_date || "—"}
                      <div className="text-xs text-gray-500">
                        {m.bank_transaction?.description || ""}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      {m.bank_transaction?.classification}
                      {m.bank_transaction?.is_pending ? " (pending)" : ""}
                    </td>
                    <td className="py-2 pr-3">{name}</td>
                    <td className="py-2 pr-3">{m.confidence_score}</td>
                    <td className="py-2 space-x-2">
                      <button
                        type="button"
                        disabled={busy === m.id}
                        className="rounded bg-green-600 px-2 py-1 text-xs text-white disabled:opacity-50"
                        onClick={() =>
                          void act({ action: "post_match", matchId: m.id })
                        }
                      >
                        Post Payment
                      </button>
                      <button
                        type="button"
                        disabled={busy === m.id}
                        className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-800"
                        onClick={() =>
                          void act({ action: "reject_match", matchId: m.id })
                        }
                      >
                        Reject Match
                      </button>
                      <button
                        type="button"
                        disabled={busy === m.id}
                        className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-800"
                        onClick={() =>
                          void act({ action: "mark_duplicate", matchId: m.id })
                        }
                      >
                        Mark Duplicate
                      </button>
                    </td>
                  </tr>
                );
              })}
              {(data?.matches || []).length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-gray-500">
                    No match candidates. Bank sync remains disabled until owner setup.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800">Open exceptions</h2>
        <ul className="mt-2 space-y-1 text-sm text-gray-700">
          {(data?.exceptions || []).map((e) => (
            <li key={e.id}>
              [{e.severity}] {e.kind} · {new Date(e.created_at).toLocaleString()}
            </li>
          ))}
          {(data?.exceptions || []).length === 0 && (
            <li className="text-gray-500">None</li>
          )}
        </ul>
      </section>
    </div>
  );
}
