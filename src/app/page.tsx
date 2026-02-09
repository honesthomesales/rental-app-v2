'use client'

import { useEffect, useState } from 'react'
import { DashboardMetrics } from '@/types/database'
import { 
  HomeIcon, 
  CurrencyDollarIcon, 
  ExclamationTriangleIcon,
  BuildingOfficeIcon,
  XMarkIcon,
  PencilIcon
} from '@heroicons/react/24/outline'

export default function Dashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [loading, setLoading] = useState(true)
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
  const [insuranceSearchTerm, setInsuranceSearchTerm] = useState<string>('')
  const [taxSearchTerm, setTaxSearchTerm] = useState<string>('')
  const [showPotentialIncomeSection, setShowPotentialIncomeSection] = useState(false)
  const [showPotentialIncomeModal, setShowPotentialIncomeModal] = useState(false)
  const [potentialIncomeProperties, setPotentialIncomeProperties] = useState<any[]>([])
  const [taxSelectedProperties, setTaxSelectedProperties] = useState<Map<string, number>>(new Map())
  const [editingRentValue, setEditingRentValue] = useState<{propertyId: string, value: string} | null>(null)
  
  // Color states: 0 = default (gray), 1 = yellow, 2 = light green, 3 = lime, 4 = medium red, 5 = bright red

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    try {
      console.log('Fetching dashboard data in parallel...')
      
      // OPTIMIZED: Fetch all data in parallel instead of sequentially
      const [metricsResponse, propertiesResponse, leasesResponse] = await Promise.all([
        fetch('/api/dashboard/metrics'),
        fetch('/api/properties'),
        fetch('/api/leases')
      ])

      // Process metrics
      if (!metricsResponse.ok) {
        throw new Error(`Dashboard metrics failed: ${metricsResponse.status}`)
      }
      const data = await metricsResponse.json()
      console.log('Dashboard data received:', data)
      setMetrics(data)

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
        
          // Calculate potential income properties (unoccupied with rent_value)
        if (data && propertiesData && leasesResponse.ok) {
          const leasesData = await leasesResponse.json()
          
          // Get occupied property IDs from active leases
          const occupiedPropertyIds = new Set<string>()
          const today = new Date().toISOString().split('T')[0]
          const todayDate = new Date(today)
          
          leasesData.forEach((lease: any) => {
            // Check if lease is occupied (status = 'occupied' or legacy 'active' and within date range)
            // Handle both new status ('occupied') and legacy status ('active')
            const isOccupied = lease.status === 'occupied' || lease.status === 'active'
            if (isOccupied && lease.property_id) {
              const startDate = new Date(lease.lease_start_date)
              const endDate = lease.lease_end_date ? new Date(lease.lease_end_date) : null
              
              // Lease is occupied if today is between start and end (or no end date)
              if (todayDate >= startDate && (!endDate || todayDate <= endDate)) {
                occupiedPropertyIds.add(lease.property_id)
              }
            }
          })
          
          // Filter unoccupied properties with rent_value
          // A property is unoccupied if it's not in the occupiedPropertyIds set
          const potentialProps = propertiesData.filter((property: any) => {
            const isOccupied = occupiedPropertyIds.has(property.id)
            const hasRentValue = property.rent_value && property.rent_value > 0
            
            // Debug logging for 4750 S pine
            if (property.address && property.address.toLowerCase().includes('4750') && property.address.toLowerCase().includes('pine')) {
              console.log('🔍 4750 S Pine property check:', {
                propertyId: property.id,
                propertyName: property.name,
                address: property.address,
                isOccupied,
                hasRentValue,
                rentValue: property.rent_value,
                willShow: !isOccupied && hasRentValue
              })
            }
            
            return !isOccupied && hasRentValue
          })
          
          // Sort by potential income (rent_value) descending
          potentialProps.sort((a: any, b: any) => (b.rent_value || 0) - (a.rent_value || 0))
          setPotentialIncomeProperties(potentialProps)
        } else if (data && propertiesData) {
          // If leases fetch failed, still set properties but no potential income calculation
          setPotentialIncomeProperties([])
          setLeases([])
        }
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
      // Set empty metrics on error
      setMetrics({
        totalProperties: 0,
        occupiedProperties: 0,
        monthlyIncome: 0,
        latePayments: 0,
        propertyTypeBreakdown: {
          house: 0,
          doublewide: 0,
          singlewide: 0,
          loan: 0
        }
      })
    } finally {
      setLoading(false)
    }
  }

  const handleDoubleClick = (property: any, field: string) => {
    setEditingProperty(property)
    setEditingField(field)
    // For numeric fields, preserve decimal format when editing
    if (field === 'tax_paid_amount_current' || field === 'tax_paid_amount_previous' || field === 'property_tax') {
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

  const getSortedInsuranceProperties = () => {
    const filtered = getFilteredProperties()
    
    // Apply search filter
    const searchFiltered = insuranceSearchTerm
      ? filtered.filter(property => {
          const searchLower = insuranceSearchTerm.toLowerCase()
          return (
            property.name?.toLowerCase().includes(searchLower) ||
            property.insurance_provider?.toLowerCase().includes(searchLower) ||
            property.insurance_policy_number?.toLowerCase().includes(searchLower)
          )
        })
      : filtered
    
    // Apply sorting
    return [...searchFiltered].sort((a, b) => {
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
    const filtered = getFilteredProperties()
    
    // Apply search filter
    const searchFiltered = taxSearchTerm
      ? filtered.filter(property => {
          const searchLower = taxSearchTerm.toLowerCase()
          return (
            property.name?.toLowerCase().includes(searchLower) ||
            property.owner_name?.toLowerCase().includes(searchLower) ||
            property.county?.toLowerCase().includes(searchLower) ||
            property.Map_ID?.toLowerCase().includes(searchLower) ||
            property.map_id_trailer?.toLowerCase().includes(searchLower)
          )
        })
      : filtered
    
    // Apply sorting
    return [...searchFiltered].sort((a, b) => {
      let aValue: any = a[taxSortField] || ''
      let bValue: any = b[taxSortField] || ''
      
      // Special handling for sorting by owed amount
      if (taxSortField === 'tax_paid_amount_previous') {
        const annualTaxDueA = ((parseFloat(String(a.property_tax || 0)) * 12))
        const totalPaidA = (parseFloat(String(a.tax_paid_amount_current || 0)) + parseFloat(String(a.tax_paid_amount_previous || 0)))
        const owedA = Math.max(0, annualTaxDueA - totalPaidA)
        
        const annualTaxDueB = ((parseFloat(String(b.property_tax || 0)) * 12))
        const totalPaidB = (parseFloat(String(b.tax_paid_amount_current || 0)) + parseFloat(String(b.tax_paid_amount_previous || 0)))
        const owedB = Math.max(0, annualTaxDueB - totalPaidB)
        
        aValue = owedA
        bValue = owedB
      }
      
      // Special handling for sorting by monthly tax (owed/12)
      if (taxSortField === 'property_tax') {
        const annualTaxDueA = ((parseFloat(String(a.property_tax || 0)) * 12))
        const totalPaidA = (parseFloat(String(a.tax_paid_amount_current || 0)) + parseFloat(String(a.tax_paid_amount_previous || 0)))
        const owedA = Math.max(0, annualTaxDueA - totalPaidA)
        const monthlyOwedA = owedA / 12
        
        const annualTaxDueB = ((parseFloat(String(b.property_tax || 0)) * 12))
        const totalPaidB = (parseFloat(String(b.tax_paid_amount_current || 0)) + parseFloat(String(b.tax_paid_amount_previous || 0)))
        const owedB = Math.max(0, annualTaxDueB - totalPaidB)
        const monthlyOwedB = owedB / 12
        
        aValue = monthlyOwedA
        bValue = monthlyOwedB
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

  const getFilteredProperties = () => {
    if (!typeFilter) return properties
    return properties.filter(p => p.property_type === typeFilter)
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
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

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard 1.4</h1>
        <p className="text-gray-600 mt-2">Rental properties overview</p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <HomeIcon className="h-8 w-8 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Occupied / Total Properties</p>
              <p className="text-2xl font-semibold text-gray-900">
                {metrics?.occupiedProperties || 0} / {metrics?.totalProperties || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <CurrencyDollarIcon className="h-8 w-8 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Monthly Income</p>
              <p className="text-2xl font-semibold text-gray-900">${metrics?.monthlyIncome?.toLocaleString() || 0}</p>
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
              <p className="text-2xl font-semibold text-gray-900">${metrics?.totalPotentialIncome?.toLocaleString() || 0}</p>
              <p className="text-xs text-gray-500 mt-1">
                Unoccupied: ${metrics?.potentialIncome?.toLocaleString() || 0}
              </p>
              <p className="text-xs text-indigo-600 mt-1 font-medium">Click to view/edit</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg shadow">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <CurrencyDollarIcon className="h-7 w-7 text-emerald-600" />
            </div>
            <div className="ml-3 flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-500 mb-1.5">Profit</p>
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-gray-900 whitespace-nowrap">
                  <span className="text-gray-600">Current:</span>{' '}
                  <span className={metrics?.currentProfit && metrics.currentProfit >= 0 ? 'text-green-600' : 'text-red-600'}>
                    ${metrics?.currentProfit?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                  </span>
                </div>
                <div className="text-xs font-semibold text-gray-900 whitespace-nowrap">
                  <span className="text-gray-600">Potential:</span>{' '}
                  <span className={metrics?.potentialProfit && metrics.potentialProfit >= 0 ? 'text-green-600' : 'text-red-600'}>
                    ${metrics?.potentialProfit?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Late Payments and Total Owed Combined */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <ExclamationTriangleIcon className="h-8 w-8 text-red-600" />
            </div>
            <div className="ml-4 flex-1">
              <p className="text-sm font-medium text-gray-500">Late Payments & Total Owed</p>
              <div className="mt-1">
                <p className="text-xl font-semibold text-gray-900">
                  {metrics?.latePayments || 0} payments
                </p>
                <p className="text-xl font-semibold text-gray-900">
                  ${metrics?.totalOwed?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                </p>
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
            {potentialIncomeProperties.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No unoccupied properties with potential income found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Property
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Potential Income
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {potentialIncomeProperties.map((property) => (
                      <tr key={property.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{property.name || 'Unnamed Property'}</div>
                          {property.address && (
                            <div className="text-sm text-gray-500">{property.address}</div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-indigo-600">
                          ${(property.rent_value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                    {potentialIncomeProperties.length > 0 && (
                      <tr className="bg-gray-100 font-semibold">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          Total Potential Income
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-indigo-600">
                          ${potentialIncomeProperties.reduce((sum, p) => sum + (p.rent_value || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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

      {/* Quick Actions */}
      <div className="mt-8 flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <div className="relative">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="pl-3 pr-8 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Types</option>
              <option value="house">House</option>
              <option value="doublewide">Doublewide</option>
              <option value="singlewide">Singlewide</option>
              <option value="loan">Loan</option>
            </select>
          </div>
        </div>
        
        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center">
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
            {/* Search Bar */}
            <div className="mb-4">
              <input
                type="text"
                placeholder="Search by property name, provider, or policy number..."
                value={insuranceSearchTerm}
                onChange={(e) => setInsuranceSearchTerm(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            
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
            
            {/* Insurance List */}
            {getSortedInsuranceProperties().length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No properties found. Total properties: {properties.length}
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
                      ) : (property.insurance_provider || 'None')}
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
                      ) : (property.insurance_policy_number || 'None')}
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
                      ) : (property.insurance_premium ? `$${property.insurance_premium.toLocaleString()}` : 'Not set')}
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
            {/* Search Bar */}
            <div className="mb-4">
              <input
                type="text"
                placeholder="Search by property name, owner, county, map ID, or trailer..."
                value={taxSearchTerm}
                onChange={(e) => setTaxSearchTerm(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            
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
              <div className="text-center py-8 text-gray-500">
                No properties found. Total properties: {properties.length}
              </div>
            ) : (
              getSortedTaxProperties().map((property) => {
                const colorState = taxSelectedProperties.get(property.id) || 0
                const rowColor = getTaxRowColor(colorState)
                const annualTaxDue = (parseFloat(String(property.property_tax || 0)) * 12)
                const totalTaxesPaid = (parseFloat(String(property.tax_paid_amount_current || 0)) + parseFloat(String(property.tax_paid_amount_previous || 0)))
                // Use manual tax_owed if set, otherwise calculate
                const taxesOwed = property.tax_owed !== null && property.tax_owed !== undefined 
                  ? parseFloat(String(property.tax_owed)) 
                  : Math.max(0, annualTaxDue - totalTaxesPaid)
                // For yellow (1), light green (2), or light red (6) rows, show $0.00 for monthly tax
                const monthlyTaxOwed = (colorState === 1 || colorState === 2 || colorState === 6) 
                  ? 0 
                  : taxesOwed / 12
                
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
                  <div className="font-medium text-sm">{property.name}</div>
                  <div className="text-xs text-gray-500">
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
                  <div className="text-xs text-gray-500">
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
                  <div className="text-xs text-gray-500">
                    <span className="px-1 rounded">
                      ${monthlyTaxOwed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
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
                      ) : (property.tax_paid_amount_current ? `$${property.tax_paid_amount_current.toLocaleString()}` : '$0')}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    <span 
                      onDoubleClick={() => {
                        // Use manual tax_owed if set, otherwise calculate
                        const annualTaxDue = parseFloat(String(property.property_tax || 0)) * 12
                        const totalPaid = parseFloat(String(property.tax_paid_amount_current || 0)) + parseFloat(String(property.tax_paid_amount_previous || 0))
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
                  <div className="text-xs text-gray-500">
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
                  <div className="text-xs text-gray-500">
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
                <h2 className="text-xl font-semibold text-gray-900">Unoccupied Properties - Potential Rent</h2>
                <p className="text-sm text-gray-600 mt-1">Edit rent_value to update potential income</p>
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
              {potentialIncomeProperties.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No unoccupied properties with potential income found.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Property
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Address
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Potential Rent (Monthly)
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {potentialIncomeProperties.map((property) => (
                        <tr key={property.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{property.name || 'Unnamed Property'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">{property.address || 'N/A'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            {editingRentValue?.propertyId === property.id ? (
                              <input
                                type="number"
                                step="0.01"
                                value={editingRentValue.value}
                                onChange={(e) => setEditingRentValue({ propertyId: property.id, value: e.target.value })}
                                onBlur={async () => {
                                  const newValue = parseFloat(editingRentValue.value) || 0
                                  try {
                                    const response = await fetch(`/api/properties/${property.id}`, {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ rent_value: newValue })
                                    })
                                    if (response.ok) {
                                      // Update local state
                                      setPotentialIncomeProperties(prev => 
                                        prev.map(p => p.id === property.id ? { ...p, rent_value: newValue } : p)
                                      )
                                      // Refresh dashboard metrics
                                      fetchDashboardData()
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
                                className="text-sm font-semibold text-indigo-600 cursor-pointer hover:text-indigo-800"
                                onClick={() => setEditingRentValue({ propertyId: property.id, value: (property.rent_value || 0).toString() })}
                              >
                                ${(property.rent_value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <button
                              onClick={() => setEditingRentValue({ propertyId: property.id, value: (property.rent_value || 0).toString() })}
                              className="text-blue-600 hover:text-blue-900"
                              title="Edit rent value"
                            >
                              <PencilIcon className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {potentialIncomeProperties.length > 0 && (
                        <tr className="bg-gray-100 font-semibold">
                          <td colSpan={2} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            Total Potential Income
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-indigo-600">
                            ${potentialIncomeProperties.reduce((sum, p) => sum + (p.rent_value || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
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
    </div>
  )
}