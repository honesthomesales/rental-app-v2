'use client'

import { Suspense } from 'react'
import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import LateTenantsPanel from '@/components/tenant-accounts/LateTenantsPanel'
import LastPaidPanel from '@/components/tenant-accounts/LastPaidPanel'

export type TenantAccountsView = 'late' | 'last-paid'

function parseView(raw: string | null): TenantAccountsView {
  if (raw === 'last-paid' || raw === 'lastPaid' || raw === 'last_paid') {
    return 'last-paid'
  }
  return 'late'
}

function TenantAccountsInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const view = useMemo(
    () => parseView(searchParams.get('view')),
    [searchParams],
  )

  const setView = useCallback(
    (next: TenantAccountsView) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('view', next)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto min-w-0 overflow-x-hidden">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Tenant Accounts</h1>
        <p className="text-gray-600 mt-2 text-sm sm:text-base">
          Late balances and most recent eligible payments in one place
        </p>
        <div
          className="mt-4 inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5"
          role="group"
          aria-label="Tenant Accounts view"
        >
          <button
            type="button"
            onClick={() => setView('late')}
            className={`px-3 py-2 text-sm font-medium rounded transition-colors ${
              view === 'late'
                ? 'bg-blue-600 text-white'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
            aria-pressed={view === 'late'}
          >
            Late Tenants
          </button>
          <button
            type="button"
            onClick={() => setView('last-paid')}
            className={`px-3 py-2 text-sm font-medium rounded transition-colors ${
              view === 'last-paid'
                ? 'bg-blue-600 text-white'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
            aria-pressed={view === 'last-paid'}
          >
            Last Paid
          </button>
        </div>
      </div>

      {view === 'late' ? (
        <LateTenantsPanel embedded />
      ) : (
        <LastPaidPanel embedded />
      )}
    </div>
  )
}

export default function TenantAccountsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6">
          <div className="animate-pulse h-8 bg-gray-200 rounded w-1/3 mb-4" />
          <div className="animate-pulse h-10 bg-gray-100 rounded w-64" />
        </div>
      }
    >
      <TenantAccountsInner />
    </Suspense>
  )
}
