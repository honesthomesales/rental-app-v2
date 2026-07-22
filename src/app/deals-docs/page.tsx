'use client'

import { Suspense, useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import DealsPanel from '@/components/deals-docs/DealsPanel'
import DocumentsPanel from '@/components/deals-docs/DocumentsPanel'

export type DealsDocsView = 'deals' | 'docs'

function parseView(raw: string | null): DealsDocsView {
  if (raw === 'docs' || raw === 'documents' || raw === 'document') return 'docs'
  return 'deals'
}

function DealsDocsInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const view = useMemo(
    () => parseView(searchParams.get('view')),
    [searchParams],
  )

  const setView = useCallback(
    (next: DealsDocsView) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('view', next)
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  return (
    <div className="min-w-0 overflow-x-hidden">
      <div className="px-4 sm:px-6 pt-4 sm:pt-6 max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900">Deals / Docs</h1>
        <div
          className="mt-4 inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5"
          role="group"
          aria-label="Deals or Docs view"
        >
          <button
            type="button"
            onClick={() => setView('deals')}
            className={`px-3 py-2 text-sm font-medium rounded transition-colors ${
              view === 'deals'
                ? 'bg-blue-600 text-white'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
            aria-pressed={view === 'deals'}
            data-testid="deals-docs-toggle-deals"
          >
            Deals
          </button>
          <button
            type="button"
            onClick={() => setView('docs')}
            className={`px-3 py-2 text-sm font-medium rounded transition-colors ${
              view === 'docs'
                ? 'bg-blue-600 text-white'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
            aria-pressed={view === 'docs'}
            data-testid="deals-docs-toggle-docs"
          >
            Docs
          </button>
        </div>
      </div>
      {view === 'deals' ? <DealsPanel /> : <DocumentsPanel />}
    </div>
  )
}

export default function DealsDocsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6">
          <div className="animate-pulse h-8 bg-gray-200 rounded w-1/3 mb-4" />
          <div className="animate-pulse h-10 bg-gray-100 rounded w-64" />
        </div>
      }
    >
      <DealsDocsInner />
    </Suspense>
  )
}
