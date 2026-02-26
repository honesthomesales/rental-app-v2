'use client'

import { useEffect, useState, useMemo } from 'react'

interface PaymentInvoice {
  id: string
  due_date: string
  period_start: string
  period_end: string
  amount_total: number
  amount_rent: number
  amount_late: number
  status: string
  recalculated_balance: number
}

interface PaymentEntry {
  id: string
  payment_date: string
  amount: number
  payment_type: string
  notes: string
  tenant_name: string | null
  invoice: PaymentInvoice | null
}

interface PropertyPayments {
  property_id: string
  property_name: string
  property_address: string
  property_type: string
  cadence: string | null
  rent: number | null
  payments: PaymentEntry[]
}

type SortField = 'property' | 'tenant' | 'cadence' | 'lastPaid' | 'totalPaid'
type SortDirection = 'asc' | 'desc'

export default function LastPaidPage() {
  const [data, setData] = useState<PropertyPayments[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [cadenceFilter, setCadenceFilter] = useState('')
  const [sortField, setSortField] = useState<SortField>('property')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [expandedProperty, setExpandedProperty] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/last-paid')
      if (!response.ok) throw new Error('Failed to fetch')
      const result = await response.json()
      setData(Array.isArray(result) ? result : [])
    } catch (error) {
      console.error('Error fetching last paid data:', error)
      setData([])
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value: number | string | null | undefined) => {
    const num = typeof value === 'string' ? parseFloat(value) : (value || 0)
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num)
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return ' ↕'
    return sortDirection === 'asc' ? ' ↑' : ' ↓'
  }

  // Filter properties that have at least one payment
  const propertiesWithPayments = useMemo(() => {
    return data.filter(p => p.payments.length > 0)
  }, [data])

  const filteredAndSorted = useMemo(() => {
    let filtered = propertiesWithPayments

    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(p =>
        p.property_name?.toLowerCase().includes(term) ||
        p.property_address?.toLowerCase().includes(term) ||
        p.payments.some(pay => pay.tenant_name?.toLowerCase().includes(term))
      )
    }

    if (cadenceFilter) {
      filtered = filtered.filter(p => {
        const c = p.cadence?.toLowerCase() || ''
        if (cadenceFilter === 'weekly') return c === 'weekly'
        if (cadenceFilter === 'biweekly') return c === 'biweekly' || c === 'bi-weekly'
        if (cadenceFilter === 'monthly') return c === 'monthly'
        return true
      })
    }

    const sorted = [...filtered].sort((a, b) => {
      const dir = sortDirection === 'asc' ? 1 : -1
      switch (sortField) {
        case 'property':
          return dir * (a.property_name || '').localeCompare(b.property_name || '')
        case 'tenant': {
          const tA = a.payments[0]?.tenant_name || ''
          const tB = b.payments[0]?.tenant_name || ''
          return dir * tA.localeCompare(tB)
        }
        case 'cadence':
          return dir * (a.cadence || '').localeCompare(b.cadence || '')
        case 'lastPaid': {
          const dateA = a.payments[0]?.payment_date || ''
          const dateB = b.payments[0]?.payment_date || ''
          return dir * dateA.localeCompare(dateB)
        }
        case 'totalPaid': {
          const sumA = a.payments.reduce((s, p) => s + (parseFloat(p.amount as any) || 0), 0)
          const sumB = b.payments.reduce((s, p) => s + (parseFloat(p.amount as any) || 0), 0)
          return dir * (sumA - sumB)
        }
        default:
          return 0
      }
    })

    return sorted
  }, [propertiesWithPayments, searchTerm, cadenceFilter, sortField, sortDirection])

  const cadenceBadge = (cadence: string | null) => {
    const c = cadence?.toLowerCase() || ''
    if (c === 'weekly') return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">Weekly</span>
    if (c === 'biweekly' || c === 'bi-weekly') return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-700">Bi-weekly</span>
    if (c === 'monthly') return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">Monthly</span>
    return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-500">-</span>
  }

  const invoiceStatusBadge = (status: string | null) => {
    if (!status) return null
    const s = status.toUpperCase()
    if (s === 'PAID') return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">Paid</span>
    if (s === 'OPEN') return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">Open</span>
    if (s === 'VOID') return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-500">Void</span>
    return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-100 text-yellow-700">{status}</span>
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-16 bg-gray-100 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Last Paid</h1>
        <p className="text-gray-500 text-sm">Last 4 payments per property with invoice details</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
            <input
              type="text"
              placeholder="Search by property or tenant..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cadence</label>
            <select
              value={cadenceFilter}
              onChange={(e) => setCadenceFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Cadences</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Bi-weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('property')}
              >
                Property{sortIndicator('property')}
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('tenant')}
              >
                Tenant{sortIndicator('tenant')}
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('cadence')}
              >
                Cadence{sortIndicator('cadence')}
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('lastPaid')}
              >
                Last Paid{sortIndicator('lastPaid')}
              </th>
              <th
                className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('totalPaid')}
              >
                Last 4 Total{sortIndicator('totalPaid')}
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredAndSorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No payment history found
                </td>
              </tr>
            ) : (
              filteredAndSorted.map((property) => {
                const lastPayment = property.payments[0]
                const totalLast4 = property.payments.reduce((s, p) => s + (parseFloat(p.amount as any) || 0), 0)
                const isExpanded = expandedProperty === property.property_id

                return (
                  <tr key={property.property_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">{property.property_name}</div>
                      <div className="text-xs text-gray-500">{property.property_address}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {lastPayment?.tenant_name || '-'}
                    </td>
                    <td className="px-4 py-3">
                      {cadenceBadge(property.cadence)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {formatDate(lastPayment?.payment_date)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-green-700">
                      {formatCurrency(totalLast4)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setExpandedProperty(isExpanded ? null : property.property_id)}
                        className="px-3 py-1 text-xs font-medium rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                      >
                        {isExpanded ? 'Hide' : 'Detail'}
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Expanded Payment Detail Modal */}
      {expandedProperty && (() => {
        const property = filteredAndSorted.find(p => p.property_id === expandedProperty)
        if (!property) return null

        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setExpandedProperty(null)}>
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">{property.property_name}</h2>
                    <p className="text-sm text-gray-500">{property.property_address}</p>
                    <div className="flex gap-2 mt-1">
                      {cadenceBadge(property.cadence)}
                      {property.rent && (
                        <span className="text-sm text-gray-600">Rent: {formatCurrency(property.rent)}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setExpandedProperty(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <h3 className="text-sm font-semibold text-gray-700 mb-3">Last {property.payments.length} Payment{property.payments.length !== 1 ? 's' : ''}</h3>

                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Invoice Period</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Invoice Total</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Invoice Status</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {property.payments.map((payment) => (
                      <tr key={payment.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-sm text-gray-900">{formatDate(payment.payment_date)}</td>
                        <td className="px-3 py-2 text-sm text-right font-medium text-green-700">{formatCurrency(payment.amount)}</td>
                        <td className="px-3 py-2 text-sm text-gray-600">{payment.payment_type || '-'}</td>
                        <td className="px-3 py-2 text-sm text-gray-600">
                          {payment.invoice ? (
                            <span>
                              {formatDate(payment.invoice.period_start)} – {formatDate(payment.invoice.period_end)}
                            </span>
                          ) : (
                            <span className="text-gray-400 italic">No invoice</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-sm text-right text-gray-700">
                          {payment.invoice ? formatCurrency(payment.invoice.amount_total) : '-'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {payment.invoice ? invoiceStatusBadge(payment.invoice.status) : '-'}
                        </td>
                        <td className="px-3 py-2 text-sm text-right">
                          {payment.invoice ? (
                            <span className={payment.invoice.recalculated_balance > 0 ? 'font-medium text-red-600' : 'text-green-700'}>
                              {formatCurrency(payment.invoice.recalculated_balance)}
                            </span>
                          ) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50">
                    <tr>
                      <td className="px-3 py-2 text-sm font-semibold text-gray-700">Total</td>
                      <td className="px-3 py-2 text-sm text-right font-bold text-green-700">
                        {formatCurrency(property.payments.reduce((s, p) => s + (parseFloat(p.amount as any) || 0), 0))}
                      </td>
                      <td colSpan={5}></td>
                    </tr>
                  </tfoot>
                </table>

                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => setExpandedProperty(null)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
