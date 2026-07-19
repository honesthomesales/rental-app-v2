'use client'

import { useCallback, useEffect, useState } from 'react'
import { useCommunicationsFeatures } from '@/hooks/useCommunicationsFeatures'

type ApprovalRow = {
  id: string
  tenant_name: string
  tenant_phone: string | null
  property_name: string | null
  trigger_type: string
  template_key: string | null
  body: string
  status: string
  balance_snapshot: number
  days_late_snapshot: number | null
  generation_reason: string
  not_before: string | null
  stale_reason: string | null
  created_at: string
}

const actionable = new Set(['draft', 'pending_approval', 'approved', 'scheduled'])

export default function CommunicationApprovalsPage() {
  const { features, loaded: featuresLoaded } = useCommunicationsFeatures()
  const [drafts, setDrafts] = useState<ApprovalRow[]>([])
  const [canApprove, setCanApprove] = useState(false)
  const [providerEnabled, setProviderEnabled] = useState(false)
  const [featureDisabled, setFeatureDisabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch('/api/communications/approvals', {
        cache: 'no-store',
        credentials: 'include',
      })
      const data = await res.json()
      if (res.status === 403 && data.code === 'COMMUNICATIONS_DISABLED') {
        setFeatureDisabled(true)
        setDrafts([])
        setCanApprove(false)
        return
      }
      if (!res.ok) {
        setMessage(data.error || 'Could not load communication approvals')
        setDrafts([])
        return
      }
      setFeatureDisabled(false)
      setDrafts(Array.isArray(data.drafts) ? data.drafts : [])
      setCanApprove(Boolean(data.canApprove))
      setProviderEnabled(Boolean(data.providerEnabled))
    } catch {
      setMessage('Could not load communication approvals')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!featuresLoaded) return
    if (!features.tenantCommunicationsEnabled) {
      setFeatureDisabled(true)
      setLoading(false)
      return
    }
    void load()
  }, [features.tenantCommunicationsEnabled, featuresLoaded, load])

  const act = async (id: string, action: 'approve_send' | 'reject' | 'cancel') => {
    if (action === 'approve_send') {
      const confirmed = window.confirm(
        'Approve this exact message and submit it when quiet-hour and safety checks allow?',
      )
      if (!confirmed) return
    }
    setBusyId(id)
    setMessage(null)
    try {
      const res = await fetch(`/api/communications/approvals/${id}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(data.error || 'Approval action failed')
        return
      }
      const actionMessage = data.scheduled
        ? `Approved and scheduled for ${new Date(data.draft.not_before).toLocaleString()}`
        : data.sent
          ? 'Approved message submitted to the provider'
          : 'Approval record updated'
      await load()
      setMessage(actionMessage)
    } catch {
      setMessage('Approval action failed')
    } finally {
      setBusyId(null)
    }
  }

  if (featuresLoaded && (featureDisabled || !features.tenantCommunicationsEnabled)) {
    return (
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-2xl font-bold text-gray-900">
          Tenant communications are not enabled
        </h1>
        <p className="mt-3 text-sm text-gray-600">
          The Communication Approval Center is turned off for this environment.
          Drafts, consent tools, and SMS sending stay unavailable until an owner
          enables the tenant-communications feature flag.
        </p>
      </main>
    )
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Communication Approval Center</h1>
          <p className="text-sm text-gray-600 mt-1">
            Drafts never send automatically. Owner approval and server revalidation are required.
          </p>
          {!providerEnabled && (
            <p className="mt-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              SMS provider sending is disabled. You can manage consent, create drafts,
              and review the approval list. Messages will not be submitted to a provider.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="px-4 py-2 rounded-md border border-gray-300 text-sm hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {message && (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          {message}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading approval list…</p>
      ) : drafts.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
          No communication drafts.
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map((draft) => (
            <article key={draft.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-gray-900">{draft.tenant_name}</h2>
                  <p className="text-sm text-gray-600">
                    {draft.property_name || 'No property'} · {draft.tenant_phone || 'No phone'}
                  </p>
                </div>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold uppercase text-gray-700">
                  {draft.status.replaceAll('_', ' ')}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-4">
                <div><dt className="text-gray-500">Trigger</dt><dd>{draft.trigger_type}</dd></div>
                <div><dt className="text-gray-500">Balance snapshot</dt><dd>${Number(draft.balance_snapshot).toFixed(2)}</dd></div>
                <div><dt className="text-gray-500">Days late</dt><dd>{draft.days_late_snapshot ?? '—'}</dd></div>
                <div><dt className="text-gray-500">Created</dt><dd>{new Date(draft.created_at).toLocaleString()}</dd></div>
              </dl>
              <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm whitespace-pre-wrap">
                {draft.body}
              </div>
              <p className="mt-2 text-xs text-gray-500">{draft.generation_reason}</p>
              {draft.not_before && (
                <p className="mt-1 text-xs text-amber-700">
                  Scheduled no earlier than {new Date(draft.not_before).toLocaleString()}
                </p>
              )}
              {draft.stale_reason && (
                <p className="mt-1 text-xs text-red-700">{draft.stale_reason}</p>
              )}
              {canApprove && actionable.has(draft.status) && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === draft.id}
                    onClick={() => void act(draft.id, 'approve_send')}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    Approve and Send
                  </button>
                  <button
                    type="button"
                    disabled={busyId === draft.id}
                    onClick={() => void act(draft.id, 'reject')}
                    className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </main>
  )
}
