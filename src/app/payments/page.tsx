'use client'

import { useEffect, useState } from 'react'

interface Lease {
  id: string
  property_id: string
  tenant_id: string
  rent: number
  rent_cadence: string
  rent_due_day: number
  lease_start_date: string
  status: string
}

interface Property {
  id: string
  name: string
  address: string
}

interface Tenant {
  id: string
  full_name: string
  first_name: string
  last_name: string
}

interface Invoice {
  id: string
  invoice_no: string
  due_date: string
  period_start: string
  period_end: string
  amount_rent: number
  amount_late: number
  amount_other: number
  amount_total: number
  amount_paid: number
  balance_due: number
  status: string
  paid_in_full_at: string | null
}

interface LeaseRow {
  lease: Lease
  property: Property
  tenant: Tenant
  unpaidInvoicesCount: number
  totalOwed: number
}

export default function PaymentsPage() {
  const [leases, setLeases] = useState<LeaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [cadenceFilter, setCadenceFilter] = useState('all')
  const [selectedLease, setSelectedLease] = useState<LeaseRow | null>(null)
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loadingInvoices, setLoadingInvoices] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0])
  const [paymentType, setPaymentType] = useState('Rent')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sortField, setSortField] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [showEditPaymentsModal, setShowEditPaymentsModal] = useState(false)
  const [invoicePayments, setInvoicePayments] = useState<any[]>([])
  const [loadingPayments, setLoadingPayments] = useState(false)
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null)
  const [editingPayment, setEditingPayment] = useState<any | null>(null)
  const [showEditSinglePaymentModal, setShowEditSinglePaymentModal] = useState(false)
  const [showEditInvoiceModal, setShowEditInvoiceModal] = useState(false)
  const [editInvoiceAmountPaid, setEditInvoiceAmountPaid] = useState('')
  const [editInvoiceLateFee, setEditInvoiceLateFee] = useState('')
  const [togglingLateFee, setTogglingLateFee] = useState<string | null>(null)
  const [generatingNotice, setGeneratingNotice] = useState<string | null>(null)
  const [showNoticeModal, setShowNoticeModal] = useState(false)
  const [noticeContent, setNoticeContent] = useState('')
  const [noticeTitle, setNoticeTitle] = useState('')
  const [showMiscIncomeModal, setShowMiscIncomeModal] = useState(false)
  const [properties, setProperties] = useState<Property[]>([])

  useEffect(() => {
    fetchLeases()
    fetchProperties()
  }, [])

  const handlePrintNotice = () => {
    const printWin = window.open('', '_blank', 'width=900,height=1100')
    if (!printWin) { alert('Please allow popups'); return }
    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title></title><style>
@page{margin:.5in;size:letter portrait}*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#000;background:#fff;padding:20px}
.t{font-size:22px;font-weight:bold;text-align:center;margin-bottom:20px}
.lr{font-size:11px;text-align:center;margin-bottom:15px}
.s{margin-bottom:12px}.h{font-weight:bold;font-size:14px;margin-top:15px;margin-bottom:8px}
.td{font-weight:bold;font-size:16px;background:#fef3cd;padding:12px;border-left:4px solid #ffc107;margin:15px 0}
.i{font-weight:bold;color:#dc3545;background:#f8d7da;padding:10px;margin:15px 0;border-radius:4px}
.ll{background:#f8f9fa;padding:12px;border-left:4px solid #007bff;margin:10px 0}
.d{background:#d4edda;padding:12px;border-left:4px solid #28a745;margin:10px 0}
.in{margin-left:20px;margin-bottom:4px}.dv{border-top:1px solid #ccc;margin:20px 0}
@media print{body{padding:0}}
</style></head><body>${noticeContent.split('\n').map(l=>{
if(l.startsWith('**NOTICE TO PAY'))return'<div class="t">'+l.replace(/\*\*/g,'')+'</div>';
if(l.startsWith('7-DAY NOTICE PURSUANT'))return'<div class="lr">'+l+'</div>';
if(l.startsWith('**BREAKDOWN'))return'<div class="h">'+l.replace(/\*\*/g,'')+'</div>';
if(l.startsWith('**TOTAL DUE:'))return'<div class="td">'+l.replace(/\*\*/g,'')+'</div>';
if(l.startsWith('Rent:')||l.startsWith('Late Fee:')||l.startsWith('Other'))return'<div class="in">'+l+'</div>';
if(l.startsWith('**IMPORTANT:'))return'<div class="i">'+l.replace(/\*\*/g,'')+'</div>';
if(l.startsWith('**LANDLORD:'))return'<div class="h">'+l.replace(/\*\*/g,'')+'</div>';
if(l.startsWith('**NOTICE DELIVERY:'))return'<div class="h">'+l.replace(/\*\*/g,'')+'</div>';
if(l.includes('Honest Home')||l.includes('PO Box')||l.includes('Text:')||l.includes('Email:'))return'<div class="ll">'+l+'</div>';
if(l.includes('Date Notice')||l.includes('Method of'))return'<div class="d">'+l+'</div>';
if(l.trim()==='---')return'<div class="dv"></div>';
if(l.trim()==='')return'<br>';
if(l.startsWith('Date:')||l.startsWith('To:')||l.startsWith('Property:')){
const p=l.split(':');return'<div class="s"><strong>'+p[0]+':</strong>'+p.slice(1).join(':')+'</div>';}
return'<div class="s">'+l+'</div>';
}).join('')}<script>window.onload=function(){setTimeout(function(){window.print()},250)};</script></body></html>`;
    printWin.document.write(html);
    printWin.document.close();
  }

  const fetchProperties = async () => {
    try {
      const response = await fetch('/api/properties')
      if (response.ok) {
        const data = await response.json()
        setProperties(data)
      }
    } catch (error) {
      console.error('Error fetching properties:', error)
    }
  }

  const fetchLeases = async () => {
    try {
      setLoading(true)
      
      // Fetch all active leases with related data
      const response = await fetch('/api/leases')
      
      if (!response.ok) {
        console.error('API Error:', response.status, response.statusText)
        const errorData = await response.json()
        console.error('Error details:', errorData)
        setLeases([])
        return
      }
      
      const data = await response.json()
      console.log('Leases API response:', data)
      
      if (!Array.isArray(data)) {
        console.error('No leases data received, got:', typeof data, data)
        setLeases([])
        return
      }

      // Get invoices for all leases
      const today = new Date().toISOString().split('T')[0]
      
      const leasesWithData: LeaseRow[] = await Promise.all(
        data
          .filter((lease: any) => lease.status === 'active')
          .map(async (leaseData: any) => {
            // Fetch invoices from lease start to current date
            const invoicesResponse = await fetch(
              `/api/invoices?leaseId=${leaseData.id}&from=${leaseData.lease_start_date}&to=${today}`
            )
            const invoicesData = await invoicesResponse.json()
            const invoices = Array.isArray(invoicesData) ? invoicesData : []
            
            // Calculate unpaid invoices and total owed
            // First, get existing unpaid invoices
            const existingUnpaidInvoices = invoices.filter((inv: Invoice) => 
              inv.status === 'OPEN' && parseFloat(inv.balance_due as any) > 0
            )
            
            // For now, let's be conservative and only count existing unpaid invoices
            // TODO: Add missing invoice detection later if needed
            let missingInvoicesCount = 0
            let missingInvoicesAmount = 0
            
            const totalUnpaidCount = existingUnpaidInvoices.length + missingInvoicesCount
            const totalOwed = existingUnpaidInvoices.reduce((sum: number, inv: Invoice) => 
              sum + parseFloat(inv.balance_due as any), 0
            ) + missingInvoicesAmount

            return {
              lease: leaseData,
              property: leaseData.RENT_properties || {},
              tenant: leaseData.RENT_tenants || {},
              unpaidInvoicesCount: totalUnpaidCount,
              totalOwed
            }
          })
      )

      setLeases(leasesWithData)
    } catch (error) {
      console.error('Error fetching leases:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleViewInvoices = async (leaseRow: LeaseRow) => {
    setSelectedLease(leaseRow)
    setShowInvoiceModal(true)
    setLoadingInvoices(true)

    try {
      // Fetch all invoices for this lease for the current year up to today
      const currentYear = new Date().getFullYear()
      const yearStart = `${currentYear}-01-01`
      const today = new Date().toISOString().split('T')[0]
      
      const url = `/api/invoices?leaseId=${leaseRow.lease.id}&from=${yearStart}&to=${today}`
      console.log('Fetching invoices from:', url)
      
      const response = await fetch(url)
      const data = await response.json()
      
      console.log('Invoices response:', data)
      
      // Use invoices from database directly - don't recalculate late fees
      // Late fees should be managed in the database and via the "Waive Fee" button
      setInvoices(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Error fetching invoices:', error)
      setInvoices([])
    } finally {
      setLoadingInvoices(false)
    }
  }

  const handleAddPayment = (invoice: Invoice) => {
    setSelectedInvoice(invoice)
    setPaymentAmount(invoice.balance_due.toString())
    setPaymentDate(invoice.due_date) // Set to invoice due date instead of today
    setPaymentType('Rent')
    setPaymentNotes('')
    setShowPaymentModal(true)
  }

  const handleEditPayments = async (invoice: Invoice) => {
    setEditingInvoice(invoice)
    setShowEditPaymentsModal(true)
    setLoadingPayments(true)

    try {
      // Fetch all payments for this invoice
      const response = await fetch(`/api/payments?invoiceId=${invoice.id}`)
      const data = await response.json()
      
      console.log('Payments for invoice:', data)
      setInvoicePayments(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Error fetching payments:', error)
      setInvoicePayments([])
    } finally {
      setLoadingPayments(false)
    }
  }

  const handleEditSinglePayment = (payment: any) => {
    setEditingPayment(payment)
    setPaymentAmount(payment.amount.toString())
    setPaymentDate(payment.payment_date.split('T')[0])
    setPaymentType(payment.payment_type || 'Rent')
    setPaymentNotes(payment.notes || '')
    setShowEditSinglePaymentModal(true)
  }

  const handleUpdatePayment = async () => {
    if (!editingPayment) return

    setIsSubmitting(true)
    try {
      const updateData = {
        payment_date: paymentDate,
        amount: parseFloat(paymentAmount),
        payment_type: paymentType,
        notes: paymentNotes
      }

      console.log('Sending payment update:', { id: editingPayment.id, updateData })

      const response = await fetch(`/api/rent/payments?id=${editingPayment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('Payment update failed:', errorData)
        throw new Error(errorData.error || 'Failed to update payment')
      }

      const result = await response.json()
      console.log('Payment updated:', result)

      // Update invoice balance
      if (editingPayment.invoice_id) {
        await updateInvoiceBalance(editingPayment.invoice_id)
      }

      // Refresh data
      setShowEditSinglePaymentModal(false)
      if (editingInvoice) {
        await handleEditPayments(editingInvoice)
      }
      if (selectedLease) {
        await handleViewInvoices(selectedLease)
        await fetchLeases()
      }
    } catch (error) {
      console.error('Error updating payment:', error)
      alert('Failed to update payment')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUpdateInvoice = async () => {
    if (!selectedInvoice) return

    setIsSubmitting(true)
    try {
      const newAmountPaid = parseFloat(editInvoiceAmountPaid)
      const newLateFee = parseFloat(editInvoiceLateFee)
      const rentAmount = Number(selectedInvoice.amount_rent)
      const newTotal = rentAmount + newLateFee
      const newBalance = newTotal - newAmountPaid

      console.log('Updating invoice:', {
        invoiceId: selectedInvoice.id,
        rentAmount,
        newLateFee,
        newTotal,
        newAmountPaid,
        newBalance
      })

      const response = await fetch(`/api/invoices?id=${selectedInvoice.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_late: newLateFee,
          amount_total: newTotal,
          amount_paid: newAmountPaid,
          balance_due: newBalance,
          status: newBalance <= 0 ? 'PAID' : 'OPEN',
          paid_in_full_at: newBalance <= 0 ? new Date().toISOString() : null
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('Failed to update invoice:', errorData)
        throw new Error('Failed to update invoice')
      }

      console.log('Invoice updated successfully')

      setShowEditInvoiceModal(false)
      if (selectedLease) {
        await handleViewInvoices(selectedLease)
        await fetchLeases()
      }
    } catch (error) {
      console.error('Error updating invoice:', error)
      alert('Failed to update invoice: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleToggleLateFee = async (invoice: Invoice) => {
    try {
      setTogglingLateFee(invoice.id)
      
      const currentLateFee = parseFloat(invoice.amount_late as any || 0)
      
      // Determine late fee amount based on lease cadence
      let lateFeeAmount = 0
      if (selectedLease) {
        const cadence = selectedLease.lease.rent_cadence?.toLowerCase() || ''
        if (cadence.includes('monthly')) {
          lateFeeAmount = 45
        } else if (cadence.includes('biweekly') || cadence.includes('bi-weekly')) {
          lateFeeAmount = 25
        } else if (cadence.includes('weekly')) {
          lateFeeAmount = 15
        } else {
          lateFeeAmount = 45 // Default to monthly rate
        }
      } else {
        lateFeeAmount = 45 // Default to monthly rate if no lease info
      }
      
      const newLateFee = currentLateFee > 0 ? 0 : lateFeeAmount
      
      const response = await fetch(`/api/invoices?id=${invoice.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount_late: newLateFee
        })
      })

      if (response.ok) {
        // Refresh the invoice data
        if (selectedLease) {
          await handleViewInvoices(selectedLease)
          await fetchLeases()
        }
        alert(`Late fee ${newLateFee > 0 ? `applied ($${newLateFee})` : 'removed'} successfully!`)
      } else {
        const errorData = await response.json()
        alert(`Error: ${errorData.error}`)
      }
    } catch (error) {
      console.error('Error toggling late fee:', error)
      alert('Failed to toggle late fee. Please try again.')
    } finally {
      setTogglingLateFee(null)
    }
  }

  const handleGenerateLateNotice = async (invoice: Invoice) => {
    if (!selectedLease) return

    try {
      setGeneratingNotice(invoice.id)

      const response = await fetch('/api/generate-notice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invoiceId: invoice.id,
          leaseId: selectedLease.lease.id,
        }),
      })

      if (response.ok) {
        const { noticeContent, noticeTitle } = await response.json()
        setNoticeContent(noticeContent)
        setNoticeTitle(noticeTitle)
        setShowNoticeModal(true)
      } else {
        const errorData = await response.json()
        alert(`Error generating notice: ${errorData.error}`)
      }
    } catch (error) {
      console.error('Error generating late notice:', error)
      alert('Failed to generate late notice. Please try again.')
    } finally {
      setGeneratingNotice(null)
    }
  }

  const handleGenerateLateNoticeForLease = async (leaseRow: LeaseRow) => {
    try {
      setGeneratingNotice(leaseRow.lease.id)

      // Get the most recent unpaid invoice for this lease
      const response = await fetch(`/api/invoices?leaseId=${leaseRow.lease.id}&from=${leaseRow.lease.lease_start_date}&to=${new Date().toISOString().split('T')[0]}`)
      const invoices = await response.json()
      
      if (!Array.isArray(invoices) || invoices.length === 0) {
        alert('No invoices found for this lease')
        return
      }

      // Find the most recent unpaid invoice
      const unpaidInvoices = invoices.filter((inv: Invoice) => 
        inv.status === 'OPEN' && parseFloat(inv.balance_due as any) > 0
      )

      if (unpaidInvoices.length === 0) {
        alert('No unpaid invoices found for this lease')
        return
      }

      // Use the most recent unpaid invoice
      const mostRecentInvoice = unpaidInvoices.sort((a: Invoice, b: Invoice) => 
        new Date(b.due_date).getTime() - new Date(a.due_date).getTime()
      )[0]

      const noticeResponse = await fetch('/api/generate-notice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invoiceId: mostRecentInvoice.id,
          leaseId: leaseRow.lease.id,
        }),
      })

      if (noticeResponse.ok) {
        const { noticeContent, noticeTitle } = await noticeResponse.json()
        setNoticeContent(noticeContent)
        setNoticeTitle(noticeTitle)
        setShowNoticeModal(true)
      } else {
        const errorData = await noticeResponse.json()
        alert(`Error generating notice: ${errorData.error}`)
      }
    } catch (error) {
      console.error('Error generating late notice:', error)
      alert('Failed to generate late notice. Please try again.')
    } finally {
      setGeneratingNotice(null)
    }
  }

  const handleWaiveLateFee = async (invoice: Invoice) => {
    if (!confirm('Are you sure you want to waive the late fee for this invoice?')) return

    try {
      const rentAmount = parseFloat(invoice.amount_rent as any)
      const paidAmount = parseFloat(invoice.amount_paid as any)
      const newTotal = rentAmount
      const newBalance = rentAmount - paidAmount

      console.log('Waiving late fee:', { 
        invoiceId: invoice.id, 
        oldLateFee: invoice.amount_late,
        rentAmount,
        paidAmount,
        newTotal,
        newBalance
      })

      // Update invoice to remove late fee
      const response = await fetch(`/api/invoices?id=${invoice.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_late: 0,
          amount_total: newTotal,
          balance_due: newBalance,
          status: newBalance <= 0 ? 'PAID' : 'OPEN',
          paid_in_full_at: newBalance <= 0 ? new Date().toISOString() : null
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('Failed to waive late fee:', errorData)
        throw new Error('Failed to waive late fee')
      }

      const result = await response.json()
      console.log('Late fee waived successfully:', result)

      // Refresh invoices
      if (selectedLease) {
        await handleViewInvoices(selectedLease)
        await fetchLeases()
      }
    } catch (error) {
      console.error('Error waiving late fee:', error)
      alert('Failed to waive late fee: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const updateInvoiceBalance = async (invoiceId: string) => {
    try {
      // Fetch all payments for this invoice
      const paymentsResponse = await fetch(`/api/payments?invoiceId=${invoiceId}`)
      const payments = await paymentsResponse.json()
      
      // Calculate total paid
      const totalPaid = Array.isArray(payments) 
        ? payments.reduce((sum, p) => sum + parseFloat(p.amount), 0) 
        : 0

      console.log('Updating invoice balance:', { invoiceId, totalPaid, paymentsCount: payments.length })
      
      // Update invoice balance using query parameter
      const updateResponse = await fetch(`/api/invoices?id=${invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_paid: totalPaid,
          balance_due: totalPaid,  // Will be recalculated on backend
          status: 'updating'  // Will be recalculated on backend
        })
      })

      if (!updateResponse.ok) {
        const errorData = await updateResponse.json()
        console.error('Failed to update invoice balance:', errorData)
        throw new Error('Failed to update invoice balance')
      }

      const result = await updateResponse.json()
      console.log('Invoice balance updated:', result)
    } catch (error) {
      console.error('Error updating invoice balance:', error)
      throw error
    }
  }

  const handleDeletePayment = async (paymentId: string, invoiceId?: string) => {
    if (!confirm('Are you sure you want to delete this payment?')) return

    try {
      const response = await fetch('/api/payments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: paymentId })
      })

      if (!response.ok) {
        throw new Error('Failed to delete payment')
      }

      console.log('Payment deleted successfully')

      // Update invoice balance if invoice ID is provided
      if (invoiceId) {
        console.log('Updating invoice balance after delete...')
        await updateInvoiceBalance(invoiceId)
      }

      // Refresh payments and invoices
      if (editingInvoice) {
        await handleEditPayments(editingInvoice)
      }
      if (selectedLease) {
        await handleViewInvoices(selectedLease)
        await fetchLeases()
      }
    } catch (error) {
      console.error('Error deleting payment:', error)
      alert('Failed to delete payment: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const handleSubmitPayment = async () => {
    if (!selectedInvoice || !selectedLease) return
    
    setIsSubmitting(true)
    try {
      const paymentAmountNum = parseFloat(paymentAmount)
      const currentPaid = parseFloat(selectedInvoice.amount_paid as any)
      const newTotalPaid = currentPaid + paymentAmountNum
      const amountTotal = parseFloat(selectedInvoice.amount_total as any)
      const newBalance = amountTotal - newTotalPaid

      console.log('Adding payment to invoice:', {
        invoiceId: selectedInvoice.id,
        currentPaid,
        paymentAmount: paymentAmountNum,
        newTotalPaid,
        amountTotal,
        newBalance
      })

      // Update invoice directly
      const response = await fetch(`/api/invoices?id=${selectedInvoice.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_paid: newTotalPaid,
          balance_due: newBalance,
          status: newBalance <= 0 ? 'PAID' : 'OPEN',
          paid_in_full_at: newBalance <= 0 ? new Date().toISOString() : null
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('Failed to update invoice:', errorData)
        throw new Error('Failed to add payment')
      }

      console.log('Payment added successfully to invoice')

      // Refresh data
      setShowPaymentModal(false)
      await handleViewInvoices(selectedLease)
      await fetchLeases()
    } catch (error) {
      console.error('Error adding payment:', error)
      alert('Failed to add payment: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const getInvoiceStatusColor = (invoice: Invoice) => {
    const balance = parseFloat(invoice.balance_due as any)
    const total = parseFloat(invoice.amount_total as any)
    
    if (balance === 0) return 'bg-green-50 border-green-200'
    if (balance < total) return 'bg-yellow-50 border-yellow-200'
    return 'bg-red-50 border-red-200'
  }

  const getInvoiceStatusBadge = (invoice: Invoice) => {
    const balance = parseFloat(invoice.balance_due as any)
    const total = parseFloat(invoice.amount_total as any)
    
    if (balance === 0) return <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded">Paid</span>
    if (balance < total) return <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded">Partial</span>
    return <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded">Unpaid</span>
  }

  const normalizeCadence = (cadence: string) => {
    if (!cadence) return 'monthly'
    const lower = cadence.toLowerCase()
    if (lower.includes('week') && lower.includes('bi')) return 'bi-weekly'
    if (lower.includes('week')) return 'weekly'
    return 'monthly'
  }

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const getSortIcon = (field: string) => {
    if (sortField !== field) {
      return (
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      )
    }
    return sortDirection === 'asc' ? (
      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    )
  }

  let filteredLeases = leases.filter(row => {
    const matchesSearch = 
      row.property?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.tenant?.full_name?.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesCadence = 
      cadenceFilter === 'all' || 
      normalizeCadence(row.lease.rent_cadence) === cadenceFilter

    return matchesSearch && matchesCadence
  })

  // Apply sorting
  if (sortField) {
    filteredLeases = [...filteredLeases].sort((a, b) => {
      let aValue: any
      let bValue: any

      switch (sortField) {
        case 'property':
          aValue = a.property?.name || ''
          bValue = b.property?.name || ''
          break
        case 'tenant':
          aValue = a.tenant?.full_name || ''
          bValue = b.tenant?.full_name || ''
          break
        case 'cadence':
          aValue = normalizeCadence(a.lease.rent_cadence)
          bValue = normalizeCadence(b.lease.rent_cadence)
          break
        case 'unpaidInvoices':
          aValue = a.unpaidInvoicesCount
          bValue = b.unpaidInvoicesCount
          break
        case 'totalOwed':
          aValue = a.totalOwed
          bValue = b.totalOwed
          break
        default:
          return 0
      }

      if (typeof aValue === 'string') {
        return sortDirection === 'asc' 
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue)
      } else {
        return sortDirection === 'asc' 
          ? aValue - bValue
          : bValue - aValue
      }
    })
  }

  const handleSaveMiscIncome = async (incomeData: any) => {
    try {
      const expenseData = {
        ...incomeData,
        interest_rate: 9.9999, // Use max positive value to identify misc income (one-time expenses use -9.9999)
        balance: 0,
        address: 'N/A',
        category: 'Misc Income'
      }
      
      const response = await fetch('/api/expenses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(expenseData)
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('API error:', errorData)
        alert(`Error: ${errorData.error || 'Failed to save misc income'}\n\nCheck console for details.`)
        return
      }

      setShowMiscIncomeModal(false)
      alert('Misc income added successfully!')
    } catch (error) {
      console.error('Error saving misc income:', error)
      alert('Failed to save misc income. Please try again.')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Payment Management</h1>
              <p className="text-gray-600">Track and manage rental payments</p>
            </div>
            <button
              onClick={() => setShowMiscIncomeModal(true)}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center space-x-2"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Add Misc Income</span>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by property or tenant..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Cadence</label>
              <select
                value={cadenceFilter}
                onChange={(e) => setCadenceFilter(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Cadences</option>
                <option value="weekly">Weekly</option>
                <option value="bi-weekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>
        </div>

        {/* Leases Table */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          ) : filteredLeases.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">No active leases found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gradient-to-r from-blue-600 to-purple-600 text-white">
                  <tr>
                    <th 
                      className="px-6 py-4 text-left text-sm font-semibold cursor-pointer hover:bg-blue-700 select-none"
                      onClick={() => handleSort('property')}
                    >
                      <div className="flex items-center space-x-2">
                        <span>Property</span>
                        {getSortIcon('property')}
                      </div>
                    </th>
                    <th 
                      className="px-6 py-4 text-left text-sm font-semibold cursor-pointer hover:bg-blue-700 select-none"
                      onClick={() => handleSort('tenant')}
                    >
                      <div className="flex items-center space-x-2">
                        <span>Tenant</span>
                        {getSortIcon('tenant')}
                      </div>
                    </th>
                    <th 
                      className="px-6 py-4 text-center text-sm font-semibold cursor-pointer hover:bg-blue-700 select-none"
                      onClick={() => handleSort('cadence')}
                    >
                      <div className="flex items-center justify-center space-x-2">
                        <span>Cadence</span>
                        {getSortIcon('cadence')}
                      </div>
                    </th>
                    <th className="px-6 py-4 text-center text-sm font-semibold">
                      Day Due
                    </th>
                    <th 
                      className="px-6 py-4 text-center text-sm font-semibold cursor-pointer hover:bg-blue-700 select-none"
                      onClick={() => handleSort('unpaidInvoices')}
                    >
                      <div className="flex items-center justify-center space-x-2">
                        <span>Unpaid Invoices</span>
                        {getSortIcon('unpaidInvoices')}
                      </div>
                    </th>
                    <th 
                      className="px-6 py-4 text-right text-sm font-semibold cursor-pointer hover:bg-blue-700 select-none"
                      onClick={() => handleSort('totalOwed')}
                    >
                      <div className="flex items-center justify-end space-x-2">
                        <span>Total Owed</span>
                        {getSortIcon('totalOwed')}
                      </div>
                    </th>
                    <th className="px-6 py-4 text-center text-sm font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredLeases.map((row, index) => (
                    <tr 
                      key={row.lease.id} 
                      className={`hover:bg-blue-50 transition-colors ${
                        index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                      }`}
                    >
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900">{row.property?.name || 'Unknown'}</div>
                        <div className="text-sm text-gray-500">{row.property?.address}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-gray-900">{row.tenant?.full_name || `${row.tenant?.first_name} ${row.tenant?.last_name}`}</div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="px-3 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                          {normalizeCadence(row.lease.rent_cadence)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="px-3 py-1 text-sm font-medium bg-gray-100 text-gray-800 rounded-full">
                          {row.lease.rent_due_day || 1}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-3 py-1 text-sm font-bold rounded-full ${
                          row.unpaidInvoicesCount > 0 
                            ? 'bg-red-100 text-red-800' 
                            : 'bg-green-100 text-green-800'
                        }`}>
                          {row.unpaidInvoicesCount}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className={`text-lg font-bold ${
                          row.totalOwed > 0 ? 'text-red-600' : 'text-green-600'
                        }`}>
                          ${row.totalOwed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex justify-center space-x-2">
                          <button
                            onClick={() => handleViewInvoices(row)}
                            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                          >
                            Detail
                          </button>
                          {row.totalOwed > 0 && (
                            <button
                              onClick={() => handleGenerateLateNoticeForLease(row)}
                              disabled={generatingNotice === row.lease.id}
                              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors shadow-sm ${
                                generatingNotice === row.lease.id
                                  ? 'bg-gray-400 text-white cursor-not-allowed'
                                  : 'bg-purple-600 text-white hover:bg-purple-700'
                              }`}
                              title="Generate 7-Day Late Notice with Intent to Evict"
                            >
                              {generatingNotice === row.lease.id ? 'Generating...' : 'Generate Notice'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Invoice Modal */}
      {showInvoiceModal && selectedLease && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-4 flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">{selectedLease.property?.name}</h2>
                <p className="text-blue-100">{selectedLease.tenant?.full_name}</p>
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

            {/* Modal Body */}
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
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Due Date</th>
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
                        const balance = parseFloat(invoice.balance_due as any)
                        const paid = parseFloat(invoice.amount_paid as any)
                        const hasPayments = paid > 0
                        
                        return (
                          <tr key={invoice.id} className={`hover:bg-gray-50 ${getInvoiceStatusColor(invoice)}`}>
                            <td className="px-3 py-2">
                              {getInvoiceStatusBadge(invoice)}
                            </td>
                            <td className="px-3 py-2 text-sm">
                              {new Date(invoice.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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
                              <div className="flex justify-center space-x-1">
                                {balance > 0 && (
                                  <button
                                    onClick={() => handleAddPayment(invoice)}
                                    className="px-3 py-1 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700 transition-colors"
                                  >
                                    Add Payment
                                  </button>
                                )}
                                {hasPayments && (
                                  <button
                                    onClick={() => {
                                      setSelectedInvoice(invoice)
                                      setEditInvoiceAmountPaid(invoice.amount_paid.toString())
                                      setEditInvoiceLateFee(invoice.amount_late.toString())
                                      setShowEditInvoiceModal(true)
                                    }}
                                    className="px-3 py-1 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 transition-colors"
                                  >
                                    Edit
                                  </button>
                                )}
                                {balance > 0 && (
                                  <button
                                    onClick={() => handleToggleLateFee(invoice)}
                                    disabled={togglingLateFee === invoice.id}
                                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                                      parseFloat(invoice.amount_late as any || 0) > 0
                                        ? 'bg-red-600 text-white hover:bg-red-700'
                                        : 'bg-green-600 text-white hover:bg-green-700'
                                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                                    title={(() => {
                                      if (parseFloat(invoice.amount_late as any || 0) > 0) {
                                        return 'Remove late fee'
                                      }
                                      // Determine late fee amount for tooltip
                                      if (selectedLease) {
                                        const cadence = selectedLease.lease.rent_cadence?.toLowerCase() || ''
                                        if (cadence.includes('monthly')) return 'Apply $45 late fee'
                                        if (cadence.includes('biweekly') || cadence.includes('bi-weekly')) return 'Apply $25 late fee'
                                        if (cadence.includes('weekly')) return 'Apply $15 late fee'
                                      }
                                      return 'Apply late fee'
                                    })()}
                                  >
                                    {togglingLateFee === invoice.id ? '...' : 
                                     parseFloat(invoice.amount_late as any || 0) > 0 ? 'Remove Fee' : 'Add Fee'}
                                  </button>
                                )}
                                {parseFloat(invoice.amount_late as any) > 0 && (
                                  <button
                                    onClick={() => handleWaiveLateFee(invoice)}
                                    className="px-3 py-1 bg-orange-600 text-white text-xs font-medium rounded hover:bg-orange-700 transition-colors"
                                    title="Waive late fee"
                                  >
                                    Waive Fee
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && selectedInvoice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-green-600 to-blue-600 text-white px-6 py-4 rounded-t-xl">
              <h2 className="text-xl font-bold">Add Payment</h2>
              <p className="text-sm text-green-100">Invoice: {selectedInvoice.invoice_no}</p>
              <p className="text-sm text-green-100">
                Due: {new Date(selectedInvoice.due_date + 'T12:00:00').toLocaleDateString()} | Period: {new Date(selectedInvoice.period_start + 'T12:00:00').toLocaleDateString()} - {new Date(selectedInvoice.period_end + 'T12:00:00').toLocaleDateString()}
              </p>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Payment Date</label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-sm text-gray-500">Balance due: ${parseFloat(selectedInvoice.balance_due as any).toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Payment Type</label>
                <select
                  value={paymentType}
                  onChange={(e) => setPaymentType(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="Rent">Rent</option>
                  <option value="Late Fee">Late Fee</option>
                  <option value="Deposit">Deposit</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Notes (optional)</label>
                <textarea
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Add any notes about this payment..."
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-gray-50 px-6 py-4 rounded-b-xl flex justify-end space-x-3">
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

      {/* Edit Payments Modal */}
      {showEditPaymentsModal && editingInvoice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-4 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold">Edit Payments</h2>
                <p className="text-sm text-purple-100">Invoice: {editingInvoice.invoice_no}</p>
                <p className="text-sm text-purple-100">
                  Due: {new Date(editingInvoice.due_date + 'T12:00:00').toLocaleDateString()} | 
                  Total: ${parseFloat(editingInvoice.amount_total as any).toLocaleString('en-US', { minimumFractionDigits: 2 })} | 
                  Balance: ${parseFloat(editingInvoice.balance_due as any).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <button
                onClick={() => setShowEditPaymentsModal(false)}
                className="text-white hover:text-gray-200 transition-colors"
              >
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {loadingPayments ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
                </div>
              ) : invoicePayments.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-500">No payments found for this invoice</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b-2 border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Payment Date</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Amount</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Type</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Method</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Notes</th>
                        <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {invoicePayments.map((payment) => (
                        <tr key={payment.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm">
                            {new Date(payment.payment_date).toLocaleDateString('en-US', { 
                              month: 'short', 
                              day: 'numeric', 
                              year: 'numeric' 
                            })}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-medium text-green-600">
                            ${parseFloat(payment.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {payment.payment_type || 'Rent'}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {payment.payment_method || 'Manual Entry'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {payment.notes || '-'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex justify-center space-x-2">
                              <button
                                onClick={() => handleEditSinglePayment(payment)}
                                className="px-3 py-1 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 transition-colors"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeletePayment(payment.id, payment.invoice_id)}
                                className="px-3 py-1 bg-red-600 text-white text-xs font-medium rounded hover:bg-red-700 transition-colors"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="bg-gray-50 px-6 py-4 flex justify-between items-center border-t">
              <div className="text-sm text-gray-600">
                Total Payments: <span className="font-bold">${invoicePayments.reduce((sum, p) => sum + parseFloat(p.amount), 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </div>
              <button
                onClick={() => setShowEditPaymentsModal(false)}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Invoice Modal */}
      {showEditInvoiceModal && selectedInvoice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-4 rounded-t-xl">
              <h2 className="text-xl font-bold">Edit Invoice</h2>
              <p className="text-sm text-purple-100">Invoice: {selectedInvoice.invoice_no}</p>
              <p className="text-sm text-purple-100">Due: {new Date(selectedInvoice.due_date + 'T12:00:00').toLocaleDateString()}</p>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              <div className="bg-gray-50 p-3 rounded-lg">
                <div className="text-sm text-gray-600">Rent Amount (Fixed)</div>
                <div className="text-lg font-bold">${Number(selectedInvoice.amount_rent).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Late Fee</label>
                <input
                  type="number"
                  step="0.01"
                  value={editInvoiceLateFee}
                  onChange={(e) => setEditInvoiceLateFee(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="0.00"
                />
                <p className="mt-1 text-xs text-gray-500">Set to 0 to waive late fee</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Amount Paid</label>
                <input
                  type="number"
                  step="0.01"
                  value={editInvoiceAmountPaid}
                  onChange={(e) => setEditInvoiceAmountPaid(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                <div className="text-sm font-medium text-blue-900 mb-1">Calculated Balance:</div>
                <div className="text-2xl font-bold text-blue-600">
                  ${(Number(selectedInvoice.amount_rent) + parseFloat(editInvoiceLateFee || '0') - parseFloat(editInvoiceAmountPaid || '0')).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-gray-50 px-6 py-4 rounded-b-xl flex justify-end space-x-3">
              <button
                onClick={() => setShowEditInvoiceModal(false)}
                disabled={isSubmitting}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateInvoice}
                disabled={isSubmitting}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Updating...' : 'Update Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Single Payment Modal */}
      {showEditSinglePaymentModal && editingPayment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-4 rounded-t-xl">
              <h2 className="text-xl font-bold">Edit Payment</h2>
              <p className="text-sm text-blue-100">Payment ID: {editingPayment.id.substring(0, 8)}...</p>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Payment Date</label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Payment Type</label>
                <select
                  value={paymentType}
                  onChange={(e) => setPaymentType(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="Rent">Rent</option>
                  <option value="Late Fee">Late Fee</option>
                  <option value="Deposit">Deposit</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
                <textarea
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Add any notes about this payment..."
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-gray-50 px-6 py-4 rounded-b-xl flex justify-end space-x-3">
              <button
                onClick={() => setShowEditSinglePaymentModal(false)}
                disabled={isSubmitting}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdatePayment}
                disabled={isSubmitting || !paymentAmount || parseFloat(paymentAmount) <= 0}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Updating...' : 'Update Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Late Notice Modal */}
      {showNoticeModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-4 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold">{noticeTitle}</h2>
                <p className="text-purple-100">7-Day Notice to Pay Rent or Quit</p>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={handlePrintNotice}
                  className="px-4 py-2 bg-white text-purple-600 rounded-lg hover:bg-gray-100 transition-colors"
                  title="Opens clean print window"
                >
                  📄 Print
                </button>
                <button
                  onClick={() => setShowNoticeModal(false)}
                  className="text-white hover:text-gray-200 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal Body - Notice Content */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="bg-white p-8 border border-gray-200 rounded-lg print:border-0 print:shadow-none">
                <div className="whitespace-pre-line text-sm leading-relaxed">
                  {noticeContent.split('\n').map((line, index) => {
                    if (line.startsWith('**NOTICE TO PAY RENT OR QUIT')) {
                      // Main title - extra large and bold
                      return (
                        <div key={index} className="font-bold text-2xl mb-4 text-center">
                          {line.replace(/\*\*/g, '')}
                        </div>
                      )
                    } else if (line.startsWith('**BREAKDOWN OF AMOUNTS DUE:**')) {
                      // Section header - bold
                      return (
                        <div key={index} className="font-bold text-base mb-3 mt-6 text-gray-800">
                          {line.replace(/\*\*/g, '')}
                        </div>
                      )
                    } else if (line.startsWith('**TOTAL DUE:')) {
                      // Total due - bold and highlighted
                      return (
                        <div key={index} className="font-bold text-lg mb-4 bg-yellow-100 p-3 rounded border-l-4 border-yellow-500">
                          {line.replace(/\*\*/g, '')}
                        </div>
                      )
                    } else if (line.startsWith('Rent:') || line.startsWith('Late Fee:') || line.startsWith('Other Charges:')) {
                      // Amount breakdown lines - clean formatting
                      return (
                        <div key={index} className="text-sm mb-1 ml-4">
                          {line}
                        </div>
                      )
                    } else if (line.startsWith('**IMPORTANT:')) {
                      // Special formatting for important notice
                      return (
                        <div key={index} className="font-bold text-base mb-2 text-red-600 bg-red-50 p-2 rounded">
                          {line.replace(/\*\*/g, '')}
                        </div>
                      )
                    } else if (line.startsWith('**LANDLORD:**')) {
                      // Landlord section header
                      return (
                        <div key={index} className="font-bold text-base mb-3 mt-6 text-gray-800">
                          {line.replace(/\*\*/g, '')}
                        </div>
                      )
                    } else if (line.startsWith('**NOTICE DELIVERY:**')) {
                      // Notice delivery section header
                      return (
                        <div key={index} className="font-bold text-base mb-3 mt-4 text-gray-800">
                          {line.replace(/\*\*/g, '')}
                        </div>
                      )
                    } else if (line.includes('Honest Home Sales, LLC') || line.includes('PO Box 705') || line.includes('Text:') || line.includes('Email:')) {
                      // Landlord contact info - full width box
                      return (
                        <div key={index} className="text-sm mb-1 bg-gray-50 p-3 rounded border-l-4 border-blue-500">
                          {line}
                        </div>
                      )
                    } else if (line.includes('Date Notice Delivered:') || line.includes('Method of Delivery:')) {
                      // Delivery info - full width box
                      return (
                        <div key={index} className="text-sm mb-1 bg-gray-50 p-3 rounded border-l-4 border-green-500">
                          {line}
                        </div>
                      )
                    } else {
                      return <div key={index}>{line}</div>
                    }
                  })}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-gray-50 px-6 py-4 flex justify-end space-x-3">
              <button
                onClick={() => setShowNoticeModal(false)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
              <button
                onClick={handlePrintNotice}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                title="Opens clean print window"
              >
                📄 Print Notice
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Misc Income Modal */}
      {showMiscIncomeModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Add Misc Income
            </h2>
            <form onSubmit={(e) => {
              e.preventDefault()
              const formData = new FormData(e.currentTarget)
              const propertyId = formData.get('property_id') as string
              const incomeData = {
                category: 'Misc Income',
                amount: parseFloat(formData.get('amount_owed') as string) || 0,
                expense_date: formData.get('last_paid_date') as string || new Date().toISOString().split('T')[0],
                memo: formData.get('mail_info') as string || '',
                amount_owed: parseFloat(formData.get('amount_owed') as string) || 0,
                last_paid_date: formData.get('last_paid_date') as string || undefined,
                mail_info: formData.get('mail_info') as string || undefined,
                address: 'N/A',
                balance: 0,
                interest_rate: 9.9999 // Use max positive value to identify misc income (one-time expenses use -9.9999)
              }
              
              // Only include property_id if a valid property is selected
              if (propertyId && propertyId !== '' && propertyId !== 'None') {
                incomeData.property_id = propertyId
              }
              
              handleSaveMiscIncome(incomeData)
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Description *</label>
                  <textarea
                    name="mail_info"
                    rows={3}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    placeholder="Enter income description"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Amount *</label>
                    <input
                      type="number"
                      name="amount_owed"
                      step="0.01"
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      placeholder="0.00"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Date Received *</label>
                    <input
                      type="date"
                      name="last_paid_date"
                      defaultValue={new Date().toISOString().split('T')[0]}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Property (Optional)</label>
                  <select
                    name="property_id"
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  >
                    <option value="">None</option>
                    {properties.map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.name} - {property.address}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowMiscIncomeModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                >
                  Add Misc Income
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

