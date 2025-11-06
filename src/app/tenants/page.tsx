'use client'

import { useEffect, useState, useMemo } from 'react'
import { Tenant, Property } from '@/types/database'
import { UsersIcon, PlusIcon, PhoneIcon, EnvelopeIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'

type SortField = 'name' | 'email' | 'phone' | 'is_active' | 'property' | 'lease_start_date'
type SortDirection = 'asc' | 'desc'

export default function TenantsPage() {
  const [allTenants, setAllTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null)
  const [showPropertyModal, setShowPropertyModal] = useState(false)
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null)
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    fetchTenants()
  }, [])

  const fetchTenants = async () => {
    try {
      console.log('Fetching tenants...')
      const response = await fetch('/api/tenants')
      console.log('Tenants response status:', response.status)
      
      if (!response.ok) {
        const errorData = await response.json()
        console.error('API error:', errorData)
        throw new Error(errorData.error || 'Failed to fetch tenants')
      }
      
      const data = await response.json()
      console.log('Tenants data received:', data?.length || 0)
      setAllTenants(data || [])
    } catch (error) {
      console.error('Error fetching tenants:', error)
      setAllTenants([])
    } finally {
      setLoading(false)
    }
  }

  // Compute filtered and sorted tenants using useMemo
  const tenants = useMemo(() => {
    let filtered = allTenants.filter(tenant => {
      if (!searchTerm) return true
      
      const searchLower = searchTerm.toLowerCase()
      const fullName = (tenant.full_name || `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim()).toLowerCase()
      const email = (tenant.email || '').toLowerCase()
      const phone = (tenant.phone || '').toLowerCase()
      const propertyName = (tenant.property?.name || '').toLowerCase()
      
      return fullName.includes(searchLower) || 
             email.includes(searchLower) || 
             phone.includes(searchLower) ||
             propertyName.includes(searchLower)
    })

    filtered.sort((a, b) => {
      let aValue: any
      let bValue: any

      switch (sortField) {
        case 'name':
          aValue = (a.full_name || `${a.first_name || ''} ${a.last_name || ''}`.trim() || 'NO TENANT').toLowerCase()
          bValue = (b.full_name || `${b.first_name || ''} ${b.last_name || ''}`.trim() || 'NO TENANT').toLowerCase()
          break
        case 'email':
          aValue = (a.email || '').toLowerCase()
          bValue = (b.email || '').toLowerCase()
          break
        case 'phone':
          aValue = a.phone || ''
          bValue = b.phone || ''
          break
        case 'is_active':
          aValue = a.is_active ? 1 : 0
          bValue = b.is_active ? 1 : 0
          break
        case 'property':
          aValue = (a.property?.name || '').toLowerCase()
          bValue = (b.property?.name || '').toLowerCase()
          break
        case 'lease_start_date':
          aValue = a.lease_start_date || ''
          bValue = b.lease_start_date || ''
          break
        default:
          aValue = ''
          bValue = ''
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
      return 0
    })

    return filtered
  }, [allTenants, sortField, sortDirection, searchTerm])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const handleAddTenant = () => {
    setShowAddModal(true)
  }

  const handleEditTenant = (tenant: Tenant) => {
    setEditingTenant(tenant)
  }

  const handleViewProperty = (property: Property) => {
    setSelectedProperty(property)
    setShowPropertyModal(true)
  }

  const handleDeleteTenant = async (tenant: Tenant) => {
    const tenantName = tenant.full_name || `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim() || 'NO TENANT'
    if (!confirm(`Are you sure you want to delete ${tenantName}?`)) {
      return
    }

    try {
      const response = await fetch(`/api/tenants?id=${tenant.id}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete tenant')
      }

      // Refresh the tenants list
      await fetchTenants()
    } catch (error) {
      console.error('Error deleting tenant:', error)
      alert('Failed to delete tenant. Please try again.')
    }
  }

  const handleSaveTenant = async (tenantData: Partial<Tenant>) => {
    if (!editingTenant) return

    try {
      const response = await fetch('/api/tenants', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: editingTenant.id,
          ...tenantData
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update tenant')
      }

      // Refresh the tenants list
      await fetchTenants()
      setEditingTenant(null)
    } catch (error) {
      console.error('Error updating tenant:', error)
      alert('Failed to update tenant. Please try again.')
    }
  }

  const handleSaveProperty = async (propertyData: Partial<Property>) => {
    if (!selectedProperty) return

    try {
      const response = await fetch('/api/properties', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: selectedProperty.id,
          ...propertyData
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update property')
      }

      // Refresh the tenants list to get updated property data
      await fetchTenants()
      setShowPropertyModal(false)
      setSelectedProperty(null)
    } catch (error) {
      console.error('Error updating property:', error)
      alert('Failed to update property. Please try again.')
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white p-6 rounded-lg shadow">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
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
          <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
          <p className="text-gray-600 mt-2">
            Manage your tenants {searchTerm && `(${tenants.length} of ${allTenants.length})`}
            {!searchTerm && `(${allTenants.length})`}
          </p>
        </div>
        <button
          onClick={handleAddTenant}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center"
        >
          <PlusIcon className="h-5 w-5 mr-2" />
          Add Tenant
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">All Tenants</h2>
            <div className="flex items-center space-x-4">
              <input
                type="text"
                placeholder="Search tenants..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center">
                    Name
                    {sortField === 'name' && (
                      <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('email')}
                >
                  <div className="flex items-center">
                    Contact
                    {sortField === 'email' && (
                      <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('is_active')}
                >
                  <div className="flex items-center">
                    Status
                    {sortField === 'is_active' && (
                      <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('property')}
                >
                  <div className="flex items-center">
                    Property
                    {sortField === 'property' && (
                      <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('lease_start_date')}
                >
                  <div className="flex items-center">
                    Lease Period
                    {sortField === 'lease_start_date' && (
                      <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10">
                        <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                          <span className="text-sm font-medium text-blue-800">
                            {(() => {
                              const fullName = tenant.full_name || `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim()
                              if (fullName) {
                                const parts = fullName.split(' ')
                                return (parts[0]?.[0] || '') + (parts[1]?.[0] || '')
                              }
                              return 'NT'
                            })()}
                          </span>
                        </div>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">
                          {tenant.full_name || `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim() || 'NO TENANT'}
                        </div>
                        <div className="text-xs text-gray-500">Tenant ID: {tenant.id?.toString().slice(0, 8) || 'N/A'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="space-y-1">
                      {tenant.email && (
                        <div className="flex items-center text-sm text-gray-600">
                          <EnvelopeIcon className="h-4 w-4 mr-2" />
                          {tenant.email}
                        </div>
                      )}
                      {tenant.phone && (
                        <div className="flex items-center text-sm text-gray-600">
                          <PhoneIcon className="h-4 w-4 mr-2" />
                          {tenant.phone}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      tenant.is_active 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {tenant.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {tenant.property ? (
                      <div className="flex items-center space-x-2">
                        <div>
                          <div className="font-medium text-gray-900">{tenant.property.name}</div>
                          <div className="text-xs text-gray-500">
                            {tenant.property.address}, {tenant.property.city}, {tenant.property.state}
                          </div>
                        </div>
                        <button
                          onClick={() => handleViewProperty(tenant.property!)}
                          className="text-blue-600 hover:text-blue-900 text-xs"
                          title="View Property Details"
                        >
                          View
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-400">No property assigned</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {tenant.lease_start_date && tenant.lease_end_date ? (
                      <div>
                        <div>{new Date(tenant.lease_start_date).toLocaleDateString()}</div>
                        <div>to {new Date(tenant.lease_end_date).toLocaleDateString()}</div>
                      </div>
                    ) : (
                      'No lease data'
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleEditTenant(tenant)}
                        className="text-blue-600 hover:text-blue-900"
                        title="Edit Tenant"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteTenant(tenant)}
                        className="text-red-600 hover:text-red-900"
                        title="Delete Tenant"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {tenants.length === 0 && (
        <div className="text-center py-12">
          <UsersIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No tenants found</h3>
          <p className="text-gray-500 mb-4">Get started by adding your first tenant.</p>
          <button
            onClick={handleAddTenant}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Add Tenant
          </button>
        </div>
      )}

      {/* Add Tenant Modal - Placeholder */}
      {showAddModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Tenant</h2>
            <p className="text-gray-600 mb-4">Tenant form will be implemented here.</p>
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

      {/* Edit Tenant Modal */}
      {editingTenant && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Edit Tenant</h2>
            <form onSubmit={(e) => {
              e.preventDefault()
              const formData = new FormData(e.currentTarget)
              const tenantData = {
                first_name: formData.get('first_name') as string,
                last_name: formData.get('last_name') as string,
                full_name: formData.get('full_name') as string,
                email: formData.get('email') as string,
                phone: formData.get('phone') as string,
                is_active: formData.get('is_active') === 'on',
                notes: formData.get('notes') as string
              }
              handleSaveTenant(tenantData)
            }}>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">First Name</label>
                    <input
                      type="text"
                      name="first_name"
                      defaultValue={editingTenant.first_name}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Last Name</label>
                    <input
                      type="text"
                      name="last_name"
                      defaultValue={editingTenant.last_name}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Full Name</label>
                  <input
                    type="text"
                    name="full_name"
                    defaultValue={editingTenant.full_name || ''}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    placeholder="Auto-generated if left empty"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Email</label>
                    <input
                      type="email"
                      name="email"
                      defaultValue={editingTenant.email || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Phone</label>
                    <input
                      type="tel"
                      name="phone"
                      defaultValue={editingTenant.phone || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Notes</label>
                  <textarea
                    name="notes"
                    defaultValue={editingTenant.notes || ''}
                    rows={3}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      name="is_active"
                      defaultChecked={editingTenant.is_active}
                      className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                    />
                    <span className="ml-2 text-sm text-gray-700">Active Tenant</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => setEditingTenant(null)}
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

      {/* Property Modal */}
      {showPropertyModal && selectedProperty && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Property Details</h2>
            <form onSubmit={(e) => {
              e.preventDefault()
              const formData = new FormData(e.currentTarget)
              const propertyData = {
                name: formData.get('name') as string,
                address: formData.get('address') as string,
                city: formData.get('city') as string,
                state: formData.get('state') as string,
                zip_code: formData.get('zip_code') as string,
                bedrooms: formData.get('bedrooms') ? parseInt(formData.get('bedrooms') as string) : undefined,
                bathrooms: formData.get('bathrooms') ? parseInt(formData.get('bathrooms') as string) : undefined,
                square_feet: formData.get('square_feet') ? parseInt(formData.get('square_feet') as string) : undefined,
                property_type: formData.get('property_type') as string,
                monthly_rent: formData.get('monthly_rent') ? parseFloat(formData.get('monthly_rent') as string) : undefined,
                notes: formData.get('notes') as string
              }
              handleSaveProperty(propertyData)
            }}>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Property Name</label>
                    <input
                      type="text"
                      name="name"
                      defaultValue={selectedProperty.name}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Property Type</label>
                    <select
                      name="property_type"
                      defaultValue={selectedProperty.property_type || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    >
                      <option value="">Select Type</option>
                      <option value="house">House</option>
                      <option value="doublewide">Double Wide</option>
                      <option value="singlewide">Single Wide</option>
                      <option value="loan">Loan</option>
                    </select>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700">Address</label>
                  <input
                    type="text"
                    name="address"
                    defaultValue={selectedProperty.address}
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
                      defaultValue={selectedProperty.city}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">State</label>
                    <input
                      type="text"
                      name="state"
                      defaultValue={selectedProperty.state}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">ZIP Code</label>
                    <input
                      type="text"
                      name="zip_code"
                      defaultValue={selectedProperty.zip_code}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Bedrooms</label>
                    <input
                      type="number"
                      name="bedrooms"
                      defaultValue={selectedProperty.bedrooms || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Bathrooms</label>
                    <input
                      type="number"
                      name="bathrooms"
                      defaultValue={selectedProperty.bathrooms || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      min="0"
                      step="0.5"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Square Feet</label>
                    <input
                      type="number"
                      name="square_feet"
                      defaultValue={selectedProperty.square_feet || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      min="0"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700">Monthly Rent</label>
                  <input
                    type="number"
                    name="monthly_rent"
                    defaultValue={selectedProperty.monthly_rent || ''}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    min="0"
                    step="0.01"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700">Notes</label>
                  <textarea
                    name="notes"
                    defaultValue={selectedProperty.notes || ''}
                    rows={3}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
              </div>
              
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowPropertyModal(false)
                    setSelectedProperty(null)
                  }}
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
