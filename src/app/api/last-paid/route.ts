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
        RENT_tenants(id, full_name, first_name, last_name)
      `)
      .in('property_id', propertyIds)

    const leaseMap = new Map<string, any>()
    if (!leasesError && leases) {
      leases.forEach(l => leaseMap.set(l.id, l))
    }

    // Also fetch payments linked to invoices to recalculate invoice balance
    const paymentsByInvoice = new Map<string, number>()
    if (payments) {
      payments.forEach(p => {
        if (p.invoice_id) {
          paymentsByInvoice.set(
            p.invoice_id,
            (paymentsByInvoice.get(p.invoice_id) || 0) + (parseFloat(p.amount as any) || 0)
          )
        }
      })
    }

    // Group payments by property_id and take last 4
    const paymentsByProperty = new Map<string, any[]>()
    payments?.forEach(p => {
      if (!p.property_id) return
      const list = paymentsByProperty.get(p.property_id) || []
      if (list.length < 4) {
        const invoice = p.invoice_id ? invoiceMap.get(p.invoice_id) : null
        const lease = p.lease_id ? leaseMap.get(p.lease_id) : null
        const tenantData = lease?.RENT_tenants
        const tenantName = tenantData?.full_name ||
          `${tenantData?.first_name || ''} ${tenantData?.last_name || ''}`.trim() || null

        let invoiceBalance = null
        if (invoice) {
          const actualPaid = paymentsByInvoice.get(invoice.id) || 0
          const amountTotal = parseFloat(invoice.amount_total as any || 0)
          invoiceBalance = amountTotal - actualPaid
        }

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
            recalculated_balance: invoiceBalance
          } : null
        })
        paymentsByProperty.set(p.property_id, list)
      }
    })

    // Build response grouped by property
    const result = properties.map(property => {
      const recentPayments = paymentsByProperty.get(property.id) || []
      // Find the active lease for cadence info
      const activeLease = leases?.find(l =>
        l.property_id === property.id &&
        (l.status === 'occupied' || l.status === 'active')
      )
      return {
        property_id: property.id,
        property_name: property.name,
        property_address: property.address,
        property_type: property.property_type,
        cadence: activeLease?.rent_cadence || null,
        rent: activeLease?.rent || null,
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
