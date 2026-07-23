"use client";

import { useCallback, useEffect, useState } from "react";

type TokenRow = {
  id: string;
  status: string;
  active: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_at: string;
  label: string | null;
};

type Props = {
  tenantId: string;
  tenantName: string;
  propertyId?: string | null;
};

function fmt(dt: string | null) {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return dt;
  }
}

/**
 * Staff-only portal link controls. Raw URL shown only immediately after mint.
 */
export function StaffPortalLinkPanel({ tenantId, tenantName, propertyId }: Props) {
  const [portalEnabled, setPortalEnabled] = useState(false);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/staff/portal-tokens?tenantId=${encodeURIComponent(tenantId)}`,
        { credentials: "include", cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Unable to load portal links");
        return;
      }
      setPortalEnabled(Boolean(data.portalEnabled));
      setTokens(data.tokens || []);
    } catch {
      setError("Unable to load portal links");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mint(regenerate: boolean) {
    setBusy(true);
    setError(null);
    setFreshUrl(null);
    setCopied(false);
    try {
      const res = await fetch("/api/staff/portal-tokens", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          propertyId: propertyId || undefined,
          regenerate,
          label: regenerate ? "staff_regenerated" : "staff_issued",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create link");
        return;
      }
      setFreshUrl(data.portalUrl || null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(tokenId: string) {
    if (!confirm("Revoke this portal link? It will stop working immediately.")) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/staff/portal-tokens", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId, reason: "staff_revoke" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Revoke failed");
        return;
      }
      setFreshUrl(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function copyFresh() {
    if (!freshUrl) return;
    try {
      await navigator.clipboard.writeText(freshUrl);
      setCopied(true);
    } catch {
      setError("Copy failed — select the link manually");
    }
  }

  const active = tokens.find((t) => t.active);

  return (
    <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700">
      <div className="font-medium text-gray-900">Portal link</div>
      <p className="mt-0.5 text-[11px] text-gray-500">
        {tenantName}
        {!portalEnabled ? " · portal flag off" : null}
      </p>

      {loading ? (
        <p className="mt-1 text-gray-500">Loading…</p>
      ) : (
        <>
          {active ? (
            <div className="mt-1 space-y-0.5">
              <div>
                Status: <span className="font-medium text-green-700">active</span>
              </div>
              <div>Expires: {fmt(active.expires_at)}</div>
              <div>Last used: {fmt(active.last_used_at)}</div>
            </div>
          ) : (
            <div className="mt-1 text-gray-500">No active link</div>
          )}

          {freshUrl && (
            <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2">
              <p className="font-medium text-amber-900">
                Copy now — this full link is shown only once
              </p>
              <p className="mt-1 break-all font-mono text-[10px] text-amber-950">
                {freshUrl}
              </p>
              <button
                type="button"
                onClick={() => void copyFresh()}
                className="mt-1 rounded bg-amber-800 px-2 py-1 text-[11px] font-medium text-white"
              >
                {copied ? "Copied" : "Copy Portal Link"}
              </button>
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-1">
            <button
              type="button"
              disabled={busy || !portalEnabled}
              onClick={() => void mint(true)}
              className="rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
            >
              {active ? "Regenerate Link" : "Generate Portal Link"}
            </button>
            {active && (
              <button
                type="button"
                disabled={busy || !portalEnabled}
                onClick={() => void revoke(active.id)}
                className="rounded border border-red-300 bg-white px-2 py-1 text-[11px] font-medium text-red-700 disabled:opacity-40"
              >
                Revoke
              </button>
            )}
          </div>

          {tokens.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-gray-600">
                Portal access history ({tokens.length})
              </summary>
              <ul className="mt-1 max-h-28 overflow-y-auto space-y-1">
                {tokens.map((t) => (
                  <li key={t.id} className="border-t border-gray-200 pt-1">
                    {t.status} · created {fmt(t.created_at)}
                    {t.revoked_reason ? ` · ${t.revoked_reason}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {error && <p className="mt-1 text-red-600">{error}</p>}
    </div>
  );
}
