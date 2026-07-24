'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type FutureRow = {
  id: string
  tenantName: string
  propertyName: string
  leaseId: string
  amount: number
  paymentMethod: string
  paymentDate: string
  eligibleDate: string
  daysUntilEligible: number
  status: string
  allocationStatus: string
  reference: string | null
}

export default function FuturePaymentsReviewPage() {
  const [forbidden, setForbidden] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [businessDate, setBusinessDate] = useState<string>('')
  const [rows, setRows] = useState<FutureRow[]>([])
  const [allocatingId, setAllocatingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const session = await fetch('/api/auth/session', { credentials: 'include' })
      if (!session.ok) {
        setForbidden(true)
        return
      }
      const sessionData = await session.json()
      if (sessionData.role !== 'owner') {
        setForbidden(true)
        return
      }

      const res = await fetch('/api/data-health/future-payments', {
        credentials: 'include',
        cache: 'no-store',
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(data.error || 'Failed to load future payments')
        setRows([])
        return
      }
      setBusinessDate(String(data.businessDate || ''))
      setRows(Array.isArray(data.rows) ? data.rows : [])
    } catch {
      setMessage('Failed to load future payments')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const allocateIfEligible = async (paymentId: string) => {
    setAllocatingId(paymentId)
    setMessage(null)
    try {
      const res = await fetch('/api/data-health/future-payments', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allocatePaymentId: paymentId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(data.error || 'Allocate failed')
        return
      }
      setMessage(
        data.allocated
          ? 'Payment allocated with newest-eligible-invoice-first.'
          : data.alreadyAllocated
            ? 'Payment was already linked.'
            : data.reason || 'No allocation performed.',
      )
      await load()
    } catch {
      setMessage('Allocate failed')
    } finally {
      setAllocatingId(null)
    }
  }

  if (forbidden) {
    return (
      <div className="max-w-3xl mx-auto p-8">
        <h1 className="text-xl font-semibold text-gray-900">Future Payments Review</h1>
        <p className="mt-2 text-sm text-gray-600">Owner access required.</p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Future Payments Review</h1>
          <p className="text-sm text-gray-600 mt-1">
            Payments dated after the America/New_York business date. They must not
            allocate until eligible.
          </p>
          {businessDate ? (
            <p className="text-xs text-gray-500 mt-1">Business date: {businessDate}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Link
            href="/data-health"
            className="px-3 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Back to Data Health
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="px-3 py-2 text-sm bg-gray-800 text-white rounded hover:bg-gray-700 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {message && <p className="text-sm text-gray-800">{message}</p>}

      {loading ? (
        <p className="text-sm text-gray-600">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-600 rounded border border-gray-200 bg-white p-4">
          No future-dated payments. Payments dated today or earlier are excluded.
        </p>
      ) : (
        <div className="overflow-x-auto overscroll-x-contain border border-gray-200 rounded-lg bg-white">
          <table className="min-w-[960px] w-full text-xs sm:text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">Tenant</th>
                <th className="px-3 py-2">Property</th>
                <th className="px-3 py-2">Lease</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2">Payment date</th>
                <th className="px-3 py-2">Eligible date</th>
                <th className="px-3 py-2 text-right">Days</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Allocation</th>
                <th className="px-3 py-2">Reference</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">{row.tenantName}</td>
                  <td className="px-3 py-2">{row.propertyName}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">
                    {String(row.leaseId).slice(0, 8)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    ${Number(row.amount).toFixed(2)}
                  </td>
                  <td className="px-3 py-2">{row.paymentMethod}</td>
                  <td className="px-3 py-2">{row.paymentDate}</td>
                  <td className="px-3 py-2">{row.eligibleDate}</td>
                  <td className="px-3 py-2 text-right">{row.daysUntilEligible}</td>
                  <td className="px-3 py-2">{row.status}</td>
                  <td className="px-3 py-2">{row.allocationStatus}</td>
                  <td className="px-3 py-2 max-w-[10rem] truncate" title={row.reference || ''}>
                    {row.reference || '—'}
                  </td>
                  <td className="px-3 py-2">
                    {row.daysUntilEligible <= 0 ? (
                      <button
                        type="button"
                        disabled={allocatingId === row.id}
                        onClick={() => void allocateIfEligible(row.id)}
                        className="text-blue-700 hover:underline disabled:opacity-50"
                      >
                        {allocatingId === row.id ? 'Allocating…' : 'Allocate'}
                      </button>
                    ) : (
                      <span className="text-gray-400">Wait</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
