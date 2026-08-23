'use client'

import { useEffect, useState } from 'react'
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

/** DB sometimes stores -1 as a sentinel for tax paid fields; treat as $0 for display and math */
function effectiveTaxPaid(value: unknown): number {
  const n = parseFloat(String(value ?? ''))
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

function formatTaxPaidCell(value: unknown): string {
  const n = effectiveTaxPaid(value)
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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

  const potentialIncomeRows = metrics?.potentialIncomeRows || []
  
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

      // Process properties
      if (propertiesResponse.ok) {
        const propertiesData = await propertiesResponse.json()
        console.log('Properties data for dashboard:', propertiesData?.length || 0)
        setProperties(propertiesData || [])
        
        // Load color states from properties (including 0 for default state)
        const colorStates = new Map<string, number>()
        propertiesData.forEach((property: any) => {
          // Explicitly check for number type, including 0
          if (typeof property.tax_color_state === 'number') {
            colorStates.set(property.id, property.tax_color_state)
          }
        })
        setTaxSelectedProperties(colorStates)
        
        if (propertiesData && leasesResponse.ok) {
          const leasesData = await leasesResponse.json()

          const newestLeaseByProperty = selectNewestLeaseByProperty<DashboardLeaseRow>(leasesData)
          const soldPropertyIds = new Set<string>()

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
    if (field === 'tax_paid_amount_current' || field === 'tax_paid_amount_previous') {
      const n = effectiveTaxPaid(property[field])
      setEditingValue(property[field] != null && property[field] !== '' ? n.toFixed(2) : '')
    } else if (field === 'property_tax') {
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
      
      // Special handling for taxes_owed field - store directly in tax_owed field
      if (editingField === 'taxes_owed') {
        const newOwed = parseFloat(editingValue) || 0
        // Store the owed amount directly (manual override)
        updateData.tax_owed = newOwed === 0 ? null : parseFloat(newOwed.toFixed(2))
        console.log('Updating owed amount:', {
          propertyId: editingProperty.id,
          newOwed,
          editingValue,
          updateData
        })
      } else {
        // Ensure numeric fields are converted to numbers with proper decimal precision
        if (editingField === 'tax_paid_amount_current' || editingField === 'tax_paid_amount_previous' || editingField === 'property_tax') {
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
      
      // Special handling for sorting by owed amount
      if (taxSortField === 'tax_paid_amount_previous') {
        const annualTaxDueA = ((parseFloat(String(a.property_tax || 0)) * 12))
        const totalPaidA = effectiveTaxPaid(a.tax_paid_amount_current) + effectiveTaxPaid(a.tax_paid_amount_previous)
        const owedA = Math.max(0, annualTaxDueA - totalPaidA)
        
        const annualTaxDueB = ((parseFloat(String(b.property_tax || 0)) * 12))
        const totalPaidB = effectiveTaxPaid(b.tax_paid_amount_current) + effectiveTaxPaid(b.tax_paid_amount_previous)
        const owedB = Math.max(0, annualTaxDueB - totalPaidB)
        
        aValue = owedA
        bValue = owedB
      }
      
      // Special handling for sorting by monthly tax (owed/12)
      if (taxSortField === 'property_tax') {
        const annualTaxDueA = ((parseFloat(String(a.property_tax || 0)) * 12))
        const totalPaidA = effectiveTaxPaid(a.tax_paid_amount_current) + effectiveTaxPaid(a.tax_paid_amount_previous)
        const owedA = Math.max(0, annualTaxDueA - totalPaidA)
        const monthlyOwedA = owedA / 12
        
        const annualTaxDueB = ((parseFloat(String(b.property_tax || 0)) * 12))
        const totalPaidB = effectiveTaxPaid(b.tax_paid_amount_current) + effectiveTaxPaid(b.tax_paid_amount_previous)
        const owedB = Math.max(0, annualTaxDueB - totalPaidB)
        const monthlyOwedB = owedB / 12
        
        aValue = monthlyOwedA
        bValue = monthlyOwedB
      }
      
      if (taxSortField === 'tax_paid_amount_current') {
        aValue = effectiveTaxPaid(a.tax_paid_amount_current)
        bValue = effectiveTaxPaid(b.tax_paid_amount_current)
      }

      // Special handling for sorting by color state
      if (taxSortField === 'color_state') {
        // Sort order: 0 (default) comes last, then 6, 1, 2, 3, 4, 5
        const stateA = taxSelectedProperties.get(a.id) || 0
        const stateB = taxSelectedProperties.get(b.id) || 0
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
    // Color states: 
    // 0 = default (gray)
    // 1 = yellow (Customer owed taxes) - more yellow and darker
    // 2 = light green (Customer paid)
    // 3 = lime/fluorescent green (Paid)
    // 4 = medium red (Customer Owed)
    // 5 = red (Owed)
    // 6 = light red (Unpaid taxes)
    // 7 = dark green (Bank paid)
    switch (state) {
      case 1:
        return 'bg-yellow-300' // More yellow and darker for Customer owed taxes
      case 2:
        return 'bg-green-100' // Light green for Customer paid
      case 3:
        return 'bg-lime-400' // Fluorescent green for Paid
      case 4:
        return 'bg-red-300' // Medium red for Customer Owed
      case 5:
        return 'bg-red-500' // Red for Owed
      case 6:
        return 'bg-red-100' // Light red for Unpaid taxes
      case 7:
        return 'bg-green-800' // Dark green for Bank paid
      default:
        return 'bg-gray-50' // Default
    }
  }

  const handleTaxToggle = async (propertyId: string) => {
    const currentState = taxSelectedProperties.get(propertyId) || 0
    // Cycle through: 0 -> 6 -> 1 -> 2 -> 3 -> 4 -> 5 -> 7 -> 0
    // 0 = Default (gray)
    // 6 = Light red (Unpaid taxes)
    // 1 = Yellow (Customer owed taxes)
    // 2 = Light green (Customer paid)
    // 3 = Lime (Paid)
    // 4 = Med Red (Customer Owed)
    // 5 = Red (Owed)
    // 7 = Dark green (Bank paid)
    let nextState: number
    if (currentState === 0) {
      nextState = 6
    } else if (currentState === 6) {
      nextState = 1
    } else if (currentState === 5) {
      nextState = 7
    } else if (currentState === 7) {
      nextState = 0
    } else {
      nextState = currentState + 1
    }
    
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

  if (auth.status === 'loading' || dashboardView.kind === 'auth_pending') {
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
                {formatWholeDollarDisplay(metrics?.monthlyIncome)}
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

        <div className="bg-white p-6 rounded-lg shadow">
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
            </div>
          </div>
        </div>
      </div>

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
                  <div className="w-4 h-4 rounded border border-red-200 bg-red-100"></div>
                  <span className="text-gray-600">Light red: Unpaid taxes</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded border border-yellow-500 bg-yellow-300"></div>
                  <span className="text-gray-600">Yellow: Customer owed taxes</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded border border-lime-500 bg-lime-400"></div>
                  <span className="text-gray-600">Lime: Paid</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded border border-green-500 bg-green-100"></div>
                  <span className="text-gray-600">Light green: Customer paid</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded border border-red-400 bg-red-300"></div>
                  <span className="text-gray-600">Med Red: Customer Owed</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded border border-red-600 bg-red-500"></div>
                  <span className="text-gray-600">Red: Owed</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded border border-green-800 bg-green-800"></div>
                  <span className="text-gray-600">Dark green: Bank paid</span>
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
            </p>
            {/* Tax List Header */}
            <div className="bg-gray-100 p-3 rounded-lg border font-medium text-sm text-gray-700">
              <div className="grid gap-2" style={{ gridTemplateColumns: '0.4fr 1.6fr 1.2fr 0.8fr 0.8fr 0.8fr 0.8fr 1.1fr 0.8fr' }}>
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
                  className="cursor-pointer hover:bg-gray-200 px-2 py-1 rounded flex items-center"
                  onClick={() => handleTaxSort('property_tax')}
                >
                  Monthly Tax (Owed/12)
                  {taxSortField === 'property_tax' && (
                    <span className="ml-1">{taxSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
                <div 
                  className="cursor-pointer hover:bg-gray-200 px-2 py-1 rounded flex items-center"
                  onClick={() => handleTaxSort('tax_paid_amount_current')}
                >
                  Current Year Paid
                  {taxSortField === 'tax_paid_amount_current' && (
                    <span className="ml-1">{taxSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
                <div 
                  className="cursor-pointer hover:bg-gray-200 px-2 py-1 rounded flex items-center"
                  onClick={() => handleTaxSort('tax_paid_amount_previous')}
                >
                  Owed
                  {taxSortField === 'tax_paid_amount_previous' && (
                    <span className="ml-1">{taxSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
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
                  Trailer
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
                const colorState = taxSelectedProperties.get(property.id) || 0
                const rowColor = getTaxRowColor(colorState)
                const annualTaxDue = (parseFloat(String(property.property_tax || 0)) * 12)
                const totalTaxesPaid =
                  effectiveTaxPaid(property.tax_paid_amount_current) +
                  effectiveTaxPaid(property.tax_paid_amount_previous)
                // Use manual tax_owed if set, otherwise calculate
                const taxesOwed = property.tax_owed !== null && property.tax_owed !== undefined 
                  ? parseFloat(String(property.tax_owed)) 
                  : Math.max(0, annualTaxDue - totalTaxesPaid)
                // For yellow (1), light green (2), or light red (6) rows, show $0.00 for monthly tax
                const monthlyTaxOwed = (colorState === 1 || colorState === 2 || colorState === 6) 
                  ? 0 
                  : taxesOwed / 12

                const darkTaxRow = colorState === 5 || colorState === 7
                const taxCellText = darkTaxRow ? 'text-xs text-white' : 'text-xs text-gray-500'
                const taxNameText = darkTaxRow ? 'font-medium text-sm text-white' : 'font-medium text-sm'
                
                return (
                <div key={property.id} className={`${rowColor} p-4 rounded-lg border cursor-pointer hover:opacity-90`}>
                <div className="grid gap-2 items-center" style={{ gridTemplateColumns: '0.4fr 1.6fr 1.2fr 0.8fr 0.8fr 0.8fr 0.8fr 1.1fr 0.8fr' }}>
                  <div className="flex items-center justify-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleTaxToggle(property.id)
                      }}
                      className={`w-4 h-4 rounded border-2 ${
                        colorState === 0 
                          ? 'border-gray-300 bg-gray-100' 
                          : colorState === 6
                          ? 'border-red-200 bg-red-100'
                          : colorState === 1
                          ? 'border-yellow-500 bg-yellow-300'
                          : colorState === 2
                          ? 'border-green-500 bg-green-100'
                          : colorState === 3
                          ? 'border-lime-500 bg-lime-400'
                          : colorState === 4
                          ? 'border-red-400 bg-red-300'
                          : colorState === 5
                          ? 'border-red-600 bg-red-500'
                          : colorState === 7
                          ? 'border-green-800 bg-green-800'
                          : 'border-gray-300 bg-gray-100'
                      } hover:opacity-80 focus:outline-none`}
                      title={`State: ${colorState === 0 ? 'Default' : colorState === 6 ? 'Light red: Unpaid taxes' : colorState === 1 ? 'Yellow: Customer owed taxes' : colorState === 2 ? 'Light green: Customer paid' : colorState === 3 ? 'Lime: Paid' : colorState === 4 ? 'Med Red: Customer Owed' : colorState === 5 ? 'Red: Owed' : colorState === 7 ? 'Dark green: Bank paid' : 'Default'}`}
                    />
                  </div>
                  <div className={taxNameText}>{property.name}</div>
                  <div className={taxCellText}>
                    <span 
                      onDoubleClick={() => handleDoubleClick(property, 'owner_name')}
                      className="hover:bg-yellow-100 px-1 rounded cursor-pointer"
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
                  <div className={taxCellText}>
                    <span 
                      onDoubleClick={() => handleDoubleClick(property, 'tax_paid_amount_current')}
                      className="hover:bg-yellow-100 px-1 rounded cursor-pointer"
                    >
                      {editingProperty?.id === property.id && editingField === 'tax_paid_amount_current' ? (
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
                      ) : formatTaxPaidCell(property.tax_paid_amount_current)}
                    </span>
                  </div>
                  <div className={taxCellText}>
                    <span 
                      onDoubleClick={() => {
                        // Use manual tax_owed if set, otherwise calculate
                        const annualTaxDue = parseFloat(String(property.property_tax || 0)) * 12
                        const totalPaid =
                          effectiveTaxPaid(property.tax_paid_amount_current) +
                          effectiveTaxPaid(property.tax_paid_amount_previous)
                        const currentOwed = property.tax_owed !== null && property.tax_owed !== undefined
                          ? parseFloat(String(property.tax_owed))
                          : Math.max(0, annualTaxDue - totalPaid)
                        setEditingProperty(property)
                        setEditingField('taxes_owed')
                        // Use the value with 2 decimals
                        setEditingValue(parseFloat(currentOwed.toFixed(2)).toString())
                      }}
                      className="hover:bg-yellow-100 px-1 rounded cursor-pointer"
                    >
                      {editingProperty?.id === property.id && editingField === 'taxes_owed' ? (
                        <input
                          type="number"
                          step="0.01"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={handleSaveEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit()
                            if (e.key === 'Escape') handleCancelEdit()
                          }}
                          className="text-xs border rounded px-1 w-full"
                          autoFocus
                          placeholder="Enter owed amount"
                        />
                      ) : (taxesOwed > 0 ? `$${taxesOwed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$0.00')}
                    </span>
                  </div>
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
