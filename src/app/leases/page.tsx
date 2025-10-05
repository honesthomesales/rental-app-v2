'use client'

import { useEffect, useState, useMemo } from 'react'
import { Lease, Property, Tenant } from '@/types/database'
import { DocumentTextIcon, PlusIcon, CalendarIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'

interface LeaseWithDetails extends Lease {
  RENT_properties?: Property
  RENT_tenants?: Tenant
}

export default function LeasesPage() {
  const [allLeases, setAllLeases] = useState<LeaseWithDetails[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingLease, setEditingLease] = useState<LeaseWithDetails | null>(null)
  const [filters, setFilters] = useState({
    search: '',
    status: 'all'
  })
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    fetchLeases()
    fetchProperties()
    fetchTenants()
  }, [])

  const fetchLeases = async () => {
    try {
      const response = await fetch('/api/leases')
      const data = await response.json()
      setAllLeases(data || [])
    } catch (error) {
      console.error('Error fetching leases:', error)
      setAllLeases([])
    } finally {
      setLoading(false)
    }
  }

  const fetchProperties = async () => {
    try {
      const response = await fetch('/api/properties')
      const data = await response.json()
      setProperties(data || [])
    } catch (error) {
      console.error('Error fetching properties:', error)
      setProperties([])
    }
  }

  const fetchTenants = async () => {
    try {
      const response = await fetch('/api/tenants')
      const data = await response.json()
      setTenants(data || [])
    } catch (error) {
      console.error('Error fetching tenants:', error)
      setTenants([])
    }
  }

  // Filter leases based on current filter state
  const filteredLeases = useMemo(() => {
    return allLeases.filter(lease => {
      // Search filter
      if (filters.search) {
        const searchTerm = filters.search.toLowerCase()
        const propertyName = lease.RENT_properties?.name?.toLowerCase() || ''
        const propertyAddress = lease.RENT_properties?.address?.toLowerCase() || ''
        const tenantName = lease.RENT_tenants?.full_name?.toLowerCase() || 
                          `${lease.RENT_tenants?.first_name || ''} ${lease.RENT_tenants?.last_name || ''}`.toLowerCase()
        
        if (!propertyName.includes(searchTerm) && 
            !propertyAddress.includes(searchTerm) && 
            !tenantName.includes(searchTerm)) {
          return false
        }
      }

      // Status filter
      if (filters.status !== 'all') {
        const leaseStatus = lease.status?.toLowerCase() || 'active'
        if (filters.status.toLowerCase() !== leaseStatus) {
          return false
        }
      }

      return true
    })
  }, [allLeases, filters])

  const handleAddLease = () => {
    setShowAddModal(true)
  }

  const handleSubmitLease = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsSubmitting(true)
    
    try {
      const formData = new FormData(e.currentTarget)
      const leaseData = {
        property_id: formData.get('property_id') as string,
        tenant_id: formData.get('tenant_id') as string,
        lease_start_date: formData.get('lease_start_date') as string,
        lease_end_date: formData.get('lease_end_date') as string,
        rent: parseFloat(formData.get('rent') as string) || 0,
        rent_cadence: formData.get('rent_cadence') as string,
        rent_due_day: parseInt(formData.get('rent_due_day') as string) || 1,
        grace_days: parseInt(formData.get('grace_days') as string) || 0,
        status: 'active'
      }

      console.log('Submitting lease:', leaseData)

      const response = await fetch('/api/leases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(leaseData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create lease')
      }

      const newLease = await response.json()
      console.log('Lease created successfully:', newLease)

      // Refresh the leases list
      await fetchLeases()
      
      // Close the modal
      setShowAddModal(false)
      
      // Reset the form
      e.currentTarget.reset()
      
    } catch (error) {
      console.error('Error creating lease:', error)
      alert('Failed to create lease: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEditLease = (lease: LeaseWithDetails) => {
    setEditingLease(lease)
  }

  const handleDeleteLease = async (lease: LeaseWithDetails) => {
    if (!confirm(`Are you sure you want to delete this lease for ${lease.RENT_properties?.name}?`)) {
      return
    }

    try {
      const response = await fetch(`/api/leases?id=${lease.id}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete lease')
      }

      // Refresh the leases list
      await fetchLeases()
    } catch (error) {
      console.error('Error deleting lease:', error)
      alert('Failed to delete lease. Please try again.')
    }
  }

  const handleSaveLease = async (leaseData: Partial<LeaseWithDetails>) => {
    if (!editingLease) return

    try {
      const response = await fetch('/api/leases', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: editingLease.id,
          ...leaseData
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update lease')
      }

      // Refresh the leases list to show updated property/tenant associations
      await fetchLeases()
      setEditingLease(null)
    } catch (error) {
      console.error('Error updating lease:', error)
      alert('Failed to update lease. Please try again.')
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800'
      case 'inactive':
        return 'bg-gray-100 text-gray-800'
      case 'terminated':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getCadenceColor = (cadence: string) => {
    switch (cadence) {
      case 'weekly':
        return 'bg-blue-100 text-blue-800'
      case 'biweekly':
        return 'bg-purple-100 text-purple-800'
      case 'monthly':
        return 'bg-green-100 text-green-800'
      default:
        return 'bg-gray-100 text-gray-800'
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
          <h1 className="text-2xl font-bold text-gray-900">Leases</h1>
          <p className="text-gray-600 mt-2">Manage your rental leases</p>
        </div>
        <button
          onClick={handleAddLease}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center"
        >
          <PlusIcon className="h-5 w-5 mr-2" />
          Add Lease
        </button>
      </div>

      {/* Debug Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
        <div className="text-sm text-blue-800">
          <strong>Debug Info:</strong> Showing {filteredLeases.length} of {allLeases.length} leases
          <br />
          <strong>Filters:</strong> Search: "{filters.search}", Status: {filters.status}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">All Leases</h2>
            <div className="flex items-center space-x-4">
              <input
                type="text"
                placeholder="Search leases..."
                value={filters.search}
                onChange={(e) => setFilters({...filters, search: e.target.value})}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <select 
                value={filters.status}
                onChange={(e) => setFilters({...filters, status: e.target.value})}
                className="px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="terminated">Terminated</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Property / Tenant
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Lease Period
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Rent
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Due Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredLeases.map((lease) => (
                <tr key={lease.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10">
                        <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                          <DocumentTextIcon className="h-5 w-5 text-blue-600" />
                        </div>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">
                          {lease.RENT_properties?.name || 'Unknown Property'}
                        </div>
                        <div className="text-sm text-gray-500">
                          {lease.RENT_tenants?.full_name || 'Unknown Tenant'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center text-sm text-gray-900">
                      <CalendarIcon className="h-4 w-4 mr-2 text-gray-400" />
                      <div>
                        <div>{new Date(lease.lease_start_date).toLocaleDateString()}</div>
                        <div>to {new Date(lease.lease_end_date).toLocaleDateString()}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      ${lease.rent.toLocaleString()}
                    </div>
                    <div className="text-sm text-gray-500">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getCadenceColor(lease.rent_cadence || 'monthly')}`}>
                        {lease.rent_cadence || 'monthly'}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {(() => {
                        const today = new Date()
                        const leaseStart = new Date(lease.lease_start_date)
                        
                        // Calculate next due date based on cadence and rent_due_day
                        let nextDueDate = new Date(leaseStart)
                        
                        switch (lease.rent_cadence) {
                          case 'weekly':
                            // Use due_weekday if available, otherwise default to Friday (5)
                            const dueWeekday = lease.due_weekday || 5
                            const daysToDueDay = (dueWeekday - today.getDay() + 7) % 7
                            nextDueDate = new Date(today)
                            nextDueDate.setDate(today.getDate() + daysToDueDay)
                            break
                          case 'biweekly':
                            // Every other week on the due weekday starting from lease start
                            const biweeklyDueWeekday = lease.due_weekday || 5
                            const weeksSinceStart = Math.floor((today.getTime() - leaseStart.getTime()) / (7 * 24 * 60 * 60 * 1000))
                            const nextBiweeklyWeek = weeksSinceStart + (weeksSinceStart % 2 === 0 ? 2 : 1)
                            nextDueDate = new Date(leaseStart)
                            nextDueDate.setDate(leaseStart.getDate() + (nextBiweeklyWeek * 7))
                            // Adjust to the correct weekday
                            const currentWeekday = nextDueDate.getDay()
                            const daysToAdjust = (biweeklyDueWeekday - currentWeekday + 7) % 7
                            nextDueDate.setDate(nextDueDate.getDate() + daysToAdjust)
                            break
                          case 'monthly':
                            // Use rent_due_day if available, otherwise use lease start day
                            const dueDay = lease.rent_due_day || leaseStart.getDate()
                            nextDueDate = new Date(today.getFullYear(), today.getMonth(), dueDay)
                            if (nextDueDate <= today) {
                              nextDueDate = new Date(today.getFullYear(), today.getMonth() + 1, dueDay)
                            }
                            break
                        }
                        
                        return nextDueDate.toLocaleDateString()
                      })()}
                    </div>
                    <div className="text-xs text-gray-500">
                      {lease.rent_cadence === 'weekly' ? 
                        `Every ${lease.due_weekday ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][lease.due_weekday] : 'Friday'}` :
                       lease.rent_cadence === 'biweekly' ? 
                        `Every other ${lease.due_weekday ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][lease.due_weekday] : 'Friday'}` :
                       `Day ${lease.rent_due_day || new Date(lease.lease_start_date).getDate()} each month`}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(lease.status || 'active')}`}>
                      {lease.status || 'active'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleEditLease(lease)}
                        className="text-blue-600 hover:text-blue-900"
                        title="Edit Lease"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteLease(lease)}
                        className="text-red-600 hover:text-red-900"
                        title="Delete Lease"
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

      {filteredLeases.length === 0 && (
        <div className="text-center py-12">
          <DocumentTextIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No leases found</h3>
          <p className="text-gray-500 mb-4">Get started by adding your first lease.</p>
          <button
            onClick={handleAddLease}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Add Lease
          </button>
        </div>
      )}

      {/* Add Lease Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Add New Lease</h2>
            
            <form onSubmit={handleSubmitLease} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Property Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Property *</label>
                  <select
                    name="property_id"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select a property</option>
                    {properties.map(property => (
                      <option key={property.id} value={property.id}>
                        {property.name} - {property.address}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Tenant Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tenant *</label>
                  <select
                    name="tenant_id"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select a tenant</option>
                    {tenants.map(tenant => (
                      <option key={tenant.id} value={tenant.id}>
                        {tenant.full_name || `${tenant.first_name} ${tenant.last_name}`}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Lease Start Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lease Start Date *</label>
                  <input
                    type="date"
                    name="lease_start_date"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Lease End Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lease End Date</label>
                  <input
                    type="date"
                    name="lease_end_date"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Rent Amount */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rent Amount *</label>
                  <input
                    type="number"
                    name="rent"
                    step="0.01"
                    min="0"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="0.00"
                  />
                </div>

                {/* Rent Cadence */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rent Cadence *</label>
                  <select
                    name="rent_cadence"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select cadence</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>

                {/* Rent Due Day */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rent Due Day *</label>
                  <input
                    type="number"
                    name="rent_due_day"
                    min="1"
                    max="31"
                    required
                    defaultValue="1"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="1"
                  />
                </div>

                {/* Grace Days */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Grace Days</label>
                  <input
                    type="number"
                    name="grace_days"
                    min="0"
                    defaultValue="0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="0"
                  />
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Creating...' : 'Create Lease'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

          {/* Edit Lease Modal */}
          {editingLease && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Edit Lease</h2>
            <form onSubmit={(e) => {
              e.preventDefault()
              const formData = new FormData(e.currentTarget)
              const leaseData = {
                property_id: formData.get('property_id') as string,
                tenant_id: formData.get('tenant_id') as string,
                lease_start_date: formData.get('lease_start_date') as string,
                lease_end_date: formData.get('lease_end_date') as string,
                rent: parseFloat(formData.get('rent') as string) || 0,
                rent_cadence: formData.get('rent_cadence') as string,
                rent_due_day: parseInt(formData.get('rent_due_day') as string) || null,
                due_weekday: parseInt(formData.get('due_weekday') as string) || null,
                move_in_fee: parseFloat(formData.get('move_in_fee') as string) || 0,
                late_fee_amount: parseFloat(formData.get('late_fee_amount') as string) || 0,
                status: formData.get('status') as string,
                notes: formData.get('notes') as string
              }
              handleSaveLease(leaseData)
            }}>
              <div className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Property</label>
                    <select
                      name="property_id"
                      defaultValue={editingLease.property_id}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    >
                      <option value="">Select a property</option>
                      {properties.map((property) => (
                        <option key={property.id} value={property.id}>
                          {property.name} - {property.address}
                        </option>
                      ))}
                    </select>
                    {editingLease.RENT_properties && (
                      <p className="mt-1 text-sm text-gray-500">
                        Current: {editingLease.RENT_properties.name} - {editingLease.RENT_properties.address}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Tenant</label>
                    <select
                      name="tenant_id"
                      defaultValue={editingLease.tenant_id}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    >
                      <option value="">Select a tenant</option>
                      {tenants.map((tenant) => (
                        <option key={tenant.id} value={tenant.id}>
                          {tenant.full_name || `${tenant.first_name} ${tenant.last_name}`}
                        </option>
                      ))}
                    </select>
                    {editingLease.RENT_tenants && (
                      <p className="mt-1 text-sm text-gray-500">
                        Current: {editingLease.RENT_tenants.full_name || `${editingLease.RENT_tenants.first_name} ${editingLease.RENT_tenants.last_name}`}
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Lease Start Date</label>
                    <input
                      type="date"
                      name="lease_start_date"
                      defaultValue={editingLease.lease_start_date}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Lease End Date</label>
                    <input
                      type="date"
                      name="lease_end_date"
                      defaultValue={editingLease.lease_end_date}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Rent Amount</label>
                    <input
                      type="number"
                      name="rent"
                      step="0.01"
                      defaultValue={editingLease.rent}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Rent Cadence</label>
                    <select
                      name="rent_cadence"
                      defaultValue={editingLease.rent_cadence || 'monthly'}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    >
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Bi-weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Due Day of Month</label>
                    <input
                      type="number"
                      name="rent_due_day"
                      min="1"
                      max="31"
                      defaultValue={editingLease.rent_due_day || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      placeholder="e.g., 1 for 1st of month"
                    />
                    <p className="mt-1 text-xs text-gray-500">For monthly payments (1-31)</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Due Day of Week</label>
                    <select
                      name="due_weekday"
                      defaultValue={editingLease.due_weekday || 5}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    >
                      <option value="0">Sunday</option>
                      <option value="1">Monday</option>
                      <option value="2">Tuesday</option>
                      <option value="3">Wednesday</option>
                      <option value="4">Thursday</option>
                      <option value="5">Friday</option>
                      <option value="6">Saturday</option>
                    </select>
                    <p className="mt-1 text-xs text-gray-500">For weekly/bi-weekly payments</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Move-in Fee</label>
                    <input
                      type="number"
                      name="move_in_fee"
                      step="0.01"
                      defaultValue={editingLease.move_in_fee || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Late Fee Amount</label>
                    <input
                      type="number"
                      name="late_fee_amount"
                      step="0.01"
                      defaultValue={editingLease.late_fee_amount || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Status</label>
                    <select
                      name="status"
                      defaultValue={editingLease.status || 'active'}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="terminated">Terminated</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Notes</label>
                    <textarea
                      name="notes"
                      defaultValue={editingLease.notes || ''}
                      rows={3}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-200 sticky bottom-0 bg-white">
                <button
                  type="button"
                  onClick={() => setEditingLease(null)}
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
