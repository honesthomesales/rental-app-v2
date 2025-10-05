'use client'

import React, { useEffect, useState } from 'react'
import { Property } from '@/types/database'
import { BuildingOfficeIcon, PlusIcon, MagnifyingGlassIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'

type SortField = 'name' | 'city' | 'property_type' | 'rent_value' | 'cadence' | 'tenantName' | 'isOccupied' | 'is_for_rent'
type SortDirection = 'asc' | 'desc'

type PropertyWithLease = Property & {
  cadence?: string
  tenantName?: string
  isOccupied?: boolean
}

export default function PropertiesPage() {
  
  const [properties, setProperties] = useState<PropertyWithLease[]>([])
  const [filteredProperties, setFilteredProperties] = useState<PropertyWithLease[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingProperty, setEditingProperty] = useState<PropertyWithLease | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  useEffect(() => {
    fetchProperties()
  }, [])

  useEffect(() => {
    filterAndSortProperties()
  }, [properties, searchTerm, sortField, sortDirection])

  const fetchProperties = async () => {
    try {
      const response = await fetch('/api/properties')
      
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
      const currentDate = new Date()
      const propertiesWithLease = data.map((property: Property) => {
        // Find lease where current date is between lease_start_date and lease_end_date
        const activeLease = leaseData.find((lease: any) => {
          if (lease.property_id !== property.id) return false
          
          const startDate = new Date(lease.lease_start_date)
          const endDate = lease.lease_end_date ? new Date(lease.lease_end_date) : null
          
          // Check if current date is within lease period
          const isWithinLeasePeriod = currentDate >= startDate && (!endDate || currentDate <= endDate)
          
          return isWithinLeasePeriod
        })
        
        // Try different field names for tenant name
        const tenantName = activeLease?.RENT_tenants?.full_name || 
                          (activeLease?.RENT_tenants?.first_name && activeLease?.RENT_tenants?.last_name ? 
                            `${activeLease.RENT_tenants.first_name} ${activeLease.RENT_tenants.last_name}` : 
                            'Vacant')
        
        return {
          ...property,
          cadence: activeLease?.rent_cadence || 'N/A',
          tenantName: tenantName,
          isOccupied: !!activeLease
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

  const filterAndSortProperties = () => {
    let filtered = properties.filter(property => {
      const searchLower = searchTerm.toLowerCase()
      return (
        property.name.toLowerCase().includes(searchLower) ||
        property.address.toLowerCase().includes(searchLower) ||
        property.city.toLowerCase().includes(searchLower) ||
        property.state.toLowerCase().includes(searchLower) ||
        property.property_type.toLowerCase().includes(searchLower)
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

    setFilteredProperties(filtered)
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
    setShowAddModal(true)
  }

  const handleEditProperty = (property: Property) => {
    setEditingProperty(property)
  }



  const handleSaveProperty = async (propertyData: Partial<PropertyWithLease>) => {
    if (!editingProperty) return

    try {
      const response = await fetch('/api/properties', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: editingProperty.id,
          ...propertyData
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update property')
      }

      // Refresh the properties list
      await fetchProperties()
      setEditingProperty(null)
    } catch (error) {
      console.error('Error updating property:', error)
      alert(`Failed to update property. Please try again. Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleDeleteProperty = async (property: PropertyWithLease) => {
    if (!confirm(`Are you sure you want to delete ${property.name}?`)) {
      return
    }

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
        <button
          onClick={handleAddProperty}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center"
        >
          <PlusIcon className="h-5 w-5 mr-2" />
          Add Property
        </button>
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
                  onClick={() => handleSort('isOccupied')}
                >
                  <div className="flex items-center">
                    Occupied
                    {sortField === 'isOccupied' && (
                      <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('is_for_rent')}
                >
                  <div className="flex items-center">
                    Status
                    {sortField === 'is_for_rent' && (
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
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <BuildingOfficeIcon className="h-5 w-5 text-blue-600 mr-3" />
                        <div>
                          <div className="text-sm font-medium text-gray-900">{property.name}</div>
                          <div className="text-sm text-gray-500">{property.tenantName}</div>
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
                      ${property.rent_value?.toLocaleString() || 'N/A'}
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
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        property.isOccupied 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {property.isOccupied ? 'Occupied' : 'Unoccupied'}
                      </span>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        property.is_for_rent 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {property.is_for_rent ? 'For Rent' : 'Not Available'}
                      </span>
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

      {/* Add Property Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Property</h2>
            <p className="text-gray-600 mb-4">Property form will be implemented here.</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Property Modal */}
      {editingProperty && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Edit Property</h2>
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
                is_for_rent: formData.get('is_for_rent') === 'on'
              }
              handleSaveProperty(propertyData)
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Property Name</label>
                  <input
                    type="text"
                    name="name"
                    defaultValue={editingProperty.name}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Address</label>
                  <input
                    type="text"
                    name="address"
                    defaultValue={editingProperty.address}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">City</label>
                    <input
                      type="text"
                      name="city"
                      defaultValue={editingProperty.city}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">State</label>
                    <input
                      type="text"
                      name="state"
                      defaultValue={editingProperty.state}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">ZIP Code</label>
                    <input
                      type="text"
                      name="zip_code"
                      defaultValue={editingProperty.zip_code}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Property Type</label>
                  <select
                    name="property_type"
                    defaultValue={editingProperty.property_type}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  >
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
                    defaultValue={editingProperty.rent_value || ''}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    placeholder="Enter monthly rent value"
                  />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Bedrooms</label>
                    <input
                      type="number"
                      name="bedrooms"
                      defaultValue={editingProperty.bedrooms || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Bathrooms</label>
                    <input
                      type="number"
                      name="bathrooms"
                      step="0.5"
                      defaultValue={editingProperty.bathrooms || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Square Feet</label>
                    <input
                      type="number"
                      name="square_feet"
                      defaultValue={editingProperty.square_feet || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                </div>
                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      name="is_for_rent"
                      defaultChecked={editingProperty.is_for_rent}
                      className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                    />
                    <span className="ml-2 text-sm text-gray-700">Available for Rent</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => setEditingProperty(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
