'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { StarIcon } from '@heroicons/react/24/solid'
import { useAuth } from '@/components/auth/AuthProvider'
import { fetchAuthenticated } from '@/lib/auth/authenticated-fetch'
import {
  logoutRedirectPath,
  resolveProtectedDataView,
  shouldRunProtectedQueries,
} from '@/lib/auth/session-state'
import {
  formatMonthKeyLabel,
  shiftMonthKey,
  toBusinessMonthKey,
} from '@/lib/date-month'
import { RentCollectedDetailModal } from '@/components/profit/RentCollectedDetailModal'

type SortField = 'property' | 'expected_rent' | 'rent_collected' | 'misc_income' | 'total_income'
type SortDirection = 'asc' | 'desc'

type ProfitViewMode = 'detail' | 'sixMonth' | 'twelveMonth'

type RollingMonthRow = {
  month: string
  label: string
  currentProfit: number
  potentialProfit: number
}

function rollingMonthCountForView(view: ProfitViewMode): 6 | 12 | null {
  if (view === 'sixMonth') return 6
  if (view === 'twelveMonth') return 12
  return null
}

export default function ProfitPage() {
  const auth = useAuth()
  const [loading, setLoading] = useState(true)
  const [metricsError, setMetricsError] = useState<string | null>(null)
  const [selectedMonth, setSelectedMonth] = useState(() => toBusinessMonthKey())
  const fetchGenerationRef = useRef(0)
  const [monthlyMetrics, setMonthlyMetrics] = useState<any>(null)
  const [sortField, setSortField] = useState<SortField>('property')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [viewMode, setViewMode] = useState<ProfitViewMode>('detail')
  const [rollingMonthRows, setRollingMonthRows] = useState<RollingMonthRow[]>([])
  const [rollingMonthLoading, setRollingMonthLoading] = useState(false)
  const [rollingMonthReferenceMonth, setRollingMonthReferenceMonth] = useState<string | null>(null)
  const [rentDetailProperty, setRentDetailProperty] = useState<{
    propertyId: string
    propertyName: string
    propertyAddress?: string
  } | null>(null)
  const rollingMonthCount = rollingMonthCountForView(viewMode)

  const fetchMonthlyMetrics = useCallback(async () => {
    const requestMonth = selectedMonth
    const generation = ++fetchGenerationRef.current
    setLoading(true)
    setMetricsError(null)
    try {
      const response = await fetchAuthenticated(
        `/api/profit/metrics?month=${encodeURIComponent(requestMonth)}`,
      )
      if (generation !== fetchGenerationRef.current) return
      if (response.ok) {
        const data = await response.json()
        if (generation !== fetchGenerationRef.current) return
        if (data?.month && data.month !== requestMonth) {
          console.warn(
            `Profit metrics month mismatch: requested ${requestMonth}, got ${data.month}`,
          )
        }
        setMonthlyMetrics(data)
        setMetricsError(null)
      } else {
        console.error('Failed to fetch monthly metrics:', response.status)
        let message = `Failed to load profit metrics (${response.status})`
        try {
          const errorData = await response.json()
          console.error('Error details:', errorData)
          if (errorData?.error) message = String(errorData.error)
        } catch {
          /* ignore parse errors */
        }
        if (generation !== fetchGenerationRef.current) return
        setMonthlyMetrics(null)
        setMetricsError(message)
      }
    } catch (error) {
      console.error('Error fetching monthly metrics:', error)
      if (generation !== fetchGenerationRef.current) return
      setMonthlyMetrics(null)
      setMetricsError('Could not load profit metrics. Check your connection and try again.')
    } finally {
      if (generation === fetchGenerationRef.current) setLoading(false)
    }
  }, [selectedMonth])

  useEffect(() => {
    setMonthlyMetrics(null)
  }, [selectedMonth])

  useEffect(() => {
    if (!shouldRunProtectedQueries(auth.status)) {
      if (auth.status !== 'loading') {
        setLoading(false)
        setMonthlyMetrics(null)
      }
      return
    }

    void fetchMonthlyMetrics()
  }, [auth.status, fetchMonthlyMetrics])

  useEffect(() => {
    if (!shouldRunProtectedQueries(auth.status)) return
    if (!rollingMonthCount) return

    let cancelled = false
    const load = async () => {
      setRollingMonthLoading(true)
      setRollingMonthRows([])
      try {
        const response = await fetchAuthenticated(
          `/api/profit/monthly-summary?months=${rollingMonthCount}`,
        )
        if (!response.ok) return
        const data = await response.json()
        if (!cancelled && data?.months) {
          setRollingMonthRows(data.months)
          setRollingMonthReferenceMonth(data.referenceMonth ?? null)
        }
      } catch (e) {
        console.error(`Error fetching ${rollingMonthCount}-month profit summary:`, e)
      } finally {
        if (!cancelled) setRollingMonthLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [auth.status, rollingMonthCount])

  const formatCurrency = (amount: number) => {
    return `$${Math.round(amount).toLocaleString()}`
  }

  const formatMonthSpelled = (monthKey: string) => {
    const [y, m] = monthKey.split('-').map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    })
  }

  const rollingMonthsSortedDesc = useMemo(() => {
    return [...rollingMonthRows].sort((a, b) => b.month.localeCompare(a.month))
  }, [rollingMonthRows])

  const rollingMonthAverages = useMemo(() => {
    if (rollingMonthsSortedDesc.length === 0) {
      return { currentProfit: 0, potentialProfit: 0 }
    }
    const n = rollingMonthsSortedDesc.length
    const currentProfit =
      rollingMonthsSortedDesc.reduce((sum, row) => sum + row.currentProfit, 0) / n
    const potentialProfit =
      rollingMonthsSortedDesc.reduce((sum, row) => sum + row.potentialProfit, 0) / n
    return { currentProfit, potentialProfit }
  }, [rollingMonthsSortedDesc])

  const navigateMonth = (direction: 'prev' | 'next') => {
    setSelectedMonth((prev) =>
      shiftMonthKey(prev, direction === 'prev' ? -1 : 1),
    )
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const sortedPropertyDetails = useMemo(() => {
    if (!monthlyMetrics?.propertyDetails) return []
    
    const details = [...monthlyMetrics.propertyDetails]
    
    return details.sort((a: any, b: any) => {
      let aValue: any
      let bValue: any
      
      switch (sortField) {
        case 'property':
          aValue = (a.property_name || '').toLowerCase()
          bValue = (b.property_name || '').toLowerCase()
          break
        case 'expected_rent':
          aValue = a.expected_rent || 0
          bValue = b.expected_rent || 0
          break
        case 'rent_collected':
          aValue = a.rent_collected || 0
          bValue = b.rent_collected || 0
          break
        case 'misc_income':
          aValue = a.misc_income || 0
          bValue = b.misc_income || 0
          break
        case 'total_income':
          aValue = (a.rent_collected || 0) + (a.misc_income || 0)
          bValue = (b.rent_collected || 0) + (b.misc_income || 0)
          break
        default:
          return 0
      }
      
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
      return 0
    })
  }, [monthlyMetrics?.propertyDetails, sortField, sortDirection])

  const renderRollingMonthsView = (monthCount: 6 | 12) => {
    const refMonth =
      rollingMonthReferenceMonth ?? toBusinessMonthKey()
    const periodLabel = monthCount === 12 ? '12 months' : '6 months'
    const skeletonCount = monthCount
    const gridClass =
      monthCount === 12 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'

    return (
    <div className={`mx-auto ${monthCount === 12 ? 'max-w-5xl' : 'max-w-3xl'}`}>
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-3 shadow-2xl shadow-slate-900/25 ring-1 ring-white/10 sm:p-4">
        <div
          className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-teal-400/15 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-20 -left-12 h-48 w-48 rounded-full bg-indigo-500/20 blur-3xl"
          aria-hidden
        />

        <div className="relative mb-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-center text-[10px] font-semibold uppercase tracking-[0.12em] sm:text-[11px]">
          <div>
            <span className="text-green-400">Current profit</span>
            <p className="mt-0.5 font-mono text-sm normal-case tracking-normal text-green-300">
              {rollingMonthLoading
                ? '…'
                : formatCurrency(rollingMonthAverages.currentProfit)}{' '}
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-green-400/80">
                avg ({periodLabel})
              </span>
            </p>
          </div>
          <div>
            <span className="text-lime-400">Potential if debt paid</span>
            <p className="mt-0.5 font-mono text-sm normal-case tracking-normal text-lime-300">
              {rollingMonthLoading
                ? '…'
                : formatCurrency(rollingMonthAverages.potentialProfit)}{' '}
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-lime-400/80">
                avg ({periodLabel})
              </span>
            </p>
          </div>
        </div>

        {rollingMonthLoading ? (
          <div className={`relative grid ${gridClass} gap-2`}>
            {[...Array(skeletonCount)].map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-lg bg-white/5 p-2 ring-1 ring-white/10"
              >
                <div className="mb-2 h-2 w-20 rounded bg-white/10" />
                <div className="mb-1 h-5 w-16 rounded bg-white/10" />
                <div className="h-4 w-14 rounded bg-white/5" />
              </div>
            ))}
          </div>
        ) : rollingMonthsSortedDesc.length === 0 ? (
          <p className="relative py-10 text-center text-sm text-slate-400">
            Could not load monthly summary. Try again or refresh the page.
          </p>
        ) : (
          <div className={`relative grid ${gridClass} gap-2`}>
            {rollingMonthsSortedDesc.map((row) => {
              const curPositive = row.currentProfit >= 0
              const isCurrentMonth = row.month === refMonth
              return (
                <article
                  key={row.month}
                  className="group relative flex flex-col overflow-hidden rounded-lg bg-white/[0.97] p-2 shadow-md shadow-slate-950/15 ring-1 ring-white/70 transition duration-300 hover:-translate-y-0.5 hover:bg-white hover:shadow-lg hover:ring-teal-200/50 sm:p-2.5"
                >
                  <div
                    className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${
                      curPositive
                        ? 'from-emerald-500 via-teal-400 to-cyan-400'
                        : 'from-rose-500 via-orange-400 to-amber-400'
                    }`}
                    aria-hidden
                  />

                  <header className="mb-1.5 flex items-start gap-1">
                    {isCurrentMonth ? (
                      <StarIcon
                        className="mt-0.5 h-3 w-3 shrink-0 text-amber-400"
                        aria-label="Current month"
                      />
                    ) : (
                      <span className="inline-block w-3 shrink-0" aria-hidden />
                    )}
                    <span className="min-w-0 text-[10px] font-medium leading-tight text-slate-700 sm:text-[11px]">
                      {formatMonthSpelled(row.month)}
                    </span>
                  </header>

                  <div className="flex flex-1 flex-col justify-between gap-1">
                    <p
                      className={`font-mono text-base font-bold tabular-nums leading-tight sm:text-lg ${
                        curPositive ? 'text-green-600' : 'text-rose-600'
                      }`}
                    >
                      {formatCurrency(row.currentProfit)}
                    </p>
                    <p
                      className={`font-mono text-sm font-semibold tabular-nums leading-tight ${
                        row.potentialProfit >= 0 ? 'text-lime-600' : 'text-rose-600'
                      }`}
                    >
                      {formatCurrency(row.potentialProfit)}
                    </p>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
    )
  }

  const renderMetricsView = () => (
    <div className="space-y-6">
      {/* Calendar Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigateMonth('prev')}
              className="p-2 hover:bg-gray-100 rounded-lg"
              title="Previous month"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => {
                if (e.target.value) {
                  setSelectedMonth(e.target.value)
                }
              }}
              className="text-xl font-semibold text-gray-900 border-none bg-transparent cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
            />
            <button
              onClick={() => navigateMonth('next')}
              className="p-2 hover:bg-gray-100 rounded-lg"
              title="Next month"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Three Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Fixed Expenses */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center mb-4">
            <div className="w-4 h-4 bg-red-500 rounded-full mr-3"></div>
            <h3 className="text-lg font-semibold text-gray-900">Fixed Expenses</h3>
          </div>
          
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Insurance</div>
              <div className="text-2xl font-bold text-gray-900">
                {formatCurrency(monthlyMetrics?.fixedExpenses?.insurance || 0)}
              </div>
            </div>
            
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Taxes</div>
              <div className="text-2xl font-bold text-gray-900">
                {formatCurrency(monthlyMetrics?.fixedExpenses?.taxes || 0)}
              </div>
            </div>
            
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Total Payments</div>
              <div className="text-2xl font-bold text-gray-900">
                {formatCurrency(monthlyMetrics?.fixedExpenses?.totalPayments || 0)}
              </div>
            </div>
            
            <div className="bg-red-50 p-4 rounded-lg border border-red-200">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-600 mb-1">Total Fixed Expenses</div>
                  <div className="text-2xl font-bold text-red-600">
                    {formatCurrency(monthlyMetrics?.fixedExpenses?.total || 0)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-600 mb-1">Potential Fixed Expenses</div>
                  <div className="text-2xl font-bold text-green-600">
                    {formatCurrency(monthlyMetrics?.fixedExpenses?.potential || 0)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 1 Time Expense and Income */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center mb-4">
            <div className="w-4 h-4 bg-orange-500 rounded-full mr-3"></div>
            <h3 className="text-lg font-semibold text-gray-900">1 Time Expense and Income</h3>
          </div>
          
          {/* Expenses Section */}
          <div className="mb-6">
            <div className="text-sm font-medium text-gray-700 mb-3">Expenses</div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <div className="text-xs text-gray-600 mb-1">Other Expenses</div>
              <div className="text-lg font-bold text-gray-600">
                {formatCurrency(monthlyMetrics?.oneTimeExpenseIncome?.expenses?.otherExpenses || 0)}
              </div>
            </div>
          </div>
          
          {/* Income Section */}
          <div className="mb-6">
            <div className="text-sm font-medium text-gray-700 mb-3">Income</div>
            <div className="bg-green-50 p-3 rounded-lg">
              <div className="text-xs text-gray-600 mb-1">Misc Income</div>
              <div className="text-lg font-bold text-green-600">
                {formatCurrency(monthlyMetrics?.oneTimeExpenseIncome?.income?.miscIncome || 0)}
              </div>
            </div>
          </div>
          
          {/* Totals */}
          <div className="space-y-3 pt-3 border-t border-gray-200">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-gray-700">Total Income:</span>
              <span className="text-lg font-bold text-green-600">
                {formatCurrency((monthlyMetrics?.rentCollection?.collected || 0) + (monthlyMetrics?.oneTimeExpenseIncome?.income?.miscIncome || 0))}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-gray-700">Total Debt:</span>
              <span className="text-lg font-bold text-red-600">
                {formatCurrency(monthlyMetrics?.oneTimeExpenseIncome?.totalDebt || 0)}
              </span>
            </div>
          </div>
        </div>

        {/* Rent Collection */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center mb-4">
            <div className="w-4 h-4 bg-blue-500 rounded-full mr-3"></div>
            <h3 className="text-lg font-semibold text-gray-900">Rent Collection</h3>
          </div>
          
          {/* Gauge Chart */}
          <div className="flex justify-center mb-6">
            <div className="relative w-40 h-24">
              <svg className="w-40 h-24" viewBox="0 0 100 50">
                {/* Background arc */}
                <path
                  d="M 10 45 A 40 40 0 0 1 90 45"
                  stroke="#e5e7eb"
                  strokeWidth="8"
                  fill="none"
                  strokeLinecap="round"
                />
                {/* Progress arc - dynamic based on collection rate (use decimal 0-1) */}
                <path
                  d="M 10 45 A 40 40 0 0 1 90 45"
                  stroke="#eab308"
                  strokeWidth="8"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${(monthlyMetrics?.rentCollection?.collectionRateDecimal || 0) * 126}, 126`}
                />
                {/* Center dot */}
                <circle cx="50" cy="45" r="3" fill="#6b7280" />
                {/* Needle - rotated based on collection rate (use decimal 0-1) */}
                <line
                  x1="50"
                  y1="45"
                  x2="50"
                  y2="15"
                  stroke="#374151"
                  strokeWidth="2"
                  strokeLinecap="round"
                  transform={`rotate(${((monthlyMetrics?.rentCollection?.collectionRateDecimal || 0) * 180) - 90} 50 45)`}
                />
              </svg>
              <div className="absolute inset-0 flex items-end justify-center pb-2">
                <div className="text-center">
                  <div className="text-xs text-gray-600">Rent Collected</div>
                  <div className="text-lg font-bold text-gray-900">
                    {formatCurrency(monthlyMetrics?.rentCollection?.collected || 0)}
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Legend */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
                <span className="text-sm text-gray-600">Rent Collected</span>
              </div>
              <span className="text-sm font-medium text-gray-900">
                {formatCurrency(monthlyMetrics?.rentCollection?.collected || 0)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="w-3 h-3 bg-yellow-500 rounded-full mr-2"></div>
                <span className="text-sm text-gray-600">Expected</span>
              </div>
              <span className="text-sm font-medium text-gray-900">
                {formatCurrency(monthlyMetrics?.rentCollection?.expected || 0)}
              </span>
            </div>
          </div>
          
          {/* Current Profit */}
          <div className="mt-6 pt-4 border-t border-gray-200">
            <div className="text-center">
              <div className="text-sm text-gray-600 mb-2">CURRENT PROFIT</div>
              {(() => {
                const totalIncome = (monthlyMetrics?.rentCollection?.collected || 0) + (monthlyMetrics?.oneTimeExpenseIncome?.income?.miscIncome || 0)
                const totalExpenses = (monthlyMetrics?.fixedExpenses?.total || 0) + (monthlyMetrics?.oneTimeExpenseIncome?.expenses?.otherExpenses || 0)
                const profit = totalIncome - totalExpenses
                return (
                  <div className={`text-6xl font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(profit)}
                  </div>
                )
              })()}
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200 text-center">
              <div className="text-sm text-gray-600 mb-2">Potential if House Debt is paid</div>
              {(() => {
                const potentialProfit = monthlyMetrics?.potentialProfit || 0
                return (
                  <div className={`text-4xl font-bold ${potentialProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(potentialProfit)}
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const viewToggle = (
    <div
      className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 shadow-sm"
      role="group"
      aria-label="Profit view mode"
    >
      <button
        type="button"
        onClick={() => setViewMode('detail')}
        className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
          viewMode === 'detail'
            ? 'bg-white text-gray-900 shadow'
            : 'text-gray-600 hover:text-gray-900'
        }`}
      >
        Monthly detail
      </button>
      <button
        type="button"
        onClick={() => setViewMode('sixMonth')}
        className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
          viewMode === 'sixMonth'
            ? 'bg-white text-gray-900 shadow'
            : 'text-gray-600 hover:text-gray-900'
        }`}
      >
        Last 6 months
      </button>
      <button
        type="button"
        onClick={() => setViewMode('twelveMonth')}
        className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
          viewMode === 'twelveMonth'
            ? 'bg-white text-gray-900 shadow'
            : 'text-gray-600 hover:text-gray-900'
        }`}
      >
        Last 12 months
      </button>
    </div>
  )

  const profitView = resolveProtectedDataView({
    authStatus: auth.status,
    loading: loading && viewMode === 'detail',
    httpStatus: metricsError ? 500 : monthlyMetrics ? 200 : null,
    networkError: false,
    itemCount: monthlyMetrics ? 1 : 0,
    emptyMessage: 'Unable to load profit data',
    loadNoun: 'profit',
  })

  if (auth.status === 'loading') {
    return (
      <div className="p-6">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          <h1 className="text-2xl font-bold text-gray-900">Profit Analysis v2.3</h1>
        </div>
        <p className="text-gray-500" data-testid="profit-auth-pending">Checking sign-in…</p>
      </div>
    )
  }

  if (
    profitView.kind === 'sign_in_required' ||
    profitView.kind === 'session_expired'
  ) {
    return (
      <div className="p-6 text-center space-y-3" data-testid="profit-auth-required">
        <p className="text-gray-700 font-medium">{profitView.message}</p>
        <a
          href={logoutRedirectPath()}
          className="inline-block px-4 py-2 bg-slate-900 text-white rounded-md text-sm"
        >
          Sign In
        </a>
      </div>
    )
  }

  if (loading && viewMode === 'detail') {
    return (
      <div className="p-6">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          <h1 className="text-2xl font-bold text-gray-900">Profit Analysis v2.3</h1>
          {viewToggle}
        </div>
        <div className="animate-pulse">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white p-6 rounded-lg shadow">
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                <div className="h-8 bg-gray-200 rounded w-3/4"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 w-full min-w-0 max-w-full">
      <div className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <h1 className="text-2xl font-bold text-gray-900">Profit Analysis v2.3</h1>
            {viewToggle}
          </div>
          <div className="flex flex-wrap items-end justify-end gap-8 ml-auto">
            {viewMode === 'detail' && monthlyMetrics && (
              <div className="text-right">
                <p className="text-sm text-gray-600">Current Profit</p>
                {(() => {
                  const totalIncome =
                    (monthlyMetrics.rentCollection?.collected || 0) +
                    (monthlyMetrics.oneTimeExpenseIncome?.income?.miscIncome || 0)
                  const totalExpenses =
                    (monthlyMetrics.fixedExpenses?.total || 0) +
                    (monthlyMetrics.oneTimeExpenseIncome?.expenses?.otherExpenses || 0)
                  const profit = totalIncome - totalExpenses
                  return (
                    <p
                      className={`text-2xl font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}
                    >
                      {formatCurrency(profit)}
                    </p>
                  )
                })()}
              </div>
            )}
            {viewMode === 'detail' && monthlyMetrics?.averageProfit12Months !== undefined && (
              <div className="text-right">
                <p className="text-sm text-gray-600">Average Profit (12 Months)</p>
                <p
                  className={`text-2xl font-bold ${monthlyMetrics.averageProfit12Months >= 0 ? 'text-green-600' : 'text-red-600'}`}
                >
                  {formatCurrency(monthlyMetrics.averageProfit12Months)}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>


      {rollingMonthCount ? (
        renderRollingMonthsView(rollingMonthCount)
      ) : (
        <>
          {metricsError && (
            <div
              className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              data-testid="profit-metrics-error"
            >
              <p className="text-sm text-red-800">{metricsError}</p>
              <button
                type="button"
                onClick={() => fetchMonthlyMetrics()}
                className="shrink-0 rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800"
              >
                Retry
              </button>
            </div>
          )}

          {/* Monthly Metrics View */}
          {renderMetricsView()}

          {/* Detailed Income and Rent by Property */}
          <div className="bg-white rounded-lg shadow min-w-0 max-w-full mt-8">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Income and Rent Details - {formatMonthKeyLabel(selectedMonth)}</h2>
          <p className="text-sm text-gray-600 mt-1">Detailed breakdown by property for the selected month</p>
          <p className="text-xs text-gray-500 mt-1 sm:hidden" data-testid="profit-swipe-hint">
            Swipe sideways to see all columns · tap headers to sort
          </p>
        </div>

        <div
          className="table-scroll-x overflow-x-auto overscroll-x-contain"
          tabIndex={0}
          role="region"
          aria-label="Profit income and rent details"
          data-testid="profit-totals-table-scroller"
        >
          <table className="min-w-[980px] w-max max-w-none divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider md:sticky md:left-0 bg-gray-50 z-10 cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('property')}
                >
                  <div className="flex items-center">
                    Property
                    {sortField === 'property' && (
                      <span className="ml-2">
                        {sortDirection === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('expected_rent')}
                >
                  <div className="flex items-center">
                    Expected Rent
                    {sortField === 'expected_rent' && (
                      <span className="ml-2">
                        {sortDirection === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('rent_collected')}
                >
                  <div className="flex items-center">
                    Rent Collected
                    {sortField === 'rent_collected' && (
                      <span className="ml-2">
                        {sortDirection === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('misc_income')}
                >
                  <div className="flex items-center">
                    Misc Income
                    {sortField === 'misc_income' && (
                      <span className="ml-2">
                        {sortDirection === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('total_income')}
                >
                  <div className="flex items-center">
                    Total Income
                    {sortField === 'total_income' && (
                      <span className="ml-2">
                        {sortDirection === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Detail
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedPropertyDetails && sortedPropertyDetails.length > 0 && (
                <tr className="bg-blue-50 font-semibold border-b-2 border-blue-200">
                  <td className="px-6 py-4 whitespace-nowrap md:sticky md:left-0 bg-blue-50 z-10">
                    <span className="text-sm font-bold text-gray-900">TOTALS</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                    {formatCurrency(sortedPropertyDetails.reduce((sum: number, p: any) => sum + (p.expected_rent || 0), 0))}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                    {formatCurrency(sortedPropertyDetails.reduce((sum: number, p: any) => sum + (p.rent_collected || 0), 0))}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                    {formatCurrency(sortedPropertyDetails.reduce((sum: number, p: any) => sum + (p.misc_income || 0), 0))}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-lg font-bold text-green-600">
                    {formatCurrency(sortedPropertyDetails.reduce((sum: number, p: any) => sum + (p.rent_collected || 0) + (p.misc_income || 0), 0))}
                  </td>
                  <td className="px-4 py-4" />
                </tr>
              )}
              {sortedPropertyDetails && sortedPropertyDetails.length > 0 ? (
                sortedPropertyDetails.map((property: any, index: number) => (
                  <tr key={property.property_id || `row-${index}`} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap md:sticky md:left-0 bg-white z-10">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {property.property_name || 'Unknown Property'}
                        </div>
                        <div className="text-sm text-gray-500">
                          {property.property_address || ''}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(property.expected_rent || 0)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(property.rent_collected || 0)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(property.misc_income || 0)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                      {formatCurrency((property.rent_collected || 0) + (property.misc_income || 0))}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-center">
                      {property.property_id && (property.rent_collected || 0) > 0 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setRentDetailProperty({
                              propertyId: property.property_id,
                              propertyName: property.property_name || 'Property',
                              propertyAddress: property.property_address,
                            })
                          }
                          className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors min-h-9"
                          data-testid={`profit-rent-detail-${property.property_id}`}
                        >
                          Detail
                        </button>
                      ) : (
                        <span className="text-gray-300 text-sm">—</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center text-sm text-gray-500" data-testid="profit-property-empty">
                    {loading
                      ? 'Loading property details…'
                      : metricsError
                        ? 'Property details unavailable. Use Retry above.'
                        : monthlyMetrics
                          ? `No property data available for ${formatMonthKeyLabel(selectedMonth)}`
                          : 'No property data loaded.'}
                  </td>
                </tr>
              )}
              {sortedPropertyDetails && sortedPropertyDetails.length > 0 && (
                <tr className="bg-gray-100 font-semibold">
                  <td className="px-6 py-4 whitespace-nowrap md:sticky md:left-0 bg-gray-100 z-10">
                    TOTALS
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                    {formatCurrency(sortedPropertyDetails.reduce((sum: number, p: any) => sum + (p.expected_rent || 0), 0))}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(sortedPropertyDetails.reduce((sum: number, p: any) => sum + (p.rent_collected || 0), 0))}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(sortedPropertyDetails.reduce((sum: number, p: any) => sum + (p.misc_income || 0), 0))}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                    {formatCurrency(sortedPropertyDetails.reduce((sum: number, p: any) => sum + (p.rent_collected || 0) + (p.misc_income || 0), 0))}
                  </td>
                  <td className="px-4 py-4" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <RentCollectedDetailModal
        open={rentDetailProperty != null}
        onClose={() => setRentDetailProperty(null)}
        month={selectedMonth}
        propertyId={rentDetailProperty?.propertyId ?? null}
        propertyName={rentDetailProperty?.propertyName ?? ''}
        propertyAddress={rentDetailProperty?.propertyAddress}
      />
        </>
      )}
    </div>
  )
}
