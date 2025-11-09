'use client'

import { useEffect, useState, useMemo } from 'react'
import { LateTenantData } from '@/types/database'
import { ExclamationTriangleIcon, PhoneIcon, EnvelopeIcon, CurrencyDollarIcon, XMarkIcon } from '@heroicons/react/24/outline'

export default function LateTenantsPage() {
  const [summary, setSummary] = useState<any>({
    lateLeases: 0,
    totalLateOwed: 0,
    thirtyPlusLate: 0,
    avgDaysLate: 0
  })
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    daysLate: 'all',
    cadence: 'all',
    property: 'all',
    search: ''
  })
  const [expandedTenant, setExpandedTenant] = useState<string | null>(null)
  const [selectedPeriod, setSelectedPeriod] = useState<{tenant: any, period: any} | null>(null)
  const [showPeriodModal, setShowPeriodModal] = useState(false)
  const [viewMode, setViewMode] = useState<'detailed' | 'condensed'>('condensed')
  const [sortField, setSortField] = useState<string>('daysLate')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [showPaymentsModal, setShowPaymentsModal] = useState(false)
  const [selectedTenantPayments, setSelectedTenantPayments] = useState<any[]>([])
  const [selectedTenantInfo, setSelectedTenantInfo] = useState<any>(null)
  const [allLateTenants, setAllLateTenants] = useState<any[]>([])

  useEffect(() => {
    fetchLateTenants()
  }, [])

  const fetchLateTenants = async () => {
    try {
      console.log('Fetching late tenants...')
      const response = await fetch('/api/late-tenants')
      console.log('Late tenants response status:', response.status)
      
      if (!response.ok) {
        const errorData = await response.json()
        console.error('API error:', errorData)
        throw new Error(errorData.error || 'Failed to fetch late tenants')
      }
      
      const data = await response.json()
      console.log('📥 API Response:', data?.rows?.length, 'tenants loaded')
      console.log('📥 Sample tenant:', data?.rows?.[0])
      setAllLateTenants(data?.rows || [])
      setSummary(data?.summary || {
        lateLeases: 0,
        totalLateOwed: 0,
        thirtyPlusLate: 0,
        avgDaysLate: 0
      })
    } catch (error) {
      console.error('Error fetching late tenants:', error)
      setAllLateTenants([])
    } finally {
      setLoading(false)
    }
  }

  // Filter and sort late tenants
  const filteredLateTenants = useMemo(() => {
    console.log('🔄 Filtering with:', filters, 'Total tenants:', allLateTenants.length)
    let filtered = allLateTenants.filter(tenant => {
      // Days late filter
      if (filters.daysLate !== 'all') {
        const minDays = parseInt(filters.daysLate)
        if (tenant.daysLate < minDays) return false
      }

      // Cadence filter
      if (filters.cadence !== 'all') {
        const tenantCadence = tenant.lease?.rent_cadence?.toLowerCase() || ''
        if (filters.cadence === 'weekly' && !tenantCadence.includes('weekly')) return false
        if (filters.cadence === 'biweekly' && !tenantCadence.includes('bi') && !tenantCadence.includes('bi-weekly')) return false
        if (filters.cadence === 'monthly' && !tenantCadence.includes('monthly')) return false
      }

      // Search filter
      if (filters.search) {
        const searchTerm = filters.search.toLowerCase()
        const tenantName = tenant.tenant?.full_name?.toLowerCase() || ''
        const propertyName = tenant.property?.name?.toLowerCase() || ''
        const propertyAddress = tenant.property?.address?.toLowerCase() || ''
        
        if (!tenantName.includes(searchTerm) && 
            !propertyName.includes(searchTerm) && 
            !propertyAddress.includes(searchTerm)) {
          return false
        }
      }

      return true
    })

    // Sort filtered tenants
    filtered.sort((a, b) => {
      let aValue: any
      let bValue: any

      switch (sortField) {
        case 'daysLate':
          aValue = a.daysLate || 0
          bValue = b.daysLate || 0
          break
        case 'tenant':
          aValue = (a.tenant?.full_name || '').toLowerCase()
          bValue = (b.tenant?.full_name || '').toLowerCase()
          break
        case 'property':
          aValue = (a.property?.name || '').toLowerCase()
          bValue = (b.property?.name || '').toLowerCase()
          break
        case 'totalOwedLate':
          aValue = a.totalOwedLate || 0
          bValue = b.totalOwedLate || 0
          break
        case 'cadence':
          aValue = (a.lease?.rent_cadence || '').toLowerCase()
          bValue = (b.lease?.rent_cadence || '').toLowerCase()
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
  }, [allLateTenants, filters, sortField, sortDirection])

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  // Use filteredLateTenants directly - no need for separate lateTenants state

  const handleCall = (phone: string) => {
    window.open(`tel:${phone}`)
  }

  const handleText = (phone: string) => {
    window.open(`sms:${phone}`)
  }

  const handleEmail = (email: string) => {
    window.open(`mailto:${email}`)
  }

  const handleWaiveLateFee = async (tenant: any) => {
    try {
      const currentDate = new Date().toISOString().split('T')[0]
      
      console.log('🔍 Frontend Waive Debug - Tenant:', tenant)
      console.log('🔍 Frontend Waive Debug - Lease ID:', tenant.leaseId)
      
      const response = await fetch('/api/late-fees/waive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leaseId: tenant.leaseId,
          currentDate
        })
      })

      const result = await response.json()

      if (result.success) {
        // Refresh the data
        console.log('🔍 Refreshing data after waiver...')
        await fetchLateTenants()
        console.log('🔍 Data refreshed, showing success message')
        alert(`Late fees waived successfully! ${result.invoicesUpdated || 0} invoices updated.`)
      } else {
        console.error('🔍 Waive late fee failed:', result.error)
        alert(`Error: ${result.error}`)
      }
    } catch (error) {
      console.error('Error waiving late fees:', error)
      alert('Failed to waive late fees. Please try again.')
    }
  }

  const toggleTenantDetails = (tenantId: string) => {
    setExpandedTenant(expandedTenant === tenantId ? null : tenantId)
  }

  const handlePeriodClick = (tenant: any, period: any) => {
    setSelectedPeriod({ tenant, period })
    setShowPeriodModal(true)
  }

  const handleAddPayment = () => {
    // TODO: Implement add payment for specific period
    console.log('Add payment for period:', selectedPeriod)
    setShowPeriodModal(false)
  }

  const handleWaiveLateFeeForPeriod = async () => {
    if (!selectedPeriod) return
    
    try {
      const currentDate = new Date().toISOString().split('T')[0]
      
      const response = await fetch('/api/late-fees/waive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invoiceId: selectedPeriod.period.invoice_id,
          currentDate
        })
      })

      const result = await response.json()

      if (result.success) {
        // Close the modal and refresh the data
        setShowPeriodModal(false)
        setSelectedPeriod(null)
        await fetchLateTenants()
        alert(`Late fee waived successfully for this period!`)
      } else {
        alert(`Error: ${result.error}`)
      }
    } catch (error) {
      console.error('Error waiving late fee for period:', error)
      alert('Failed to waive late fee. Please try again.')
    }
  }

  const handleShowAllPayments = async (tenant: any) => {
    try {
      setSelectedTenantInfo(tenant)
      const response = await fetch(`/api/payments?leaseId=${tenant.leaseId}&limit=100`)
      if (response.ok) {
        const payments = await response.json()
        setSelectedTenantPayments(payments)
        setShowPaymentsModal(true)
      } else {
        console.error('Failed to fetch payments')
      }
    } catch (error) {
      console.error('Error fetching payments:', error)
    }
  }

  const getDaysLateColor = (days: number) => {
    if (days >= 30) return 'text-red-600 bg-red-100'
    if (days >= 7) return 'text-orange-600 bg-orange-100'
    return 'text-yellow-600 bg-yellow-100'
  }

  const getDaysLateBorder = (days: number) => {
    if (days >= 30) return 'border-l-4 border-red-500'
    if (days >= 7) return 'border-l-4 border-orange-500'
    return 'border-l-4 border-yellow-500'
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Late Tenants</h1>
        <p className="text-gray-600 mt-2">Track overdue payments and manage late tenants</p>
      </div>

      {/* Portfolio Totals Banner */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">{summary.lateLeases}</div>
            <div className="text-sm text-gray-500">Late Leases</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-orange-600">
              ${summary.totalLateOwed.toLocaleString()}
            </div>
            <div className="text-sm text-gray-500">Total Late Owed</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">
              ${summary.totalAllOwed?.toLocaleString() || '0'}
            </div>
            <div className="text-sm text-gray-500">Total Owed (All)</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">
              {summary.thirtyPlusLate}
            </div>
            <div className="text-sm text-gray-500">30+ Days Late</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">
              {summary.avgDaysLate}
            </div>
            <div className="text-sm text-gray-500">Avg Days Late</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Days Late</label>
            <select
              value={filters.daysLate}
              onChange={(e) => setFilters({...filters, daysLate: e.target.value})}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All</option>
              <option value="1">≥1 day</option>
              <option value="7">≥7 days</option>
              <option value="14">≥14 days</option>
              <option value="30">≥30 days</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cadence</label>
            <select
              value={filters.cadence}
              onChange={(e) => setFilters({...filters, cadence: e.target.value})}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Bi-weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Property</label>
            <select
              value={filters.property}
              onChange={(e) => setFilters({...filters, property: e.target.value})}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Properties</option>
              {/* Property options would be populated from API */}
            </select>
          </div>
          
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
            <input
              type="text"
              placeholder="Search tenant name or property address..."
              value={filters.search}
              onChange={(e) => setFilters({...filters, search: e.target.value})}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
        
        {/* View Mode Toggle */}
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <span className="text-sm font-medium text-gray-700">View Mode:</span>
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('detailed')}
                  className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                    viewMode === 'detailed'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Detailed View
                </button>
                <button
                  onClick={() => setViewMode('condensed')}
                  className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                    viewMode === 'condensed'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Condensed View
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>


      {/* Late Tenants List */}
      <div className="space-y-4">
        {viewMode === 'detailed' ? (
          // Detailed View
          filteredLateTenants.map((tenant, index) => (
            <div
              key={index}
              className={`bg-white rounded-lg shadow p-4 ${getDaysLateBorder(tenant.daysLate)}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center mb-3">
                    <ExclamationTriangleIcon className="h-6 w-6 text-red-600 mr-3" />
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {tenant.property.name}
                      </h3>
                      <p className="text-sm text-gray-600">{tenant.tenant.full_name}</p>
                      <p className="text-xs text-gray-500">{tenant.lease.rent_cadence} • Grace: 0 days</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-3">
                    <div>
                      <p className="text-sm text-gray-500">Days Late</p>
                      <p className={`text-lg font-semibold ${getDaysLateColor(tenant.daysLate)}`}>
                        {tenant.daysLate}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500"># Late Periods</p>
                      <p className="text-lg font-semibold text-gray-900">{tenant.totalLatePeriods || 0}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Total Owed (Late)</p>
                      <p className="text-lg font-semibold text-gray-900">
                        ${tenant.totalOwedLate.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {tenant.mostRecentPayment && (
                    <div className="mb-3">
                      <p className="text-sm text-gray-500">Most Recent Payment</p>
                      <p className="text-sm text-gray-900">
                        {new Date(tenant.mostRecentPayment.date).toLocaleDateString()} • 
                        ${tenant.mostRecentPayment.amount.toLocaleString()} • 
                        {tenant.mostRecentPayment.method}
                      </p>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleText(tenant.tenant.phone || '')}
                        className="flex items-center px-3 py-2 text-sm text-blue-600 hover:text-blue-800"
                      >
                        <PhoneIcon className="h-4 w-4 mr-1" />
                        Text
                      </button>
                      <button
                        onClick={() => handleEmail(tenant.tenant.email || '')}
                        className="flex items-center px-3 py-2 text-sm text-blue-600 hover:text-blue-800"
                      >
                        <EnvelopeIcon className="h-4 w-4 mr-1" />
                        Email
                      </button>
                    </div>
                    <button
                      onClick={() => toggleTenantDetails(tenant.lease.id)}
                      className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
                    >
                      {expandedTenant === tenant.lease.id ? 'Hide Details' : 'Show Details'}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col space-y-2 ml-6">
                  <button
                    onClick={() => handleWaiveLateFee(tenant)}
                    className="bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 text-sm"
                  >
                    Waive Late Fee
                  </button>
                  <button className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 text-sm">
                    Add Note
                  </button>
                </div>
              </div>
              
              {/* Expandable Late Periods Details */}
              {expandedTenant === tenant.lease.id && tenant.lateInvoices && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Late Periods Details</h4>
                  <div className="space-y-2">
                    {tenant.lateInvoices.map((period: any, idx: number) => (
                      <div 
                        key={idx} 
                        className="flex justify-between items-center py-2 px-3 bg-red-50 rounded cursor-pointer hover:bg-red-100 transition-colors"
                        onClick={() => handlePeriodClick(tenant, period)}
                        title="Click to add payment or waive late fee for this period"
                      >
                        <div>
                          <span className="text-sm font-medium text-gray-900">
                            {new Date(period.due_date).toLocaleDateString()}
                          </span>
                          <span className="text-xs text-gray-500 ml-2">
                            Due Date
                          </span>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-red-600">
                            ${period.balance_due.toLocaleString()}
                          </div>
                          <div className="text-xs text-gray-500">
                            Paid: ${period.amount_paid.toLocaleString()} / ${period.amount_total.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        ) : (
          // Condensed View
          <div className="bg-white rounded-lg shadow overflow-hidden">
            {/* Desktop Table View */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('property')}
                    >
                      <div className="flex items-center">
                        Property Address
                        {sortField === 'property' && (
                          <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('tenant')}
                    >
                      <div className="flex items-center">
                        Renter
                        {sortField === 'tenant' && (
                          <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('daysLate')}
                    >
                      <div className="flex items-center">
                        Late Periods
                        {sortField === 'daysLate' && (
                          <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Total Late Fees
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('totalOwedLate')}
                    >
                      <div className="flex items-center">
                        Total Late Amount
                        {sortField === 'totalOwedLate' && (
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
                  {filteredLateTenants.map((tenant, index) => (
                    <tr 
                      key={index} 
                      className={`hover:bg-gray-50 cursor-pointer ${getDaysLateBorder(tenant.daysLate)}`}
                      onDoubleClick={() => handleShowAllPayments(tenant)}
                      title="Double-click to view payments"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <ExclamationTriangleIcon className="h-5 w-5 text-red-600 mr-2" />
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {tenant.property.name}
                            </div>
                            <div className="text-sm text-gray-500">
                              {tenant.property.address || 'No address'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {tenant.tenant.full_name}
                        </div>
                        <div className="text-sm text-gray-500">
                          {tenant.lease.rent_cadence}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {tenant.totalLatePeriods || 0}
                        </div>
                        <div className="text-xs text-gray-500">
                          {tenant.daysLate} days late
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-red-600">
                          ${(tenant.totalLateFees || 0).toLocaleString()}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          ${tenant.totalOwedLate.toLocaleString()}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleWaiveLateFee(tenant)
                          }}
                          className="text-yellow-600 hover:text-yellow-900"
                        >
                          Waive Fee
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="lg:hidden">
              {filteredLateTenants.map((tenant, index) => (
                <div 
                  key={index} 
                  className={`p-4 border-b border-gray-200 last:border-b-0 cursor-pointer ${getDaysLateBorder(tenant.daysLate)}`}
                  onDoubleClick={() => handleShowAllPayments(tenant)}
                  title="Double-tap to view payments"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center flex-1">
                      <ExclamationTriangleIcon className="h-5 w-5 text-red-600 mr-2 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {tenant.property.name}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {tenant.property.address || 'No address'}
                        </div>
                        <div className="text-sm text-gray-600 mt-1">
                          {tenant.tenant.full_name}
                        </div>
                        <div className="text-xs text-gray-500">
                          {tenant.lease.rent_cadence}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-3">
                    <div>
                      <div className="text-xs text-gray-500">Late Periods</div>
                      <div className="text-sm font-medium text-gray-900">
                        {tenant.totalLatePeriods || 0}
                      </div>
                      <div className="text-xs text-gray-500">
                        {tenant.daysLate} days late
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Late Fees</div>
                      <div className="text-sm font-medium text-red-600">
                        ${(tenant.totalLateFees || 0).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div className="mb-3">
                    <div className="text-xs text-gray-500">Total Late Amount</div>
                    <div className="text-lg font-semibold text-gray-900">
                      ${tenant.totalOwedLate.toLocaleString()}
                    </div>
                  </div>

                  <div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleWaiveLateFee(tenant)
                      }}
                      className="w-full bg-yellow-600 text-white px-3 py-2 rounded text-sm font-medium hover:bg-yellow-700 transition-colors"
                    >
                      Waive Fee
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {filteredLateTenants.length === 0 && (
        <div className="text-center py-12">
          <ExclamationTriangleIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No late tenants found</h3>
          <p className="text-gray-500">All tenants are up to date with their payments.</p>
        </div>
      )}

      {/* Period Action Modal */}
      {showPeriodModal && selectedPeriod && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">Period Actions</h3>
                <button
                  onClick={() => setShowPeriodModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>
            </div>

            <div className="px-6 py-4">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Property</label>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <div className="font-medium text-gray-900">{selectedPeriod.tenant.property.name}</div>
                    <div className="text-sm text-gray-500">{selectedPeriod.tenant.tenant.full_name}</div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Late Period</label>
                  <div className="p-3 bg-red-50 rounded-lg">
                    <div className="font-medium text-gray-900">
                      {new Date(selectedPeriod.period.dueDate).toLocaleDateString()}
                    </div>
                    <div className="text-sm text-red-600">
                      Owed: ${selectedPeriod.period.shortfall.toLocaleString()} 
                      (Paid: ${selectedPeriod.period.amountPaid.toLocaleString()} / ${selectedPeriod.period.expectedAmount.toLocaleString()})
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Amount</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={selectedPeriod.period.shortfall}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter payment amount"
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => setShowPeriodModal(false)}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleWaiveLateFeeForPeriod}
                className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
              >
                Waive Late Fee
              </button>
              <button
                onClick={handleAddPayment}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Add Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payments Modal */}
      {showPaymentsModal && selectedTenantInfo && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[80vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">All Payments</h3>
                  <p className="text-sm text-gray-500">
                    {selectedTenantInfo.property.name} - {selectedTenantInfo.tenant.full_name}
                  </p>
                </div>
                <button
                  onClick={() => setShowPaymentsModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>
            </div>

            <div className="px-6 py-4 overflow-y-auto max-h-[60vh]">
              {selectedTenantPayments.length > 0 ? (
                <div className="space-y-4">
                  {/* Summary Header */}
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="text-sm font-medium text-red-800 mb-2">Current Status</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <div className="text-red-600 font-medium">Amount Owed</div>
                        <div className="text-gray-900">${selectedTenantInfo?.totalOwedLate?.toLocaleString() || '0'}</div>
                      </div>
                      <div>
                        <div className="text-red-600 font-medium">Date Owed</div>
                        <div className="text-gray-900">
                          {selectedTenantInfo?.daysLate ? `${selectedTenantInfo.daysLate} days ago` : 'N/A'}
                        </div>
                      </div>
                      <div>
                        <div className="text-red-600 font-medium">Late Fee Owed</div>
                        <div className="text-gray-900">${selectedTenantInfo?.totalLateFees?.toLocaleString() || '0'}</div>
                      </div>
                      <div>
                        <div className="text-red-600 font-medium">Status</div>
                        <div className="text-gray-900">
                          {selectedTenantInfo?.totalOwedLate > 0 ? 'Overdue' : 'Current'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Late Invoices Breakdown */}
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-gray-700 mb-2">Late Invoices Breakdown</div>
                    {selectedTenantInfo?.lateInvoices?.map((invoice, index) => (
                      <div key={index} className="bg-red-50 border border-red-200 rounded-lg p-3">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center space-x-4 mb-2">
                              <div className="text-sm font-medium text-gray-900">
                                ${invoice.balance_due.toLocaleString()} owed
                              </div>
                              <div className="text-sm text-gray-500">
                                Due: {new Date(invoice.due_date).toLocaleDateString()}
                              </div>
                              <div className="text-xs text-red-600 font-medium">
                                {invoice.days_late} days late
                              </div>
                            </div>
                            <div className="text-xs text-gray-500">
                              Period: {new Date(invoice.period_start).toLocaleDateString()} - {new Date(invoice.period_end).toLocaleDateString()}
                            </div>
                            <div className="text-xs text-gray-500">
                              Original: ${invoice.amount_total.toLocaleString()} | Paid: ${invoice.amount_paid.toLocaleString()}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium text-red-600">
                              Late Fee: ${invoice.amount_late.toLocaleString()}
                            </div>
                            <div className="text-xs text-gray-500">
                              {invoice.status}
                            </div>
                          </div>
                        </div>
                      </div>
                    )) || (
                      <div className="text-center py-4 text-gray-500">
                        No late invoices found
                      </div>
                    )}
                  </div>

                  {/* Payment History - Collapsed View */}
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-gray-700 mb-2">Payment History</div>
                    {selectedTenantPayments.map((payment, index) => (
                      <div key={index} className="bg-gray-50 rounded-lg p-3">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center space-x-4">
                            <div className="text-sm font-medium text-gray-900">
                              ${payment.amount.toLocaleString()}
                            </div>
                            <div className="text-sm text-gray-500">
                              {new Date(payment.payment_date).toLocaleDateString()}
                            </div>
                            <div className="text-xs text-gray-400">
                              {payment.payment_method} • {payment.payment_type}
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className="text-xs text-gray-500">
                              {payment.status}
                            </span>
                            {payment.notes && (
                              <div className="text-xs text-gray-400 max-w-xs truncate" title={payment.notes}>
                                {payment.notes}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <CurrencyDollarIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No payments found</h3>
                  <p className="text-gray-500">No payment history available for this tenant.</p>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowPaymentsModal(false)}
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
