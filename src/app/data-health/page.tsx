'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { MissingInformationButton } from '@/components/missing-information/MissingInformationButton'

type SessionInfo = { ok?: boolean; role?: string }

type LateFeeRow = {
  propertyId: string
  propertyName: string
  tenantId: string
  tenantName: string
  leaseId: string
  invoiceId: string
  dueDate: string
  cadence: string
  currentRentBalance: number
  graceDays: number
  existingLateFee: number
  waived: boolean
  proposedLateFee: number
  currentTotal: number
  resultingTotal: number
  resultingBalance: number
  eligible: boolean
  reasonEligible: string | null
  reasonSkipped: string | null
}

type PropertyGroup = {
  propertyId: string
  propertyName: string
  tenantName: string
  invoices: LateFeeRow[]
  eligibleCount: number
  totalEligibleFee: number
}

export default function DataHealthPage() {
  const [role, setRole] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [expandedProperties, setExpandedProperties] = useState<Set<string>>(
    () => new Set(),
  )
  const [incomingUnresolved, setIncomingUnresolved] = useState<number | null>(
    null,
  )

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

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/staff/incoming-payments?status=pending', {
          credentials: 'include',
          cache: 'no-store',
        })
        if (!res.ok) {
          setIncomingUnresolved(0)
          return
        }
        const data = await res.json()
        const matches = Array.isArray(data.matches) ? data.matches : []
        const awaiting = Array.isArray(data.awaitingVerification)
          ? data.awaitingVerification
          : []
        const exceptions = Array.isArray(data.exceptions) ? data.exceptions : []
        setIncomingUnresolved(matches.length + awaiting.length + exceptions.length)
      } catch {
        setIncomingUnresolved(0)
      }
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
      setSelectedInvoiceIds(new Set())
      setExpandedProperties(new Set())
    } catch {
      setMessage('Preview failed')
    } finally {
      setLoading(false)
    }
  }

  const eligibleRows = useMemo(() => {
    const rows = Array.isArray(preview?.rows)
      ? (preview?.rows as LateFeeRow[])
      : []
    return rows.filter((r) => r.eligible)
  }, [preview])

  const propertyGroups = useMemo(() => {
    const map = new Map<string, PropertyGroup>()
    for (const row of eligibleRows) {
      const key = row.propertyId || row.propertyName || 'unknown'
      const existing = map.get(key)
      if (!existing) {
        map.set(key, {
          propertyId: key,
          propertyName: row.propertyName || 'Property',
          tenantName: row.tenantName || '',
          invoices: [row],
          eligibleCount: 1,
          totalEligibleFee: Number(row.proposedLateFee || 0),
        })
      } else {
        existing.invoices.push(row)
        existing.eligibleCount += 1
        existing.totalEligibleFee += Number(row.proposedLateFee || 0)
      }
    }
    return [...map.values()].sort((a, b) =>
      a.propertyName.localeCompare(b.propertyName),
    )
  }, [eligibleRows])

  const selectedEligible = useMemo(
    () => eligibleRows.filter((r) => selectedInvoiceIds.has(r.invoiceId)),
    [eligibleRows, selectedInvoiceIds],
  )

  const selectedPropertyCount = useMemo(() => {
    const props = new Set(selectedEligible.map((r) => r.propertyId || r.propertyName))
    return props.size
  }, [selectedEligible])

  const selectedFeeTotal = useMemo(
    () =>
      selectedEligible.reduce((s, r) => s + Number(r.proposedLateFee || 0), 0),
    [selectedEligible],
  )

  const togglePropertyExpanded = (propertyId: string) => {
    setExpandedProperties((prev) => {
      const next = new Set(prev)
      if (next.has(propertyId)) next.delete(propertyId)
      else next.add(propertyId)
      return next
    })
  }

  const setPropertySelection = (group: PropertyGroup, checked: boolean) => {
    setSelectedInvoiceIds((prev) => {
      const next = new Set(prev)
      for (const inv of group.invoices) {
        if (checked) next.add(inv.invoiceId)
        else next.delete(inv.invoiceId)
      }
      return next
    })
  }

  const toggleInvoice = (invoiceId: string) => {
    setSelectedInvoiceIds((prev) => {
      const next = new Set(prev)
      if (next.has(invoiceId)) next.delete(invoiceId)
      else next.add(invoiceId)
      return next
    })
  }

  const propertyCheckState = (
    group: PropertyGroup,
  ): 'checked' | 'unchecked' | 'indeterminate' => {
    const ids = group.invoices.map((i) => i.invoiceId)
    const selected = ids.filter((id) => selectedInvoiceIds.has(id)).length
    if (selected === 0) return 'unchecked'
    if (selected === ids.length) return 'checked'
    return 'indeterminate'
  }

  const applyEligible = async () => {
    if (selectedEligible.length === 0) return
    const confirmMsg =
      `Apply late fees to ${selectedPropertyCount} properties / ${selectedEligible.length} invoices for $${selectedFeeTotal.toFixed(2)}?`
    if (!window.confirm(confirmMsg)) return

    setApplying(true)
    setMessage(null)
    try {
      const res = await fetch('/api/data-health/late-fees', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apply: true,
          invoiceIds: selectedEligible.map((r) => r.invoiceId),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(data.error || 'Apply failed')
        return
      }
      const applied = Number(data.applied ?? data.successCount ?? selectedEligible.length)
      const failed = Number(data.failed ?? data.failureCount ?? 0)
      setMessage(
        `Applied ${applied} late fee(s). Failures: ${failed}. Fee total $${Number(data.feeTotal ?? selectedFeeTotal).toFixed(2)}.`,
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
        <p className="mt-2 text-sm text-gray-600">Owner access required.</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Data Health</h1>
          <p className="text-sm text-gray-600 mt-1">
            Owner-only financial safety tools. Signed in as {role}.
          </p>
        </div>
        <MissingInformationButton />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Reviews</h2>
        <ul className="list-disc pl-5 text-sm space-y-1">
          <li>
            <Link
              className="text-blue-700 hover:underline"
              href="/data-health/future-payments"
            >
              Future Payments Review
            </Link>
          </li>
          <li>
            <Link className="text-blue-700 hover:underline" href="/payments">
              Missing invoice review (via Payments → missing preview)
            </Link>
          </li>
          {(incomingUnresolved ?? 0) > 0 ? (
            <li>
              <Link
                className="text-amber-800 hover:underline font-medium"
                href="/incoming-payments"
              >
                Incoming Payments Review ({incomingUnresolved} unresolved)
              </Link>
            </li>
          ) : (
            <li className="text-gray-500">
              Incoming Payments Review — no unresolved items (route preserved at{' '}
              <Link className="text-blue-700 hover:underline" href="/incoming-payments">
                /incoming-payments
              </Link>
              )
            </li>
          )}
        </ul>
      </div>

      <div className="border border-gray-200 rounded-lg p-4 space-y-3">
        <h2 className="text-lg font-medium">Late-fee reconciliation</h2>
        <p className="text-sm text-gray-600">
          One collapsed entry per property. Expand to select invoices. Apply
          Eligible writes only selected eligible invoices.
        </p>
        <div className="flex flex-wrap gap-2">
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
            disabled={applying || selectedEligible.length === 0}
            className="px-3 py-2 text-sm bg-amber-700 text-white rounded hover:bg-amber-600 disabled:opacity-50"
          >
            {applying
              ? 'Applying…'
              : `Apply Eligible (${selectedEligible.length})`}
          </button>
        </div>
        {selectedEligible.length > 0 && (
          <p className="text-sm text-gray-800">
            Selected: {selectedPropertyCount} properties · {selectedEligible.length}{' '}
            invoices · ${selectedFeeTotal.toFixed(2)}
          </p>
        )}
        {message && <p className="text-sm text-gray-800">{message}</p>}
        {preview && (
          <div className="text-sm text-gray-700 space-y-1">
            <div>Business date: {String(preview.businessDate || '')}</div>
            <div>Examined: {String(preview.examined ?? 0)}</div>
            <div>Eligible: {eligibleRows.length}</div>
            <div>Skipped: {String(preview.skippedCount ?? 0)}</div>
            <div>
              Proposed fee total: ${String(preview.proposedFeeTotal ?? 0)}
            </div>
          </div>
        )}

        {propertyGroups.length > 0 && (
          <div className="space-y-2 border border-gray-100 rounded max-h-[32rem] overflow-y-auto">
            {propertyGroups.map((group) => {
              const checkState = propertyCheckState(group)
              const expanded = expandedProperties.has(group.propertyId)
              const selectedCount = group.invoices.filter((i) =>
                selectedInvoiceIds.has(i.invoiceId),
              ).length
              const selectedFee = group.invoices
                .filter((i) => selectedInvoiceIds.has(i.invoiceId))
                .reduce((s, i) => s + Number(i.proposedLateFee || 0), 0)

              return (
                <div
                  key={group.propertyId}
                  className="border-b border-gray-100 last:border-b-0"
                >
                  <div className="flex items-start gap-2 px-3 py-2 bg-gray-50">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checkState === 'checked'}
                      ref={(el) => {
                        if (el) el.indeterminate = checkState === 'indeterminate'
                      }}
                      onChange={(e) =>
                        setPropertySelection(group, e.target.checked)
                      }
                      aria-label={`Select all invoices for ${group.propertyName}`}
                    />
                    <button
                      type="button"
                      className="mt-0.5 w-6 h-6 rounded border border-gray-300 text-sm leading-none"
                      onClick={() => togglePropertyExpanded(group.propertyId)}
                      aria-expanded={expanded}
                      aria-label={expanded ? 'Collapse' : 'Expand'}
                    >
                      {expanded ? '−' : '+'}
                    </button>
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="font-medium text-gray-900">
                        {group.propertyName}
                      </div>
                      {group.tenantName ? (
                        <div className="text-gray-600">{group.tenantName}</div>
                      ) : null}
                      <div className="text-xs text-gray-600 mt-1">
                        {group.eligibleCount} eligible · $
                        {group.totalEligibleFee.toFixed(2)} total · {selectedCount}{' '}
                        selected · ${selectedFee.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {expanded && (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead className="bg-white">
                          <tr>
                            <th className="px-2 py-1 text-left">Sel</th>
                            <th className="px-2 py-1 text-left">Due</th>
                            <th className="px-2 py-1 text-left">Type</th>
                            <th className="px-2 py-1 text-right">Original</th>
                            <th className="px-2 py-1 text-right">Unpaid</th>
                            <th className="px-2 py-1 text-left">Eligibility</th>
                            <th className="px-2 py-1 text-right">Existing fee</th>
                            <th className="px-2 py-1 text-right">Proposed</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.invoices.map((inv) => (
                            <tr
                              key={inv.invoiceId}
                              className="border-t border-gray-100"
                            >
                              <td className="px-2 py-1">
                                <input
                                  type="checkbox"
                                  checked={selectedInvoiceIds.has(inv.invoiceId)}
                                  onChange={() => toggleInvoice(inv.invoiceId)}
                                  aria-label={`Select invoice ${inv.invoiceId}`}
                                />
                              </td>
                              <td className="px-2 py-1">{inv.dueDate}</td>
                              <td className="px-2 py-1">
                                Rent / {inv.cadence}
                              </td>
                              <td className="px-2 py-1 text-right">
                                ${Number(inv.currentTotal || 0).toFixed(2)}
                              </td>
                              <td className="px-2 py-1 text-right">
                                ${Number(inv.currentRentBalance || 0).toFixed(2)}
                              </td>
                              <td className="px-2 py-1">
                                {inv.eligible
                                  ? inv.reasonEligible || 'eligible'
                                  : inv.reasonSkipped || 'skipped'}
                              </td>
                              <td className="px-2 py-1 text-right">
                                ${Number(inv.existingLateFee || 0).toFixed(2)}
                                {inv.waived ? ' (waived)' : ''}
                              </td>
                              <td className="px-2 py-1 text-right">
                                ${Number(inv.proposedLateFee || 0).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
