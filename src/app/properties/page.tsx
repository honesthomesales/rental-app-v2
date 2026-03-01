'use client'

import React, { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { Property } from '@/types/database'
import { BuildingOfficeIcon, PlusIcon, MagnifyingGlassIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'

type SortField = 'name' | 'city' | 'property_type' | 'rent_value' | 'cadence' | 'tenantName' | 'leaseStatus' | 'is_for_rent'
type SortDirection = 'asc' | 'desc'

type PropertyWithLease = Property & {
  cadence?: string
  tenantName?: string
  isOccupied?: boolean
  leaseStatus?: string | null
  leaseId?: string | null
}

export default function PropertiesPage() {
  
  const [properties, setProperties] = useState<PropertyWithLease[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingProperty, setEditingProperty] = useState<PropertyWithLease | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [showRetired, setShowRetired] = useState(false)

  useEffect(() => {
    fetchProperties()
  }, [showRetired])

  // OPTIMIZED: Use useMemo for expensive filtering and sorting calculations
  const filteredProperties = useMemo(() => {
    let filtered = properties.filter(property => {
      // Filter by retired status - if showRetired is false, exclude retired properties
      // If showRetired is true, show all properties
      if (!showRetired && property.status === 'retired') {
        return false
      }
      
      // If showRetired is true, we want to show all (including retired)
      // If showRetired is false, we want to show only active/null (retired already filtered above)
      
      const searchLower = searchTerm.toLowerCase()
      return (
        property.name.toLowerCase().includes(searchLower) ||
        property.address.toLowerCase().includes(searchLower) ||
        property.city.toLowerCase().includes(searchLower) ||
        property.state.toLowerCase().includes(searchLower) ||
        (property.property_type && property.property_type.toLowerCase().includes(searchLower))
      )
    })

    filtered.sort((a, b) => {
      let aValue: any = a[sortField]
      let bValue: any = b[sortField]

      // Handle different data types
      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase()
        bValue = bValue.toLowerCase()
      } else if (typeof aValue === 'boolean') {
        // For boolean values, convert to numbers (false = 0, true = 1)
        aValue = aValue ? 1 : 0
        bValue = bValue ? 1 : 0
      } else if (typeof aValue === 'number') {
        // Numbers are already comparable
        aValue = aValue || 0
        bValue = bValue || 0
      } else {
        // Handle undefined/null values
        aValue = aValue || ''
        bValue = bValue || ''
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
      return 0
    })

    return filtered
  }, [properties, searchTerm, sortField, sortDirection, showRetired])
  
  useEffect(() => {
    fetchProperties()
  }, [showRetired])

  const fetchProperties = async () => {
    try {
      const response = await fetch(`/api/properties?includeRetired=${showRetired}`)
      
      if (!response.ok) {
        const errorData = await response.json()
        console.error('API error:', errorData)
        throw new Error(errorData.error || 'Failed to fetch properties')
      }
      
      const data = await response.json()
      
      // Fetch lease data to get cadence and tenant info
      const leaseResponse = await fetch('/api/leases')
      let leaseData = []
      if (leaseResponse.ok) {
        leaseData = await leaseResponse.json()
      }
      
      // Merge property data with lease data
      // Show all lease statuses (occupied, active, sold, empty)
      const propertiesWithLease = data.map((property: Property) => {
        // Find any lease for this property - show all statuses
        const anyLease = leaseData.find((l: any) => l.property_id === property.id)
        
        // Check if lease has tenants (occupied or sold) for isOccupied flag
        const isActiveLease = anyLease && (
          anyLease.status === 'occupied' || 
          anyLease.status === 'sold'
        )
        
        // Try different field names for tenant name
        const tenantName = anyLease?.RENT_tenants?.full_name || 
                          (anyLease?.RENT_tenants?.first_name && anyLease?.RENT_tenants?.last_name ? 
                            `${anyLease.RENT_tenants.first_name} ${anyLease.RENT_tenants.last_name}` : 
                            'Vacant')
        
        return {
          ...property,
          cadence: anyLease?.rent_cadence || 'N/A',
          tenantName: tenantName,
          isOccupied: !!isActiveLease, // Only true if status is occupied/active/sold
          leaseStatus: anyLease?.status || null, // Show all lease statuses
          leaseId: anyLease?.id || null, // Store lease ID for updates
          // Show lease rent if has lease, otherwise show property rent_value
          displayRent: anyLease ? anyLease.rent : property.rent_value
        }
      })
      
      setProperties(propertiesWithLease || [])
    } catch (error) {
      console.error('Error fetching properties:', error)
      setProperties([])
    } finally {
      setLoading(false)
    }
  }


  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const handleAddProperty = () => {
    setEditingProperty(null)
    setShowAddModal(true)
  }

  const handleEditProperty = (property: Property) => {
    setEditingProperty(property)
    setShowAddModal(true)
  }

  const handleRetireProperty = async (property: Property) => {
    if (!confirm(`Are you sure you want to retire ${property.name}? This will exclude it from current calculations but preserve all history.`)) {
      return
    }

    try {
      const response = await fetch('/api/properties', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: property.id,
          status: 'retired'
        })
      })

      if (response.ok) {
        await fetchProperties()
        alert(`Property "${property.name}" has been retired successfully.`)
      } else {
        const errorData = await response.json()
        console.error('Failed to retire property:', errorData)
        
        if (errorData.details && errorData.details.includes('column does not exist')) {
          alert(`Database Setup Required:\n\n${errorData.details}\n\nPlease run the migration script in Supabase SQL Editor.`)
        } else {
          alert(`Failed to retire property: ${errorData.error || errorData.details || 'Unknown error'}`)
        }
      }
    } catch (error) {
      console.error('Error retiring property:', error)
      alert(`Failed to retire property: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleActivateProperty = async (property: Property) => {
    try {
      const response = await fetch('/api/properties', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: property.id,
          status: 'occupied'
        })
      })

      if (response.ok) {
        fetchProperties()
      } else {
        alert('Failed to activate property. Please try again.')
      }
    } catch (error) {
      console.error('Error activating property:', error)
      alert('Failed to activate property. Please try again.')
    }
  }

  const handleSaveProperty = async (propertyData: Partial<PropertyWithLease> & { lease_status?: string }) => {
    try {
      const url = '/api/properties'
      const method = editingProperty ? 'PUT' : 'POST'
      
      // Extract lease_status from propertyData
      const { lease_status, ...propertyUpdateData } = propertyData
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editingProperty ? { id: editingProperty.id, ...propertyUpdateData } : propertyUpdateData)
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `Failed to ${editingProperty ? 'update' : 'create'} property`)
      }

      // If lease_status was provided, update the lease
      if (lease_status && editingProperty?.leaseId) {
        try {
          const leaseResponse = await fetch('/api/leases', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              id: editingProperty.leaseId,
              status: lease_status
            })
          })

          if (!leaseResponse.ok) {
            console.warn('Failed to update lease status, but property was saved')
          }
        } catch (leaseError) {
          console.error('Error updating lease status:', leaseError)
          // Don't fail the whole operation if lease update fails
        }
      }

      // Refresh the properties list
      await fetchProperties()
      setShowAddModal(false)
      setEditingProperty(null)
    } catch (error) {
      console.error(`Error ${editingProperty ? 'updating' : 'creating'} property:`, error)
      alert(`Failed to ${editingProperty ? 'update' : 'create'} property. Please try again. Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleDeleteProperty = async (property: PropertyWithLease) => {
    try {
      const response = await fetch(`/api/properties?id=${property.id}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete property')
      }

      // Refresh the properties list
      await fetchProperties()
    } catch (error) {
      console.error('Error deleting property:', error)
      alert('Failed to delete property. Please try again.')
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="h-10 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b">
              <div className="grid grid-cols-8 gap-4">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="h-4 bg-gray-200 rounded"></div>
                ))}
              </div>
            </div>
            {[...Array(5)].map((_, i) => (
              <div key={i} className="p-4 border-b">
                <div className="grid grid-cols-8 gap-4">
                  {[...Array(8)].map((_, j) => (
                    <div key={j} className="h-4 bg-gray-200 rounded"></div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Properties</h1>
          <p className="text-gray-600 mt-2">Manage your rental properties ({filteredProperties.length} of {properties.length})</p>
        </div>
        <div className="flex items-center space-x-3">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showRetired}
              onChange={(e) => setShowRetired(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">Show Retired</span>
          </label>
          <button
            onClick={handleAddProperty}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            Add Property
          </button>
        </div>
      </div>

      {/* Search and Filter */}
      <div className="mb-6">
        <div className="relative">
          <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search properties by name, address, city, state, or type..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Info Banner */}
      <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
        <div className="flex items-center">
          <svg className="h-5 w-5 text-blue-600 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-blue-800">
            <span className="font-medium">Note:</span> Insurance premiums and property taxes are managed on the{' '}
            <Link href="/" className="font-semibold underline hover:text-blue-900">Dashboard</Link> page.
          </p>
        </div>
      </div>

      {/* Properties Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th 
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center">
                    Property Name
                    {sortField === 'name' && (
                      <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('city')}
                >
                  <div className="flex items-center">
                    City
                    {sortField === 'city' && (
                      <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('property_type')}
                >
                  <div className="flex items-center">
                    Type
                    {sortField === 'property_type' && (
                      <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('rent_value')}
                >
                  <div className="flex items-center">
                    Rent Value
                    {sortField === 'rent_value' && (
                      <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('cadence')}
                >
                  <div className="flex items-center">
                    Cadence
                    {sortField === 'cadence' && (
                      <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('tenantName')}
                >
                  <div className="flex items-center">
                    Tenant
                    {sortField === 'tenantName' && (
                      <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('leaseStatus')}
                >
                  <div className="flex items-center">
                    Lease Status
                    {sortField === 'leaseStatus' && (
                      <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredProperties.map((property) => (
                <React.Fragment key={property.id}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-4 py-4 whitespace-nowrap w-1/4">
                      <div className="flex items-center">
                        <BuildingOfficeIcon className="h-5 w-5 text-blue-600 mr-3" />
                        <div>
                          <div className="text-sm font-medium text-gray-900 truncate">{property.name}</div>
                          <div className="text-sm text-gray-500 truncate">{property.tenantName}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {property.city}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full capitalize">
                        {property.property_type}
                      </span>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      ${property.displayRent?.toLocaleString() || property.rent_value?.toLocaleString() || 'N/A'}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 rounded-full capitalize">
                        {property.cadence}
                      </span>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {property.tenantName}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      {property.leaseStatus ? (
                        <select
                          value={property.leaseStatus}
                          onChange={async (e) => {
                            if (property.leaseId) {
                              try {
                                const response = await fetch('/api/leases', {
                                  method: 'PUT',
                                  headers: {
                                    'Content-Type': 'application/json',
                                  },
                                  body: JSON.stringify({
                                    id: property.leaseId,
                                    status: e.target.value
                                  })
                                })

                                if (response.ok) {
                                  await fetchProperties()
                                } else {
                                  alert('Failed to update lease status')
                                }
                              } catch (error) {
                                console.error('Error updating lease status:', error)
                                alert('Failed to update lease status')
                              }
                            }
                          }}
                          className={`px-2 py-1 text-xs font-medium rounded border-0 capitalize focus:ring-2 focus:ring-blue-500 ${
                            property.leaseStatus === 'occupied'
                              ? 'bg-green-100 text-green-800'
                              : property.leaseStatus === 'sold'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          <option value="empty">Empty</option>
                          <option value="occupied">Has Tenants</option>
                          <option value="sold">Sold</option>
                        </select>
                      ) : (
                        <span className="text-xs text-gray-400">No lease</span>
                      )}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleEditProperty(property)}
                          className="text-blue-600 hover:text-blue-900"
                          title="Edit Property"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        {property.status === 'retired' ? (
                          <button
                            onClick={() => handleActivateProperty(property)}
                            className="text-green-600 hover:text-green-900"
                            title="Activate Property"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleRetireProperty(property)}
                            className="text-orange-600 hover:text-orange-900"
                            title="Retire Property (Sold)"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteProperty(property)}
                          className="text-red-600 hover:text-red-900"
                          title="Delete Property"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {filteredProperties.length === 0 && (
          <div className="text-center py-12">
            <BuildingOfficeIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {searchTerm ? 'No properties match your search' : 'No properties found'}
            </h3>
            <p className="text-gray-500 mb-4">
              {searchTerm ? 'Try adjusting your search terms.' : 'Get started by adding your first property.'}
            </p>
            {!searchTerm && (
              <button
                onClick={handleAddProperty}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                Add Property
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add/Edit Property Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              {editingProperty ? 'Edit Property' : 'Add New Property'}
            </h2>
            <form onSubmit={(e) => {
              e.preventDefault()
              const formData = new FormData(e.currentTarget)
              const propertyData = {
                name: formData.get('name') as string,
                address: formData.get('address') as string,
                city: formData.get('city') as string,
                state: formData.get('state') as string,
                zip_code: formData.get('zip_code') as string,
                property_type: formData.get('property_type') as string,
                bedrooms: parseInt(formData.get('bedrooms') as string) || 0,
                bathrooms: parseFloat(formData.get('bathrooms') as string) || 0,
                square_feet: parseInt(formData.get('square_feet') as string) || 0,
                rent_value: parseFloat(formData.get('rent_value') as string) || 0,
                lease_status: formData.get('lease_status') as string
              }
              handleSaveProperty(propertyData)
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Property Name *</label>
                  <input
                    type="text"
                    name="name"
                    defaultValue={editingProperty?.name || ''}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Address *</label>
                  <input
                    type="text"
                    name="address"
                    defaultValue={editingProperty?.address || ''}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">City *</label>
                    <input
                      type="text"
                      name="city"
                      defaultValue={editingProperty?.city || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">State *</label>
                    <input
                      type="text"
                      name="state"
                      defaultValue={editingProperty?.state || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">ZIP Code</label>
                    <input
                      type="text"
                      name="zip_code"
                      defaultValue={editingProperty?.zip_code || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Property Type *</label>
                  <select
                    name="property_type"
                    defaultValue={editingProperty?.property_type || ''}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  >
                    <option value="">Select type</option>
                    <option value="house">House</option>
                    <option value="doublewide">Double Wide</option>
                    <option value="singlewide">Single Wide</option>
                    <option value="loan">Loan</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Rent Value</label>
                  <input
                    type="number"
                    name="rent_value"
                    step="0.01"
                    defaultValue={editingProperty?.rent_value || ''}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    placeholder="Enter monthly rent value"
                  />
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="ml-3 flex-1">
                      <h3 className="text-sm font-medium text-blue-800">Insurance & Tax Management</h3>
                      <div className="mt-2 text-sm text-blue-700">
                        <p>To view or edit insurance premiums and property taxes, please use the <Link href="/" className="font-semibold underline hover:text-blue-900">Dashboard</Link> page.</p>
                        {editingProperty && (editingProperty.insurance_premium || editingProperty.property_tax) && (
                          <div className="mt-2 text-xs">
                            <p className="font-medium">Current values:</p>
                            {editingProperty.insurance_premium && (
                              <p>Insurance: ${editingProperty.insurance_premium.toLocaleString()}/year</p>
                            )}
                            {editingProperty.property_tax && (
                              <p>Tax: ${editingProperty.property_tax.toLocaleString()}/year</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Bedrooms</label>
                    <input
                      type="number"
                      name="bedrooms"
                      defaultValue={editingProperty?.bedrooms || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Bathrooms</label>
                    <input
                      type="number"
                      name="bathrooms"
                      step="0.5"
                      defaultValue={editingProperty?.bathrooms || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Square Feet</label>
                    <input
                      type="number"
                      name="square_feet"
                      defaultValue={editingProperty?.square_feet || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Lease Status</label>
                  <select
                    name="lease_status"
                    defaultValue={editingProperty?.leaseStatus || 'empty'}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  >
                    <option value="empty">Empty</option>
                    <option value="occupied">Has Tenants</option>
                    <option value="sold">Sold</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-500">Updates the lease status for this property</p>
                </div>
              </div>
              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false)
                    setEditingProperty(null)
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  {editingProperty ? 'Update Property' : 'Add Property'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
