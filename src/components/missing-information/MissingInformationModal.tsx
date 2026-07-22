'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type {
  MissingInfoCategory,
  MissingInfoSeverity,
  MissingInformationFinding,
} from '@/lib/missing-information/scan'

type Props = {
  open: boolean
  onClose: () => void
}

const SEVERITY_ORDER: MissingInfoSeverity[] = [
  'critical',
  'warning',
  'informational',
]

const SEVERITY_LABEL: Record<MissingInfoSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  informational: 'Informational',
}

const SEVERITY_BADGE: Record<MissingInfoSeverity, string> = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  warning: 'bg-amber-100 text-amber-800 border-amber-200',
  informational: 'bg-gray-100 text-gray-700 border-gray-200',
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
  )
  return Array.from(nodes).filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  )
}

export function MissingInformationModal({ open, onClose }: Props) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [findings, setFindings] = useState<MissingInformationFinding[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/missing-information', {
        credentials: 'include',
        cache: 'no-store',
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load findings')
      }
      setFindings(Array.isArray(data.findings) ? data.findings : [])
    } catch (cause) {
      setFindings([])
      setError(cause instanceof Error ? cause.message : 'Failed to load findings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  useEffect(() => {
    if (!open) return
    previouslyFocused.current =
      typeof document !== 'undefined'
        ? (document.activeElement as HTMLElement | null)
        : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const items = focusableElements(dialogRef.current)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (event.shiftKey) {
        if (active === first || !dialogRef.current.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKey)
    const t = window.setTimeout(() => {
      const closeBtn = dialogRef.current?.querySelector<HTMLElement>(
        '[data-mi-close]',
      )
      closeBtn?.focus()
    }, 0)

    return () => {
      window.clearTimeout(t)
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = previousOverflow
      previouslyFocused.current?.focus?.()
    }
  }, [open, onClose])

  const grouped = useMemo(() => {
    const bySeverity: Record<
      MissingInfoSeverity,
      Partial<Record<MissingInfoCategory, MissingInformationFinding[]>>
    > = {
      critical: {},
      warning: {},
      informational: {},
    }
    for (const item of findings) {
      const catMap = bySeverity[item.severity]
      const list = catMap[item.category] || []
      list.push(item)
      catMap[item.category] = list
    }
    return bySeverity
  }, [findings])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-3xl flex-col rounded-lg border border-gray-200 bg-white shadow-xl"
        style={{ maxHeight: 'min(90vh, 720px)' }}
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-gray-900">
              Missing Information
            </h2>
            <p className="mt-0.5 text-sm text-gray-600">
              Read-only findings. No automatic repairs are performed.
            </p>
          </div>
          <button
            type="button"
            data-mi-close
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <p className="text-sm text-gray-500">Scanning records…</p>
          )}
          {!loading && error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
              <button
                type="button"
                onClick={() => void load()}
                className="ml-2 font-medium text-blue-700 hover:underline"
              >
                Retry
              </button>
            </div>
          )}
          {!loading && !error && findings.length === 0 && (
            <p className="text-sm text-gray-600">
              No missing-information findings right now.
            </p>
          )}
          {!loading &&
            !error &&
            SEVERITY_ORDER.map((severity) => {
              const categories = grouped[severity]
              const categoryKeys = Object.keys(categories) as MissingInfoCategory[]
              if (categoryKeys.length === 0) return null
              return (
                <section key={severity} className="mb-6 last:mb-0">
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-800">
                    {SEVERITY_LABEL[severity]}
                  </h3>
                  {categoryKeys.sort().map((category) => (
                    <div key={`${severity}-${category}`} className="mb-4">
                      <h4 className="mb-2 text-sm font-medium text-gray-700">
                        {category}
                      </h4>
                      <ul className="space-y-3">
                        {(categories[category] || []).map((item) => (
                          <li
                            key={item.id}
                            className="rounded-md border border-gray-200 bg-white p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-gray-900">
                                {item.problem}
                              </span>
                              <span
                                className={`rounded border px-1.5 py-0.5 text-xs font-medium ${SEVERITY_BADGE[item.severity]}`}
                              >
                                {SEVERITY_LABEL[item.severity]}
                              </span>
                              {item.blocking && (
                                <span className="rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">
                                  Blocking
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-sm text-gray-700">
                              {item.affectedRecord.label}{' '}
                              <span className="text-gray-500">
                                ({item.affectedRecord.type})
                              </span>
                            </p>
                            <p className="mt-1 text-sm text-gray-600">
                              {item.explanation}
                            </p>
                            <Link
                              href={item.href}
                              className="mt-2 inline-block text-sm font-medium text-blue-700 hover:underline"
                              onClick={onClose}
                            >
                              Open related screen
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              )
            })}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
          <p className="text-sm text-gray-600">
            {loading ? '…' : `${findings.length} finding${findings.length === 1 ? '' : 's'}`}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
