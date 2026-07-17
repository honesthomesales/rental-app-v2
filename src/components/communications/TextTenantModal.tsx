'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  MESSAGE_TEMPLATES,
  isOutsideDaytimeHours,
  renderTemplate,
  smsSegmentInfo,
  type MessageTemplate,
} from '@/lib/communications/templates'
import type { TemplateContext, TemplateKey } from '@/lib/communications/types'
import { telHref } from '@/lib/communications/phone'

export type CommunicationTarget = {
  tenantId: string
  tenantName: string
  phone?: string | null
  propertyId?: string | null
  propertyLabel?: string | null
  leaseId?: string | null
  leaseStatus?: string | null
  templateContext?: TemplateContext
}

type HistoryItem = {
  id: string
  direction: string
  body: string
  channel: string
  template_key: string | null
  status: string
  created_at: string
  sent_at: string | null
  delivered_at: string | null
  failed_at: string | null
  error_message: string | null
  sent_by_auth_user_id: string | null
}

type Props = {
  open: boolean
  target: CommunicationTarget | null
  onClose: () => void
}

function consentLabel(status: string | null | undefined): string {
  if (status === 'opted_out') return 'Opted out — outbound SMS blocked'
  if (status === 'opted_in') return 'Opted in'
  return 'Consent unknown — confirmation required to send'
}

