'use client'

import { useEffect, useState } from 'react'
import { DashboardMetrics } from '@/types/database'
import { 
  HomeIcon, 
  CurrencyDollarIcon, 
  ExclamationTriangleIcon,
  BuildingOfficeIcon
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
  const [potentialIncomeProperties, setPotentialIncomeProperties] = useState<any[]>([])

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    try {
      console.log('Fetching dashboard metrics...')
      const response = await fetch('/api/dashboard/metrics')
      console.log('Dashboard API response status:', response.status)
      const data = await response.json()
      console.log('Dashboard data received:', data)
      setMetrics(data)
      
      // Also fetch properties for insurance and tax sections
      const propertiesResponse = await fetch('/api/properties')
      if (propertiesResponse.ok) {
        const propertiesData = await propertiesResponse.json()
        console.log('Properties data for dashboard:', propertiesData?.length || 0)
        setProperties(propertiesData || [])
        
        // Calculate potential income properties (unoccupied with rent_value)
        if (data && propertiesData) {
          // Get occupied property IDs from active leases
          const occupiedPropertyIds = new Set<string>()
          const today = new Date().toISOString().split('T')[0]
          
          // Fetch all leases and filter for active ones
          const leasesResponse = await fetch('/api/leases')
          if (leasesResponse.ok) {
            const leasesData = await leasesResponse.json()
            leasesData.forEach((lease: any) => {
              // Check if lease is active (status = 'active' and within date range)
              if (lease.status === 'active' && lease.property_id) {
                const startDate = new Date(lease.lease_start_date)
                const endDate = lease.lease_end_date ? new Date(lease.lease_end_date) : null
                const todayDate = new Date(today)
                
                // Lease is active if today is between start and end (or no end date)
                if (todayDate >= startDate && (!endDate || todayDate <= endDate)) {
                  occupiedPropertyIds.add(lease.property_id)
                }
              }
            })
          }
          
          // Filter unoccupied properties with rent_value
          const potentialProps = propertiesData.filter((property: any) => 
            !occupiedPropertyIds.has(property.id) && 
            property.rent_value && 
            property.rent_value > 0
          )
          
          // Sort by potential income (rent_value) descending
          potentialProps.sort((a: any, b: any) => (b.rent_value || 0) - (a.rent_value || 0))
          setPotentialIncomeProperties(potentialProps)
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
    setEditingValue(property[field] || '')
  }

  const handleSaveEdit = async () => {
    if (!editingProperty || !editingField) return

    try {
      const response = await fetch(`/api/properties/${editingProperty.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          [editingField]: editingValue
        })
      })

      if (response.ok) {
        // Update local state
        setProperties(prev => prev.map(p => 
          p.id === editingProperty.id 
            ? { ...p, [editingField]: editingValue }
            : p
        ))
        
        // Clear editing state
        setEditingProperty(null)
        setEditingField('')
        setEditingValue('')
      } else {
        console.error('Failed to update property')
      }
    } catch (error) {
      console.error('Error updating property:', error)
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
            property.Map_ID?.toLowerCase().includes(searchLower)
          )
        })
      : filtered
    
    // Apply sorting
    return [...searchFiltered].sort((a, b) => {
      let aValue = a[taxSortField] || ''
      let bValue = b[taxSortField] || ''
      
      if (typeof aValue === 'string') aValue = aValue.toLowerCase()
      if (typeof bValue === 'string') bValue = bValue.toLowerCase()
      
      if (aValue < bValue) return taxSortDirection === 'asc' ? -1 : 1
      if (aValue > bValue) return taxSortDirection === 'asc' ? 1 : -1
      return 0
    })
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
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

        <div className="bg-white p-6 rounded-lg shadow">
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
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <ExclamationTriangleIcon className="h-8 w-8 text-red-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Late Payments</p>
              <p className="text-2xl font-semibold text-gray-900">{metrics?.latePayments || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <CurrencyDollarIcon className="h-8 w-8 text-orange-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Total Owed</p>
              <p className="text-2xl font-semibold text-gray-900">${metrics?.totalOwed?.toLocaleString() || 0}</p>
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
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Property Tax Overview</h2>
          <button
            onClick={() => setShowTaxSection(!showTaxSection)}
            className="text-purple-600 hover:text-purple-800 font-medium"
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
                placeholder="Search by property name, owner, county, or map ID..."
                value={taxSearchTerm}
                onChange={(e) => setTaxSearchTerm(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            
            {/* Tax List Header */}
            <div className="bg-gray-100 p-3 rounded-lg border font-medium text-sm text-gray-700">
              <div className="grid gap-2" style={{ gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr 1fr 1.5fr' }}>
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
                  Monthly Tax
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
                  Previous Year Paid
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
              </div>
            </div>
            
            {/* Tax List */}
            {getSortedTaxProperties().length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No properties found. Total properties: {properties.length}
              </div>
            ) : (
              getSortedTaxProperties().map((property) => (
                <div key={property.id} className="bg-gray-50 p-4 rounded-lg border cursor-pointer hover:bg-gray-100">
                <div className="grid gap-2 items-center" style={{ gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr 1fr 1.5fr' }}>
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
                    <span 
                      onDoubleClick={() => handleDoubleClick(property, 'property_tax')}
                      className="hover:bg-yellow-100 px-1 rounded cursor-pointer"
                    >
                      {editingProperty?.id === property.id && editingField === 'property_tax' ? (
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
                      ) : (property.property_tax ? `$${property.property_tax.toLocaleString()}` : 'Not set')}
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
                      ) : (property.tax_paid_amount_current ? `$${property.tax_paid_amount_current.toLocaleString()}` : 'Not set')}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    <span 
                      onDoubleClick={() => handleDoubleClick(property, 'tax_paid_amount_previous')}
                      className="hover:bg-yellow-100 px-1 rounded cursor-pointer"
                    >
                      {editingProperty?.id === property.id && editingField === 'tax_paid_amount_previous' ? (
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
                      ) : (property.tax_paid_amount_previous ? `$${property.tax_paid_amount_previous.toLocaleString()}` : 'Not set')}
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
                </div>
              </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}