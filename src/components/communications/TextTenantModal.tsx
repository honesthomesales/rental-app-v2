'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  MESSAGE_TEMPLATES,
  renderTemplate,
  smsSegmentInfo,
  type MessageTemplate,
} from '@/lib/communications/templates'
import type { TemplateContext, TemplateKey } from '@/lib/communications/types'
import { isUsablePhone, normalizeToE164, smsHref } from '@/lib/communications/phone'

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
}

type ManualActivityKind =
  | 'text_prepared'
  | 'message_copied'
  | 'sms_app_opened'
  | 'manually_sent'
  | 'canceled'

type Props = {
  open: boolean
  target: CommunicationTarget | null
  onClose: () => void
}

const MANUAL_TEMPLATES: TemplateKey[] = [
  'rent_due_reminder',
  'late_payment_reminder',
  'promise_to_pay',
  'custom',
]

export function TextTenantModal({ open, target, onClose }: Props) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusNote, setStatusNote] = useState<string | null>(null)
  const [templateKey, setTemplateKey] = useState<TemplateKey>('rent_due_reminder')
  const [messageBody, setMessageBody] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [recording, setRecording] = useState(false)

  const phoneE164 = useMemo(
    () => normalizeToE164(target?.phone),
    [target?.phone],
  )
  const phoneUsable = isUsablePhone(target?.phone)

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
    },
    [ctx],
  )

  const recordActivity = useCallback(
    async (kind: ManualActivityKind, body?: string) => {
      if (!target?.tenantId) return
      setRecording(true)
      try {
        await fetch('/api/communications/manual-activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: target.tenantId,
            propertyId: target.propertyId || null,
            leaseId: target.leaseId || null,
            kind,
            message: body ?? messageBody,
            templateKey,
            // Never claim provider delivery
            deliveryStatus: 'manual_unverified',
          }),
        })
      } catch {
        /* recording is best-effort when schema/flags unavailable */
      } finally {
        setRecording(false)
      }
    },
    [messageBody, target, templateKey],
  )

  useEffect(() => {
    if (!open || !target?.tenantId) return
    let cancelled = false
    previouslyFocused.current = document.activeElement as HTMLElement | null
    setLoading(true)
    setError(null)
    setStatusNote(null)
    applyTemplate('rent_due_reminder')

    void (async () => {
      try {
        await fetch('/api/communications/manual-activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: target.tenantId,
            propertyId: target.propertyId || null,
            leaseId: target.leaseId || null,
            kind: 'text_prepared',
            message: '',
            templateKey: 'rent_due_reminder',
            deliveryStatus: 'manual_unverified',
          }),
        })
      } catch {
        /* ignore */
      }
    })()

    ;(async () => {
      try {
        const res = await fetch(
          `/api/communications?tenantId=${encodeURIComponent(target.tenantId)}`,
        )
        const data = await res.json()
        if (cancelled) return
        setHistory(Array.isArray(data.messages) ? data.messages : [])
      } catch {
        if (!cancelled) setHistory([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      cancelled = true
      document.body.style.overflow = previousOverflow
      previouslyFocused.current?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once per tenant
  }, [open, target?.tenantId])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        void recordActivity('canceled')
        onClose()
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    queueMicrotask(() => {
      dialogRef.current?.querySelector<HTMLElement>('button, select, textarea')?.focus()
    })
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, recordActivity])

  const segment = smsSegmentInfo(messageBody)
  const selectedTemplate: MessageTemplate | undefined = MESSAGE_TEMPLATES.find(
    (t) => t.key === templateKey,
  )
  const openSmsLink = smsHref(target?.phone, messageBody)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(messageBody)
      setStatusNote('Message copied. Delivery was not confirmed.')
      await recordActivity('message_copied')
    } catch {
      setError('Could not copy message')
    }
  }

  const handleOpenSms = async () => {
    if (!openSmsLink) {
      setError('Stored mobile number is missing or invalid')
      return
    }
    await recordActivity('sms_app_opened')
    setStatusNote(
      'Messaging app opened. Opening SMS does not prove the message was sent or delivered.',
    )
    window.location.href = openSmsLink
  }

  const handleMarkManuallySent = async () => {
    await recordActivity('manually_sent')
    setStatusNote('Recorded as manually sent (unverified). Not treated as provider delivery.')
  }

  const handleCancel = async () => {
    await recordActivity('canceled')
    onClose()
  }

  if (!open || !target) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/50 p-0 sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) void handleCancel()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white w-full sm:max-w-lg sm:rounded-lg rounded-t-xl max-h-[min(95vh,100dvh)] flex flex-col shadow-xl min-w-0"
      >
        <div className="px-4 py-3 border-b border-gray-200 shrink-0">
          <h2 id={titleId} className="text-lg font-semibold text-gray-900">
            Text Tenant
          </h2>
          <p className="text-sm text-gray-600 mt-1">{target.tenantName}</p>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3 overscroll-contain">
          <div className="grid grid-cols-1 gap-1 text-sm">
            <div>
              <span className="text-gray-500">Property: </span>
              <span className="font-medium break-words">
                {target.propertyLabel || '—'}
              </span>
            </div>
            <div>
              <label className="text-gray-500" htmlFor="text-tenant-phone">
                Stored mobile:{' '}
              </label>
              <span id="text-tenant-phone" className="font-medium break-all">
                {phoneE164 || target.phone || 'No phone on file'}
              </span>
            </div>
            {!phoneUsable && (
              <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md p-3">
                Missing or invalid phone. You can still prepare and copy a message,
                but Open SMS App requires a usable number.
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="text-tenant-template"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Message template
            </label>
            <select
              id="text-tenant-template"
              value={templateKey}
              onChange={(e) => applyTemplate(e.target.value as TemplateKey)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            >
              {MESSAGE_TEMPLATES.filter((t) => MANUAL_TEMPLATES.includes(t.key)).map(
                (t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ),
              )}
            </select>
            {selectedTemplate?.key === 'late_payment_reminder' && (
              <p className="mt-1 text-xs text-gray-500">Past-due reminder template.</p>
            )}
            {selectedTemplate?.key === 'promise_to_pay' && (
              <p className="mt-1 text-xs text-gray-500">Promise-to-pay follow-up template.</p>
            )}
          </div>

          <div>
            <label
              htmlFor="text-tenant-message"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Editable message
            </label>
            <textarea
              id="text-tenant-message"
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              rows={5}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm resize-y min-h-[120px]"
              placeholder="Type your message…"
            />
            <div className="mt-1 text-xs text-gray-500">
              {segment.characters} characters · {segment.segments} SMS segment
              {segment.segments === 1 ? '' : 's'}
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 text-blue-900 text-sm rounded-md p-3">
            Manual SMS only. Opening the messaging app does not prove the message
            was sent or delivered. Provider auto-send remains disabled unless
            separately approved.
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-2">Recent history</h3>
            {loading ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-gray-500">No messages yet.</p>
            ) : (
              <ul className="space-y-2 max-h-40 overflow-y-auto">
                {history.map((m) => (
                  <li
                    key={m.id}
                    className="rounded-md border border-gray-200 bg-white p-2 text-sm"
                  >
                    <div className="text-xs text-gray-500 mb-1">
                      {m.status}
                      {m.template_key ? ` · ${m.template_key}` : ''}
                    </div>
                    <p className="whitespace-pre-wrap break-words text-gray-900">{m.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {statusNote && (
            <div className="bg-green-50 border border-green-200 text-green-900 text-sm rounded-md p-3">
              {statusNote}
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-md p-3">
              {error}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex flex-col gap-2 shrink-0 bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={!messageBody.trim()}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              Copy Message
            </button>
            <button
              type="button"
              onClick={() => void handleOpenSms()}
              disabled={!openSmsLink || !messageBody.trim()}
              className="w-full px-4 py-3 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Open SMS App
            </button>
          </div>
          <button
            type="button"
            onClick={() => void handleMarkManuallySent()}
            disabled={recording || !messageBody.trim()}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            Record Activity (manually sent, unverified)
          </button>
          <button
            type="button"
            onClick={() => void handleCancel()}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
