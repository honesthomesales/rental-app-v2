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
                Current: ${metrics?.monthlyIncome?.toLocaleString() || 0} + 
                Unoccupied: ${metrics?.potentialIncome?.toLocaleString() || 0}
              </p>
              <p className="text-xs text-green-600 mt-1 font-medium">
                ✓ PWA Ready - Install on Mobile!
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
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Type Breakdown</h2>
        <p className="text-sm text-gray-600 mb-6">Your properties by type</p>
        
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
          <div className="space-y-4">
            {/* Group by insurance provider */}
            {Object.entries(
              getFilteredProperties().reduce((acc: any, property) => {
                const provider = property.insurance_provider || 'No Insurance'
                if (!acc[provider]) acc[provider] = []
                acc[provider].push(property)
                return acc
              }, {})
            ).map(([provider, providerProperties]: [string, any]) => (
              <div key={provider} className="border rounded-lg p-4">
                <h3 className="font-medium text-gray-900 mb-2">
                  {provider} ({(providerProperties as any[]).length} properties)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {(providerProperties as any[]).map((property) => (
                    <div key={property.id} className="bg-gray-50 p-3 rounded cursor-pointer hover:bg-gray-100">
                      <div className="font-medium text-sm">{property.name}</div>
                      <div className="text-xs text-gray-500">
                        <span 
                          onDoubleClick={() => handleDoubleClick(property, 'insurance_provider')}
                          className="hover:bg-yellow-100 px-1 rounded"
                        >
                          Provider: {editingProperty?.id === property.id && editingField === 'insurance_provider' ? (
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
                          className="hover:bg-yellow-100 px-1 rounded"
                        >
                          Policy: {editingProperty?.id === property.id && editingField === 'insurance_policy_number' ? (
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
                          className="hover:bg-yellow-100 px-1 rounded"
                        >
                          Premium: {editingProperty?.id === property.id && editingField === 'insurance_premium' ? (
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
                  ))}
                </div>
              </div>
            ))}
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
          <div className="space-y-4">
            {/* Group by tax status */}
            {[
              { 
                title: 'Tax Paid', 
                properties: getFilteredProperties().filter(p => p.property_tax && p.property_tax > 0),
                color: 'bg-green-50 border-green-200'
              },
              { 
                title: 'Tax Not Set', 
                properties: getFilteredProperties().filter(p => !p.property_tax || p.property_tax === 0),
                color: 'bg-red-50 border-red-200'
              }
            ].map(({ title, properties: groupProperties, color }) => (
              <div key={title} className={`border rounded-lg p-4 ${color}`}>
                <h3 className="font-medium text-gray-900 mb-2">
                  {title} ({groupProperties.length} properties)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {groupProperties.map((property) => (
                    <div key={property.id} className="bg-white p-3 rounded border cursor-pointer hover:bg-gray-50">
                      <div className="font-medium text-sm">{property.name}</div>
                      <div className="text-xs text-gray-500">
                        <span 
                          onDoubleClick={() => handleDoubleClick(property, 'owner_name')}
                          className="hover:bg-yellow-100 px-1 rounded"
                        >
                          Owner: {editingProperty?.id === property.id && editingField === 'owner_name' ? (
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
                          onDoubleClick={() => handleDoubleClick(property, 'property_tax')}
                          className="hover:bg-yellow-100 px-1 rounded"
                        >
                          Annual Tax: {editingProperty?.id === property.id && editingField === 'property_tax' ? (
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
                          onDoubleClick={() => handleDoubleClick(property, 'Map_ID')}
                          className="hover:bg-yellow-100 px-1 rounded"
                        >
                          Map ID: {editingProperty?.id === property.id && editingField === 'Map_ID' ? (
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
                          onDoubleClick={() => handleDoubleClick(property, 'Interest_Rate')}
                          className="hover:bg-yellow-100 px-1 rounded"
                        >
                          Interest Rate: {editingProperty?.id === property.id && editingField === 'Interest_Rate' ? (
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
                            />
                          ) : (property.Interest_Rate ? `${property.Interest_Rate}%` : 'Not set')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}