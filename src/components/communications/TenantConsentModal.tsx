'use client'

import { useEffect, useState } from 'react'
import type { CommunicationTarget } from './TextTenantModal'
import type { SmsConsentStatus } from '@/lib/communications/types'

type ConsentEvent = {
  id: string
  prior_status: string | null
  new_status: string
  source: string
  notes: string | null
  supporting_document_reference: string | null
  recorded_by_auth_user_id: string | null
  created_at: string
}

export function TenantConsentModal({
  open,
  target,
  onClose,
}: {
  open: boolean
  target: CommunicationTarget | null
  onClose: () => void
}) {
  const [status, setStatus] = useState<SmsConsentStatus>('unknown')
  const [source, setSource] = useState('owner_recorded')
  const [notes, setNotes] = useState('')
  const [documentReference, setDocumentReference] = useState('')
  const [events, setEvents] = useState<ConsentEvent[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !target) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void fetch(`/api/communications/consent?tenantId=${encodeURIComponent(target.tenantId)}`, {
      cache: 'no-store',
      credentials: 'include',
    })
      .then(async (res) => ({ res, data: await res.json() }))
      .then(({ res, data }) => {
        if (cancelled) return
        if (!res.ok) throw new Error(data.error || 'Failed to load consent')
        setStatus(data.preference?.sms_consent_status || 'unknown')
        setSource(data.preference?.consent_source || 'owner_recorded')
        setNotes(data.preference?.consent_notes || '')
        setDocumentReference(data.preference?.supporting_document_reference || '')
        setEvents(Array.isArray(data.events) ? data.events : [])
        setCanEdit(Boolean(data.canEdit))
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Failed to load consent')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, target])

  const save = async () => {
    if (!target) return
    if (!window.confirm(`Record SMS consent as ${status.replace('_', ' ')}?`)) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/communications/consent', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: target.tenantId,
          status,
          source,
          notes,
          supportingDocumentReference: documentReference,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update consent')
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to update consent')
    } finally {
      setSaving(false)
    }
  }

  if (!open || !target) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-lg font-semibold text-gray-900">SMS Consent</h2>
          <p className="text-sm text-gray-600">{target.tenantName} · {target.phone || 'No phone'}</p>
        </div>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto p-4">
          {loading ? <p className="text-sm text-gray-500">Loading…</p> : (
            <>
              <label className="block text-sm">
                <span className="font-medium text-gray-700">Status</span>
                <select
                  value={status}
                  disabled={!canEdit}
                  onChange={(event) => setStatus(event.target.value as SmsConsentStatus)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
                >
                  <option value="unknown">Unknown — blocks sending</option>
                  <option value="opted_in">Opted in</option>
                  <option value="opted_out">Opted out — blocks sending</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-medium text-gray-700">Consent source</span>
                <select
                  value={source}
                  disabled={!canEdit}
                  onChange={(event) => setSource(event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
                >
                  <option value="owner_recorded">Owner recorded</option>
                  <option value="verbal">Verbal</option>
                  <option value="signed_form">Signed form</option>
                  <option value="lease_document">Lease document</option>
                  <option value="imported">Imported record</option>
                  <option value="corrected">Corrected record</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-medium text-gray-700">Notes</span>
                <textarea
                  value={notes}
                  disabled={!canEdit}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-gray-700">Supporting document reference</span>
                <input
                  value={documentReference}
                  disabled={!canEdit}
                  onChange={(event) => setDocumentReference(event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
                />
              </label>
              <div>
                <h3 className="text-sm font-medium text-gray-900">Audit history</h3>
                {events.length === 0 ? (
                  <p className="mt-1 text-sm text-gray-500">No consent events recorded.</p>
                ) : (
                  <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto">
                    {events.map((event) => (
                      <li key={event.id} className="rounded border border-gray-200 p-2 text-xs">
                        <div>{event.prior_status || 'none'} → {event.new_status} · {event.source}</div>
                        <div className="text-gray-500">{new Date(event.created_at).toLocaleString()}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
          {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        </div>
        <div className="flex gap-2 border-t border-gray-200 px-4 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-4 py-2 text-sm">
            Close
          </button>
          {canEdit && (
            <button
              type="button"
              disabled={saving || loading || !target.phone}
              onClick={() => void save()}
              className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Record Consent'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

