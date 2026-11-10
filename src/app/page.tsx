'use client'

import { useEffect, useRef, useState } from 'react'
import { DashboardMetrics } from '@/types/database'
import { 
  HomeIcon, 
  CurrencyDollarIcon, 
  ExclamationTriangleIcon,
  BuildingOfficeIcon,
  XMarkIcon,
  PencilIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline'
import { MissingInformationButton } from '@/components/missing-information/MissingInformationButton'
import { formatWholeDollarDisplay } from '@/lib/format-whole-dollar'
import { useAuth } from '@/components/auth/AuthProvider'
import {
  resolveProtectedDataView,
  shouldRunProtectedQueries,
  logoutRedirectPath,
} from '@/lib/auth/session-state'
import {
  countsTowardCurrentIncome,
  selectNewestLeaseByProperty,
} from '@/lib/lease-status'
import {
  effectiveTaxPaid,
  isMobileHomeType,
  normalizeTaxColorState,
} from '@/lib/dashboard-tax'
import {
  currentYearMonthlyTax,
  homeTaxLedger,
  isTaxYearBlank,
  isTaxYearPaid,
  landTaxLedger,
  taxYearsForDate,
  withTaxYearEntry,
  type TaxYearEntry,
} from '@/lib/tax-years'

const DASHBOARD_FETCH_TIMEOUT_MS = 25_000

type DashboardLeaseRow = {
  id: string
  property_id?: string | null
  status?: string | null
  created_at?: string | null
  lease_start_date?: string | null
}

/**
 * Insurance + Property Tax tables and dashboard metrics API: only these property_type values.
 * (Excludes loan, other, and unset/null type — those rows never enter either overview list.)
 */
const OVERVIEW_RESIDENTIAL_TYPES = ['house', 'doublewide', 'singlewide'] as const

function isOverviewResidentialType(propertyType: string | null | undefined): boolean {
  return (
    propertyType != null &&
    (OVERVIEW_RESIDENTIAL_TYPES as readonly string[]).includes(propertyType)
  )
}

/** Same rows for Insurance and Tax: match any of these fields (String() avoids Map_ID number / null bugs) */
function overviewSearchMatches(property: any, searchLower: string): boolean {
  if (!searchLower) return true
  const fields = [
    property.name,
    property.owner_name,
    property.county,
    property.Map_ID,
    property.map_id_trailer,
    property.insurance_provider,
    property.insurance_policy_number,
  ]
  return fields.some((v) => String(v ?? '').toLowerCase().includes(searchLower))
}

function formatTaxMoney(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const TAX_GRID_COLUMNS = '0.32fr 0.85fr 0.82fr 0.62fr 0.72fr 0.95fr 0.95fr 0.95fr 0.9fr 0.85fr'

function TaxYearAmount({
  entry,
  dark,
  label,
  onCommit,
}: {
  entry: TaxYearEntry
  dark: boolean
  label?: string
  onCommit: (next: TaxYearEntry) => void
}) {
  const paid = isTaxYearPaid(entry)
  const blank = isTaxYearBlank(entry)
  const [editingOwed, setEditingOwed] = useState(false)
  const [owedDraft, setOwedDraft] = useState('')
  const [showPaid, setShowPaid] = useState(false)
  const [paidDraft, setPaidDraft] = useState(entry.paid > 0 ? entry.paid.toFixed(2) : '')
  const clickTimer = useRef<number | null>(null)

  const hasBill = entry.owed != null && entry.owed > 0
  const amountClass = !hasBill
    ? dark
      ? 'text-xs text-white/70'
      : 'text-xs text-gray-400'
    : paid
      ? dark
        ? 'text-sm font-bold text-green-200 line-through'
        : 'text-sm font-bold text-green-700 line-through'
      : dark
        ? 'text-sm font-bold text-red-200'
        : 'text-sm font-bold text-red-700'
  const labelClass = dark
    ? 'text-[10px] uppercase tracking-wide text-white/80'
    : 'text-[10px] uppercase tracking-wide text-gray-600'

  const startOwedEdit = () => {
    if (clickTimer.current) window.clearTimeout(clickTimer.current)
    setShowPaid(false)
    setOwedDraft(entry.owed != null && entry.owed > 0 ? entry.owed.toFixed(2) : '')
    setEditingOwed(true)
  }

  const commitOwed = () => {
    const parsed = parseFloat(owedDraft)
    const owed = owedDraft.trim() === '' || Number.isNaN(parsed) ? null : parsed
    setEditingOwed(false)
    if ((owed ?? 0) === (entry.owed ?? 0)) return
    onCommit({ owed, paid: entry.paid })
  }

  const commitPaid = () => {
    const parsed = parseFloat(paidDraft)
    const nextPaid = paidDraft.trim() === '' || Number.isNaN(parsed) ? 0 : Math.max(0, parsed)
    setShowPaid(false)
    if (Math.abs(nextPaid - entry.paid) < 0.001) return
    onCommit({ owed: entry.owed, paid: nextPaid })
  }

  const amountText = entry.owed != null && entry.owed > 0 ? formatTaxMoney(entry.owed) : '—'

  return (
    <div className="leading-tight min-w-0">
      {label ? <div className={`${labelClass} mb-0.5`}>{label}</div> : null}
      {editingOwed ? (
        <input
          type="number"
          step="0.01"
          value={owedDraft}
          onChange={(e) => setOwedDraft(e.target.value)}
          onBlur={commitOwed}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitOwed()
            if (e.key === 'Escape') setEditingOwed(false)
          }}
          onClick={(e) => e.stopPropagation()}
          className="text-xs border rounded px-1 w-full text-gray-900 bg-white"
          autoFocus
          placeholder="Owed"
        />
      ) : (
        <span
          onClick={() => {
            if (!paid) return
            if (clickTimer.current) window.clearTimeout(clickTimer.current)
            clickTimer.current = window.setTimeout(() => {
              setPaidDraft(entry.paid > 0 ? entry.paid.toFixed(2) : '')
              setShowPaid(true)
            }, 250)
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            startOwedEdit()
          }}
          className={`block px-1 rounded cursor-pointer hover:bg-yellow-100 ${amountClass}`}
          title={paid ? 'Click to change the amount paid. Double-click to change the bill.' : 'Double-click to set the amount owed.'}
        >
          {amountText}
        </span>
      )}
      {!paid && !blank ? (
        <input
          type="number"
          step="0.01"
          value={paidDraft}
          onChange={(e) => setPaidDraft(e.target.value)}
          onBlur={commitPaid}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          onClick={(e) => e.stopPropagation()}
          className="mt-1 text-xs border rounded px-1 py-0.5 w-full text-gray-900 bg-white"
          placeholder="Paid"
          aria-label="Amount paid"
        />
      ) : null}
      {paid && showPaid ? (
        <input
          type="number"
          step="0.01"
          value={paidDraft}
          onChange={(e) => setPaidDraft(e.target.value)}
          onBlur={commitPaid}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setShowPaid(false)
          }}
          onClick={(e) => e.stopPropagation()}
          className="mt-1 text-xs border rounded px-1 py-0.5 w-full text-gray-900 bg-white"
          autoFocus
          aria-label="Amount paid"
        />
      ) : null}
    </div>
  )
}

function displayInsuranceField(value: string | null | undefined): string {
  const t = (value ?? '').trim()
  if (!t) return '—'
  const lower = t.toLowerCase()
  if (lower === 'none' || lower === 'n/a' || lower === 'null') return '—'
  return t
}

