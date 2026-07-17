'use client'

import { useEffect, useState, useMemo } from 'react'
import { Lease, Property, Tenant } from '@/types/database'
import { DocumentTextIcon, PlusIcon, CalendarIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import {
  LEASE_STATUS_OPTIONS,
  leaseStatusLabel,
  leaseStatusBadgeClass,
  isPeriodToPeriod,
  periodToPeriodSinceLabel,
  isPhysicallyOccupied,
} from '@/lib/lease-status'
import { getBusinessDate } from '@/lib/business-date'
import type { RentChangePreview } from '@/lib/rent-change'
import { TenantCommunicationActions } from '@/components/communications/TenantCommunicationActions'
import {
  TextTenantModal,
  type CommunicationTarget,
} from '@/components/communications/TextTenantModal'

interface LeaseWithDetails extends Lease {
  RENT_properties?: Property
  RENT_tenants?: Tenant
}

type SortField = 'property' | 'tenant' | 'lease_start_date' | 'rent' | 'status'
type SortDirection = 'asc' | 'desc'

export default function LeasesPage() {
  const [allLeases, setAllLeases] = useState<LeaseWithDetails[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingLease, setEditingLease] = useState<LeaseWithDetails | null>(null)
  const [filters, setFilters] = useState({ search: '', status: 'all' })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sortField, setSortField] = useState<SortField>('property')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const [businessDate] = useState(() => getBusinessDate())

  // Edit modal controlled state
  const [originalRent, setOriginalRent] = useState<number>(0)
  const [editRent, setEditRent] = useState<number>(0)
  const [originalStatus, setOriginalStatus] = useState<string>('occupied')
  const [editStatus, setEditStatus] = useState<string>('occupied')
  const [rentEffectiveDate, setRentEffectiveDate] = useState<string>('')
  const [effectiveDateOptions, setEffectiveDateOptions] = useState<string[]>([])
  const [rentPreview, setRentPreview] = useState<RentChangePreview | null>(null)
  const [showPreviewPanel, setShowPreviewPanel] = useState(false)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [pendingLeaseData, setPendingLeaseData] = useState<Record<string, any> | null>(null)
  const [endingDate, setEndingDate] = useState<string>('')
  const [commTarget, setCommTarget] = useState<CommunicationTarget | null>(null)

  const rentChanged = editRent !== originalRent
  const isTransitioningToVacant =
    ['empty', 'sold'].includes(editStatus) && isPhysicallyOccupied(originalStatus)

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

  const filteredLeases = useMemo(() => {
    let filtered = allLeases.filter(lease => {
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

      if (filters.status !== 'all') {
        const leaseStatus = lease.status?.toLowerCase() || 'occupied'
        if (filters.status.toLowerCase() !== leaseStatus) {
          return false
        }
      }

      return true
    })

    filtered.sort((a, b) => {
      let aValue: any
      let bValue: any

      switch (sortField) {
        case 'property':
          aValue = (a.RENT_properties?.name || '').toLowerCase()
          bValue = (b.RENT_properties?.name || '').toLowerCase()
          break
        case 'tenant':
          aValue = (a.RENT_tenants?.full_name || '').toLowerCase()
          bValue = (b.RENT_tenants?.full_name || '').toLowerCase()
          break
        case 'lease_start_date':
          aValue = a.lease_start_date || ''
          bValue = b.lease_start_date || ''
          break
        case 'rent':
          aValue = a.rent || 0
          bValue = b.rent || 0
          break
        case 'status':
          aValue = (a.status || 'occupied').toLowerCase()
          bValue = (b.status || 'occupied').toLowerCase()
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
  }, [allLeases, filters, sortField, sortDirection])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

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
        status: formData.get('status') as string || 'occupied',
      }

      console.log('Submitting lease:', leaseData)

      const response = await fetch('/api/leases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leaseData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        const errorMessage = errorData.details || errorData.error || 'Failed to create lease'
        console.error('Lease creation error details:', errorData)
        throw new Error(errorMessage)
      }

      const newLease = await response.json()
      console.log('Lease created successfully:', newLease)

      if (e.currentTarget) {
        e.currentTarget.reset()
      }

      await fetchLeases()
      setShowAddModal(false)
    } catch (error) {
      console.error('Error creating lease:', error)
      alert('Failed to create lease: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEditLease = (lease: LeaseWithDetails) => {
    const status = lease.status || 'occupied'
    setEditingLease(lease)
    setOriginalRent(lease.rent)
    setEditRent(lease.rent)
    setOriginalStatus(status)
    setEditStatus(status)
    setRentEffectiveDate(businessDate)
    setEffectiveDateOptions([businessDate])
    setRentPreview(null)
    setShowPreviewPanel(false)
    setPendingLeaseData(null)
    setEndingDate(businessDate)
  }

  const handleEditSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)

    const leaseData: Record<string, any> = {
      property_id: formData.get('property_id') as string,
      tenant_id: formData.get('tenant_id') as string,
      lease_start_date: formData.get('lease_start_date') as string,
      lease_end_date: isTransitioningToVacant
        ? endingDate
        : (formData.get('lease_end_date') as string),
      rent: editRent,
      rent_cadence: formData.get('rent_cadence') as string,
      rent_due_day: parseInt(formData.get('rent_due_day') as string) || null,
      due_weekday: parseInt(formData.get('due_weekday') as string) || null,
      move_in_fee: parseFloat(formData.get('move_in_fee') as string) || 0,
      late_fee_amount: parseFloat(formData.get('late_fee_amount') as string) || 0,
      status: editStatus,
      notes: formData.get('notes') as string,
    }

    if (rentChanged) {
      leaseData.rentEffectiveDate = rentEffectiveDate || businessDate
    }

    if (rentChanged && !showPreviewPanel) {
      setIsLoadingPreview(true)
      try {
        const params = new URLSearchParams({
          leaseId: editingLease!.id,
          newRent: String(editRent),
          effectiveDate: rentEffectiveDate || businessDate,
        })
        const res = await fetch(`/api/leases/rent-change-preview?${params}`)
        if (!res.ok) throw new Error('Preview request failed')
        const preview: RentChangePreview & { effectiveDateOptions?: string[] } = await res.json()
        setRentPreview(preview)
        if (preview.effectiveDateOptions?.length) {
          setEffectiveDateOptions(preview.effectiveDateOptions)
        }
        setPendingLeaseData(leaseData)
        setShowPreviewPanel(true)
      } catch (err) {
        console.error('Error fetching rent change preview:', err)
        alert('Failed to fetch rent change preview. Please try again.')
      } finally {
        setIsLoadingPreview(false)
      }
      return
    }

    await handleSaveLease(leaseData)
  }

  const handleConfirmSave = async () => {
    if (!pendingLeaseData) return
    await handleSaveLease(pendingLeaseData)
  }

  const handleDeleteLease = async (lease: LeaseWithDetails) => {
    try {
      const response = await fetch(`/api/leases?id=${lease.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete lease')
      }

      await fetchLeases()
    } catch (error) {
      console.error('Error deleting lease:', error)
      alert('Failed to delete lease. Please try again.')
    }
  }

  const handleSaveLease = async (leaseData: Record<string, any>) => {
    if (!editingLease) return

    try {
      const response = await fetch('/api/leases', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingLease.id,
          ...leaseData,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update lease')
      }

      await fetchLeases()
      setEditingLease(null)
    } catch (error) {
      console.error('Error updating lease:', error)
      alert('Failed to update lease. Please try again.')
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
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="all">All Status</option>
                {LEASE_STATUS_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('property')}
                >
                  <div className="flex items-center">
                    Property / Tenant
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
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('rent')}
                >
                  <div className="flex items-center">
                    Rent
                    {sortField === 'rent' && (
                      <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Due Date
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('status')}
                >
                  <div className="flex items-center">
                    Status
                    {sortField === 'status' && (
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
                        let nextDueDate = new Date(leaseStart)

                        switch (lease.rent_cadence) {
                          case 'weekly': {
                            const dueWeekday = lease.due_weekday || 5
                            const daysToDueDay = (dueWeekday - today.getDay() + 7) % 7
                            nextDueDate = new Date(today)
                            nextDueDate.setDate(today.getDate() + daysToDueDay)
                            break
                          }
                          case 'biweekly': {
                            const biweeklyDueWeekday = lease.due_weekday || 5
                            const weeksSinceStart = Math.floor((today.getTime() - leaseStart.getTime()) / (7 * 24 * 60 * 60 * 1000))
                            const nextBiweeklyWeek = weeksSinceStart + (weeksSinceStart % 2 === 0 ? 2 : 1)
                            nextDueDate = new Date(leaseStart)
                            nextDueDate.setDate(leaseStart.getDate() + (nextBiweeklyWeek * 7))
                            const currentWeekday = nextDueDate.getDay()
                            const daysToAdjust = (biweeklyDueWeekday - currentWeekday + 7) % 7
                            nextDueDate.setDate(nextDueDate.getDate() + daysToAdjust)
                            break
                          }
                          case 'monthly':
                          default: {
                            const dueDay = lease.rent_due_day || leaseStart.getDate()
                            nextDueDate = new Date(today.getFullYear(), today.getMonth(), dueDay)
                            if (nextDueDate <= today) {
                              nextDueDate = new Date(today.getFullYear(), today.getMonth() + 1, dueDay)
                            }
                            break
                          }
                        }

                        return nextDueDate.toLocaleDateString()
                      })()}
                    </div>
                    <div className="text-xs text-gray-500">
                      {lease.rent_cadence === 'weekly' ?
                        `Every ${lease.due_weekday != null ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][lease.due_weekday] : 'Friday'}` :
                        lease.rent_cadence === 'biweekly' ?
                          `Every other ${lease.due_weekday != null ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][lease.due_weekday] : 'Friday'}` :
                          `Day ${lease.rent_due_day || new Date(lease.lease_start_date).getDate()} each month`}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${leaseStatusBadgeClass(lease.status)}`}>
                      {leaseStatusLabel(lease.status)}
                    </span>
                    {isPeriodToPeriod({ status: lease.status, leaseEndDate: lease.lease_end_date, businessDate }) && (
                      <div className="text-xs text-orange-600 mt-1">
                        {periodToPeriodSinceLabel(lease.lease_end_date!)}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex flex-col gap-2">
                      <TenantCommunicationActions
                        phone={lease.RENT_tenants?.phone}
                        onText={() =>
                          setCommTarget({
                            tenantId: lease.tenant_id || lease.RENT_tenants?.id || '',
                            tenantName:
                              lease.RENT_tenants?.full_name ||
                              `${lease.RENT_tenants?.first_name || ''} ${lease.RENT_tenants?.last_name || ''}`.trim() ||
                              'Tenant',
                            phone: lease.RENT_tenants?.phone,
                            propertyId: lease.property_id || lease.RENT_properties?.id || null,
                            propertyLabel:
                              lease.RENT_properties?.address ||
                              lease.RENT_properties?.name ||
                              null,
                            leaseId: lease.id,
                            leaseStatus: lease.status || null,
                            templateContext: {
                              amount_due: lease.rent != null ? `$${Number(lease.rent).toLocaleString()}` : '',
                            },
                          })
                        }
                      />
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

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lease Start Date *</label>
                  <input
                    type="date"
                    name="lease_start_date"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lease End Date</label>
                  <input
                    type="date"
                    name="lease_end_date"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

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

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status *</label>
                  <select
                    name="status"
                    required
                    defaultValue="occupied"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {LEASE_STATUS_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>

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

            {showPreviewPanel && rentPreview ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-medium text-gray-900 mb-1">Rent Change Preview</h3>
                  <p className="text-sm text-gray-600 bg-blue-50 border border-blue-100 rounded-md p-3">
                    Past invoices will not be changed. Existing open or partial invoices due on
                    or after the effective date will be updated.
                  </p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    <span className="text-gray-600">Old rent</span>
                    <span className="font-medium">${rentPreview.oldRent.toLocaleString()}</span>
                    <span className="text-gray-600">New rent</span>
                    <span className="font-medium">${rentPreview.newRent.toLocaleString()}</span>
                    <span className="text-gray-600">Effective date</span>
                    <span className="font-medium">{rentPreview.effectiveDate}</span>
                    <span className="text-gray-600">Affected future invoices</span>
                    <span className="font-medium">{rentPreview.affectedInvoiceCount}</span>
                    {rentPreview.earliestAffectedDate && (
                      <>
                        <span className="text-gray-600">Earliest affected due date</span>
                        <span className="font-medium">{rentPreview.earliestAffectedDate}</span>
                        <span className="text-gray-600">Latest affected due date</span>
                        <span className="font-medium">{rentPreview.latestAffectedDate}</span>
                      </>
                    )}
                    <span className="text-gray-600">Current invoice total</span>
                    <span className="font-medium">${rentPreview.currentInvoiceTotal.toLocaleString()}</span>
                    <span className="text-gray-600">Proposed invoice total</span>
                    <span className="font-medium">${rentPreview.proposedInvoiceTotal.toLocaleString()}</span>
                    <span className="text-gray-600">Resulting balance change</span>
                    <span className={`font-medium ${rentPreview.totalBalanceChange > 0 ? 'text-red-600' : rentPreview.totalBalanceChange < 0 ? 'text-green-600' : 'text-gray-800'}`}>
                      {rentPreview.totalBalanceChange >= 0 ? '+' : ''}${rentPreview.totalBalanceChange.toLocaleString()}
                    </span>
                    <span className="text-gray-600">Skipped past invoices</span>
                    <span className="font-medium">{rentPreview.skippedPast}</span>
                    <span className="text-gray-600">Skipped PAID invoices</span>
                    <span className="font-medium">{rentPreview.skippedPaid}</span>
                    <span className="text-gray-600">Skipped VOID invoices</span>
                    <span className="font-medium">{rentPreview.skippedVoid}</span>
                  </div>
                  {rentPreview.affectedInvoiceCount === 0 && (
                    <p className="text-sm text-gray-500 mt-2">No open or partial invoices on or after the effective date will be updated.</p>
                  )}
                </div>
                <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPreviewPanel(false)
                      setRentPreview(null)
                      setPendingLeaseData(null)
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmSave}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Apply Rent Change Going Forward
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleEditSubmit}>
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
                      {isTransitioningToVacant ? (
                        <>
                          <label className="block text-sm font-medium text-gray-700">Actual Ending Date</label>
                          <input
                            type="date"
                            value={endingDate}
                            onChange={e => setEndingDate(e.target.value)}
                            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                            required
                          />
                          <p className="mt-1 text-xs text-gray-500">Date tenant vacated for {editStatus}</p>
                        </>
                      ) : (
                        <>
                          <label className="block text-sm font-medium text-gray-700">Lease End Date</label>
                          <input
                            type="date"
                            name="lease_end_date"
                            defaultValue={editingLease.lease_end_date}
                            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                            required
                          />
                        </>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Rent Amount</label>
                      <input
                        type="number"
                        name="rent"
                        step="0.01"
                        value={editRent}
                        onChange={e => {
                          setEditRent(parseFloat(e.target.value) || 0)
                          setRentPreview(null)
                          setShowPreviewPanel(false)
                          setPendingLeaseData(null)
                        }}
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

                  {rentChanged && (
                    <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 space-y-3">
                      <p className="text-sm font-medium text-amber-800">
                        Rent changed from ${originalRent.toLocaleString()} → ${editRent.toLocaleString()}.
                        The new rent applies prospectively from the effective date.
                      </p>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Effective date</label>
                        <input
                          type="date"
                          value={rentEffectiveDate || businessDate}
                          min={businessDate}
                          onChange={e => {
                            setRentEffectiveDate(e.target.value)
                            setRentPreview(null)
                            setShowPreviewPanel(false)
                            setPendingLeaseData(null)
                          }}
                          className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                          required
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          Defaults to today ({businessDate}). Only open or partial invoices due on or after this date are updated.
                        </p>
                      </div>
                      {effectiveDateOptions.length > 1 && (
                        <div className="flex flex-wrap gap-2">
                          {effectiveDateOptions.map(d => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => {
                                setRentEffectiveDate(d)
                                setRentPreview(null)
                                setShowPreviewPanel(false)
                                setPendingLeaseData(null)
                              }}
                              className={`text-xs px-2 py-1 rounded border ${rentEffectiveDate === d ? 'bg-amber-200 border-amber-400' : 'bg-white border-gray-300 hover:bg-gray-50'}`}
                            >
                              {d === businessDate ? 'Today' : `Next period: ${d}`}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

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
                        value={editStatus}
                        onChange={e => setEditStatus(e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      >
                        {LEASE_STATUS_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
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
                    disabled={isLoadingPreview}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoadingPreview ? 'Loading preview…' : rentChanged ? 'Preview & Save' : 'Save Changes'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <TextTenantModal
        open={Boolean(commTarget)}
        target={commTarget}
        onClose={() => setCommTarget(null)}
      />
    </div>
  )
}
