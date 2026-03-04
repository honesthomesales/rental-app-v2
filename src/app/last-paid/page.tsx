'use client'

import { useEffect, useState, useMemo } from 'react'
import { downloadAsPDF, downloadAsWord } from '@/lib/form-downloads'
import { XMarkIcon } from '@heroicons/react/24/outline'

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
  lease_id: string | null
  totalOwed: number
  payments: PaymentEntry[]
}

type SortField = 'property' | 'tenant' | 'cadence' | 'lastPaid' | 'totalOwed'
type SortDirection = 'asc' | 'desc'

export default function LastPaidPage() {
  const [data, setData] = useState<PropertyPayments[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [cadenceFilter, setCadenceFilter] = useState('')
  const [sortField, setSortField] = useState<SortField>('property')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [expandedProperty, setExpandedProperty] = useState<string | null>(null)
  const [selectedLease, setSelectedLease] = useState<any>(null)
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [invoices, setInvoices] = useState<any[]>([])
  const [loadingInvoices, setLoadingInvoices] = useState(false)
  const [invoicePaymentTotals, setInvoicePaymentTotals] = useState<Map<string, number>>(new Map())
  const [invoicePaidDates, setInvoicePaidDates] = useState<Map<string, string | null>>(new Map())
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0])
  const [paymentType, setPaymentType] = useState('Rent')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [selectedPropertyForGenerate, setSelectedPropertyForGenerate] = useState<PropertyPayments | null>(null)
  const [selectedCounty, setSelectedCounty] = useState('')
  const [generatingForm, setGeneratingForm] = useState(false)
  const [formType, setFormType] = useState<'notice' | 'ejectment' | 'both'>('notice')
  const [ejectmentReason, setEjectmentReason] = useState<'nonpayment' | 'endtenancy' | 'violation'>('nonpayment')
  const [violationDescription, setViolationDescription] = useState('')
  const [generatedForms, setGeneratedForms] = useState<any>(null)
  const [showFormsModal, setShowFormsModal] = useState(false)
  const [downloadFormat, setDownloadFormat] = useState<'pdf' | 'docx'>('pdf')
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table')

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

  const handleViewInvoices = async (property: PropertyPayments) => {
    if (!property.lease_id) {
      alert('No active lease found for this property')
      return
    }

    // Create a lease row structure similar to payments page
    const leaseRow = {
      lease: { id: property.lease_id },
      property: { id: property.property_id, name: property.property_name, address: property.property_address },
      tenant: { id: '', full_name: property.payments[0]?.tenant_name || '' }
    }

    setSelectedLease(leaseRow)
    setShowInvoiceModal(true)
    setLoadingInvoices(true)

    try {
      const today = new Date()
      const todayStr = today.toISOString().split('T')[0]
      const futureDate = new Date(today)
      futureDate.setFullYear(today.getFullYear() + 1)
      const futureDateStr = futureDate.toISOString().split('T')[0]
      
      const url = `/api/invoices?leaseId=${property.lease_id}&to=${futureDateStr}`
      const response = await fetch(url)
      
      if (!response.ok) {
        console.error('Error fetching invoices:', response.status)
        setInvoices([])
        setLoadingInvoices(false)
        return
      }
      
      const invoicesData = await response.json()
      const existingInvoices = Array.isArray(invoicesData) ? invoicesData : []
      
      // Fetch payment totals for all invoices
      const paymentTotalsMap = new Map<string, number>()
      const paidDatesMap = new Map<string, string | null>()
      
      existingInvoices.forEach((invoice: any) => {
        paymentTotalsMap.set(invoice.id, parseFloat(invoice.amount_paid as any) || 0)
        paidDatesMap.set(invoice.id, null)
      })
      
      await Promise.all(
        existingInvoices.map(async (invoice: any) => {
          try {
            const paymentsResponse = await fetch(`/api/payments?invoiceId=${invoice.id}`)
            if (paymentsResponse.ok) {
              const paymentsData = await paymentsResponse.json()
              if (Array.isArray(paymentsData) && paymentsData.length > 0) {
                const linkedPayments = paymentsData.filter((p: any) => p.invoice_id === invoice.id)
                const actualPaid = linkedPayments.reduce((sum: number, p: any) => sum + (parseFloat(p.amount) || 0), 0)
                paymentTotalsMap.set(invoice.id, actualPaid)
                
                if (linkedPayments.length > 0) {
                  const validPayments = linkedPayments.filter((p: any) => p.payment_date)
                  if (validPayments.length > 0) {
                    const sortedPayments = validPayments.sort((a: any, b: any) => 
                      new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime()
                    )
                    paidDatesMap.set(invoice.id, sortedPayments[0].payment_date)
                  }
                }
              }
            }
          } catch (error) {
            console.error(`Error fetching payments for invoice ${invoice.id}:`, error)
          }
        })
      )
      
      setInvoicePaymentTotals(paymentTotalsMap)
      setInvoicePaidDates(paidDatesMap)
      
      const sortedInvoices = existingInvoices.sort((a: any, b: any) => {
        const dateA = new Date(a.due_date).getTime()
        const dateB = new Date(b.due_date).getTime()
        return dateB - dateA
      })
      
      setInvoices(sortedInvoices)
    } catch (error) {
      console.error('Error fetching invoices:', error)
      setInvoices([])
    } finally {
      setLoadingInvoices(false)
    }
  }

  const handleMakePayment = (invoice: any) => {
    const actualPaid = invoicePaymentTotals.get(invoice.id) ?? parseFloat(invoice.amount_paid as any)
    const amountTotal = parseFloat(invoice.amount_total as any)
    const balanceDue = amountTotal - actualPaid
    
    setSelectedInvoice(invoice)
    setPaymentAmount(balanceDue.toString())
    setPaymentDate(invoice.due_date)
    setPaymentType('Rent')
    setPaymentNotes('')
    setShowPaymentModal(true)
  }

  const handleSubmitPayment = async () => {
    if (!selectedInvoice || !selectedLease) return
    
    setIsSubmitting(true)
    try {
      const paymentAmountNum = parseFloat(paymentAmount)
      
      if (isNaN(paymentAmountNum) || paymentAmountNum <= 0) {
        alert('Please enter a valid payment amount greater than 0')
        return
      }

      const leaseId = selectedInvoice.lease_id || selectedLease.lease.id
      const propertyId = selectedLease.property.id
      const tenantId = selectedInvoice.tenant_id || ''
      let invoiceId = selectedInvoice.id

      if (invoiceId && invoiceId.startsWith('expected-')) {
        const dueDate = invoiceId.replace('expected-', '')
        const invoiceData = {
          lease_id: leaseId,
          property_id: propertyId,
          tenant_id: tenantId,
          due_date: dueDate,
          period_start: selectedInvoice.period_start,
          period_end: selectedInvoice.period_end,
          amount_rent: selectedInvoice.amount_rent || selectedInvoice.amount_total,
          amount_late: selectedInvoice.amount_late || 0,
          amount_other: selectedInvoice.amount_other || 0,
          amount_total: selectedInvoice.amount_total,
          amount_paid: 0,
          balance_due: selectedInvoice.amount_total,
          status: 'OPEN'
        }
        
        const createInvoiceResponse = await fetch('/api/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(invoiceData)
        })
        
        if (!createInvoiceResponse.ok) {
          const errorData = await createInvoiceResponse.json().catch(() => ({}))
          throw new Error(errorData.error || 'Failed to create invoice')
        }
        
        const createdInvoice = await createInvoiceResponse.json()
        invoiceId = createdInvoice.id || createdInvoice.invoice?.id
      }

      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lease_id: leaseId,
          property_id: propertyId,
          tenant_id: tenantId,
          invoice_id: invoiceId,
          amount: paymentAmountNum,
          payment_date: paymentDate,
          payment_type: paymentType,
          notes: paymentNotes || ''
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to add payment')
      }

      setPaymentAmount('')
      setPaymentDate(new Date().toISOString().split('T')[0])
      setPaymentType('Rent')
      setPaymentNotes('')

      setShowPaymentModal(false)
      const property = data.find(p => p.property_id === propertyId)
      if (property) {
        await handleViewInvoices(property)
      }
      await fetchData()
    } catch (error) {
      console.error('Error adding payment:', error)
      alert('Failed to add payment: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleGenerateForms = async () => {
    if (!selectedPropertyForGenerate || !selectedCounty) {
      alert('Please select a property and county')
      return
    }

    if (!selectedPropertyForGenerate.lease_id) {
      alert('No active lease found for this property')
      return
    }

    if (formType === 'ejectment' || formType === 'both') {
      if (ejectmentReason === 'nonpayment' && !selectedPropertyForGenerate.totalOwed) {
        alert('No amount owed found for this tenant')
        return
      }
      if (ejectmentReason === 'violation' && !violationDescription.trim()) {
        alert('Please provide a description of the lease violation')
        return
      }
    }

    try {
      setGeneratingForm(true)

      const response = await fetch('/api/generate-ejectment-forms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenantId: `${selectedPropertyForGenerate.property_name} - ${selectedPropertyForGenerate.payments[0]?.tenant_name || ''}`,
          county: selectedCounty,
          formType,
          ejectmentReason,
          violationDescription,
          leaseId: selectedPropertyForGenerate.lease_id,
        }),
      })

      if (response.ok) {
        const forms = await response.json()
        setGeneratedForms(forms)
        setShowGenerateModal(false)
        setShowFormsModal(true)
      } else {
        const errorData = await response.json()
        alert(`Error generating forms: ${errorData.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Error generating forms:', error)
      alert('Failed to generate forms. Please try again.')
    } finally {
      setGeneratingForm(false)
    }
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
          // Find most recent paid payment for each property
          const getLastPaidDate = (prop: PropertyPayments) => {
            const paidPayments = prop.payments.filter((p: PaymentEntry) => {
              if (!p.invoice) return false
              const balance = parseFloat(p.invoice.recalculated_balance as any || 0)
              return balance <= 0 && p.amount > 0
            })
            if (paidPayments.length === 0) return ''
            paidPayments.sort((a: PaymentEntry, b: PaymentEntry) => {
              const dateA = new Date(a.payment_date).getTime()
              const dateB = new Date(b.payment_date).getTime()
              return dateB - dateA
            })
            return paidPayments[0]?.payment_date || ''
          }
          const dateA = getLastPaidDate(a)
          const dateB = getLastPaidDate(b)
          return dir * dateA.localeCompare(dateB)
        }
        case 'totalOwed': {
          return dir * ((a.totalOwed || 0) - (b.totalOwed || 0))
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

  // Calculate date columns for grid view (last 9 unique payment dates)
  const gridDateColumns = useMemo(() => {
    const allDates = new Set<string>()
    filteredAndSorted.forEach(property => {
      property.payments.forEach(payment => {
        if (payment.payment_date) {
          allDates.add(payment.payment_date)
        }
      })
    })
    
    const sortedDates = Array.from(allDates)
      .map(date => new Date(date + 'T00:00:00'))
      .sort((a, b) => b.getTime() - a.getTime())
      .slice(0, 9)
      .map(date => date.toISOString().split('T')[0])
    
    return sortedDates
  }, [filteredAndSorted])

  // Format date for grid header (M/D format)
  const formatGridDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    const month = date.getMonth() + 1
    const day = date.getDate()
    return `${month}/${day}`
  }

  // Get cell value and color for grid view
  const getGridCellValue = (property: PropertyPayments, dateStr: string) => {
    const cadence = property.cadence?.toLowerCase() || ''
    const date = new Date(dateStr + 'T00:00:00')
    
    // Find payment for this date (exact match)
    const payment = property.payments.find(p => {
      const paymentDate = new Date(p.payment_date + 'T00:00:00')
      return paymentDate.toISOString().split('T')[0] === dateStr
    })
    
    if (payment) {
      const invoice = payment.invoice
      const amount = parseFloat(payment.amount as any || 0)
      
      if (invoice) {
        const balance = parseFloat(invoice.recalculated_balance as any || 0)
        
        // Paid (balance <= 0 and amount > 0) - light green
        if (balance <= 0 && amount > 0) {
          // Format: show as number if whole, otherwise currency
          const displayValue = amount % 1 === 0 ? amount.toString() : formatCurrency(amount)
          return {
            value: displayValue,
            color: 'bg-green-100', // light green
            textColor: 'text-gray-900'
          }
        }
        
        // Unpaid invoice (balance > 0) - red
        if (balance > 0) {
          return {
            value: formatCurrency(balance),
            color: 'bg-red-200', // red
            textColor: 'text-gray-900'
          }
        }
      }
      
      // Has payment but no invoice - light green
      if (amount > 0) {
        const displayValue = amount % 1 === 0 ? amount.toString() : formatCurrency(amount)
        return {
          value: displayValue,
          color: 'bg-green-100', // light green
          textColor: 'text-gray-900'
        }
      }
      
      // Payment with 0 amount (unpaid placeholder) - red
      return {
        value: '$0',
        color: 'bg-red-200', // red
        textColor: 'text-gray-900'
      }
    }
    
    // No payment found - determine if date is applicable for this cadence
    // This is a simplified check. In a full implementation, we'd need:
    // - Lease start date to calculate anchor dates
    // - Rent due day for monthly cadence
    // - Payment history to determine pattern
    
    // For now, use a heuristic: check if other properties with same cadence have payments on nearby dates
    const hasNearbyPayments = filteredAndSorted
      .filter(p => {
        const pCadence = p.cadence?.toLowerCase() || ''
        return pCadence === cadence && p.property_id !== property.property_id
      })
      .some(p => {
        return p.payments.some(pay => {
          const payDate = new Date(pay.payment_date + 'T00:00:00')
          const daysDiff = Math.abs((payDate.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
          // Check if payment is within cadence period
          if (cadence === 'weekly') return daysDiff <= 3 // Within 3 days
          if (cadence === 'biweekly' || cadence === 'bi-weekly') return daysDiff <= 7 // Within 7 days
          if (cadence === 'monthly') return daysDiff <= 15 // Within 15 days
          return false
        })
      })
    
    // If other properties with same cadence have payments around this date,
    // this property should too (missing payment - red)
    // Otherwise, it's likely not applicable (darker green with ----)
    if (hasNearbyPayments) {
      return {
        value: '',
        color: 'bg-red-200', // red - missing payment
        textColor: 'text-gray-900'
      }
    }
    
    // Not applicable for this cadence - darker green with ----
    return {
      value: '----',
      color: 'bg-green-200', // darker green
      textColor: 'text-gray-600'
    }
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
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Last Paid</h1>
          <p className="text-gray-500 text-sm">Last 4 payments per property with invoice details</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">View:</span>
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              viewMode === 'table'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Table
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              viewMode === 'grid'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Grid
          </button>
        </div>
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

      {/* Main Table or Grid */}
      {viewMode === 'table' ? (
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
                onClick={() => handleSort('totalOwed')}
              >
                Total Owed{sortIndicator('totalOwed')}
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
                // Find the most recent paid payment (where invoice balance <= 0)
                const paidPayments = property.payments.filter((p: PaymentEntry) => {
                  if (!p.invoice) return false
                  const balance = parseFloat(p.invoice.recalculated_balance as any || 0)
                  return balance <= 0 && p.amount > 0 // Only actual payments, not unpaid invoice placeholders
                })
                
                // Sort paid payments by date (most recent first)
                paidPayments.sort((a: PaymentEntry, b: PaymentEntry) => {
                  const dateA = new Date(a.payment_date).getTime()
                  const dateB = new Date(b.payment_date).getTime()
                  return dateB - dateA
                })
                
                const lastPaidPayment = paidPayments[0]
                const lastPayment = property.payments[0] // For tenant name display
                const isExpanded = expandedProperty === property.property_id

                return (
                  <tr 
                    key={property.property_id} 
                    className="hover:bg-gray-50 cursor-pointer"
                    onDoubleClick={() => {
                      if (property.lease_id) {
                        handleViewInvoices(property)
                      }
                    }}
                  >
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
                      {lastPaidPayment ? formatDate(lastPaidPayment.payment_date) : 'Never'}
                    </td>
                    <td className={`px-4 py-3 text-sm text-right font-medium ${property.totalOwed > 0 ? 'text-red-700' : 'text-green-700'}`}>
                      {formatCurrency(property.totalOwed)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => setExpandedProperty(isExpanded ? null : property.property_id)}
                          className="px-3 py-1 text-xs font-medium rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                        >
                          {isExpanded ? 'Hide' : 'Detail'}
                        </button>
                        {property.lease_id && (
                          <button
                            onClick={() => {
                              setSelectedPropertyForGenerate(property)
                              setShowGenerateModal(true)
                            }}
                            className="px-3 py-1 text-xs font-medium rounded-md bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                          >
                            Forms
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      ) : (
        /* Grid View */
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border-b border-gray-200">
                    Property
                  </th>
                  {gridDateColumns.map((dateStr) => (
                    <th
                      key={dateStr}
                      className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase border-b border-gray-200"
                    >
                      {formatGridDate(dateStr)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredAndSorted.length === 0 ? (
                  <tr>
                    <td colSpan={gridDateColumns.length + 1} className="px-4 py-8 text-center text-gray-500">
                      No payment history found
                    </td>
                  </tr>
                ) : (
                  filteredAndSorted.map((property) => {
                    const cadence = property.cadence?.toLowerCase() || ''
                    const cadenceLabel = cadence === 'weekly' ? 'weekly' : 
                                       cadence === 'biweekly' || cadence === 'bi-weekly' ? 'bi-Weekly' : 
                                       cadence === 'monthly' ? 'monthly' : ''
                    const propertyLabel = `${property.property_name}${cadenceLabel ? ` (${cadenceLabel})` : ''}`
                    
                    return (
                      <tr key={property.property_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 border-r border-gray-200">
                          {propertyLabel}
                        </td>
                        {gridDateColumns.map((dateStr) => {
                          const cell = getGridCellValue(property, dateStr)
                          return (
                            <td
                              key={dateStr}
                              className={`px-3 py-3 text-center text-sm border-r border-gray-200 ${cell.color} ${cell.textColor}`}
                            >
                              {cell.value}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

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

                <h3 className="text-sm font-semibold text-gray-700 mb-3">
                  {property.payments.filter(p => (p.invoice?.recalculated_balance || 0) > 0).length > 0 && (
                    <span>Unpaid Past Payments & </span>
                  )}
                  Last 4 Paid Payments ({property.payments.length} total)
                </h3>

                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Payment Amount</th>
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
                          {payment.invoice ? (
                            (() => {
                              const balance = parseFloat(payment.invoice.recalculated_balance as any || 0)
                              const status = balance <= 0 ? 'PAID' : payment.invoice.status
                              return invoiceStatusBadge(status)
                            })()
                          ) : '-'}
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
                      <td className="px-3 py-2 text-sm font-semibold text-gray-700">Total Owed</td>
                      <td className="px-3 py-2 text-sm text-right font-bold text-red-700">
                        {formatCurrency(property.totalOwed)}
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

      {/* Invoice Modal */}
      {showInvoiceModal && selectedLease && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold">{selectedLease.property?.name || 'Property'}</h2>
                <p className="text-sm text-blue-100">{selectedLease.property?.address}</p>
              </div>
              <button
                onClick={() => setShowInvoiceModal(false)}
                className="text-white hover:text-gray-200 transition-colors"
              >
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {loadingInvoices ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
              ) : invoices.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-500">No invoices found</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b-2 border-gray-200">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Status</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Paid Date</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Period</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Rent</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Late Fee</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Total</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Paid</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Balance</th>
                        <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {invoices.map((invoice) => {
                        const actualPaid = invoicePaymentTotals.get(invoice.id) ?? parseFloat(invoice.amount_paid as any)
                        const amountTotal = parseFloat(invoice.amount_total as any)
                        const balance = amountTotal - actualPaid
                        const paid = actualPaid
                        const showPaymentButtons = balance > 0
                        
                        return (
                          <tr 
                            key={invoice.id} 
                            className="hover:bg-gray-50 cursor-pointer"
                            onDoubleClick={() => {
                              if (showPaymentButtons) {
                                handleMakePayment(invoice)
                              }
                            }}
                          >
                            <td className="px-3 py-2">
                              {invoiceStatusBadge(invoice.status)}
                            </td>
                            <td className="px-3 py-2 text-sm">
                              {(() => {
                                const paidDate = invoicePaidDates.get(invoice.id)
                                if (paidDate) {
                                  return new Date(paidDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                }
                                return '-'
                              })()}
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-600">
                              {new Date(invoice.period_start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {new Date(invoice.period_end + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </td>
                            <td className="px-3 py-2 text-sm text-right">
                              ${parseFloat(invoice.amount_rent as any || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-3 py-2 text-sm text-right text-red-600">
                              ${parseFloat(invoice.amount_late as any || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-3 py-2 text-sm text-right font-medium">
                              ${parseFloat(invoice.amount_total as any).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-3 py-2 text-sm text-right text-green-600">
                              ${paid.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-3 py-2 text-sm text-right font-bold">
                              ${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {showPaymentButtons && (
                                <button
                                  onClick={() => handleMakePayment(invoice)}
                                  className="px-3 py-1 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700 transition-colors"
                                  type="button"
                                >
                                  Add Payment
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-gray-50 px-6 py-4 flex justify-end">
              <button
                onClick={() => setShowInvoiceModal(false)}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && selectedInvoice && selectedLease && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            <div className="bg-gradient-to-r from-green-600 to-emerald-600 text-white px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold">Add Payment</h2>
              <button
                onClick={() => setShowPaymentModal(false)}
                className="text-white hover:text-gray-200 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-green-500 focus:border-green-500"
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date</label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-green-500 focus:border-green-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Type</label>
                <select
                  value={paymentType}
                  onChange={(e) => setPaymentType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-green-500 focus:border-green-500"
                >
                  <option value="Rent">Rent</option>
                  <option value="Late Fee">Late Fee</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-green-500 focus:border-green-500"
                  placeholder="Add any notes about this payment..."
                />
              </div>
            </div>

            <div className="bg-gray-50 px-6 py-4 flex justify-end space-x-3">
              <button
                onClick={() => setShowPaymentModal(false)}
                disabled={isSubmitting}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitPayment}
                disabled={isSubmitting || !paymentAmount || parseFloat(paymentAmount) <= 0}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Processing...' : 'Add Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generate Forms Modal */}
      {showGenerateModal && selectedPropertyForGenerate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-gray-900">Generate Legal Forms</h2>
              <button
                onClick={() => {
                  setShowGenerateModal(false)
                  setSelectedPropertyForGenerate(null)
                  setSelectedCounty('')
                  setFormType('notice')
                  setEjectmentReason('nonpayment')
                  setViolationDescription('')
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Property / Tenant
                </label>
                <input
                  type="text"
                  value={`${selectedPropertyForGenerate.property_name} - ${selectedPropertyForGenerate.payments[0]?.tenant_name || ''}`}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  County
                </label>
                <select
                  value={selectedCounty}
                  onChange={(e) => setSelectedCounty(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select county...</option>
                  <option value="Spartanburg">Spartanburg</option>
                  <option value="Greenville">Greenville</option>
                  <option value="Anderson">Anderson</option>
                  <option value="Cherokee">Cherokee</option>
                  <option value="Union">Union</option>
                  <option value="Saluda">Saluda</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Form Type
                </label>
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as 'notice' | 'ejectment' | 'both')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="notice">7-Day Notice</option>
                  <option value="ejectment">Application for Ejectment</option>
                  <option value="both">Both (Notice + Ejectment)</option>
                </select>
              </div>

              {(formType === 'ejectment' || formType === 'both') && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Reason for Ejectment
                    </label>
                    <select
                      value={ejectmentReason}
                      onChange={(e) => setEjectmentReason(e.target.value as 'nonpayment' | 'endtenancy' | 'violation')}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="nonpayment">Tenant fails or refuses to pay rent when due</option>
                      <option value="endtenancy">Term of tenancy or occupancy has ended</option>
                      <option value="violation">Terms or conditions of the lease have been violated</option>
                    </select>
                  </div>

                  {ejectmentReason === 'violation' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Description of Violation
                      </label>
                      <textarea
                        value={violationDescription}
                        onChange={(e) => setViolationDescription(e.target.value)}
                        rows={4}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Describe the lease violation..."
                      />
                    </div>
                  )}
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Download Format
                </label>
                <select
                  value={downloadFormat}
                  onChange={(e) => setDownloadFormat(e.target.value as 'pdf' | 'docx')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="pdf">PDF</option>
                  <option value="docx">Word (DOCX)</option>
                </select>
              </div>

              <div className="pt-4 border-t border-gray-200 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowGenerateModal(false)
                    setSelectedPropertyForGenerate(null)
                    setSelectedCounty('')
                    setFormType('notice')
                    setEjectmentReason('nonpayment')
                    setViolationDescription('')
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenerateForms}
                  disabled={generatingForm || !selectedCounty}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {generatingForm ? 'Generating...' : 'Generate Forms'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Generated Forms Display Modal */}
      {showFormsModal && generatedForms && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-gray-900">Generated Forms</h2>
              <button
                onClick={() => {
                  setShowFormsModal(false)
                  setGeneratedForms(null)
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-6">
              {generatedForms.notice && (
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-3">7-Day Notice</h3>
                  <div className="border border-gray-300 rounded-lg p-4 bg-gray-50">
                    <pre className="whitespace-pre-wrap text-sm font-mono">{generatedForms.notice}</pre>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => {
                        if (downloadFormat === 'pdf') {
                          downloadAsPDF(generatedForms.notice, '7-Day-Notice.pdf')
                        } else {
                          downloadAsWord(generatedForms.notice, '7-Day-Notice.docx')
                        }
                      }}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      Download Notice ({downloadFormat.toUpperCase()})
                    </button>
                  </div>
                </div>
              )}

              {generatedForms.ejectment && (
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-3">Application for Ejectment (SCCA/732)</h3>
                  <div className="border border-gray-300 rounded-lg p-4 bg-gray-50">
                    <pre className="whitespace-pre-wrap text-sm font-mono">{generatedForms.ejectment}</pre>
                  </div>
                  <div className="mt-3 flex justify-end space-x-2">
                    {generatedForms.ejectmentHTML && (
                      <button
                        onClick={() => {
                          const blob = new Blob([generatedForms.ejectmentHTML], { type: 'text/html' })
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = 'Application-for-Ejectment.html'
                          a.click()
                          URL.revokeObjectURL(url)
                        }}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        View HTML
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (downloadFormat === 'pdf') {
                          downloadAsPDF(generatedForms.ejectment, 'Application-for-Ejectment.pdf', generatedForms.ejectmentHTML)
                        } else {
                          downloadAsWord(generatedForms.ejectment, 'Application-for-Ejectment.docx')
                        }
                      }}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      Download ({downloadFormat.toUpperCase()})
                    </button>
                  </div>
                </div>
              )}

              {generatedForms.affidavit && (
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-3">Affidavit of Item of Account (SCCA/716)</h3>
                  <div className="border border-gray-300 rounded-lg p-4 bg-gray-50">
                    <pre className="whitespace-pre-wrap text-sm font-mono">{generatedForms.affidavit}</pre>
                  </div>
                  <div className="mt-3 flex justify-end space-x-2">
                    {generatedForms.affidavitHTML && (
                      <button
                        onClick={() => {
                          const blob = new Blob([generatedForms.affidavitHTML], { type: 'text/html' })
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = 'Affidavit-of-Item-of-Account.html'
                          a.click()
                          URL.revokeObjectURL(url)
                        }}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        View HTML
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (downloadFormat === 'pdf') {
                          downloadAsPDF(generatedForms.affidavit, 'Affidavit-of-Item-of-Account.pdf', generatedForms.affidavitHTML)
                        } else {
                          downloadAsWord(generatedForms.affidavit, 'Affidavit-of-Item-of-Account.docx')
                        }
                      }}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      Download ({downloadFormat.toUpperCase()})
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
