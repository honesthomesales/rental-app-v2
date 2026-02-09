import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * Diagnostic endpoint to compare invoice calculations
 * between payments page and late tenants API
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const propertyAddress = searchParams.get('address') || '5667'
    const today = new Date().toISOString().split('T')[0]
    const todayDate = new Date(today + 'T12:00:00')
    todayDate.setHours(0, 0, 0, 0)
    
    // Find the property and lease
    const { data: property } = await supabaseServer
      .from('RENT_properties')
      .select('id, address')
      .or(`address.ilike.%${propertyAddress}%,address.ilike.%main%`)
      .limit(1)
      .single()
    
    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }
    
    // Find active leases for this property
    const { data: leases } = await supabaseServer
      .from('RENT_leases')
      .select('id, lease_start_date, property_id')
      .eq('property_id', property.id)
      .eq('status', 'occupied')
    
    if (!leases || leases.length === 0) {
      return NextResponse.json({ error: 'No occupied leases found' }, { status: 404 })
    }
    
    const leaseIds = leases.map(l => l.id)
    const leaseStartDates = new Map(leases.map(l => [l.id, l.lease_start_date]))
    
    // Fetch invoices (matching late tenants API query)
    const { data: allInvoices } = await supabaseServer
      .from('RENT_invoices')
      .select('*')
      .in('lease_id', leaseIds)
      .lte('due_date', today)
      .order('due_date', { ascending: false })
    
    // Fetch payments
    const { data: allPayments } = await supabaseServer
      .from('RENT_payments')
      .select('*')
      .in('lease_id', leaseIds)
      .order('payment_date', { ascending: true })
    
    // Group payments by invoice_id
    const paymentsByInvoice = new Map<string, any[]>()
    allPayments?.forEach(payment => {
      if (payment.invoice_id) {
        if (!paymentsByInvoice.has(payment.invoice_id)) {
          paymentsByInvoice.set(payment.invoice_id, [])
        }
        paymentsByInvoice.get(payment.invoice_id)!.push(payment)
      }
    })
    
    // Process each lease
    const results: any[] = []
    
    for (const lease of leases) {
      const invoices = allInvoices?.filter(inv => inv.lease_id === lease.id) || []
      const leaseStartDate = leaseStartDates.get(lease.id)
      
      // Filter by lease_start_date
      const validInvoices = invoices.filter(inv => 
        !leaseStartDate || inv.due_date >= leaseStartDate
      )
      
      // Recalculate balance_due
      const invoicesWithRecalc = validInvoices.map(inv => {
        const linkedPayments = paymentsByInvoice.get(inv.id) || []
        const actualPaid = linkedPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0)
        const recalculatedBalanceDue = parseFloat(inv.amount_total || 0) - actualPaid
        
        return {
          ...inv,
          actualPaid,
          recalculatedBalanceDue
        }
      })
      
      // Find unpaid invoices
      const unpaidInvoices = invoicesWithRecalc.filter(inv => 
        inv.status === 'OPEN' && parseFloat(inv.recalculatedBalanceDue as any || 0) > 0
      )
      
      // Categorize all invoices
      const categorized = invoicesWithRecalc.map(inv => {
        const isUnpaid = inv.status === 'OPEN' && parseFloat(inv.recalculatedBalanceDue as any || 0) > 0
        const reasons: string[] = []
        
        if (inv.status !== 'OPEN') {
          reasons.push(`Status is ${inv.status} (not OPEN)`)
        }
        if (parseFloat(inv.recalculatedBalanceDue as any || 0) <= 0) {
          reasons.push(`Recalculated balance_due is ${inv.recalculatedBalanceDue} (<= 0)`)
        }
        if (!leaseStartDate || inv.due_date < leaseStartDate) {
          reasons.push(`Due date ${inv.due_date} is before lease_start_date ${leaseStartDate}`)
        }
        
        return {
          invoice_id: inv.id,
          due_date: inv.due_date,
          status: inv.status,
          amount_total: parseFloat(inv.amount_total || 0),
          original_balance_due: parseFloat(inv.balance_due || 0),
          original_amount_paid: parseFloat(inv.amount_paid || 0),
          actual_paid_from_payments: inv.actualPaid,
          recalculated_balance_due: inv.recalculatedBalanceDue,
          is_unpaid: isUnpaid,
          exclusion_reasons: reasons.length > 0 ? reasons : null
        }
      })
      
      results.push({
        lease_id: lease.id,
        property_address: property.address,
        lease_start_date: leaseStartDate,
        total_invoices_fetched: invoices.length,
        valid_invoices_after_lease_start_filter: validInvoices.length,
        unpaid_invoices_count: unpaidInvoices.length,
        unpaid_invoice_ids: unpaidInvoices.map(inv => inv.id),
        total_owed: unpaidInvoices.reduce((sum, inv) => 
          sum + parseFloat(inv.recalculatedBalanceDue as any || 0), 0
        ),
        all_invoices: categorized
      })
    }
    
    return NextResponse.json({
      property: property.address,
      today,
      results
    })
  } catch (error) {
    console.error('Error in invoice comparison:', error)
    return NextResponse.json(
      { error: 'Failed to compare invoices', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
