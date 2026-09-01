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
  invoiceId: string | null
  invoiceDueDate: string | null
  invoiceDueDateLabel: string | null
  paymentType: string | null
  paymentMethod: string | null
  notes: string | null
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
  onDataChanged?: () => void
}

function formatMoney(amount: number) {
  return `$${Math.round(amount).toLocaleString()}`
}

function toDateInputValue(dateStr: string) {
  if (!dateStr) return ''
  return dateStr.includes('T') ? dateStr.split('T')[0] : dateStr.substring(0, 10)
}

function scopedPaymentUrl(
  paymentId: string,
  propertyId: string,
  month: string,
) {
  const params = new URLSearchParams({
    paymentId,
    propertyId,
    month,
  })
  return `/api/profit/rent-collected-detail/payment?${params.toString()}`
}

export function RentCollectedDetailModal({
  open,
  onClose,
  month,
  propertyId,
  propertyName,
  propertyAddress,
  onDataChanged,
}: RentCollectedDetailModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<RentCollectedDetailRow[]>([])
  const [total, setTotal] = useState(0)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [editingPayment, setEditingPayment] = useState<RentCollectedDetailRow | null>(null)
  const [paymentDate, setPaymentDate] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentType, setPaymentType] = useState('Rent')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

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

  const refreshAfterChange = useCallback(async () => {
    await load()
    onDataChanged?.()
  }, [load, onDataChanged])

  const handleEditPayment = (row: RentCollectedDetailRow) => {
    setEditingPayment(row)
    setPaymentAmount(String(row.amount))
    setPaymentDate(toDateInputValue(row.paymentDate))
    setPaymentType(row.paymentType || 'Rent')
    setPaymentNotes(row.notes || '')
  }

  const handleUpdatePayment = async () => {
    if (!editingPayment || !propertyId) return

    const paymentAmountNum = parseFloat(paymentAmount)
    if (isNaN(paymentAmountNum) || paymentAmountNum <= 0) {
      alert('Please enter a valid payment amount greater than 0')
      return
    }
    if (!paymentDate) {
      alert('Please enter a payment date')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetchAuthenticated(
        scopedPaymentUrl(editingPayment.id, propertyId, month),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            payment_date: paymentDate,
            amount: paymentAmountNum,
            payment_type: paymentType,
            notes: paymentNotes || '',
          }),
        },
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || errorData.details || 'Failed to update payment')
      }

      setEditingPayment(null)
      await refreshAfterChange()
    } catch (cause) {
      alert(
        'Failed to update payment: ' +
          (cause instanceof Error ? cause.message : 'Unknown error'),
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeletePayment = async (row: RentCollectedDetailRow) => {
    if (!propertyId || deletingId) return

    const confirmed = window.confirm(
      [
        'Delete ONLY this one payment row?',
        '',
        `Tenant: ${row.tenantName || propertyName}`,
        `Date: ${row.paymentDateLabel}`,
        `Amount: ${formatMoney(row.amount)}`,
        `Payment ID: ${row.id}`,
        '',
        'This cannot be undone.',
      ].join('\n'),
    )
    if (!confirmed) return

    setDeletingId(row.id)
    try {
      const response = await fetchAuthenticated(
        scopedPaymentUrl(row.id, propertyId, month),
        { method: 'DELETE' },
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || errorData.details || 'Failed to delete payment')
      }

      await refreshAfterChange()
    } catch (cause) {
      alert(
        'Failed to delete payment: ' +
          (cause instanceof Error ? cause.message : 'Unknown error'),
      )
    } finally {
      setDeletingId(null)
    }
  }

  if (!open) return null

  return (
    <>
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
                <table className="w-full min-w-[860px]">
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
                      <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700">
                        Actions
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
                        <td className="px-3 py-2 text-center">
                          <div className="flex justify-center items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleEditPayment(row)}
                              disabled={Boolean(deletingId)}
                              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeletePayment(row)}
                              disabled={deletingId === row.id}
                              className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded hover:bg-red-700 transition-colors disabled:opacity-50"
                            >
                              {deletingId === row.id ? 'Deleting…' : 'Delete'}
                            </button>
                          </div>
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
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {editingPayment ? (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-4 rounded-t-xl">
              <h2 className="text-xl font-bold">Edit Payment</h2>
              <p className="text-sm text-blue-100">
                {editingPayment.tenantName || propertyName}
              </p>
              <p className="text-xs text-blue-100 mt-1 font-mono">
                {editingPayment.id}
              </p>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Payment Date
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Amount
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Payment Type
                </label>
                <select
                  value={paymentType}
                  onChange={(e) => setPaymentType(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="Rent">Rent</option>
                  <option value="Late Fee">Late Fee</option>
                  <option value="Deposit">Deposit</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notes
                </label>
                <textarea
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Add any notes about this payment..."
                />
              </div>
            </div>

            <div className="bg-gray-50 px-6 py-4 rounded-b-xl flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setEditingPayment(null)}
                disabled={isSubmitting}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleUpdatePayment()}
                disabled={
                  isSubmitting || !paymentAmount || parseFloat(paymentAmount) <= 0
                }
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Updating...' : 'Update Payment'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
