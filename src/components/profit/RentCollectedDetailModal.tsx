'use client'

import { useCallback, useEffect, useState } from 'react'
import { fetchAuthenticated } from '@/lib/auth/authenticated-fetch'
import { formatMonthKeyLabel } from '@/lib/date-month'

export type RentCollectedDetailRow = {
  id: string
  paymentDate: string
  paymentDateLabel: string
  amount: number
  tenantName: string | null
  invoiceDueDate: string | null
  invoiceDueDateLabel: string | null
  paymentType: string | null
  paymentMethod: string | null
  attribution: 'invoice_due_month' | 'payment_date'
  attributionLabel: string
}

type RentCollectedDetailModalProps = {
  open: boolean
  onClose: () => void
  month: string
  propertyId: string | null
  propertyName: string
  propertyAddress?: string
}

function formatMoney(amount: number) {
  return `$${Math.round(amount).toLocaleString()}`
}

export function RentCollectedDetailModal({
  open,
  onClose,
  month,
  propertyId,
  propertyName,
  propertyAddress,
}: RentCollectedDetailModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<RentCollectedDetailRow[]>([])
  const [total, setTotal] = useState(0)

  const load = useCallback(async () => {
    if (!propertyId) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetchAuthenticated(
        `/api/profit/rent-collected-detail?month=${encodeURIComponent(month)}&propertyId=${encodeURIComponent(propertyId)}`,
      )
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load rent collected detail')
      }
      setRows(Array.isArray(data.payments) ? data.payments : [])
      setTotal(Number(data.total) || 0)
    } catch (cause) {
      setRows([])
      setTotal(0)
      setError(
        cause instanceof Error
          ? cause.message
          : 'Failed to load rent collected detail',
      )
    } finally {
      setLoading(false)
    }
  }, [month, propertyId])

  useEffect(() => {
    if (!open || !propertyId) return
    void load()
  }, [open, propertyId, load])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      data-testid="profit-rent-detail-modal"
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="relative bg-gradient-to-r from-blue-600 to-purple-600 text-white px-4 sm:px-6 py-4 flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center">
          <div className="min-w-0 pr-14 sm:pr-0">
            <h2 className="text-2xl font-bold">{propertyName}</h2>
            {propertyAddress ? (
              <p className="text-blue-100 text-sm">{propertyAddress}</p>
            ) : null}
            <p className="text-blue-100 text-sm mt-1">
              Rent collected — {formatMonthKeyLabel(month)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 sm:static px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              No payments counted toward rent collected for this month.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead className="bg-gray-50 border-b-2 border-gray-200">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">
                      Payment Date
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">
                      Tenant
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">
                      Invoice Due
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">
                      Type
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">
                      Counted As
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm text-gray-900">
                        {row.paymentDateLabel}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700">
                        {row.tenantName || '—'}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700">
                        {row.invoiceDueDateLabel || '—'}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700">
                        {row.paymentType || 'Rent'}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-600">
                        {row.attributionLabel}
                      </td>
                      <td className="px-3 py-2 text-sm text-right font-medium text-green-700">
                        {formatMoney(row.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-blue-50 border-t-2 border-blue-200">
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-3 text-sm font-semibold text-gray-900"
                    >
                      Total rent collected
                    </td>
                    <td className="px-3 py-3 text-sm text-right font-bold text-green-700">
                      {formatMoney(total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