export function TextTenantModal({ open, target, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [confirmStep, setConfirmStep] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [templateKey, setTemplateKey] = useState<TemplateKey>('rent_due_reminder')
  const [messageBody, setMessageBody] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [preference, setPreference] = useState<{ sms_consent_status?: string } | null>(null)
  const [canSend, setCanSend] = useState(false)
  const [providerMessage, setProviderMessage] = useState<string | null>(null)
  const [featureMessage, setFeatureMessage] = useState<string | null>(null)
  const [confirmConsentOverride, setConfirmConsentOverride] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState('')

  const ctx: TemplateContext = useMemo(
    () => ({
      tenant_name: target?.tenantName || '',
      property_address: target?.propertyLabel || '',
      amount_due: target?.templateContext?.amount_due || '',
      due_date: target?.templateContext?.due_date || '',
      payment_amount: target?.templateContext?.payment_amount || '',
      promise_date: target?.templateContext?.promise_date || '',
      payment_link: '',
    }),
    [target],
  )

  const applyTemplate = useCallback(
    (key: TemplateKey) => {
      const t = MESSAGE_TEMPLATES.find((x) => x.key === key)
      if (!t) return
      setTemplateKey(key)
      setMessageBody(key === 'custom' ? '' : renderTemplate(t.body, ctx))
      setConfirmStep(false)
    },
    [ctx],
  )

  useEffect(() => {
    if (!open || !target?.tenantId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setConfirmStep(false)
    setConfirmConsentOverride(false)
    setIdempotencyKey(
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    )

    ;(async () => {
      try {
        const res = await fetch(
          `/api/communications?tenantId=${encodeURIComponent(target.tenantId)}`,
        )
        const data = await res.json()
        if (cancelled) return

        if (data.comingSoon || data.code === 'COMMUNICATIONS_DISABLED') {
          setFeatureMessage('Coming soon')
          setCanSend(false)
        } else if (data.code === 'COMMUNICATIONS_NOT_CONFIGURED') {
          setFeatureMessage('Communication Center not configured')
          setCanSend(false)
        } else {
          setFeatureMessage(null)
          setCanSend(Boolean(data.canSend))
        }

        setProviderMessage(data.provider?.message || null)
        setPreference(data.preference || null)
        setHistory(Array.isArray(data.messages) ? data.messages : [])
        applyTemplate('rent_due_reminder')
      } catch {
        if (!cancelled) {
          setError('Failed to load communication history')
          setCanSend(false)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, target?.tenantId, applyTemplate])

  const segment = smsSegmentInfo(messageBody)
  const outsideHours = isOutsideDaytimeHours()
  const optedOut = preference?.sms_consent_status === 'opted_out'
  const callLink = telHref(target?.phone)
  const selectedTemplate: MessageTemplate | undefined = MESSAGE_TEMPLATES.find(
    (t) => t.key === templateKey,
  )

  const handleSend = async () => {
    if (!target || !confirmStep) {
      setConfirmStep(true)
      return
    }
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/communications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: target.tenantId,
          propertyId: target.propertyId || null,
          leaseId: target.leaseId || null,
          phone: target.phone,
          message: messageBody,
          templateKey,
          idempotencyKey,
          confirmConsentOverride,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to send')
        setConfirmStep(false)
        return
      }
      if (data.communication) {
        setHistory((prev) => [...prev, data.communication])
      }
      setConfirmStep(false)
      setIdempotencyKey(
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      )
      onClose()
    } catch {
      setError('Failed to send message')
      setConfirmStep(false)
    } finally {
      setSending(false)
    }
  }

  if (!open || !target) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-lg rounded-t-xl max-h-[95vh] flex flex-col shadow-xl">
        <div className="px-4 py-3 border-b border-gray-200 shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Text Tenant</h2>
          <p className="text-sm text-gray-600 mt-1">{target.tenantName}</p>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3">
          {featureMessage && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md p-3">
              {featureMessage}
            </div>
          )}

          <div className="grid grid-cols-1 gap-1 text-sm">
            <div>
              <span className="text-gray-500">Property: </span>
              <span className="font-medium">{target.propertyLabel || '—'}</span>
            </div>
            <div>
              <span className="text-gray-500">Lease status: </span>
              <span className="font-medium">{target.leaseStatus || '—'}</span>
            </div>
            <div>
              <span className="text-gray-500">Phone: </span>
              <span className="font-medium">{target.phone || 'No phone on file'}</span>
              {callLink && (
                <a href={callLink} className="ml-2 text-blue-600 underline text-sm">
                  Call
                </a>
              )}
            </div>
            <div>
              <span className="text-gray-500">Consent: </span>
              <span
                className={`font-medium ${
                  optedOut ? 'text-red-700' : preference?.sms_consent_status === 'opted_in' ? 'text-green-700' : 'text-amber-700'
                }`}
              >
                {consentLabel(preference?.sms_consent_status)}
              </span>
            </div>
          </div>

          {providerMessage && (
            <div className="bg-gray-50 border border-gray-200 text-gray-700 text-sm rounded-md p-3">
              {providerMessage}
            </div>
          )}

          {outsideHours && (
            <div className="bg-orange-50 border border-orange-200 text-orange-900 text-sm rounded-md p-3">
              Warning: it is outside normal daytime hours (8am–8pm America/New_York). Consider waiting to send.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Template</label>
            <select
              value={templateKey}
              onChange={(e) => applyTemplate(e.target.value as TemplateKey)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            >
              {MESSAGE_TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            {selectedTemplate?.requiresManualReview && (
              <p className="mt-1 text-xs text-amber-800">
                Eviction Process Notice requires manual review and confirmation. This is not an automated legal notice.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
            <textarea
              value={messageBody}
              onChange={(e) => {
                setMessageBody(e.target.value)
                setConfirmStep(false)
              }}
              rows={5}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm resize-y min-h-[120px]"
              placeholder="Type your message…"
            />
            <div className="mt-1 flex justify-between text-xs text-gray-500">
              <span>
                {segment.characters} characters · {segment.segments} SMS segment
                {segment.segments === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Preview</label>
            <div className="bg-gray-50 border border-gray-200 rounded-md p-3 text-sm whitespace-pre-wrap break-words">
              {messageBody || <span className="text-gray-400">Empty message</span>}
            </div>
          </div>

          {preference?.sms_consent_status !== 'opted_in' && !optedOut && (
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirmConsentOverride}
                onChange={(e) => setConfirmConsentOverride(e.target.checked)}
              />
              <span>
                I confirm I am authorized to text this tenant (consent not yet recorded).
              </span>
            </label>
          )}

          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-2">Recent history</h3>
            {loading ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-gray-500">No messages yet.</p>
            ) : (
              <ul className="space-y-2 max-h-48 overflow-y-auto">
                {history.map((m) => (
                  <li
                    key={m.id}
                    className={`rounded-md border p-2 text-sm ${
                      m.direction === 'outbound'
                        ? 'border-blue-100 bg-blue-50'
                        : 'border-gray-200 bg-white'
                    }`}
                  >
                    <div className="flex justify-between gap-2 text-xs text-gray-500 mb-1">
                      <span>
                        {m.direction === 'outbound' ? 'Outbound' : 'Inbound'} · {m.channel} ·{' '}
                        {m.status}
                        {m.template_key ? ` · ${m.template_key}` : ''}
                      </span>
                      <span className="shrink-0">
                        {new Date(m.created_at).toLocaleString('en-US', {
                          timeZone: 'America/New_York',
                        })}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-gray-900">{m.body}</p>
                    {m.error_message && (
                      <p className="text-xs text-red-600 mt-1">{m.error_message}</p>
                    )}
                    {m.delivered_at && (
                      <p className="text-xs text-green-700 mt-1">Delivered</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-md p-3">
              {error}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex flex-col sm:flex-row gap-2 shrink-0 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-3 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              sending ||
              loading ||
              !canSend ||
              optedOut ||
              !messageBody.trim() ||
              Boolean(featureMessage) ||
              (preference?.sms_consent_status !== 'opted_in' && !confirmConsentOverride)
            }
            onClick={handleSend}
            className={`w-full sm:flex-1 px-4 py-3 rounded-lg text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed ${
              confirmStep ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {sending
              ? 'Sending…'
              : confirmStep
                ? 'Confirm Send Text'
                : 'Send Text'}
          </button>
        </div>
      </div>
    </div>
  )
}
