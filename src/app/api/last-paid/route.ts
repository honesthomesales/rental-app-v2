import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export const revalidate = 60

export async function GET() {
  try {
    // Fetch all non-retired properties
    const { data: properties, error: propsError } = await supabaseServer
      .from('RENT_properties')
      .select('id, name, address, property_type')
      .neq('status', 'retired')
      .order('name', { ascending: true })

    if (propsError) {
      throw new Error(`Error fetching properties: ${propsError.message}`)
    }

    if (!properties || properties.length === 0) {
      return NextResponse.json([])
    }

    const propertyIds = properties.map(p => p.id)

    // Fetch recent payments for these properties with invoice + lease + tenant joins
    // We fetch more than 4 per property since we'll group client-side
    const { data: payments, error: paymentsError } = await supabaseServer
      .from('RENT_payments')
      .select(`
        id,
        property_id,
        lease_id,
        tenant_id,
        invoice_id,
        payment_date,
        amount,
        payment_type,
        notes,
        status
      `)
      .in('property_id', propertyIds)
      .order('payment_date', { ascending: false })

    if (paymentsError) {
      throw new Error(`Error fetching payments: ${paymentsError.message}`)
    }

    // Collect unique invoice IDs to batch-fetch invoice details
    const invoiceIds = new Set<string>()
    payments?.forEach(p => {
      if (p.invoice_id) invoiceIds.add(p.invoice_id)
    })

    // Fetch invoice details for all referenced invoices
    const invoiceMap = new Map<string, any>()
    if (invoiceIds.size > 0) {
      const { data: invoices, error: invError } = await supabaseServer
        .from('RENT_invoices')
        .select('id, due_date, period_start, period_end, amount_total, amount_rent, amount_late, status')
        .in('id', Array.from(invoiceIds))

      if (!invError && invoices) {
        invoices.forEach(inv => invoiceMap.set(inv.id, inv))
      }
    }

    // Fetch active leases to map property→tenant and get cadence info
    const { data: leases, error: leasesError } = await supabaseServer
      .from('RENT_leases')
      .select(`
        id,
        property_id,
        tenant_id,
        rent,
        rent_cadence,
        status,
        lease_start_date,
        RENT_tenants(id, full_name, first_name, last_name)
      `)
      .in('property_id', propertyIds)
      .eq('status', 'occupied')

    const leaseMap = new Map<string, any>()
    if (!leasesError && leases) {
      leases.forEach(l => leaseMap.set(l.id, l))
    }

    // Fetch ALL payments to recalculate invoice balances (matching payments page logic)
    const { data: allPayments, error: allPaymentsError } = await supabaseServer
      .from('RENT_payments')
      .select('invoice_id, amount, lease_id')
      .not('invoice_id', 'is', null)

    if (allPaymentsError) {
      console.error('Error fetching all payments for balance calculation:', allPaymentsError)
    }

    // Group payments by invoice_id for balance recalculation (matching payments page logic)
    const paymentsByInvoice = new Map<string, any[]>()
    if (allPayments) {
      allPayments.forEach(p => {
        if (p.invoice_id) {
          if (!paymentsByInvoice.has(p.invoice_id)) {
            paymentsByInvoice.set(p.invoice_id, [])
          }
          paymentsByInvoice.get(p.invoice_id)!.push(p)
        }
      })
    }

    // Calculate total owed per lease (matching payments page logic exactly)
    const today = new Date().toISOString().split('T')[0]
    const totalOwedByLease = new Map<string, number>()
    const allInvoicesByLease = new Map<string, any[]>()
    
    // For each occupied lease, calculate total owed the same way as payments page
    if (leases && !leasesError) {
      for (const lease of leases) {
        // Fetch ALL invoices for this lease (matching payments page)
        const { data: leaseInvoices, error: leaseInvError } = await supabaseServer
          .from('RENT_invoices')
          .select(`
            id,
            property_id,
            lease_id,
            due_date,
            period_start,
            period_end,
            amount_total,
            amount_rent,
            amount_late,
            status
          `)
          .eq('lease_id', lease.id)
          .lte('due_date', today)

        if (leaseInvError) {
          console.error(`Error fetching invoices for lease ${lease.id}:`, leaseInvError)
          continue
        }

        if (!leaseInvoices || leaseInvoices.length === 0) {
          totalOwedByLease.set(lease.id, 0)
          allInvoicesByLease.set(lease.id, [])
          continue
        }

        // Filter invoices by lease_start_date (matching payments page logic)
        const leaseStartDate = lease.lease_start_date
        const validInvoices = leaseInvoices.filter((invoice: any) => 
          !leaseStartDate || invoice.due_date >= leaseStartDate
        )

        // Recalculate balance_due using actual payment totals (EXACT same as payments page)
        const invoicesWithRecalculatedBalance = validInvoices.map((invoice: any) => {
          const linkedPayments = paymentsByInvoice.get(invoice.id) || []
          const actualPaid = linkedPayments.reduce((sum: number, payment: any) => 
            sum + parseFloat(payment.amount || 0), 0
          )
          const amountTotal = parseFloat(invoice.amount_total as any || 0)
          const recalculatedBalanceDue = amountTotal - actualPaid
          return {
            ...invoice,
            balance_due: recalculatedBalanceDue
          }
        })

        // Filter unpaid invoices using recalculated balance_due (EXACT same as payments page)
        // Only count invoices with status='OPEN' and balance_due > 0
        const unpaidInvoices = invoicesWithRecalculatedBalance.filter((inv: any) => 
          inv.status === 'OPEN' && parseFloat(inv.balance_due as any || 0) > 0
        )

        // Calculate total owed from unpaid invoices using recalculated balance_due
        const totalOwed = unpaidInvoices.reduce((sum: number, inv: any) => 
          sum + parseFloat(inv.balance_due as any || 0), 0
        )

        totalOwedByLease.set(lease.id, totalOwed)
        allInvoicesByLease.set(lease.id, invoicesWithRecalculatedBalance)
      }
    }

    // Build full invoice map from allInvoicesByLease (already has recalculated balance)
    const fullInvoiceMap = new Map<string, any>()
    allInvoicesByLease.forEach((invoices) => {
      invoices.forEach((inv: any) => {
        fullInvoiceMap.set(inv.id, {
          id: inv.id,
          due_date: inv.due_date,
          period_start: inv.period_start,
          period_end: inv.period_end,
          amount_total: inv.amount_total,
          amount_rent: inv.amount_rent,
          amount_late: inv.amount_late,
          status: inv.status,
          recalculated_balance: inv.balance_due
        })
      })
    })
    
    // Also add invoices from invoiceMap (for payments that might not be in occupied leases)
    invoiceMap.forEach((inv, id) => {
      if (!fullInvoiceMap.has(id)) {
        // Recalculate balance for this invoice
        const linkedPayments = paymentsByInvoice.get(id) || []
        const actualPaid = linkedPayments.reduce((sum: number, payment: any) => 
          sum + parseFloat(payment.amount || 0), 0
        )
        const amountTotal = parseFloat(inv.amount_total as any || 0)
        fullInvoiceMap.set(id, {
          ...inv,
          recalculated_balance: amountTotal - actualPaid
        })
      }
    })

    // Group payments by property_id and take last 4 (for display in details)
    // Use full invoice map to get proper invoice information
    const paymentsByProperty = new Map<string, any[]>()
    payments?.forEach(p => {
      if (!p.property_id) return
      const list = paymentsByProperty.get(p.property_id) || []
      if (list.length < 4) {
        // Get invoice from full invoice map (has recalculated balance)
        const invoice = p.invoice_id ? fullInvoiceMap.get(p.invoice_id) : null
        
        const lease = p.lease_id ? leaseMap.get(p.lease_id) : null
        const tenantData = lease?.RENT_tenants
        const tenantName = tenantData?.full_name ||
          `${tenantData?.first_name || ''} ${tenantData?.last_name || ''}`.trim() || null

        list.push({
          id: p.id,
          payment_date: p.payment_date,
          amount: p.amount,
          payment_type: p.payment_type,
          notes: p.notes,
          tenant_name: tenantName,
          invoice: invoice ? {
            id: invoice.id,
            due_date: invoice.due_date,
            period_start: invoice.period_start,
            period_end: invoice.period_end,
            amount_total: invoice.amount_total,
            amount_rent: invoice.amount_rent,
            amount_late: invoice.amount_late,
            status: invoice.status,
            recalculated_balance: invoice.recalculated_balance
          } : null
        })
        paymentsByProperty.set(p.property_id, list)
      }
    })

    // Build response grouped by property
    const result = properties.map(property => {
      const recentPayments = paymentsByProperty.get(property.id) || []
      // Find the active lease for cadence info and total owed
      const activeLease = leases?.find(l =>
        l.property_id === property.id &&
        l.status === 'occupied'
      )
      // Get total owed from lease (matching payments page logic)
      const totalOwed = activeLease ? (totalOwedByLease.get(activeLease.id) || 0) : 0
      
      return {
        property_id: property.id,
        property_name: property.name,
        property_address: property.address,
        property_type: property.property_type,
        cadence: activeLease?.rent_cadence || null,
        rent: activeLease?.rent || null,
        lease_id: activeLease?.id || null,
        totalOwed: totalOwed,
        payments: recentPayments
      }
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error in last-paid API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch last paid data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
