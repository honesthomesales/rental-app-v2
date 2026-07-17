'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type SessionInfo = { ok?: boolean; role?: string }

export default function DataHealthPage() {
  const [role, setRole] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/auth/session', { credentials: 'include' })
      if (!res.ok) {
        setForbidden(true)
        return
      }
      const data = (await res.json()) as SessionInfo
      setRole(data.role || null)
      if (data.role !== 'owner') setForbidden(true)
    })()
  }, [])

  const loadPreview = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch('/api/data-health/late-fees', {
        credentials: 'include',
        cache: 'no-store',
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(data.error || 'Preview failed')
        return
      }
      setPreview(data)
    } catch {
      setMessage('Preview failed')
    } finally {
      setLoading(false)
    }
  }

  const applyEligible = async () => {
    if (
      !window.confirm(
        'Apply late fees to all eligible invoices from the preview? This writes once and is idempotent.',
      )
    ) {
      return
    }
    setApplying(true)
    setMessage(null)
    try {
      const res = await fetch('/api/data-health/late-fees', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(data.error || 'Apply failed')
        return
      }
      setMessage(
        `Applied ${data.applied ?? 0} late fee(s). Fee total $${data.feeTotal ?? 0}.`,
      )
      await loadPreview()
    } catch {
      setMessage('Apply failed')
    } finally {
      setApplying(false)
    }
  }

  if (forbidden) {
    return (
      <div className="max-w-3xl mx-auto p-8">
        <h1 className="text-xl font-semibold text-gray-900">Data Health</h1>
        <p className="mt-2 text-sm text-gray-600">
          Owner access required.
        </p>
      </div>
    )
  }

  const eligibleCount = Number(preview?.eligibleCount ?? 0)
  const rows = Array.isArray(preview?.rows) ? (preview?.rows as Array<Record<string, unknown>>) : []
  const eligibleRows = rows.filter((r) => r.eligible)

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Data Health</h1>
        <p className="text-sm text-gray-600 mt-1">
          Owner-only financial safety tools. Signed in as {role}.
        </p>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Reviews</h2>
        <ul className="list-disc pl-5 text-sm space-y-1">
          <li>
            <Link className="text-blue-700 hover:underline" href="/data-health/future-payments">
              Future Payments Review
            </Link>
          </li>
          <li>
            <Link className="text-blue-700 hover:underline" href="/payments">
              Missing invoice review (via Payments → missing preview)
            </Link>
          </li>
        </ul>
      </div>

      <div className="border border-gray-200 rounded-lg p-4 space-y-3">
        <h2 className="text-lg font-medium">Late-fee reconciliation</h2>
        <p className="text-sm text-gray-600">
          Preview is read-only. Apply runs one transactional batch. Running apply
          twice for the same business date adds no second fees.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void loadPreview()}
            disabled={loading}
            className="px-3 py-2 text-sm bg-gray-800 text-white rounded hover:bg-gray-700 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Preview late fees'}
          </button>
          <button
            type="button"
            onClick={() => void applyEligible()}
            disabled={applying || eligibleCount === 0}
            className="px-3 py-2 text-sm bg-amber-700 text-white rounded hover:bg-amber-600 disabled:opacity-50"
          >
            {applying ? 'Applying…' : `Apply ${eligibleCount} eligible`}
          </button>
        </div>
        {message && <p className="text-sm text-gray-800">{message}</p>}
        {preview && (
          <div className="text-sm text-gray-700 space-y-1">
            <div>Business date: {String(preview.businessDate || '')}</div>
            <div>Examined: {String(preview.examined ?? 0)}</div>
            <div>Eligible: {eligibleCount}</div>
            <div>Skipped: {String(preview.skippedCount ?? 0)}</div>
            <div>Proposed fee total: ${String(preview.proposedFeeTotal ?? 0)}</div>
          </div>
        )}
        {eligibleRows.length > 0 && (
          <div className="overflow-x-auto max-h-80 border border-gray-100 rounded">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1 text-left">Property</th>
                  <th className="px-2 py-1 text-left">Tenant</th>
                  <th className="px-2 py-1 text-left">Due</th>
                  <th className="px-2 py-1 text-right">Fee</th>
                  <th className="px-2 py-1 text-right">New bal</th>
                </tr>
              </thead>
              <tbody>
                {eligibleRows.slice(0, 100).map((r) => (
                  <tr key={String(r.invoiceId)} className="border-t border-gray-100">
                    <td className="px-2 py-1">{String(r.propertyName || '')}</td>
                    <td className="px-2 py-1">{String(r.tenantName || '')}</td>
                    <td className="px-2 py-1">{String(r.dueDate || '')}</td>
                    <td className="px-2 py-1 text-right">
                      ${Number(r.proposedLateFee || 0).toFixed(2)}
                    </td>
                    <td className="px-2 py-1 text-right">
                      ${Number(r.resultingBalance || 0).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