function formatInsurancePremium(value: unknown): string {
  const n = parseFloat(String(value ?? ''))
  if (!Number.isFinite(n) || n <= 0) return '—'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function Dashboard() {
  const auth = useAuth()
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [metricsHttpStatus, setMetricsHttpStatus] = useState<number | null>(null)
  const [metricsNetworkError, setMetricsNetworkError] = useState(false)
  const [properties, setProperties] = useState<any[]>([])
  const [showInsuranceSection, setShowInsuranceSection] = useState(false)
  const [showTaxSection, setShowTaxSection] = useState(false)
  const [editingProperty, setEditingProperty] = useState<any>(null)
  const [editingField, setEditingField] = useState<string>('')
  const [editingValue, setEditingValue] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [insuranceSortField, setInsuranceSortField] = useState<string>('name')
  const [insuranceSortDirection, setInsuranceSortDirection] = useState<'asc' | 'desc'>('asc')
  const [taxSortField, setTaxSortField] = useState<string>('name')
  const [taxSortDirection, setTaxSortDirection] = useState<'asc' | 'desc'>('asc')
  /** Single filter for Insurance + Property Tax lists so row counts always match */
  const [overviewSearchTerm, setOverviewSearchTerm] = useState<string>('')
  const [showPotentialIncomeSection, setShowPotentialIncomeSection] = useState(false)
  const [showPotentialIncomeModal, setShowPotentialIncomeModal] = useState(false)
  const [showOccupiedModal, setShowOccupiedModal] = useState(false)
  const [occupiedProperties, setOccupiedProperties] = useState<any[]>([])
  const [showMonthlyIncomeModal, setShowMonthlyIncomeModal] = useState(false)
  const [monthlyIncomeLeases, setMonthlyIncomeLeases] = useState<any[]>([])
  const [taxSelectedProperties, setTaxSelectedProperties] = useState<Map<string, number>>(new Map())
  const [editingRentValue, setEditingRentValue] = useState<{propertyId: string, value: string} | null>(null)
  // Monthly Income Modal filtering and sorting
  const [monthlyIncomeCadenceFilter, setMonthlyIncomeCadenceFilter] = useState<string>('all')
  const [monthlyIncomeSortField, setMonthlyIncomeSortField] = useState<'property' | 'tenant' | 'rent'>('property')
  const [monthlyIncomeSortDirection, setMonthlyIncomeSortDirection] = useState<'asc' | 'desc'>('asc')
  // Empty Properties Modal sorting
  const [emptyPropertiesSortField, setEmptyPropertiesSortField] = useState<'property' | 'address' | 'rent'>('property')
  const [emptyPropertiesSortDirection, setEmptyPropertiesSortDirection] = useState<'asc' | 'desc'>('asc')
  // Properties with Tenants Modal filtering and sorting
  const [occupiedPropertiesTypeFilter, setOccupiedPropertiesTypeFilter] = useState<string>('all')
  const [occupiedPropertiesSortField, setOccupiedPropertiesSortField] = useState<'property' | 'address' | 'type' | 'hasTenants'>('property')
  const [occupiedPropertiesSortDirection, setOccupiedPropertiesSortDirection] = useState<'asc' | 'desc'>('asc')
  const [showProfitCalculation, setShowProfitCalculation] = useState(false)

  const potentialIncomeRows = metrics?.potentialIncomeRows || []
  const profitBreakdown = metrics?.profitBreakdown
  
  // Color states: 0 = default (gray), 1 = yellow, 2 = light green, 3 = lime, 4 = medium red, 5 = bright red

  useEffect(() => {
    if (!shouldRunProtectedQueries(auth.status)) {
      if (auth.status !== 'loading') {
        setLoading(false)
        setMetrics(null)
        setMetricsHttpStatus(null)
        setMetricsNetworkError(false)
      }
      return
    }
    void fetchDashboardData()
    const refresh = () => {
      if (document.visibilityState === 'visible') void fetchDashboardData(true)
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [auth.status])

  useEffect(() => {
    const allowedTypeFilter = ['', 'house', 'doublewide', 'singlewide']
    if (!allowedTypeFilter.includes(typeFilter)) {
      setTypeFilter('')
    }
    const allowedOccupiedType = ['all', 'house', 'doublewide', 'singlewide']
    if (!allowedOccupiedType.includes(occupiedPropertiesTypeFilter)) {
      setOccupiedPropertiesTypeFilter('all')
    }
  }, [typeFilter, occupiedPropertiesTypeFilter])

  const fetchDashboardData = async (showRefreshing = false) => {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), DASHBOARD_FETCH_TIMEOUT_MS)
    try {
      if (showRefreshing) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setMetricsHttpStatus(null)
      setMetricsNetworkError(false)
      console.log('Fetching dashboard data in parallel...')
      
      // Add cache-busting timestamp to ensure fresh data
      const timestamp = Date.now()
      
      // OPTIMIZED: Fetch all data in parallel instead of sequentially
      const [metricsResponse, propertiesResponse, leasesResponse] = await Promise.all([
        fetch(`/api/dashboard/metrics?t=${timestamp}`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        }),
        fetch(`/api/properties?t=${timestamp}`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        }),
        fetch(`/api/leases?t=${timestamp}`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        }),
      ])

      // Process metrics
      if (!metricsResponse.ok) {
        setMetricsHttpStatus(metricsResponse.status)
        setMetrics(null)
        throw new Error(`Dashboard metrics failed: ${metricsResponse.status}`)
      }
      const data = await metricsResponse.json()
      console.log('Dashboard data received:', data)
      setMetrics(data)
      setMetricsHttpStatus(200)

      // Process properties / modal lists separately so a modal-only error
      // cannot wipe an already-successful metrics payload.
      try {
        if (propertiesResponse.ok) {
          const propertiesData = await propertiesResponse.json()
          console.log('Properties data for dashboard:', propertiesData?.length || 0)
          setProperties(propertiesData || [])
          
          // Load color states from properties (including 0 for default state)
          const colorStates = new Map<string, number>()
          propertiesData.forEach((property: any) => {
            // Explicitly check for number type, including 0
            if (typeof property.tax_color_state === 'number') {
              colorStates.set(property.id, normalizeTaxColorState(property.tax_color_state))
            }
          })
          setTaxSelectedProperties(colorStates)
          
          if (propertiesData && leasesResponse.ok) {
            const leasesData = await leasesResponse.json()

            const newestLeaseByProperty = selectNewestLeaseByProperty<DashboardLeaseRow>(leasesData)
            const soldPropertyIds = new Set<string>()
            const today = new Date().toISOString().split('T')[0]
            const todayDate = new Date(today)

            newestLeaseByProperty.forEach((lease, propertyId) => {
              if (lease.status === 'sold') soldPropertyIds.add(propertyId)
            })

            // Properties with Tenants modal: hasTenants = newest lease status is exactly occupied
            // (eviction is Potential Income only; keep isPhysicallyOccupied unchanged elsewhere)
            const validProperties = propertiesData.filter(
              (property: any) =>
                String(property.status || '').toLowerCase() !== 'sold' &&
                !soldPropertyIds.has(property.id) &&
                isOverviewResidentialType(property.property_type)
            )
            
            const allPropsWithTenants = validProperties.map((property: any) => {
              const newest = newestLeaseByProperty.get(property.id)
              return {
                ...property,
                hasTenants: countsTowardCurrentIncome(newest?.status),
              }
            })
            setOccupiedProperties(allPropsWithTenants)
            
            // Calculate monthly income leases (leases with tenants with rent info)
            // Only include 'occupied' status (exclude 'sold' for money calculations)
            const incomeLeases = leasesData.filter((lease: any) => {
              const isOccupied = lease.status === 'occupied'
              if (!isOccupied || !lease.property_id) return false
              const startDate = new Date(lease.lease_start_date)
              const endDate = lease.lease_end_date ? new Date(lease.lease_end_date) : null
              const isWithinDateRange = todayDate >= startDate && (!endDate || todayDate <= endDate)
              return isWithinDateRange
            })
            setMonthlyIncomeLeases(incomeLeases)
          }
        }
      } catch (modalError) {
        console.error('Error building dashboard modal data:', modalError)
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
      // Do not convert auth/network failures into legitimate-looking zeros.
      setMetrics(null)
      if (
        error instanceof TypeError ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        setMetricsNetworkError(true)
      }
    } finally {
      window.clearTimeout(timeoutId)
      setLoading(false)
      setRefreshing(false)
    }
  }

  const handleDoubleClick = (property: any, field: string) => {
    setEditingProperty(property)
    setEditingField(field)
    // For numeric fields, preserve decimal format when editing
    if (
      field === 'tax_paid_amount_current' ||
      field === 'tax_paid_amount_previous' ||
      field === 'trailer_tax_paid_amount_current' ||
      field === 'trailer_tax_paid_amount_previous'
    ) {
      const n = effectiveTaxPaid(property[field])
      setEditingValue(property[field] != null && property[field] !== '' ? n.toFixed(2) : '')
    } else if (field === 'property_tax' || field === 'trailer_property_tax') {
      const value = property[field]
      setEditingValue(value != null && value !== '' ? parseFloat(String(value)).toFixed(2) : '')
    } else {
      setEditingValue(property[field] || '')
    }
  }

  const handleSaveEdit = async () => {
    if (!editingProperty || !editingField) return

    try {
      let updateData: any = {}
      
      // Owed cells store a manual override. 0 clears it and falls back to the calculated bill.
      if (editingField === 'taxes_owed' || editingField === 'trailer_taxes_owed') {
        const column = editingField === 'taxes_owed' ? 'tax_owed' : 'trailer_tax_owed'
        const newOwed = parseFloat(editingValue) || 0
        updateData[column] = newOwed === 0 ? null : parseFloat(newOwed.toFixed(2))
        console.log('Updating owed amount:', {
          propertyId: editingProperty.id,
          newOwed,
          editingValue,
          updateData
        })
      } else {
        // Ensure numeric fields are converted to numbers with proper decimal precision
        if (
          editingField === 'tax_paid_amount_current' ||
          editingField === 'tax_paid_amount_previous' ||
          editingField === 'trailer_tax_paid_amount_current' ||
          editingField === 'trailer_tax_paid_amount_previous' ||
          editingField === 'property_tax' ||
          editingField === 'trailer_property_tax'
        ) {
          if (editingValue === '' || editingValue === null || editingValue === undefined) {
            updateData[editingField] = null
          } else {
            const numValue = parseFloat(editingValue)
            // Preserve decimal precision (2 decimal places) for tax-related fields
            updateData[editingField] = isNaN(numValue) ? null : parseFloat(numValue.toFixed(2))
          }
        } else {
          updateData[editingField] = editingValue
        }
      }

      console.log('Saving property update:', { id: editingProperty.id, field: editingField, updateData })

      const response = await fetch(`/api/properties/${editingProperty.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData)
      })

      if (response.ok) {
        const updatedProperty = await response.json()
        console.log('Property updated successfully:', updatedProperty)
        
        // Update local state with the actual response from server
        setProperties(prev => prev.map(p => 
          p.id === editingProperty.id 
            ? { ...p, ...updatedProperty }
            : p
        ))
        
        // Clear editing state
        setEditingProperty(null)
        setEditingField('')
        setEditingValue('')
      } else {
        let errorMessage = `Failed to save (${response.status})`
        try {
          const errorData = await response.json()
          console.error('Failed to update property:', {
            status: response.status,
            statusText: response.statusText,
            errorData,
            updateData,
            editingField,
            editingValue
          })
          errorMessage = errorData.details || errorData.errorMessage || errorData.error || errorMessage
          if (errorData.hint) {
            errorMessage += `\nHint: ${errorData.hint}`
          }
          if (errorData.code) {
            errorMessage += `\nCode: ${errorData.code}`
          }
          // Show full error details in console for debugging
          console.error('Full error details:', errorData)
        } catch (parseError) {
          const text = await response.text()
          console.error('Failed to parse error response:', parseError, text)
          errorMessage += `: ${text.substring(0, 200)}`
        }
        alert(errorMessage)
      }
    } catch (error) {
      console.error('Error updating property:', error)
      alert(`Error saving: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleCancelEdit = () => {
    setEditingProperty(null)
    setEditingField('')
    setEditingValue('')
  }

  const saveTaxYear = async (
    property: any,
    stream: 'land' | 'home',
    year: number,
    entry: TaxYearEntry,
  ) => {
    const asOf = new Date()
    const column = stream === 'land' ? 'tax_by_year' : 'trailer_tax_by_year'
    const current = stream === 'land' ? landTaxLedger(property, asOf) : homeTaxLedger(property, asOf)
    const ledger = withTaxYearEntry(current, year, entry)
    const response = await fetch(`/api/properties/${property.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [column]: ledger }),
    })
    if (response.ok) {
      const updatedProperty = await response.json()
      setProperties((prev) => prev.map((p) => (p.id === property.id ? { ...p, ...updatedProperty } : p)))
      return
    }
    let errorMessage = `Failed to save (${response.status})`
    try {
      const errorData = await response.json()
      errorMessage = errorData.details || errorData.errorMessage || errorData.error || errorMessage
    } catch {
      // Keep the status message.
    }
    alert(errorMessage)
  }

  const handleInsuranceSort = (field: string) => {
    if (insuranceSortField === field) {
      setInsuranceSortDirection(insuranceSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setInsuranceSortField(field)
      setInsuranceSortDirection('asc')
    }
  }

  const handleTaxSort = (field: string) => {
    if (taxSortField === field) {
      setTaxSortDirection(taxSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setTaxSortField(field)
      setTaxSortDirection('asc')
    }
  }

  /** Rows after residential + type filter (no search). Used for empty-state counts before search. */
  const getOverviewTypeFilteredRows = () => {
    const base = properties.filter((p) => isOverviewResidentialType(p.property_type))
    if (!typeFilter) return base
    return base.filter((p) => p.property_type === typeFilter)
  }

  /**
   * Single pipeline for both Insurance and Property Tax: same array instance flow.
   * Only the subsequent `.sort()` differs per section — sort cannot add/remove rows.
   */
  const getOverviewRowsUnsorted = () => {
    const typed = getOverviewTypeFilteredRows()
    const term = overviewSearchTerm.trim().toLowerCase()
    if (!term) return typed
    return typed.filter((p) => overviewSearchMatches(p, term))
  }

  const getSortedInsuranceProperties = () => {
    const rows = getOverviewRowsUnsorted()

    // Apply sorting
    return [...rows].sort((a, b) => {
      let aValue = a[insuranceSortField] || ''
      let bValue = b[insuranceSortField] || ''
      
      if (typeof aValue === 'string') aValue = aValue.toLowerCase()
      if (typeof bValue === 'string') bValue = bValue.toLowerCase()
      
      if (aValue < bValue) return insuranceSortDirection === 'asc' ? -1 : 1
      if (aValue > bValue) return insuranceSortDirection === 'asc' ? 1 : -1
      return 0
    })
  }

  const getSortedTaxProperties = () => {
    const rows = getOverviewRowsUnsorted()

    // Apply sorting
    return [...rows].sort((a, b) => {
      let aValue: any = a[taxSortField] || ''
      let bValue: any = b[taxSortField] || ''
      
      if (taxSortField.startsWith('tax_year_')) {
        const year = taxSortField.slice('tax_year_'.length)
        const asOf = new Date()
        aValue = landTaxLedger(a, asOf)[year]?.owed ?? -1
        bValue = landTaxLedger(b, asOf)[year]?.owed ?? -1
      }

      if (taxSortField === 'property_tax') {
        const asOf = new Date()
        aValue = currentYearMonthlyTax(
          a,
          asOf,
          normalizeTaxColorState(taxSelectedProperties.get(a.id) ?? a.tax_color_state),
        )
        bValue = currentYearMonthlyTax(
          b,
          asOf,
          normalizeTaxColorState(taxSelectedProperties.get(b.id) ?? b.tax_color_state),
        )
      }

      // Special handling for sorting by color state
      if (taxSortField === 'color_state') {
        const stateA = normalizeTaxColorState(taxSelectedProperties.get(a.id) || 0)
        const stateB = normalizeTaxColorState(taxSelectedProperties.get(b.id) || 0)
        // Normalize: treat 0 as highest value for sorting (comes last)
        const normalizedA = stateA === 0 ? 999 : stateA
        const normalizedB = stateB === 0 ? 999 : stateB
        aValue = normalizedA
        bValue = normalizedB
      }
      
      if (typeof aValue === 'string') aValue = aValue.toLowerCase()
      if (typeof bValue === 'string') bValue = bValue.toLowerCase()
      
      if (aValue < bValue) return taxSortDirection === 'asc' ? -1 : 1
      if (aValue > bValue) return taxSortDirection === 'asc' ? 1 : -1
      return 0
    })
  }

  const getTaxRowColor = (state: number): string => {
    switch (normalizeTaxColorState(state)) {
      case 1:
        return 'bg-yellow-300'
      case 3:
        return 'bg-lime-400'
      case 7:
        return 'bg-green-800'
      default:
        return 'bg-gray-50'
    }
  }

  const nextTaxColor = (state: number): number => {
    const current = normalizeTaxColorState(state)
    if (current === 0) return 1
    if (current === 1) return 7
    if (current === 7) return 3
    return 0
  }

  const handleTaxToggle = async (propertyId: string) => {
    const currentState = normalizeTaxColorState(taxSelectedProperties.get(propertyId) || 0)
    const nextState = nextTaxColor(currentState)
    
    // Update local state immediately (always save state, including 0)
    setTaxSelectedProperties(prev => {
      const newMap = new Map(prev)
      newMap.set(propertyId, nextState)
      return newMap
    })
    
    // Save to database - always save the state (including 0 for default)
    try {
      const response = await fetch(`/api/properties/${propertyId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tax_color_state: nextState
        })
      })
      
      if (response.ok) {
        const updatedProperty = await response.json()
        console.log('Color state saved successfully:', { propertyId, nextState, updatedProperty })
        // Update local property state with server response
        setProperties(prev => prev.map(p => 
          p.id === propertyId 
            ? { ...p, tax_color_state: nextState }
            : p
        ))
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        console.error('Failed to save color state:', { propertyId, nextState, status: response.status, errorData })
        // Revert local state on failure
        setTaxSelectedProperties(prev => {
          const newMap = new Map(prev)
          newMap.set(propertyId, currentState)
          return newMap
        })
      }
    } catch (error) {
      console.error('Error saving color state:', error)
      // Revert local state on error
      setTaxSelectedProperties(prev => {
        const newMap = new Map(prev)
        newMap.set(propertyId, currentState)
        return newMap
      })
    }
  }

  const dashboardView = resolveProtectedDataView({
    authStatus: auth.status,
    loading,
    httpStatus: metricsHttpStatus,
    networkError: metricsNetworkError,
    itemCount: metrics ? 1 : 0,
    emptyMessage: 'Unable to load dashboard',
    loadNoun: 'dashboard',
  })

  if (auth.status === 'loading') {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <p className="text-gray-500 mb-4" data-testid="dashboard-auth-pending">
            Checking sign-in…
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[...Array(4)].map((_, i) => (
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

  if (loading || dashboardView.kind === 'data_pending') {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <p className="text-gray-500 mb-4" data-testid="dashboard-data-pending">
            Loading dashboard…
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[...Array(4)].map((_, i) => (
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

  if (
    dashboardView.kind === 'sign_in_required' ||
    dashboardView.kind === 'session_expired'
  ) {
    return (
      <div className="p-6 text-center space-y-3" data-testid="dashboard-auth-required">
        <p className="text-gray-700 font-medium">{dashboardView.message}</p>
        <a
          href={logoutRedirectPath()}
          className="inline-block px-4 py-2 bg-slate-900 text-white rounded-md text-sm"
        >
          Sign In
        </a>
      </div>
    )
  }

  if (
    dashboardView.kind === 'access_denied' ||
    dashboardView.kind === 'unable_to_load' ||
    dashboardView.kind === 'network_failure' ||
    !metrics
  ) {
    return (
      <div className="p-6 text-center space-y-3" data-testid="dashboard-load-error">
        <p className="text-gray-700 font-medium">
          {dashboardView.kind === 'ready' || dashboardView.kind === 'empty'
            ? 'Unable to load dashboard'
            : dashboardView.message}
        </p>
        <button
          type="button"
          onClick={() => void fetchDashboardData()}
          className="inline-block px-4 py-2 bg-blue-600 text-white rounded-md text-sm"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 min-w-0 max-w-full">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold text-gray-900">Dashboard 1.4</h1>
          <p className="text-gray-600 mt-2">Rental properties overview</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <MissingInformationButton />
          <button
          onClick={() => fetchDashboardData(true)}
          disabled={refreshing}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Refresh dashboard data"
        >
          <ArrowPathIcon className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
          <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
        </button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div 
          className="bg-white p-6 rounded-lg shadow cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setShowOccupiedModal(true)}
        >
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <HomeIcon className="h-8 w-8 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Has Tenants / Total Properties</p>
              <p className="text-2xl font-semibold text-gray-900">
                {metrics?.occupiedProperties || 0} / {metrics?.totalProperties || 0}
              </p>
              <p className="text-xs text-blue-600 mt-1 font-medium">Click to view/edit</p>
            </div>
          </div>
        </div>

        <div 
          className="bg-white p-6 rounded-lg shadow cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setShowMonthlyIncomeModal(true)}
        >
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <CurrencyDollarIcon className="h-8 w-8 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Monthly Income</p>
              <p className="text-2xl font-semibold text-gray-900">
                {formatWholeDollarDisplay(metrics?.monthlyIncome)}{' '}
                <span className="text-lg font-medium">({metrics?.occupiedProperties || 0})</span>
              </p>
              <p className="text-xs text-green-600 mt-1 font-medium">Click to view/edit</p>
            </div>
          </div>
        </div>

        <div 
          className="bg-white p-6 rounded-lg shadow cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setShowPotentialIncomeModal(true)}
        >
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <CurrencyDollarIcon className="h-8 w-8 text-indigo-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Potential Income</p>
              <p className="text-2xl font-semibold text-gray-900" data-testid="dashboard-potential-income">
                ${(metrics?.potentialIncome || 0).toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 mt-1" data-testid="dashboard-potential-income-count">
                {potentialIncomeRows.length} qualifying properties
              </p>
              <p className="text-xs text-indigo-600 mt-1 font-medium">Click to view/edit</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow" data-testid="dashboard-profit-card">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <CurrencyDollarIcon className="h-8 w-8 text-emerald-600" />
            </div>
            <div className="ml-4 flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-500 mb-1.5">Profit</p>
              <div className="space-y-1">
                <div className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                  <span className="text-gray-600">Current:</span>{' '}
                  <span className={metrics?.currentProfit && metrics.currentProfit >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {formatWholeDollarDisplay(metrics?.currentProfit)}
                  </span>
                </div>
                <div className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                  <span className="text-gray-600">Potential:</span>{' '}
                  <span className={metrics?.potentialProfit && metrics.potentialProfit >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {formatWholeDollarDisplay(metrics?.potentialProfit)}
                  </span>
                </div>
                <div className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                  <span className="text-gray-600">Full / No Debt:</span>{' '}
                  <span className={metrics?.potentialProfitNoHouseDebt && metrics.potentialProfitNoHouseDebt >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {formatWholeDollarDisplay(metrics?.potentialProfitNoHouseDebt)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowProfitCalculation((v) => !v)}
                className="mt-2 text-xs font-medium text-emerald-700 hover:text-emerald-900"
                data-testid="dashboard-profit-view-calculation"
              >
                {showProfitCalculation ? 'Hide calculation' : 'View calculation'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showProfitCalculation && profitBreakdown && (
        <div className="bg-white rounded-lg shadow p-6 mb-8 space-y-4" data-testid="dashboard-profit-breakdown">
          <h2 className="text-lg font-semibold text-gray-900">Profit calculation</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="rounded-lg bg-gray-50 p-4 space-y-1">
              <p className="font-semibold text-gray-900">Current</p>
              <p>Occupied rent: {formatWholeDollarDisplay(profitBreakdown.occupiedMonthlyIncome)}</p>
              <p>Misc income (month): {formatWholeDollarDisplay(profitBreakdown.currentMonthMiscIncome)}</p>
              <p>− Insurance: {formatWholeDollarDisplay(profitBreakdown.monthlyInsurance)}</p>
              <p>− Taxes: {formatWholeDollarDisplay(profitBreakdown.monthlyTaxes)}</p>
              <p>− Recurring: {formatWholeDollarDisplay(profitBreakdown.recurringMonthlyPayments)}</p>
              <p>− One-time (month): {formatWholeDollarDisplay(profitBreakdown.currentMonthOneTimeExpenses)}</p>
              <p className="font-semibold pt-1">= {formatWholeDollarDisplay(profitBreakdown.currentProfit)}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-4 space-y-1">
              <p className="font-semibold text-gray-900">Potential</p>
              <p>Current profit: {formatWholeDollarDisplay(profitBreakdown.currentProfit)}</p>
              <p>+ Potential rent: {formatWholeDollarDisplay(profitBreakdown.qualifyingPotentialIncome)}</p>
              <p className="font-semibold pt-1">= {formatWholeDollarDisplay(profitBreakdown.potentialProfit)}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-4 space-y-1">
              <p className="font-semibold text-gray-900">Full / No Debt</p>
              <p>Potential: {formatWholeDollarDisplay(profitBreakdown.potentialProfit)}</p>
              <p>+ Balance &gt; $0 monthly payments: {formatWholeDollarDisplay(profitBreakdown.fullNoDebtBalanceAddBacks)}</p>
              <p className="font-semibold pt-1">= {formatWholeDollarDisplay(profitBreakdown.fullNoDebtProfit)}</p>
            </div>
          </div>

          {(
            [
              ['Misc income (current month)', profitBreakdown.contributing.miscIncome],
              ['Recurring monthly payments', profitBreakdown.contributing.recurringAll],
              ['Full / No Debt add-backs (balance > $0)', profitBreakdown.contributing.fullNoDebtAddBacks],
              ['One-time expenses (current month)', profitBreakdown.contributing.oneTimeCurrentMonth],
            ] as const
          ).map(([title, rows]) => (
            <div key={title}>
              <p className="text-sm font-medium text-gray-900 mb-2">{title}</p>
              {rows.length === 0 ? (
                <p className="text-xs text-gray-500">None</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Category / description</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Date</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500">Monthly / amount</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500">Balance</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500">Amount Owed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {rows.map((row) => (
                        <tr key={`${title}-${row.id || row.description}-${row.applicableDate}`}>
                          <td className="px-3 py-2 text-gray-900">
                            <div className="font-medium">{row.category || '—'}</div>
                            {row.description && row.description !== row.category && (
                              <div className="text-gray-500">{row.description}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-600">{row.applicableDate || '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-900">
                            {formatWholeDollarDisplay(row.amount)}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">
                            {row.balance == null ? '—' : formatWholeDollarDisplay(row.balance)}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">
                            {row.amountOwed == null ? '—' : formatWholeDollarDisplay(row.amountOwed)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Property Type Breakdown */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Type Breakdown</h2>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="bg-gray-100 rounded-lg p-4 mb-2">
              <p className="text-2xl font-bold text-gray-900">{metrics?.totalProperties || 0}</p>
            </div>
            <p className="text-sm text-gray-600">Total</p>
          </div>
          
          <div className="text-center">
            <div className="bg-green-100 rounded-lg p-4 mb-2">
              <p className="text-2xl font-bold text-green-800">{metrics?.propertyTypeBreakdown?.house || 0}</p>
            </div>
            <p className="text-sm text-gray-600">House</p>
          </div>
          
          <div className="text-center">
            <div className="bg-purple-100 rounded-lg p-4 mb-2">
              <p className="text-2xl font-bold text-purple-800">{metrics?.propertyTypeBreakdown?.doublewide || 0}</p>
            </div>
            <p className="text-sm text-gray-600">Doublewide</p>
          </div>
          
          <div className="text-center">
            <div className="bg-orange-100 rounded-lg p-4 mb-2">
              <p className="text-2xl font-bold text-orange-800">{metrics?.propertyTypeBreakdown?.singlewide || 0}</p>
            </div>
            <p className="text-sm text-gray-600">Singlewide</p>
          </div>
        </div>
      </div>

      {/* Properties Neither Occupied nor Qualifying */}
      <div className="bg-white rounded-lg shadow p-6 mb-6" data-testid="neither-occupied-nor-qualifying">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Properties Neither Occupied nor Qualifying{' '}
          <span className="text-gray-500 font-medium" data-testid="neither-occupied-nor-qualifying-count">
            ({metrics?.neitherOccupiedNorQualifyingCount ?? 0})
          </span>
        </h2>

        {(metrics?.neitherOccupiedNorQualifyingRows || []).length === 0 ? (
          <p className="text-sm text-gray-500" data-testid="neither-occupied-nor-qualifying-empty">
            All properties are occupied or qualifying for potential income.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Address
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Current lease status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Saved Rent Value
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Reason not qualifying
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {(metrics?.neitherOccupiedNorQualifyingRows || []).map((row) => (
                  <tr
                    key={row.propertyId}
                    className="hover:bg-gray-50"
                    data-testid="neither-occupied-nor-qualifying-row"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {row.address}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {row.currentLeaseStatus}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900">
                      {row.savedRentValue == null
                        ? '—'
                        : row.savedRentValue.toLocaleString('en-US', {
                            style: 'currency',
                            currency: 'USD',
                          })}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {row.reasonNotQualifying}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Potential Income Properties */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Potential Income Properties</h2>
          <button
            onClick={() => setShowPotentialIncomeSection(!showPotentialIncomeSection)}
            className="text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-2"
          >
            {showPotentialIncomeSection ? (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
                Hide
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                Show
              </>
            )}
          </button>
        </div>
        
        {showPotentialIncomeSection && (
          <div className="mt-4">
            {potentialIncomeRows.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No properties with potential income found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Property
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Potential Income
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {potentialIncomeRows.map((row, index) => (
                      <tr key={row.leaseId || `${row.status}-${row.propertyId}-${index}`} className="hover:bg-gray-50" data-testid="potential-income-list-row">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{row.propertyName || 'Unnamed Property'}</div>
                          {row.address && (
                            <div className="text-sm text-gray-500">{row.address}</div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm capitalize text-gray-600">
                          {row.status}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-indigo-600">
                          {row.monthlyPotential.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                        </td>
                      </tr>
                    ))}
                    {potentialIncomeRows.length > 0 && (
                      <tr className="bg-gray-100 font-semibold">
                        <td colSpan={2} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          Total Potential Income
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-indigo-600">
                          {(metrics?.potentialIncome || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick Actions — type + shared search apply to Insurance and Property Tax lists */}
      <div className="mt-8 flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-center">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center flex-1 min-w-0">
          <div className="relative shrink-0">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="pl-3 pr-8 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Types</option>
              <option value="house">House</option>
              <option value="doublewide">Doublewide</option>
              <option value="singlewide">Singlewide</option>
            </select>
          </div>
          <input
            type="text"
            placeholder="Search insurance & property tax (name, owner, county, map ID, trailer, provider, policy)…"
            value={overviewSearchTerm}
            onChange={(e) => setOverviewSearchTerm(e.target.value)}
            className="w-full min-w-0 sm:min-w-[280px] sm:max-w-xl flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        
        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center shrink-0">
          <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Add Property
        </button>
      </div>

      {/* Insurance Overview Section */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Insurance Overview</h2>
          <button
            onClick={() => setShowInsuranceSection(!showInsuranceSection)}
            className="text-green-600 hover:text-green-800 font-medium"
          >
            {showInsuranceSection ? 'Hide Details' : 'Show Details'}
          </button>
        </div>
        
        {showInsuranceSection && (
          <div className="space-y-2">
            {/* Insurance List Header */}
            <div className="bg-gray-100 p-3 rounded-lg border font-medium text-sm text-gray-700">
              <div className="grid gap-2" style={{ gridTemplateColumns: '2fr 1.5fr 1.5fr 1fr' }}>
                <div 
                  className="cursor-pointer hover:bg-gray-200 px-2 py-1 rounded flex items-center"
                  onClick={() => handleInsuranceSort('name')}
                >
                  Property Name
                  {insuranceSortField === 'name' && (
                    <span className="ml-1">{insuranceSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
                <div 
                  className="cursor-pointer hover:bg-gray-200 px-2 py-1 rounded flex items-center"
                  onClick={() => handleInsuranceSort('insurance_provider')}
                >
                  Provider
                  {insuranceSortField === 'insurance_provider' && (
                    <span className="ml-1">{insuranceSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
                <div 
                  className="cursor-pointer hover:bg-gray-200 px-2 py-1 rounded flex items-center"
                  onClick={() => handleInsuranceSort('insurance_policy_number')}
                >
                  Policy Number
                  {insuranceSortField === 'insurance_policy_number' && (
                    <span className="ml-1">{insuranceSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
                <div 
                  className="cursor-pointer hover:bg-gray-200 px-2 py-1 rounded flex items-center"
                  onClick={() => handleInsuranceSort('insurance_premium')}
                >
                  Premium
                  {insuranceSortField === 'insurance_premium' && (
                    <span className="ml-1">{insuranceSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-2">
              {getOverviewRowsUnsorted().length} properties (same count as Property Tax below)
            </p>
            
            {/* Insurance List */}
            {getSortedInsuranceProperties().length === 0 ? (
              <div className="text-center py-8 text-gray-500 space-y-2">
                <p>
                  {overviewSearchTerm.trim()
                    ? `No matches for this search (${getOverviewTypeFilteredRows().length} properties match type filter; clear search to see all).`
                    : `No properties in overview (${getOverviewTypeFilteredRows().length}).`}
                </p>
                {overviewSearchTerm.trim() ? (
                  <button
                    type="button"
                    onClick={() => setOverviewSearchTerm('')}
                    className="text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Clear search
                  </button>
                ) : null}
              </div>
            ) : (
              getSortedInsuranceProperties().map((property) => (
                <div key={property.id} className="bg-gray-50 p-4 rounded-lg border cursor-pointer hover:bg-gray-100">
                <div className="grid gap-2 items-center" style={{ gridTemplateColumns: '2fr 1.5fr 1.5fr 1fr' }}>
                  <div className="font-medium text-sm">{property.name}</div>
                  <div className="text-xs text-gray-500">
                    <span 
                      onDoubleClick={() => handleDoubleClick(property, 'insurance_provider')}
                      className="hover:bg-yellow-100 px-1 rounded cursor-pointer"
                    >
                      {editingProperty?.id === property.id && editingField === 'insurance_provider' ? (
                        <input
                          type="text"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={handleSaveEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit()
                            if (e.key === 'Escape') handleCancelEdit()
                          }}
                          className="text-xs border rounded px-1 w-full"
                          autoFocus
                        />
                      ) : displayInsuranceField(property.insurance_provider)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    <span 
                      onDoubleClick={() => handleDoubleClick(property, 'insurance_policy_number')}
                      className="hover:bg-yellow-100 px-1 rounded cursor-pointer"
                    >
                      {editingProperty?.id === property.id && editingField === 'insurance_policy_number' ? (
                        <input
                          type="text"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={handleSaveEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit()
                            if (e.key === 'Escape') handleCancelEdit()
                          }}
                          className="text-xs border rounded px-1 w-full"
                          autoFocus
                        />
                      ) : displayInsuranceField(property.insurance_policy_number)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    <span 
                      onDoubleClick={() => handleDoubleClick(property, 'insurance_premium')}
                      className="hover:bg-yellow-100 px-1 rounded cursor-pointer"
                    >
                      {editingProperty?.id === property.id && editingField === 'insurance_premium' ? (
                        <input
                          type="number"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={handleSaveEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit()
                            if (e.key === 'Escape') handleCancelEdit()
                          }}
                          className="text-xs border rounded px-1 w-full"
                          autoFocus
                        />
                      ) : formatInsurancePremium(property.insurance_premium)}
                    </span>
                  </div>
                </div>
              </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Tax Overview Section */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-4 mb-2">
              <h2 className="text-xl font-semibold text-gray-900">Property Tax Overview</h2>
              <div className="flex items-center gap-3 text-xs flex-wrap">
                <span className="font-medium text-gray-600">Colors:</span>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded border border-yellow-500 bg-yellow-300"></div>
                  <span className="text-gray-600">Yellow: Customer</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded border border-green-800 bg-green-800"></div>
                  <span className="text-gray-600">Dark green: Bank</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded border border-lime-500 bg-lime-400"></div>
                  <span className="text-gray-600">Lime: HHS</span>
                </div>
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowTaxSection(!showTaxSection)}
            className="text-purple-600 hover:text-purple-800 font-medium ml-4"
          >
            {showTaxSection ? 'Hide Details' : 'Show Details'}
          </button>
        </div>
        
        {showTaxSection && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 mb-2">
              {getOverviewRowsUnsorted().length} properties (same count as Insurance above; search is next to the type filter).
              Double-click a year amount to set the bill. The box under it is the amount paid. A covered bill turns green with a line through it, and you can click that amount to change what was paid. The years roll forward in May. A mobile home lists land and home in each year.
            </p>
            {/* Tax List Header */}
            <div className="bg-gray-100 p-3 rounded-lg border font-medium text-sm text-gray-700">
              <div className="grid gap-2" style={{ gridTemplateColumns: TAX_GRID_COLUMNS }}>
                <div 
                  className="cursor-pointer hover:bg-gray-200 px-2 py-1 rounded flex items-center justify-center"
                  onClick={() => handleTaxSort('color_state')}
                >
                  <span className="text-xs">Color</span>
                  {taxSortField === 'color_state' && (
                    <span className="ml-1">{taxSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
                <div 
                  className="cursor-pointer hover:bg-gray-200 px-2 py-1 rounded flex items-center"
                  onClick={() => handleTaxSort('name')}
                >
                  Property Name
                  {taxSortField === 'name' && (
                    <span className="ml-1">{taxSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
                <div 
                  className="cursor-pointer hover:bg-gray-200 px-2 py-1 rounded flex items-center"
                  onClick={() => handleTaxSort('owner_name')}
                >
                  Owner
                  {taxSortField === 'owner_name' && (
                    <span className="ml-1">{taxSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
                <div 
                  className="cursor-pointer hover:bg-gray-200 px-2 py-1 rounded flex items-center"
                  onClick={() => handleTaxSort('county')}
                >
                  County
                  {taxSortField === 'county' && (
                    <span className="ml-1">{taxSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
                <div 
                  className="cursor-pointer hover:bg-gray-200 px-2 py-1 rounded flex flex-col items-start"
                  onClick={() => handleTaxSort('property_tax')}
                >
                  <span>
                    Monthly Taxes
                    {taxSortField === 'property_tax' && (
                      <span className="ml-1">{taxSortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </span>
                  <span className="text-xs font-semibold text-gray-900">
                    {formatTaxMoney(getSortedTaxProperties().reduce((sum, property) => (
                      sum + currentYearMonthlyTax(
                        property,
                        new Date(),
                        normalizeTaxColorState(taxSelectedProperties.get(property.id) ?? property.tax_color_state),
                      )
                    ), 0))}
                  </span>
                </div>
                {taxYearsForDate(new Date()).map((year) => (
                  <div
                    key={year}
                    className="cursor-pointer hover:bg-gray-200 px-2 py-1 rounded flex items-center"
                    onClick={() => handleTaxSort(`tax_year_${year}`)}
                  >
                    {year}
                    {taxSortField === `tax_year_${year}` && (
                      <span className="ml-1">{taxSortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                ))}
                <div 
                  className="cursor-pointer hover:bg-gray-200 px-2 py-1 rounded flex items-center"
                  onClick={() => handleTaxSort('Map_ID')}
                >
                  Map ID
                  {taxSortField === 'Map_ID' && (
                    <span className="ml-1">{taxSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
                <div 
                  className="cursor-pointer hover:bg-gray-200 px-2 py-1 rounded flex items-center"
                  onClick={() => handleTaxSort('map_id_trailer')}
                >
                  Mobile Home ID
                  {taxSortField === 'map_id_trailer' && (
                    <span className="ml-1">{taxSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </div>
            </div>
            
            {/* Tax List */}
            {getSortedTaxProperties().length === 0 ? (
              <div className="text-center py-8 text-gray-500 space-y-2">
                <p>
                  {overviewSearchTerm.trim()
                    ? `No matches for this search (${getOverviewTypeFilteredRows().length} properties match type filter; clear search to see all).`
                    : `No properties in overview (${getOverviewTypeFilteredRows().length}).`}
                </p>
                {overviewSearchTerm.trim() ? (
                  <button
                    type="button"
                    onClick={() => setOverviewSearchTerm('')}
                    className="text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Clear search
                  </button>
                ) : null}
              </div>
            ) : (
              getSortedTaxProperties().map((property) => {
                const colorState = normalizeTaxColorState(taxSelectedProperties.get(property.id) ?? property.tax_color_state)
                const rowColor = getTaxRowColor(colorState)
                const taxAsOf = new Date()
                const monthlyTaxOwed = currentYearMonthlyTax(property, taxAsOf, colorState)
                const isMobileHome = isMobileHomeType(property.property_type)
                const taxYears = taxYearsForDate(taxAsOf)
                const landLedger = landTaxLedger(property, taxAsOf)
                const homeLedger = homeTaxLedger(property, taxAsOf)

                const darkTaxRow = colorState === 7
                const taxCellText = darkTaxRow ? 'text-xs text-white' : 'text-xs text-gray-500'
                const taxNameText = darkTaxRow
                  ? 'font-medium text-sm text-white break-words whitespace-normal leading-snug'
                  : 'font-medium text-sm break-words whitespace-normal leading-snug'
                
                return (
                <div key={property.id} className={`${rowColor} p-4 rounded-lg border cursor-pointer hover:opacity-90`}>
                <div className="grid gap-2 items-start" style={{ gridTemplateColumns: TAX_GRID_COLUMNS }}>
                  <div className="flex items-center justify-center self-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleTaxToggle(property.id)
                      }}
                      className={`w-4 h-4 rounded border-2 ${
                        colorState === 1
                          ? 'border-yellow-500 bg-yellow-300'
                          : colorState === 3
                          ? 'border-lime-500 bg-lime-400'
                          : colorState === 7
                          ? 'border-green-800 bg-green-800'
                          : 'border-gray-300 bg-gray-100'
                      } hover:opacity-80 focus:outline-none`}
                      title={colorState === 1 ? 'Yellow: Customer' : colorState === 7 ? 'Dark green: Bank' : colorState === 3 ? 'Lime: HHS' : 'No color'}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className={taxNameText}>{property.name}</div>
                    {isMobileHome ? (
                      <div className={darkTaxRow ? 'text-[10px] text-white/80' : 'text-[10px] text-gray-600'}>
                        {property.property_type === 'doublewide' ? 'Mobile home · double wide' : 'Mobile home · single wide'}
                      </div>
                    ) : null}
                  </div>
                  <div className={`${taxCellText} min-w-0 break-words`}>
                    <span 
                      onDoubleClick={() => handleDoubleClick(property, 'owner_name')}
                      className="hover:bg-yellow-100 px-1 rounded cursor-pointer break-words"
                    >
                      {editingProperty?.id === property.id && editingField === 'owner_name' ? (
                        <input
                          type="text"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={handleSaveEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit()
                            if (e.key === 'Escape') handleCancelEdit()
                          }}
                          className="text-xs border rounded px-1 w-full"
                          autoFocus
                        />
                      ) : (property.owner_name || 'Not set')}
                    </span>
                  </div>
                  <div className={taxCellText}>
                    <span 
                      onDoubleClick={() => handleDoubleClick(property, 'county')}
                      className="hover:bg-yellow-100 px-1 rounded cursor-pointer"
                    >
                      {editingProperty?.id === property.id && editingField === 'county' ? (
                        <input
                          type="text"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={handleSaveEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit()
                            if (e.key === 'Escape') handleCancelEdit()
                          }}
                          className="text-xs border rounded px-1 w-full"
                          autoFocus
                        />
                      ) : (property.county || 'Not set')}
                    </span>
                  </div>
                  <div className={taxCellText}>
                    <span className="px-1 rounded">
                      ${monthlyTaxOwed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  {taxYears.map((year) => {
                    const yearKey = String(year)
                    const landEntry = landLedger[yearKey] ?? { owed: null, paid: 0 }
                    const homeEntry = homeLedger[yearKey] ?? { owed: null, paid: 0 }
                    return (
                      <div key={year} className={taxCellText}>
                        <TaxYearAmount
                          entry={landEntry}
                          dark={darkTaxRow}
                          label={isMobileHome ? 'Land' : undefined}
                          onCommit={(next) => saveTaxYear(property, 'land', year, next)}
                        />
                        {isMobileHome ? (
                          <div className="mt-2">
                            <TaxYearAmount
                              entry={homeEntry}
                              dark={darkTaxRow}
                              label="Home"
                              onCommit={(next) => saveTaxYear(property, 'home', year, next)}
                            />
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                  <div className={taxCellText}>
                    <span 
                      onDoubleClick={() => handleDoubleClick(property, 'Map_ID')}
                      className="hover:bg-yellow-100 px-1 rounded cursor-pointer"
                    >
                      {editingProperty?.id === property.id && editingField === 'Map_ID' ? (
                        <input
                          type="text"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={handleSaveEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit()
                            if (e.key === 'Escape') handleCancelEdit()
                          }}
                          className="text-xs border rounded px-1 w-full"
                          autoFocus
                        />
                      ) : (property.Map_ID || 'Not set')}
                    </span>
                  </div>
                  <div className={taxCellText}>
                    {isMobileHome ? (
                      <span
                        onDoubleClick={() => handleDoubleClick(property, 'map_id_trailer')}
                        className="hover:bg-yellow-100 px-1 rounded cursor-pointer"
                      >
                        {editingProperty?.id === property.id && editingField === 'map_id_trailer' ? (
                          <input
                            type="text"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={handleSaveEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit()
                              if (e.key === 'Escape') handleCancelEdit()
                            }}
                            className="text-xs border rounded px-1 w-full"
                            autoFocus
                          />
                        ) : (property.map_id_trailer || 'Not set')}
                      </span>
                    ) : (
                      <span className="px-1">N/A</span>
                    )}
                  </div>
                </div>
              </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* Potential Income Modal */}
      {showPotentialIncomeModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Potential Income Properties</h2>
                <p className="text-sm text-gray-600 mt-1">Edit empty-property rent_value; eviction rent is read-only</p>
              </div>
              <button
                onClick={() => {
                  setShowPotentialIncomeModal(false)
                  setEditingRentValue(null)
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <div className="px-6 py-4 overflow-y-auto flex-1">
              {potentialIncomeRows.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No properties with potential income found.
                </div>
              ) : (
                <>
                  {/* Sort Controls */}
                  <div className="mb-4 flex flex-wrap gap-4 items-center">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-gray-700">Sort by:</label>
                      <select
                        value={emptyPropertiesSortField}
                        onChange={(e) => setEmptyPropertiesSortField(e.target.value as 'property' | 'address' | 'rent')}
                        className="border border-gray-300 rounded-md px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="property">Property</option>
                        <option value="address">Address</option>
                        <option value="rent">Rent</option>
                      </select>
                      <button
                        onClick={() => setEmptyPropertiesSortDirection(emptyPropertiesSortDirection === 'asc' ? 'desc' : 'asc')}
                        className="px-2 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                        title={emptyPropertiesSortDirection === 'asc' ? 'Ascending' : 'Descending'}
                      >
                        {emptyPropertiesSortDirection === 'asc' ? '↑' : '↓'}
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th 
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                            onClick={() => {
                              setEmptyPropertiesSortField('property')
                              setEmptyPropertiesSortDirection(emptyPropertiesSortField === 'property' && emptyPropertiesSortDirection === 'asc' ? 'desc' : 'asc')
                            }}
                          >
                            Property {emptyPropertiesSortField === 'property' && (emptyPropertiesSortDirection === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                            onClick={() => {
                              setEmptyPropertiesSortField('address')
                              setEmptyPropertiesSortDirection(emptyPropertiesSortField === 'address' && emptyPropertiesSortDirection === 'asc' ? 'desc' : 'asc')
                            }}
                          >
                            Address {emptyPropertiesSortField === 'address' && (emptyPropertiesSortDirection === 'asc' ? '↑' : '↓')}
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Status
                          </th>
                          <th 
                            className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                            onClick={() => {
                              setEmptyPropertiesSortField('rent')
                              setEmptyPropertiesSortDirection(emptyPropertiesSortField === 'rent' && emptyPropertiesSortDirection === 'asc' ? 'desc' : 'asc')
                            }}
                          >
                            Potential Rent (Monthly) {emptyPropertiesSortField === 'rent' && (emptyPropertiesSortDirection === 'asc' ? '↑' : '↓')}
                          </th>
                          <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {(() => {
                          const sortedRows = [...potentialIncomeRows].sort((a, b) => {
                            let aValue: any
                            let bValue: any
                            
                            switch (emptyPropertiesSortField) {
                              case 'property':
                                aValue = (a.propertyName || '').toLowerCase()
                                bValue = (b.propertyName || '').toLowerCase()
                                break
                              case 'address':
                                aValue = (a.address || '').toLowerCase()
                                bValue = (b.address || '').toLowerCase()
                                break
                              case 'rent':
                                aValue = a.monthlyPotential
                                bValue = b.monthlyPotential
                                break
                              default:
                                return 0
                            }
                            
                            if (aValue < bValue) return emptyPropertiesSortDirection === 'asc' ? -1 : 1
                            if (aValue > bValue) return emptyPropertiesSortDirection === 'asc' ? 1 : -1
                            return 0
                          })
                          
                          return sortedRows.map((row, index) => (
                        <tr key={row.leaseId || `${row.status}-${row.propertyId}-${index}`} className="hover:bg-gray-50" data-testid="potential-income-modal-row">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{row.propertyName || 'Unnamed Property'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">{row.address || 'N/A'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm capitalize text-gray-600">
                            {row.status}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            {row.status === 'empty' && editingRentValue?.propertyId === row.propertyId ? (
                              <input
                                type="number"
                                step="0.01"
                                value={editingRentValue.value}
                                onChange={(e) => setEditingRentValue({ propertyId: row.propertyId, value: e.target.value })}
                                onBlur={async () => {
                                  const newValue = parseFloat(editingRentValue.value) || 0
                                  try {
                                    const response = await fetch(`/api/properties/${row.propertyId}`, {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ rent_value: newValue })
                                    })
                                    if (response.ok) {
                                      await fetchDashboardData(true)
                                    } else {
                                      alert('Failed to update rent value')
                                    }
                                  } catch (error) {
                                    console.error('Error updating rent value:', error)
                                    alert('Error updating rent value')
                                  }
                                  setEditingRentValue(null)
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.currentTarget.blur()
                                  } else if (e.key === 'Escape') {
                                    setEditingRentValue(null)
                                  }
                                }}
                                className="text-sm text-right border rounded px-2 py-1 w-32"
                                autoFocus
                              />
                            ) : (
                              <div 
                                className={`text-sm font-semibold ${row.status === 'empty' ? 'text-indigo-600 cursor-pointer hover:text-indigo-800' : 'text-orange-700'}`}
                                onClick={row.status === 'empty' ? () => setEditingRentValue({ propertyId: row.propertyId, value: row.monthlyPotential.toString() }) : undefined}
                              >
                                {row.monthlyPotential.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            {row.status === 'empty' ? (
                              <button
                                onClick={() => setEditingRentValue({ propertyId: row.propertyId, value: row.monthlyPotential.toString() })}
                                className="text-blue-600 hover:text-blue-900"
                                title="Edit rent value"
                              >
                                <PencilIcon className="h-4 w-4" />
                              </button>
                            ) : (
                              <span className="text-xs text-gray-500">Lease rent</span>
                            )}
                          </td>
                          </tr>
                          ))
                        })()}
                        {potentialIncomeRows.length > 0 && (
                          <tr className="bg-gray-100 font-semibold">
                            <td colSpan={3} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              Total Potential Income
                            </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-indigo-600" data-testid="potential-income-modal-total">
                              {(metrics?.potentialIncome || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                            </td>
                            <td></td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => {
                  setShowPotentialIncomeModal(false)
                  setEditingRentValue(null)
                }}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Properties with Tenants Modal */}
      {showOccupiedModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Properties with Tenants</h2>
                <p className="text-sm text-gray-600 mt-1">Properties with active leases</p>
              </div>
              <button
                onClick={() => setShowOccupiedModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <div className="px-6 py-4 overflow-y-auto flex-1">
              {occupiedProperties.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No properties found.
                </div>
              ) : (
                <>
                  {/* Filter and Sort Controls */}
                  <div className="mb-4 flex flex-wrap gap-4 items-center">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-gray-700">Filter by Type:</label>
                      <select
                        value={occupiedPropertiesTypeFilter}
                        onChange={(e) => setOccupiedPropertiesTypeFilter(e.target.value)}
                        className="border border-gray-300 rounded-md px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="all">All</option>
                        <option value="house">House</option>
                        <option value="doublewide">Doublewide</option>
                        <option value="singlewide">Singlewide</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-gray-700">Sort by:</label>
                      <select
                        value={occupiedPropertiesSortField}
                        onChange={(e) => setOccupiedPropertiesSortField(e.target.value as 'property' | 'address' | 'type')}
                        className="border border-gray-300 rounded-md px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="property">Property</option>
                        <option value="address">Address</option>
                        <option value="type">Type</option>
                        <option value="hasTenants">Has Tenants</option>
                      </select>
                      <button
                        onClick={() => setOccupiedPropertiesSortDirection(occupiedPropertiesSortDirection === 'asc' ? 'desc' : 'asc')}
                        className="px-2 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                        title={occupiedPropertiesSortDirection === 'asc' ? 'Ascending' : 'Descending'}
                      >
                        {occupiedPropertiesSortDirection === 'asc' ? '↑' : '↓'}
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th 
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                            onClick={() => {
                              setOccupiedPropertiesSortField('property')
                              setOccupiedPropertiesSortDirection(occupiedPropertiesSortField === 'property' && occupiedPropertiesSortDirection === 'asc' ? 'desc' : 'asc')
                            }}
                          >
                            Property {occupiedPropertiesSortField === 'property' && (occupiedPropertiesSortDirection === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                            onClick={() => {
                              setOccupiedPropertiesSortField('address')
                              setOccupiedPropertiesSortDirection(occupiedPropertiesSortField === 'address' && occupiedPropertiesSortDirection === 'asc' ? 'desc' : 'asc')
                            }}
                          >
                            Address {occupiedPropertiesSortField === 'address' && (occupiedPropertiesSortDirection === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                            onClick={() => {
                              setOccupiedPropertiesSortField('type')
                              setOccupiedPropertiesSortDirection(occupiedPropertiesSortField === 'type' && occupiedPropertiesSortDirection === 'asc' ? 'desc' : 'asc')
                            }}
                          >
                            Type {occupiedPropertiesSortField === 'type' && (occupiedPropertiesSortDirection === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                            onClick={() => {
                              setOccupiedPropertiesSortField('hasTenants')
                              setOccupiedPropertiesSortDirection(occupiedPropertiesSortField === 'hasTenants' && occupiedPropertiesSortDirection === 'asc' ? 'desc' : 'asc')
                            }}
                          >
                            Has Tenants {occupiedPropertiesSortField === 'hasTenants' && (occupiedPropertiesSortDirection === 'asc' ? '↑' : '↓')}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {(() => {
                          // Filter by type
                          let filteredProperties = occupiedProperties.filter(property => {
                            if (occupiedPropertiesTypeFilter === 'all') return true
                            return (property.property_type || '').toLowerCase() === occupiedPropertiesTypeFilter.toLowerCase()
                          })
                          
                          // Sort properties
                          filteredProperties = [...filteredProperties].sort((a, b) => {
                            let aValue: any
                            let bValue: any
                            
                            switch (occupiedPropertiesSortField) {
                              case 'property':
                                aValue = (a.name || '').toLowerCase()
                                bValue = (b.name || '').toLowerCase()
                                break
                              case 'address':
                                aValue = (a.address || '').toLowerCase()
                                bValue = (b.address || '').toLowerCase()
                                break
                              case 'type':
                                aValue = (a.property_type || '').toLowerCase()
                                bValue = (b.property_type || '').toLowerCase()
                                break
                              case 'hasTenants':
                                // Sort by hasTenants: true comes before false in ascending
                                aValue = a.hasTenants ? 1 : 0
                                bValue = b.hasTenants ? 1 : 0
                                break
                              default:
                                return 0
                            }
                            
                            if (aValue < bValue) return occupiedPropertiesSortDirection === 'asc' ? -1 : 1
                            if (aValue > bValue) return occupiedPropertiesSortDirection === 'asc' ? 1 : -1
                            return 0
                          })
                          
                          return filteredProperties.map((property) => (
                            <tr key={property.id} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm font-medium text-gray-900">{property.name || 'Unnamed Property'}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-500">{property.address || 'N/A'}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                                  {property.property_type || 'N/A'}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                  property.hasTenants 
                                    ? 'bg-green-100 text-green-800' 
                                    : 'bg-gray-100 text-gray-800'
                                }`}>
                                  {property.hasTenants ? 'Yes' : 'No'}
                                </span>
                              </td>
                            </tr>
                          ))
                        })()}
                        {(() => {
                          // Calculate total from filtered properties
                          const filteredProperties = occupiedProperties.filter(property => {
                            if (occupiedPropertiesTypeFilter === 'all') return true
                            return (property.property_type || '').toLowerCase() === occupiedPropertiesTypeFilter.toLowerCase()
                          })
                          
                          return (
                            <tr className="bg-gray-100 font-semibold">
                              <td colSpan={3} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                Total Properties
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-blue-600">
                                {occupiedProperties.length}
                              </td>
                            </tr>
                          )
                        })()}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowOccupiedModal(false)}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Monthly Income Modal */}
      {showMonthlyIncomeModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Monthly Income - Active Leases</h2>
                <p className="text-sm text-gray-600 mt-1">Income from occupied properties</p>
              </div>
              <button
                onClick={() => setShowMonthlyIncomeModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <div className="px-6 py-4 overflow-y-auto flex-1">
              {monthlyIncomeLeases.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No active leases found.
                </div>
              ) : (
                <>
                  {/* Filter and Sort Controls */}
                  <div className="mb-4 flex flex-wrap gap-4 items-center">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-gray-700">Filter by Cadence:</label>
                      <select
                        value={monthlyIncomeCadenceFilter}
                        onChange={(e) => setMonthlyIncomeCadenceFilter(e.target.value)}
                        className="border border-gray-300 rounded-md px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="all">All</option>
                        <option value="monthly">Monthly</option>
                        <option value="bi-weekly">Bi-Weekly</option>
                        <option value="biweekly">Biweekly</option>
                        <option value="weekly">Weekly</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-gray-700">Sort by:</label>
                      <select
                        value={monthlyIncomeSortField}
                        onChange={(e) => setMonthlyIncomeSortField(e.target.value as 'property' | 'tenant' | 'rent')}
                        className="border border-gray-300 rounded-md px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="property">Property</option>
                        <option value="tenant">Tenant</option>
                        <option value="rent">Rent</option>
                      </select>
                      <button
                        onClick={() => setMonthlyIncomeSortDirection(monthlyIncomeSortDirection === 'asc' ? 'desc' : 'asc')}
                        className="px-2 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                        title={monthlyIncomeSortDirection === 'asc' ? 'Ascending' : 'Descending'}
                      >
                        {monthlyIncomeSortDirection === 'asc' ? '↑' : '↓'}
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th 
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                            onClick={() => {
                              setMonthlyIncomeSortField('property')
                              setMonthlyIncomeSortDirection(monthlyIncomeSortField === 'property' && monthlyIncomeSortDirection === 'asc' ? 'desc' : 'asc')
                            }}
                          >
                            Property {monthlyIncomeSortField === 'property' && (monthlyIncomeSortDirection === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                            onClick={() => {
                              setMonthlyIncomeSortField('tenant')
                              setMonthlyIncomeSortDirection(monthlyIncomeSortField === 'tenant' && monthlyIncomeSortDirection === 'asc' ? 'desc' : 'asc')
                            }}
                          >
                            Tenant {monthlyIncomeSortField === 'tenant' && (monthlyIncomeSortDirection === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                            onClick={() => {
                              setMonthlyIncomeSortField('rent')
                              setMonthlyIncomeSortDirection(monthlyIncomeSortField === 'rent' && monthlyIncomeSortDirection === 'asc' ? 'desc' : 'asc')
                            }}
                          >
                            Rent {monthlyIncomeSortField === 'rent' && (monthlyIncomeSortDirection === 'asc' ? '↑' : '↓')}
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Cadence
                          </th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Monthly Income
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {(() => {
                          // Filter by cadence
                          let filteredLeases = monthlyIncomeLeases.filter(lease => {
                            if (monthlyIncomeCadenceFilter === 'all') return true
                            const cadence = (lease.rent_cadence || 'monthly').toLowerCase()
                            return cadence === monthlyIncomeCadenceFilter.toLowerCase()
                          })
                          
                          // Sort leases
                          filteredLeases = [...filteredLeases].sort((a, b) => {
                            let aValue: any
                            let bValue: any
                            
                            switch (monthlyIncomeSortField) {
                              case 'property':
                                aValue = (a.RENT_properties?.name || a.RENT_properties?.address || '').toLowerCase()
                                bValue = (b.RENT_properties?.name || b.RENT_properties?.address || '').toLowerCase()
                                break
                              case 'tenant':
                                aValue = (a.RENT_tenants?.full_name || 
                                         (a.RENT_tenants?.first_name && a.RENT_tenants?.last_name ? 
                                           `${a.RENT_tenants.first_name} ${a.RENT_tenants.last_name}` : 
                                           'N/A')).toLowerCase()
                                bValue = (b.RENT_tenants?.full_name || 
                                         (b.RENT_tenants?.first_name && b.RENT_tenants?.last_name ? 
                                           `${b.RENT_tenants.first_name} ${b.RENT_tenants.last_name}` : 
                                           'N/A')).toLowerCase()
                                break
                              case 'rent':
                                aValue = a.rent || 0
                                bValue = b.rent || 0
                                break
                              default:
                                return 0
                            }
                            
                            if (aValue < bValue) return monthlyIncomeSortDirection === 'asc' ? -1 : 1
                            if (aValue > bValue) return monthlyIncomeSortDirection === 'asc' ? 1 : -1
                            return 0
                          })
                          
                          return filteredLeases.map((lease) => {
                        const rent = lease.rent || 0
                        const cadence = lease.rent_cadence || 'monthly'
                        let monthlyIncome = 0
                        switch (cadence.toLowerCase()) {
                          case 'weekly':
                            monthlyIncome = rent * 4
                            break
                          case 'bi-weekly':
                          case 'biweekly':
                            monthlyIncome = rent * 2
                            break
                          case 'monthly':
                          default:
                            monthlyIncome = rent
                            break
                        }
                        return (
                          <tr key={lease.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-gray-900">
                                {lease.RENT_properties?.name || lease.RENT_properties?.address || 'Unknown Property'}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-500">
                                {lease.RENT_tenants?.full_name || 
                                 (lease.RENT_tenants?.first_name && lease.RENT_tenants?.last_name ? 
                                   `${lease.RENT_tenants.first_name} ${lease.RENT_tenants.last_name}` : 
                                   'N/A')}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right">
                              <div className="text-sm font-semibold text-gray-900">
                                ${rent.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">
                                {cadence}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right">
                              <div className="text-sm font-bold text-green-600">
                                ${monthlyIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </div>
                            </td>
                          </tr>
                        )
                          })
                        })()}
                        {(() => {
                          // Calculate total from filtered leases
                          const filteredLeases = monthlyIncomeLeases.filter(lease => {
                            if (monthlyIncomeCadenceFilter === 'all') return true
                            const cadence = (lease.rent_cadence || 'monthly').toLowerCase()
                            return cadence === monthlyIncomeCadenceFilter.toLowerCase()
                          })
                          const total = filteredLeases.reduce((sum, lease) => {
                            const rent = lease.rent || 0
                            const cadence = lease.rent_cadence || 'monthly'
                            let monthlyIncome = 0
                            switch (cadence.toLowerCase()) {
                              case 'weekly':
                                monthlyIncome = rent * 4
                                break
                              case 'bi-weekly':
                              case 'biweekly':
                                monthlyIncome = rent * 2
                                break
                              case 'monthly':
                              default:
                                monthlyIncome = rent
                                break
                            }
                            return sum + monthlyIncome
                          }, 0)
                          
                          return filteredLeases.length > 0 ? (
                            <tr className="bg-gray-100 font-semibold">
                              <td colSpan={4} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                Total Monthly Income
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-green-600">
                                ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            </tr>
                          ) : null
                        })()}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowMonthlyIncomeModal(false)}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
