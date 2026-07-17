"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type FutureRow = {
  paymentId: string;
  tenant: string | null;
  property: string | null;
  propertyAddress: string | null;
  paymentDate: string;
  amount: number;
  status: string;
  linkedInvoice: string | null;
  businessDate: string;
  daysUntilEligible: number;
  classification: string;
};

type Payload = {
  businessDate: string;
  timezone: string;
  count: number;
  total: number;
  rows: FutureRow[];
  cadenceWarnings: Array<{ leaseId: string; warning: string; reason: string }>;
};

export default function FuturePaymentsDataHealthPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/data-health/future-payments", {
          credentials: "include",
        });
        if (!res.ok) {
          throw new Error(
            res.status === 403
              ? "Owner access required"
              : "Failed to load future payments",
          );
        }
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6">
        <p className="text-sm text-slate-500">
          <Link href="/" className="text-blue-700 hover:underline">
            Dashboard
          </Link>{" "}
          / Data health
        </p>
        <h1 className="text-2xl font-semibold text-slate-900 mt-1">
          Future-dated completed payments
        </h1>
        <p className="text-sm text-slate-600 mt-2">
          Read-only. These payments are excluded from balances, Late Tenants,
          Profit income, and allocations until their payment date arrives. No
          edit, delete, void, or allocation actions are available here.
        </p>
      </div>

      {loading ? <p className="text-sm text-slate-600">Loading…</p> : null}
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {data ? (
        <>
          <div className="mb-4 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Business date ({data.timezone}): <strong>{data.businessDate}</strong>
            {" · "}
            Excluded now: <strong>{data.count}</strong> payments /{" "}
            <strong>
              $
              {data.total.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </strong>
          </div>

          {data.cadenceWarnings?.length ? (
            <div className="mb-4 border border-slate-200 bg-white px-4 py-3 text-sm">
              <h2 className="font-medium text-slate-900">Cadence warnings</h2>
              <ul className="mt-2 list-disc pl-5 text-slate-700">
                {data.cadenceWarnings.map((w) => (
                  <li key={w.leaseId}>{w.warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="overflow-x-auto border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Tenant</th>
                  <th className="px-3 py-2 font-medium">Property</th>
                  <th className="px-3 py-2 font-medium">Payment date</th>
                  <th className="px-3 py-2 font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Invoice</th>
                  <th className="px-3 py-2 font-medium">Business date</th>
                  <th className="px-3 py-2 font-medium">Days until eligible</th>
                  <th className="px-3 py-2 font-medium">Classification</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={String(r.paymentId)} className="border-t border-slate-100">
                    <td className="px-3 py-2">{r.tenant || "—"}</td>
                    <td className="px-3 py-2">{r.property || "—"}</td>
                    <td className="px-3 py-2">{r.paymentDate}</td>
                    <td className="px-3 py-2">
                      $
                      {Number(r.amount).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-3 py-2">{r.status}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.linkedInvoice
                        ? String(r.linkedInvoice).slice(0, 8) + "…"
                        : "—"}
                    </td>
                    <td className="px-3 py-2">{r.businessDate}</td>
                    <td className="px-3 py-2">{r.daysUntilEligible}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.classification}
                    </td>
                  </tr>
                ))}
                {!data.rows.length ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-3 py-6 text-center text-slate-500"
                    >
                      No future-dated completed payments relative to the
                      business date.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
