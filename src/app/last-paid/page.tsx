'use client'

import { useEffect, useState, useMemo } from 'react'
import { downloadAsPDF, downloadAsWord } from '@/lib/form-downloads'
import { generateNoticeHTML } from '@/lib/form-html-generator'
import { EjectmentFormDownloadActions } from '@/components/EjectmentFormDownloadActions'
import { openPrintPreview, printFormDocument } from '@/lib/print-form'
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
  rent_due_day: number | null
  lease_id: string | null
  totalOwed: number
  payments: PaymentEntry[]
}

/** Real last paid date for a detail row (not invoice due date). */
function getEntryLastPaidDate(
  payment: PaymentEntry,
  allPayments: PaymentEntry[]
): string | null {
  const amt = parseFloat(String(payment.amount)) || 0
  if (amt > 0 && payment.payment_date?.trim()) {
    return payment.payment_date
  }

  const invoiceId = payment.invoice?.id
  if (!invoiceId) return null

  let best = ''
  let bestMs = -Infinity
  for (const p of allPayments) {
    if (p.invoice?.id !== invoiceId) continue
    const a = parseFloat(String(p.amount)) || 0
    if (a <= 0 || !p.payment_date) continue
    const t = new Date(p.payment_date + 'T00:00:00').getTime()
    if (!Number.isNaN(t) && t > bestMs) {
      bestMs = t
      best = p.payment_date
    }
  }
  return best || null
}

function lastPaidSortKey(payment: PaymentEntry, allPayments: PaymentEntry[]): number {
  const lastPaid = getEntryLastPaidDate(payment, allPayments)
  if (lastPaid) {
    const t = new Date(lastPaid + 'T00:00:00').getTime()
    if (!Number.isNaN(t)) return t
  }
  // Unpaid / no payment: sort after paid rows, by due date descending
  const due = payment.invoice?.due_date
  if (due) {
    const t = new Date(due + 'T00:00:00').getTime()
    if (!Number.isNaN(t)) return t - 1e15
  }
  return -Infinity
}

type SortField = 'property' | 'tenant' | 'cadence' | 'lastPaid' | 'totalOwed' | 'latestWeek'
type SortDirection = 'asc' | 'desc'
type MonthlySortField = 'property' | 'cadence' | 'dayDue' | 'thisMonth' | 'lastMonth' | 'twoMonthsAgo'

/** Max payment_date over real payments (amount > 0, linked to an invoice). Ignores invoice balance. */
function getLastPaymentReceivedDate(prop: PropertyPayments): string {
  let best = ''
  let bestMs = -Infinity
  for (const p of prop.payments) {
    if (!p.invoice) continue
    const amt = parseFloat(String(p.amount)) || 0
    if (amt <= 0) continue
    if (!p.payment_date) continue
    const t = new Date(p.payment_date).getTime()
    if (Number.isNaN(t)) continue
    if (t > bestMs) {
      bestMs = t
      best = p.payment_date
    }
  }
  return best
}

/** Sort detail rows by Last Paid (most recent payment first); unpaid rows after paid. */
function sortPaymentsByLastPaidDate(payments: PaymentEntry[]): PaymentEntry[] {
  return [...payments].sort(
    (a, b) => lastPaidSortKey(b, payments) - lastPaidSortKey(a, payments)
  )
}

function formatLastPaidCell(
  payment: PaymentEntry,
  allPayments: PaymentEntry[],
  formatDate: (d: string | null) => string
) {
  const lastPaid = getEntryLastPaidDate(payment, allPayments)
  return lastPaid ? formatDate(lastPaid) : '-'
}

