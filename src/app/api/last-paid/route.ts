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
        rent_due_day,
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

    // Calculate total owed per lease (matching payments page logic exactly)
    const today = new Date().toISOString().split('T')[0]
    const totalOwedByLease = new Map<string, number>()
    const allInvoicesByLease = new Map<string, any[]>()
    
    // For each occupied lease, calculate total owed the same way as payments page
    if (leases && !leasesError) {
      for (const lease of leases) {
        // Fetch payments for this specific lease (matching payments page: /api/payments?leaseId=...)
        const { data: leasePayments, error: leasePaymentsError } = await supabaseServer
          .from('RENT_payments')
          .select('invoice_id, amount')
          .eq('lease_id', lease.id)
          .not('invoice_id', 'is', null)

        if (leasePaymentsError) {
          console.error(`Error fetching payments for lease ${lease.id}:`, leasePaymentsError)
        }

        // Group payments by invoice_id for this lease (matching payments page logic)
        const paymentsByInvoice = new Map<string, any[]>()
        if (leasePayments) {
          leasePayments.forEach(p => {
            if (p.invoice_id) {
              if (!paymentsByInvoice.has(p.invoice_id)) {
                paymentsByInvoice.set(p.invoice_id, [])
              }
              paymentsByInvoice.get(p.invoice_id)!.push(p)
            }
          })
        }

        // Fetch ALL invoices for this lease (matching payments page: /api/invoices?leaseId=...&to=...)
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
          .order('due_date', { ascending: false })

        if (leaseInvError) {
          console.error(`Error fetching invoices for lease ${lease.id}:`, leaseInvError)
          totalOwedByLease.set(lease.id, 0)
          allInvoicesByLease.set(lease.id, [])
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

        // Debug logging for 110 McDowell
        if (lease.property_id && propertyIds.includes(lease.property_id)) {
          const property = properties.find(p => p.id === lease.property_id)
          if (property && (property.address?.toLowerCase().includes('mcdowell') || property.name?.toLowerCase().includes('mcdowell'))) {
            console.log(`Last-Paid API - Lease ${lease.id} (${property.address}): totalOwed=${totalOwed}, unpaidCount=${unpaidInvoices.length}, validInvoices=${validInvoices.length}`)
            console.log(`Last-Paid API - Unpaid invoices:`, unpaidInvoices.map(inv => ({
              id: inv.id,
              due_date: inv.due_date,
              amount_total: inv.amount_total,
              balance_due: inv.balance_due,
              status: inv.status
            })))
          }
        }

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
    // Fetch all payments to recalculate balance for these invoices
    const { data: allPayments, error: allPaymentsError } = await supabaseServer
      .from('RENT_payments')
      .select('invoice_id, amount')
      .not('invoice_id', 'is', null)

    const allPaymentsByInvoice = new Map<string, number>()
    if (!allPaymentsError && allPayments) {
      allPayments.forEach(p => {
        if (p.invoice_id) {
          allPaymentsByInvoice.set(
            p.invoice_id,
            (allPaymentsByInvoice.get(p.invoice_id) || 0) + parseFloat(p.amount as any || 0)
          )
        }
      })
    }

    invoiceMap.forEach((inv, id) => {
      if (!fullInvoiceMap.has(id)) {
        // Recalculate balance for this invoice
        const actualPaid = allPaymentsByInvoice.get(id) || 0
        const amountTotal = parseFloat(inv.amount_total as any || 0)
        fullInvoiceMap.set(id, {
          ...inv,
          recalculated_balance: amountTotal - actualPaid
        })
      }
    })

    // For each property, get:
    // 1. All unpaid past invoices (status='OPEN', balance_due > 0, due_date < today) - these are unpaid past payments
    // 2. Last 4 paid payments (where invoice balance <= 0)
    const paymentsByProperty = new Map<string, any[]>()
    
    // Process each property
    properties.forEach(property => {
      const propertyPayments: any[] = []
      
      // Find the active lease for this property
      const activeLease = leases?.find(l =>
        l.property_id === property.id &&
        l.status === 'occupied'
      )
      
      if (!activeLease) {
        paymentsByProperty.set(property.id, [])
        return
      }
      
      // Get all invoices for this lease (from allInvoicesByLease)
      const leaseInvoices = allInvoicesByLease.get(activeLease.id) || []
      
      // 1. Get all unpaid past invoices (due_date < today, balance > 0)
      const unpaidPastInvoices = leaseInvoices.filter((inv: any) => {
        const dueDate = new Date(inv.due_date)
        const todayDate = new Date(today)
        todayDate.setHours(0, 0, 0, 0)
        return inv.status === 'OPEN' && 
               parseFloat(inv.balance_due as any || 0) > 0 &&
               dueDate < todayDate
      })
      
      // For each unpaid past invoice, create a payment entry (even if no payment exists)
      unpaidPastInvoices.forEach((invoice: any) => {
        // Find payments linked to this invoice
        const invoicePayments = payments?.filter(p => p.invoice_id === invoice.id) || []
        
        if (invoicePayments.length > 0) {
          // If there are payments, create entries for them
          invoicePayments.forEach((p: any) => {
            const lease = p.lease_id ? leaseMap.get(p.lease_id) : null
            const tenantData = lease?.RENT_tenants
            const tenantName = tenantData?.full_name ||
              `${tenantData?.first_name || ''} ${tenantData?.last_name || ''}`.trim() || null
            
            propertyPayments.push({
              id: p.id,
              payment_date: p.payment_date,
              amount: p.amount,
              payment_type: p.payment_type,
              notes: p.notes,
              tenant_name: tenantName,
              invoice: {
                id: invoice.id,
                due_date: invoice.due_date,
                period_start: invoice.period_start,
                period_end: invoice.period_end,
                amount_total: invoice.amount_total,
                amount_rent: invoice.amount_rent,
                amount_late: invoice.amount_late,
                status: invoice.balance_due <= 0 ? 'PAID' : invoice.status,
                recalculated_balance: invoice.balance_due
              }
            })
          })
        } else {
          // If no payments exist, create a placeholder entry for the unpaid invoice
          const lease = activeLease
          const tenantData = lease?.RENT_tenants
          const tenantName = tenantData?.full_name ||
            `${tenantData?.first_name || ''} ${tenantData?.last_name || ''}`.trim() || null
          
          propertyPayments.push({
            id: `unpaid-${invoice.id}`,
            payment_date: invoice.due_date, // Use due_date as payment_date for unpaid invoices
            amount: 0,
            payment_type: 'Unpaid',
            notes: '',
            tenant_name: tenantName,
            invoice: {
              id: invoice.id,
              due_date: invoice.due_date,
              period_start: invoice.period_start,
              period_end: invoice.period_end,
              amount_total: invoice.amount_total,
              amount_rent: invoice.amount_rent,
              amount_late: invoice.amount_late,
              status: invoice.balance_due <= 0 ? 'PAID' : invoice.status,
              recalculated_balance: invoice.balance_due
            }
          })
        }
      })
      
      // 2. Get last 4 paid payments (where invoice balance <= 0) for table view
      // But for grid view, we need ALL invoices, so we'll add all invoices below
      const paidPayments = payments
        ?.filter(p => {
          if (!p.property_id || p.property_id !== property.id) return false
          const invoice = p.invoice_id ? fullInvoiceMap.get(p.invoice_id) : null
          if (!invoice) return false
          return parseFloat(invoice.recalculated_balance as any || 0) <= 0
        })
        .sort((a, b) => {
          const dateA = new Date(a.payment_date).getTime()
          const dateB = new Date(b.payment_date).getTime()
          return dateB - dateA // Most recent first
        })
        .slice(0, 4) || []
      
      // Add paid payments to the list
      paidPayments.forEach((p: any) => {
        const invoice = p.invoice_id ? fullInvoiceMap.get(p.invoice_id) : null
        const lease = p.lease_id ? leaseMap.get(p.lease_id) : null
        const tenantData = lease?.RENT_tenants
        const tenantName = tenantData?.full_name ||
          `${tenantData?.first_name || ''} ${tenantData?.last_name || ''}`.trim() || null
        
        propertyPayments.push({
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
            status: invoice.recalculated_balance <= 0 ? 'PAID' : invoice.status,
            recalculated_balance: invoice.recalculated_balance
          } : null
        })
      })
      
      // 3. Add ALL other invoices for this lease (for grid view)
      // These are invoices that aren't already in propertyPayments
      const invoiceIdsInPayments = new Set(propertyPayments.map((p: any) => p.invoice?.id).filter(Boolean))
      const allOtherInvoices = leaseInvoices.filter((inv: any) => !invoiceIdsInPayments.has(inv.id))
      
      // For each invoice, find all payments linked to it (from ALL payments, not just recent ones)
      allOtherInvoices.forEach((invoice: any) => {
        // Find all payments for this invoice from the full payments array
        const invoicePayments = payments?.filter(p => 
          p.invoice_id === invoice.id && 
          (p.property_id === property.id || (p.lease_id && p.lease_id === activeLease?.id))
        ) || []
        
        const lease = activeLease
        const tenantData = lease?.RENT_tenants
        const tenantName = tenantData?.full_name ||
          `${tenantData?.first_name || ''} ${tenantData?.last_name || ''}`.trim() || null
        
        if (invoicePayments.length > 0) {
          // Add all payments for this invoice
          invoicePayments.forEach((p: any) => {
            propertyPayments.push({
              id: p.id,
              payment_date: p.payment_date,
              amount: p.amount,
              payment_type: p.payment_type,
              notes: p.notes,
              tenant_name: tenantName,
              invoice: {
                id: invoice.id,
                due_date: invoice.due_date,
                period_start: invoice.period_start,
                period_end: invoice.period_end,
                amount_total: invoice.amount_total,
                amount_rent: invoice.amount_rent,
                amount_late: invoice.amount_late,
                status: invoice.balance_due <= 0 ? 'PAID' : invoice.status,
                recalculated_balance: invoice.balance_due
              }
            })
          })
        } else {
          // Invoice with no payments - add as placeholder
          propertyPayments.push({
            id: `invoice-${invoice.id}`,
            payment_date: invoice.due_date,
            amount: 0,
            payment_type: 'Invoice',
            notes: '',
            tenant_name: tenantName,
            invoice: {
              id: invoice.id,
              due_date: invoice.due_date,
              period_start: invoice.period_start,
              period_end: invoice.period_end,
              amount_total: invoice.amount_total,
              amount_rent: invoice.amount_rent,
              amount_late: invoice.amount_late,
              status: invoice.balance_due <= 0 ? 'PAID' : invoice.status,
              recalculated_balance: invoice.balance_due
            }
          })
        }
      })
      
      // Sort all payments by date (most recent first), with unpaid past invoices first
      propertyPayments.sort((a, b) => {
        // Unpaid invoices (with amount 0) should come first
        if (a.amount === 0 && b.amount !== 0) return -1
        if (a.amount !== 0 && b.amount === 0) return 1
        // Then sort by date (most recent first)
        const dateA = new Date(a.payment_date).getTime()
        const dateB = new Date(b.payment_date).getTime()
        return dateB - dateA
      })
      
      paymentsByProperty.set(property.id, propertyPayments)
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
        rent_due_day: activeLease?.rent_due_day || null,
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