export default function LastPaidPage() {
  const [data, setData] = useState<PropertyPayments[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [cadenceFilter, setCadenceFilter] = useState('')
  const [sortField, setSortField] = useState<SortField>('lastPaid')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
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
  const [formDate, setFormDate] = useState(() => new Date().toISOString().split('T')[0])
  const [generatedForms, setGeneratedForms] = useState<any>(null)
  const [showFormsModal, setShowFormsModal] = useState(false)
  const [downloadFormat, setDownloadFormat] = useState<'pdf' | 'docx'>('pdf')
  const [viewMode, setViewMode] = useState<'table' | 'grid' | 'monthly'>('table')
  const [monthlySortField, setMonthlySortField] = useState<MonthlySortField>('dayDue')
  const [monthlySortDirection, setMonthlySortDirection] = useState<SortDirection>('asc')
  const [monthlyDayDueDir, setMonthlyDayDueDir] = useState<SortDirection>('asc')
  const [monthlySortSecondaryColumn, setMonthlySortSecondaryColumn] = useState<'thisMonth' | 'lastMonth' | 'twoMonthsAgo'>('thisMonth')
  const [monthlySortSecondaryDir, setMonthlySortSecondaryDir] = useState<SortDirection>('asc')

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
          formDate,
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

  const sortIndicatorIcon = (field: SortField) => {
    if (sortField !== field) {
      return (
        <svg className="w-4 h-4 text-gray-400 inline-block ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      )
    }
    return sortDirection === 'asc' ? (
      <svg className="w-4 h-4 text-blue-600 inline-block ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-4 h-4 text-blue-600 inline-block ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    )
  }

  // Filter properties that have at least one payment
  const propertiesWithPayments = useMemo(() => {
    return data.filter(p => p.payments.length > 0)
  }, [data])

  // Filter only (no sort) - used by allMonthly and filteredAndSorted to break circular dependency
  const filteredOnly = useMemo(() => {
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
    return filtered
  }, [propertiesWithPayments, searchTerm, cadenceFilter])

  // Determine if all properties are monthly (only then use monthly dates) - must be before gridDateColumns
  const allMonthly = useMemo(() => {
    if (filteredOnly.length === 0) return false
    const cadences = filteredOnly.map(p => p.cadence?.toLowerCase() || '').filter(c => c)
    return cadences.length > 0 && cadences.every(c => c === 'monthly')
  }, [filteredOnly])

  // Calculate date columns for grid view - must be before filteredAndSorted (used in latestWeek sort)
  const gridDateColumns = useMemo(() => {
    const today = new Date()
    const dates: string[] = []
    if (allMonthly) {
      for (let i = 0; i < 9; i++) {
        const date = new Date(today.getFullYear(), today.getMonth() - i, 1)
        dates.push(date.toISOString().split('T')[0])
      }
    } else {
      const currentDay = today.getDay()
      const daysToFriday = currentDay === 5 ? 7 : (5 - currentDay + 7) % 7
      const nextFriday = new Date(today)
      nextFriday.setDate(today.getDate() + daysToFriday)
      for (let i = 0; i < 9; i++) {
        const friday = new Date(nextFriday)
        friday.setDate(nextFriday.getDate() - (i * 7))
        dates.push(friday.toISOString().split('T')[0])
      }
    }
    return dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
  }, [allMonthly])

  const filteredAndSorted = useMemo(() => {
    const sorted = [...filteredOnly].sort((a, b) => {
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
          const ms = (prop: PropertyPayments) => {
            const d = getLastPaymentReceivedDate(prop)
            if (!d) return sortDirection === 'desc' ? -Infinity : Infinity
            const t = new Date(d + 'T00:00:00').getTime()
            return Number.isNaN(t) ? (sortDirection === 'desc' ? -Infinity : Infinity) : t
          }
          return dir * (ms(a) - ms(b))
        }
        case 'totalOwed': {
          return dir * ((a.totalOwed || 0) - (b.totalOwed || 0))
        }
        case 'latestWeek': {
          // Sort by value in first (latest) week column - compute key inline to avoid use-before-init of getGridCellValue
          const firstDateStr = gridDateColumns[0]
          if (!firstDateStr) return 0
          const firstDate = new Date(firstDateStr + 'T00:00:00')
          const periodEnd = new Date(firstDate)
          const periodStart = new Date(firstDate)
          periodStart.setDate(periodEnd.getDate() - 6)
          const sortKey = (prop: PropertyPayments) => {
            let total = 0
            for (const p of prop.payments) {
              const amt = parseFloat(p.amount as any) || 0
              if (!p.payment_date || amt <= 0) continue
              const d = new Date(p.payment_date + 'T00:00:00')
              if (d >= periodStart && d <= periodEnd) total += amt
            }
            return total
          }
          return dir * (sortKey(a) - sortKey(b))
        }
        default:
          return 0
      }
    })

    return sorted
  }, [filteredOnly, sortField, sortDirection, gridDateColumns])

  const cadenceBadge = (cadence: string | null) => {
    const c = cadence?.toLowerCase() || ''
    if (c === 'weekly') return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">Weekly</span>
    if (c === 'biweekly' || c === 'bi-weekly') return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-700">Bi-weekly</span>
    if (c === 'monthly') return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">Monthly</span>
    return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-500">-</span>
  }

  // Monthly view: total paid per property for this month, last month, 2 months ago
  const now = new Date()
  const monthLabels = useMemo(() => {
    const m0 = new Date(now.getFullYear(), now.getMonth(), 1)
    const m1 = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const m2 = new Date(now.getFullYear(), now.getMonth() - 2, 1)
    return [
      m0.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      m1.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      m2.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    ]
  }, [])

  const monthlyTotals = useMemo(() => {
    const thisKey = now.getFullYear() * 12 + now.getMonth()
    const lastKey = thisKey - 1
    const twoKeys = thisKey - 2
    return filteredAndSorted.map((property) => {
      let paidThisMonth = 0
      let paidLastMonth = 0
      let paidTwoMonthsAgo = 0
      for (const p of property.payments) {
        const amt = parseFloat(p.amount as any) || 0
        if (!p.payment_date || amt <= 0) continue
        const d = new Date(p.payment_date + 'T00:00:00')
        const key = d.getFullYear() * 12 + d.getMonth()
        if (key === thisKey) paidThisMonth += amt
        else if (key === lastKey) paidLastMonth += amt
        else if (key === twoKeys) paidTwoMonthsAgo += amt
      }
      return {
        property,
        paidThisMonth,
        paidLastMonth,
        paidTwoMonthsAgo
      }
    })
  }, [filteredAndSorted])

  const monthlyTotalsSorted = useMemo(() => {
    const dir = monthlySortDirection === 'asc' ? 1 : -1
    const dayDueDir = monthlyDayDueDir === 'asc' ? 1 : -1
    const monthDir = monthlySortSecondaryDir === 'asc' ? 1 : -1
    const getDayDue = (r: { property: PropertyPayments }) => r.property.rent_due_day ?? 99
    const getMonthVal = (r: { paidThisMonth: number; paidLastMonth: number; paidTwoMonthsAgo: number }, col: 'thisMonth' | 'lastMonth' | 'twoMonthsAgo') =>
      col === 'thisMonth' ? r.paidThisMonth : col === 'lastMonth' ? r.paidLastMonth : r.paidTwoMonthsAgo

    return [...monthlyTotals].sort((a, b) => {
      if (monthlySortField === 'property') {
        return dir * (a.property.property_name || '').localeCompare(b.property.property_name || '')
      }
      if (monthlySortField === 'cadence') {
        return dir * (a.property.cadence || '').localeCompare(b.property.cadence || '')
      }
      if (monthlySortField === 'dayDue') {
        const dayCmp = dayDueDir * (getDayDue(a) - getDayDue(b))
        if (dayCmp !== 0) return dayCmp
        return monthDir * (getMonthVal(a, monthlySortSecondaryColumn) - getMonthVal(b, monthlySortSecondaryColumn))
      }
      if (monthlySortField === 'thisMonth' || monthlySortField === 'lastMonth' || monthlySortField === 'twoMonthsAgo') {
        const dayCmp = dayDueDir * (getDayDue(a) - getDayDue(b))
        if (dayCmp !== 0) return dayCmp
        return dir * (getMonthVal(a, monthlySortField) - getMonthVal(b, monthlySortField))
      }
      return 0
    })
  }, [monthlyTotals, monthlySortField, monthlySortDirection, monthlyDayDueDir, monthlySortSecondaryColumn, monthlySortSecondaryDir])

  const handleMonthlySort = (field: MonthlySortField) => {
    if (monthlySortField === field) {
      setMonthlySortDirection(d => d === 'asc' ? 'desc' : 'asc')
      if (field === 'dayDue') setMonthlyDayDueDir(d => d === 'asc' ? 'desc' : 'asc')
      if (field === 'thisMonth' || field === 'lastMonth' || field === 'twoMonthsAgo') setMonthlySortSecondaryDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setMonthlySortField(field)
      setMonthlySortDirection('asc')
      if (field === 'dayDue') setMonthlyDayDueDir('asc')
      if (field === 'thisMonth' || field === 'lastMonth' || field === 'twoMonthsAgo') {
        setMonthlySortSecondaryColumn(field)
        setMonthlySortSecondaryDir('asc')
      }
    }
  }

  const monthlySortIndicator = (field: MonthlySortField) => {
    if (field === 'dayDue') {
      if (monthlySortField !== 'dayDue' && monthlySortField !== 'thisMonth' && monthlySortField !== 'lastMonth' && monthlySortField !== 'twoMonthsAgo') return ' ↕'
      return monthlyDayDueDir === 'asc' ? ' ↑' : ' ↓'
    }
    if (field === 'thisMonth' || field === 'lastMonth' || field === 'twoMonthsAgo') {
      const isPrimary = monthlySortField === field
      const isSecondary = monthlySortSecondaryColumn === field
      if (!isPrimary && !isSecondary) return ' ↕'
      if (isPrimary) return monthlySortDirection === 'asc' ? ' ↑' : ' ↓'
      return monthlySortSecondaryDir === 'asc' ? ' ↑' : ' ↓'
    }
    if (monthlySortField !== field) return ' ↕'
    return monthlySortDirection === 'asc' ? ' ↑' : ' ↓'
  }

  // Format date for grid header (M/D format)
  const formatGridDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    const month = date.getMonth() + 1
    const day = date.getDate()
    return `${month}/${day}`
  }

  // Get which period a date belongs to based on cadence
  // For weekly: period is the Friday (Sat to Fri window)
  // For bi-weekly: period is the Friday of that bi-weekly cycle
  // For monthly: period is the first of the month
  const getPeriodKey = (dateStr: string, cadence: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    const c = cadence.toLowerCase()
    
    if (c === 'weekly') {
      // Weekly: find the Friday for this week (period is Sat to Fri)
      // If date is Friday, that's the period key
      // If date is Sat-Sun, it belongs to the next Friday
      // If date is Mon-Thu, it belongs to the Friday of that week
      const dayOfWeek = date.getDay() // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
      const friday = new Date(date)
      
      if (dayOfWeek === 5) {
        // Already Friday
        return friday.toISOString().split('T')[0]
      } else if (dayOfWeek === 6 || dayOfWeek === 0) {
        // Saturday or Sunday - belongs to next Friday
        friday.setDate(date.getDate() + (5 - dayOfWeek + 7) % 7)
      } else {
        // Monday-Thursday - belongs to Friday of this week
        friday.setDate(date.getDate() + (5 - dayOfWeek))
      }
      return friday.toISOString().split('T')[0]
    } else if (c === 'biweekly' || c === 'bi-weekly') {
      // Bi-weekly: find the Friday for this bi-weekly cycle
      // Similar to weekly but every other Friday
      const dayOfWeek = date.getDay()
      let friday = new Date(date)
      
      if (dayOfWeek === 5) {
        // Already Friday
      } else if (dayOfWeek === 6 || dayOfWeek === 0) {
        friday.setDate(date.getDate() + (5 - dayOfWeek + 7) % 7)
      } else {
        friday.setDate(date.getDate() + (5 - dayOfWeek))
      }
      
      // Round to nearest bi-weekly Friday (every 14 days from a reference)
      const reference = new Date('2024-01-05') // A Friday
      const daysSinceRef = Math.floor((friday.getTime() - reference.getTime()) / (1000 * 60 * 60 * 24))
      const periodStart = new Date(reference)
      periodStart.setDate(reference.getDate() + Math.floor(daysSinceRef / 14) * 14)
      return periodStart.toISOString().split('T')[0]
    } else if (c === 'monthly') {
      // Monthly: first day of the month
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
    }
    return dateStr
  }

  // Check if a Friday is the active Friday for a bi-weekly property
  // Bi-weekly properties only have one active Friday per bi-weekly period
  // The active Friday is the one where the invoice's period_end falls
  const isActiveFridayForBiWeekly = (fridayDateStr: string, property: PropertyPayments, allFridays: string[]) => {
    const fridayDate = new Date(fridayDateStr + 'T00:00:00')
    
    // Get all invoices for this property
    const invoiceMap = new Map<string, PaymentInvoice>()
    property.payments.forEach(p => {
      if (p.invoice && !invoiceMap.has(p.invoice.id)) {
        invoiceMap.set(p.invoice.id, p.invoice)
      }
    })
    
    // For each invoice, find which Friday's period_end is closest to the invoice's period_end
    // That Friday is the active one for this invoice
    for (const invoice of invoiceMap.values()) {
      const invoiceEnd = new Date(invoice.period_end + 'T00:00:00')
      let closestFridayForInvoice: string | null = null
      let minDiff = Infinity

      for (const f of allFridays) {
        const fDate = new Date(f + 'T00:00:00')
        const fPeriodEnd = new Date(fDate)
        // Bi-weekly period ends on Friday
        // Check if invoiceEnd is within this Friday's period (Sat to Fri)
        const fPeriodStart = new Date(fDate)
        fPeriodStart.setDate(fDate.getDate() - 13) // 14 days before Friday

        if (invoiceEnd >= fPeriodStart && invoiceEnd <= fPeriodEnd) {
          const diff = Math.abs(invoiceEnd.getTime() - fPeriodEnd.getTime())
          if (diff < minDiff) {
            minDiff = diff
            closestFridayForInvoice = f
          }
        }
      }
      if (closestFridayForInvoice === fridayDateStr) {
        return true; // This is the active Friday for this invoice
      }
    }
    return false;
  }

  // Check if a Friday is the active Friday for a monthly property
  // Monthly properties only have one active Friday per month (closest to rent_due_day)
  const isActiveFridayForMonthly = (fridayDateStr: string, property: PropertyPayments, allFridays: string[]) => {
    const fridayDate = new Date(fridayDateStr + 'T00:00:00')
    const rentDueDay = property.rent_due_day ?? 1
    
    // Get all Fridays in the same month
    const monthFridays = allFridays.filter(f => {
      const fDate = new Date(f + 'T00:00:00')
      return fDate.getFullYear() === fridayDate.getFullYear() && 
             fDate.getMonth() === fridayDate.getMonth()
    })
    
    if (monthFridays.length === 0) return false
    
    // Find the Friday closest to rent_due_day (preferring before)
    let closestFriday: string | null = null
    
    // First, check for exact match
    const exactMatch = monthFridays.find(f => {
      const fDate = new Date(f + 'T00:00:00')
      return fDate.getDate() === rentDueDay
    })
    if (exactMatch) {
      closestFriday = exactMatch
    } else {
      // Prefer Friday that comes BEFORE rent_due_day
      const fridaysBefore = monthFridays.filter(f => {
        const fDate = new Date(f + 'T00:00:00')
        return fDate.getDate() <= rentDueDay
      })
      if (fridaysBefore.length > 0) {
        closestFriday = fridaysBefore.reduce((closest, current) => {
          const currentDate = new Date(current + 'T00:00:00')
          const closestDate = new Date(closest + 'T00:00:00')
          const currentDist = Math.abs(currentDate.getDate() - rentDueDay)
          const closestDist = Math.abs(closestDate.getDate() - rentDueDay)
          return currentDist < closestDist ? current : closest
        })
      } else {
        // If no Friday before, choose closest overall
        closestFriday = monthFridays.reduce((closest, current) => {
          const currentDate = new Date(current + 'T00:00:00')
          const closestDate = new Date(closest + 'T00:00:00')
          const currentDist = Math.abs(currentDate.getDate() - rentDueDay)
          const closestDist = Math.abs(closestDate.getDate() - rentDueDay)
          return currentDist < closestDist ? current : closest
        })
      }
    }
    
    return closestFriday === fridayDateStr
  }

  // Get invoice status for a Friday date using the same logic as table view
  // This matches invoices to Friday periods based on invoice period_start/period_end
  const getInvoiceForFriday = (property: PropertyPayments, fridayDateStr: string, cadence: string, allFridays: string[]) => {
    const fridayDate = new Date(fridayDateStr + 'T00:00:00')
    
    // For monthly properties, ONLY show on the active Friday for that month
    // All other Fridays should return null (will show "----")
    if (cadence === 'monthly') {
      if (!isActiveFridayForMonthly(fridayDateStr, property, allFridays)) {
        return null // Not the active Friday for this month - show "----"
      }
      // For monthly, match invoice by month (not by period overlap)
      // Find invoice where period_start month matches this Friday's month
      const fridayMonth = fridayDate.getMonth()
      const fridayYear = fridayDate.getFullYear()
      
      const matchingPayments = property.payments.filter(p => {
        if (!p.invoice) return false
        const invoiceStart = new Date(p.invoice.period_start + 'T00:00:00')
        // Match if invoice period_start is in the same month/year as this Friday
        return invoiceStart.getMonth() === fridayMonth && 
               invoiceStart.getFullYear() === fridayYear
      })
      
      if (matchingPayments.length === 0) {
        return null
      }
      
      // Get unique invoices
      const invoiceMap = new Map<string, PaymentInvoice>()
      matchingPayments.forEach(p => {
        if (p.invoice && !invoiceMap.has(p.invoice.id)) {
          invoiceMap.set(p.invoice.id, p.invoice)
        }
      })
      
      const invoices = Array.from(invoiceMap.values())
      return invoices.length > 0 ? invoices[0] : null
    }
    
    // For bi-weekly, only show on the active Friday for that bi-weekly period
    // Use isActiveFridayForBiWeekly to determine if this Friday is active
    if (cadence === 'biweekly' || cadence === 'bi-weekly') {
      // First check if this Friday is active for any invoice
      if (!isActiveFridayForBiWeekly(fridayDateStr, property, allFridays)) {
        return null // Not an active Friday - show "----"
      }
      
      // Calculate this Friday's bi-weekly period
      const periodStart = new Date(fridayDate)
      periodStart.setDate(fridayDate.getDate() - 13) // 14 days before Friday
      const periodEnd = new Date(fridayDate)
      
      // Find invoices where the invoice period_end falls within this Friday's bi-weekly period
      const matchingPayments = property.payments.filter(p => {
        if (!p.invoice) return false
        const invoiceEnd = new Date(p.invoice.period_end + 'T00:00:00')
        // Match if invoice period_end is in this Friday's bi-weekly period
        return invoiceEnd >= periodStart && invoiceEnd <= periodEnd
      })
      
      if (matchingPayments.length === 0) {
        return null
      }
      
      // Get unique invoices
      const invoiceMap = new Map<string, PaymentInvoice>()
      matchingPayments.forEach(p => {
        if (p.invoice && !invoiceMap.has(p.invoice.id)) {
          invoiceMap.set(p.invoice.id, p.invoice)
        }
      })
      
      // For each invoice, check if this Friday is the active one
      for (const invoice of invoiceMap.values()) {
        const invoiceEnd = new Date(invoice.period_end + 'T00:00:00')
        const invoiceEndStr = invoiceEnd.toISOString().split('T')[0]
        
        // If invoice period_end matches this Friday, return it
        if (invoiceEndStr === fridayDateStr) {
          return invoice
        }
        
        // Find which Friday's period_end is closest to the invoice's period_end
        let closestFridayForInvoice: string | null = null
        let minDiff = Infinity

        for (const f of allFridays) {
          const fDate = new Date(f + 'T00:00:00')
          const fPeriodEnd = new Date(fDate)
          const fPeriodStart = new Date(fDate)
          fPeriodStart.setDate(fDate.getDate() - 13)

          if (invoiceEnd >= fPeriodStart && invoiceEnd <= fPeriodEnd) {
            const diff = Math.abs(invoiceEnd.getTime() - fPeriodEnd.getTime())
            if (diff < minDiff) {
              minDiff = diff
              closestFridayForInvoice = f
            }
          }
        }
        
        if (closestFridayForInvoice === fridayDateStr) {
          return invoice
        }
      }
      
      // No invoice found for this Friday
      return null
    }
    
    // For weekly, use period overlap matching
    // Calculate the period for this Friday
    let periodStart = new Date(fridayDate)
    let periodEnd = new Date(fridayDate)
    
    // Weekly: Saturday (6 days before Friday) to Friday
    periodStart.setDate(fridayDate.getDate() - 6)
    
    // Find invoices where the invoice period overlaps with this Friday's period
    // Use the same logic as table view - look at property.payments and their invoices
    const matchingPayments = property.payments.filter(p => {
      if (!p.invoice) return false
      
      const invoiceStart = new Date(p.invoice.period_start + 'T00:00:00')
      const invoiceEnd = new Date(p.invoice.period_end + 'T00:00:00')
      
      // Check if invoice period overlaps with Friday's period
      return invoiceStart <= periodEnd && invoiceEnd >= periodStart
    })
    
    
    if (matchingPayments.length === 0) {
      return null
    }
    
    // Get unique invoices (same invoice might have multiple payments)
    const invoiceMap = new Map<string, PaymentInvoice>()
    matchingPayments.forEach(p => {
      if (p.invoice && !invoiceMap.has(p.invoice.id)) {
        invoiceMap.set(p.invoice.id, p.invoice)
      }
    })
    
    // For now, return the first matching invoice (or we could aggregate if multiple)
    // In practice, there should be one invoice per period
    const invoices = Array.from(invoiceMap.values())
    const selectedInvoice = invoices.length > 0 ? invoices[0] : null
    
    
    return selectedInvoice
  }

  // Get cell value and color for grid view using same logic as table view
  const getGridCellValue = (property: PropertyPayments, fridayDateStr: string) => {
    const cadence = property.cadence?.toLowerCase() || ''
    if (!cadence) {
      return {
        value: '----',
        color: 'bg-green-200',
        textColor: 'text-gray-600'
      }
    }
    
    // Get the invoice for this Friday using the same logic as table view
    const invoice = getInvoiceForFriday(property, fridayDateStr, cadence, gridDateColumns)
    
    if (!invoice) {
      // No invoice for this period - show as not applicable
      return {
        value: '----',
        color: 'bg-green-200', // darker green
        textColor: 'text-gray-600'
      }
    }
    
    // Use the same logic as table view to determine status
    const balance = parseFloat(invoice.recalculated_balance as any || 0)
    const amountTotal = parseFloat(invoice.amount_total as any || 0)
    
    // Check if there are any payments for this invoice
    // Look for payments that match the invoice ID, including those with amount > 0
    const invoicePayments = property.payments.filter(p => {
      const paymentInvoiceId = p.invoice?.id
      const paymentAmount = parseFloat(p.amount as any || 0)
      return paymentInvoiceId === invoice.id && paymentAmount > 0
    })
    const hasPayments = invoicePayments.length > 0
    const totalPaid = invoicePayments.reduce((sum, p) => sum + parseFloat(p.amount as any || 0), 0)
    
    // Green when payment amount >= owed (fully paid) - show amount
    // Red only when zero or no invoice for that date
    // Show amounts when period had a payment (not "----" when paid)
    
    if (amountTotal === 0) {
      // Zero owed - show red
      return {
        value: formatCurrency(0),
        color: 'bg-red-200', // red for zero owed
        textColor: 'text-gray-900'
      }
    } else if (balance <= 0) {
      // Fully paid: balance <= 0 means fully paid (regardless of hasPayments flag)
      // Show payment amount if available, otherwise show amount total
      const displayAmount = hasPayments ? totalPaid : amountTotal
      return {
        value: formatCurrency(displayAmount),
        color: 'bg-green-200', // green for fully paid
        textColor: 'text-gray-900'
      }
    } else if (hasPayments && totalPaid >= amountTotal) {
      // Fully paid: payment amount >= owed - show payment amount in green
      return {
        value: formatCurrency(totalPaid),
        color: 'bg-green-200', // green for fully paid
        textColor: 'text-gray-900'
      }
    } else if (balance > 0 && hasPayments) {
      // Partially paid: has payments but balance > 0
      // Show balance in yellow
      return {
        value: formatCurrency(balance),
        color: 'bg-yellow-200', // yellow for partially paid
        textColor: 'text-gray-900'
      }
    } else if (balance > 0 && !hasPayments) {
      // Unpaid: balance > 0 and no payments
      // Show "----" in red (don't show amount)
      return {
        value: '----',
        color: 'bg-red-200', // red for unpaid
        textColor: 'text-gray-900'
      }
    } else {
      // Edge case: balance is 0 but no payments - show red
      return {
        value: formatCurrency(0),
        color: 'bg-red-200', // red for zero/no payment
        textColor: 'text-gray-900'
      }
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
          <button
            onClick={() => setViewMode('monthly')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              viewMode === 'monthly'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Monthly
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

      {/* Main Table, Grid, or Monthly */}
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
                const lastPaymentDate = getLastPaymentReceivedDate(property)
                const lastPayment = property.payments[0] // For tenant name display
                const tenantName = lastPayment?.tenant_name || '-'
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
                      <div className="text-xs text-gray-500">{tenantName}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {tenantName}
                    </td>
                    <td className="px-4 py-3">
                      {cadenceBadge(property.cadence)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {lastPaymentDate ? formatDate(lastPaymentDate) : 'Never'}
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
                              setFormDate(new Date().toISOString().split('T')[0])
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
      ) : viewMode === 'grid' ? (
        /* Grid View */
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border-b border-gray-200 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('property')}
                  >
                    Property{sortIndicator('property')}
                  </th>
                  <th
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border-b border-gray-200 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('cadence')}
                  >
                    Cadence{sortIndicator('cadence')}
                  </th>
                  <th
                    className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase border-b border-gray-200 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('totalOwed')}
                  >
                    Total Owed{sortIndicator('totalOwed')}
                  </th>
                  {gridDateColumns.map((dateStr, colIndex) => (
                    <th
                      key={dateStr}
                      className={`px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase border-b border-gray-200 ${colIndex === 0 ? 'cursor-pointer hover:bg-gray-100' : ''}`}
                      onClick={colIndex === 0 ? () => handleSort('latestWeek') : undefined}
                      title={colIndex === 0 ? 'Sort by latest week' : undefined}
                    >
                      <span className="inline-flex items-center justify-center gap-1">
                        {formatGridDate(dateStr)}
                        {colIndex === 0 && (
                          <span className="inline-flex items-center" aria-hidden="true">
                            {sortIndicatorIcon('latestWeek')}
                          </span>
                        )}
                      </span>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase border-b border-gray-200">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredAndSorted.length === 0 ? (
                  <tr>
                    <td colSpan={gridDateColumns.length + 4} className="px-4 py-8 text-center text-gray-500">
                      No payment history found
                    </td>
                  </tr>
                ) : (
                  filteredAndSorted.map((property) => {
                    const tenantName = property.payments[0]?.tenant_name || '-'
                    return (
                      <tr key={property.property_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm border-r border-gray-200">
                          <div className="font-medium text-gray-900">{property.property_name}</div>
                          <div className="text-xs text-gray-500">{tenantName}</div>
                        </td>
                        <td className="px-4 py-3 border-r border-gray-200">
                          {cadenceBadge(property.cadence)}
                        </td>
                        <td className={`px-4 py-3 text-sm text-right font-medium border-r border-gray-200 ${property.totalOwed > 0 ? 'text-red-700' : 'text-green-700'}`}>
                          {formatCurrency(property.totalOwed)}
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
                        <td className="px-4 py-3 text-center border-r border-gray-200">
                          {property.lease_id && (
                            <button
                              onClick={() => {
                                setSelectedPropertyForGenerate(property)
                                setFormDate(new Date().toISOString().split('T')[0])
                                setShowGenerateModal(true)
                              }}
                              className="px-3 py-1 text-xs font-medium rounded-md bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                            >
                              Notice
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Monthly View */
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    onClick={() => handleMonthlySort('property')}
                  >
                    Property{monthlySortIndicator('property')}
                  </th>
                  <th
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    onClick={() => handleMonthlySort('cadence')}
                  >
                    Cadence{monthlySortIndicator('cadence')}
                  </th>
                  <th
                    className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    onClick={() => handleMonthlySort('dayDue')}
                  >
                    Day Due{monthlySortIndicator('dayDue')}
                  </th>
                  <th
                    className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    onClick={() => handleMonthlySort('thisMonth')}
                  >
                    {monthLabels[0]}{monthlySortIndicator('thisMonth')}
                  </th>
                  <th
                    className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    onClick={() => handleMonthlySort('lastMonth')}
                  >
                    {monthLabels[1]}{monthlySortIndicator('lastMonth')}
                  </th>
                  <th
                    className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    onClick={() => handleMonthlySort('twoMonthsAgo')}
                  >
                    {monthLabels[2]}{monthlySortIndicator('twoMonthsAgo')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {monthlyTotalsSorted.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      No properties found
                    </td>
                  </tr>
                ) : (
                  monthlyTotalsSorted.map(({ property, paidThisMonth, paidLastMonth, paidTwoMonthsAgo }) => {
                    const tenantName = property.payments[0]?.tenant_name || '-'
                    return (
                      <tr key={property.property_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-gray-900">{property.property_name}</div>
                          <div className="text-xs text-gray-500">{tenantName}</div>
                        </td>
                        <td className="px-4 py-3">
                          {cadenceBadge(property.cadence)}
                        </td>
                        <td className="px-4 py-3 text-sm text-center text-gray-900">
                          {property.rent_due_day != null ? property.rent_due_day : '–'}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900">
                          {formatCurrency(paidThisMonth)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900">
                          {formatCurrency(paidLastMonth)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900">
                          {formatCurrency(paidTwoMonthsAgo)}
                        </td>
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
        const detailPayments = sortPaymentsByLastPaidDate(property.payments)

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
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Last Paid</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Payment Amount</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Invoice Period</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Invoice Total</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Invoice Status</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {detailPayments.map((payment) => (
                      <tr key={payment.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-sm text-gray-900">
                          {formatLastPaidCell(payment, detailPayments, formatDate)}
                        </td>
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
                  setFormDate(new Date().toISOString().split('T')[0])
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
                  <option value="Laurens">Laurens</option>
                  <option value="Gaston">Gaston (NC)</option>
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Form Date
                </label>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
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
                    setFormDate(new Date().toISOString().split('T')[0])
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
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const html =
                          generatedForms.noticeHTML ?? generateNoticeHTML(generatedForms.notice)
                        openPrintPreview(html)
                      }}
                      className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors"
                    >
                      Print preview
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const html =
                          generatedForms.noticeHTML ?? generateNoticeHTML(generatedForms.notice)
                        printFormDocument(html)
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Print
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (downloadFormat === 'pdf') {
                          downloadAsPDF(
                            generatedForms.notice,
                            '7-Day-Notice.pdf',
                            generatedForms.noticeHTML ?? generateNoticeHTML(generatedForms.notice)
                          )
                        } else {
                          downloadAsWord(
                            generatedForms.notice,
                            '7-Day-Notice.docx',
                            generatedForms.noticeHTML ?? generateNoticeHTML(generatedForms.notice)
                          )
                        }
                      }}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      Download 7-Day Notice ({downloadFormat.toUpperCase()})
                    </button>
                  </div>
                </div>
              )}

              {generatedForms.ejectment && (
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-3">
                    {generatedForms.ejectmentFormKind === 'NC'
                      ? 'Complaint in Summary Ejectment (AOC-CVM-201)'
                      : 'Application for Ejectment (SCCA/732)'}
                  </h3>
                  <div className="border border-gray-300 rounded-lg p-4 bg-gray-50">
                    <pre className="whitespace-pre-wrap text-sm font-mono">{generatedForms.ejectment}</pre>
                  </div>
                  <EjectmentFormDownloadActions
                    forms={generatedForms}
                    downloadFormat={downloadFormat}
                  />
                </div>
              )}

              {generatedForms.affidavit && (
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-3">
                    {generatedForms.affidavitFormKind === 'NC'
                      ? 'Affidavit of Item of Account — Rent Ledger (NC)'
                      : 'Affidavit of Item of Account (SCCA/716)'}
                  </h3>
                  <div className="border border-gray-300 rounded-lg p-4 bg-gray-50">
                    <pre className="whitespace-pre-wrap text-sm font-mono">{generatedForms.affidavit}</pre>
                  </div>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const html = generatedForms.affidavitHTML
                        if (!html) return
                        openPrintPreview(html)
                      }}
                      disabled={!generatedForms.affidavitHTML}
                      className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Print preview ledger
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const html = generatedForms.affidavitHTML
                        if (!html) return
                        printFormDocument(html)
                      }}
                      disabled={!generatedForms.affidavitHTML}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Print ledger
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const blob = new Blob([generatedForms.affidavitHTML], { type: 'text/html' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download =
                          generatedForms.affidavitFormKind === 'NC'
                            ? 'Rent-Ledger-NC.html'
                            : 'Affidavit-of-Item-of-Account.html'
                        a.click()
                        URL.revokeObjectURL(url)
                      }}
                      disabled={!generatedForms.affidavitHTML}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Download ledger HTML only
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const base =
                          generatedForms.affidavitFormKind === 'NC'
                            ? 'Rent-Ledger-NC'
                            : 'Affidavit-of-Item-of-Account'
                        if (downloadFormat === 'pdf') {
                          downloadAsPDF(generatedForms.affidavit, `${base}.pdf`, generatedForms.affidavitHTML)
                        } else {
                          downloadAsWord(generatedForms.affidavit, `${base}.docx`)
                        }
                      }}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      Download ledger ({downloadFormat.toUpperCase()})
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
