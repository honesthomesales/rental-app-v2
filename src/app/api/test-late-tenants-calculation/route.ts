import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { isAuthError, requireApiAuth } from '@/lib/auth/api-auth'

/**
 * Test endpoint to verify late tenants calculation
 * Returns raw data for debugging
 */
export async function GET(request: Request) {
  const auth = await requireApiAuth(request, { ownerOnly: true })
  if (isAuthError(auth)) return auth
try {
    const { searchParams } = new URL(request.url)
    const propertyAddress = searchParams.get('address') || '5667'
    const today = new Date().toISOString().split('T')[0]
    
    // Find the property
    const { data: property } = await supabaseServer
      .from('RENT_properties')
      .select('id, address')
      .or(`address.ilike.%${propertyAddress}%,address.ilike.%main%`)
      .limit(1)
      .single()
    
    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }
    
    // Find active leases
    const { data: leases } = await supabaseServer
      .from('RENT_leases')
      .select('id, lease_start_date')
      .eq('property_id', property.id)
      .in('status', ['occupied'])
    
    if (!leases || leases.length === 0) {
      return NextResponse.json({ error: 'No occupied leases' }, { status: 404 })
    }
    
    const leaseIds = leases.map(l => l.id)
    const leaseStartDates = new Map(leases.map(l => [l.id, l.lease_start_date]))
    
    // Fetch invoices
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
    
    const results: any[] = []
    
    for (const lease of leases) {
      const invoices = allInvoices?.filter(inv => inv.lease_id === lease.id) || []
      const leaseStartDate = leaseStartDates.get(lease.id)
      
      const validInvoices = invoices.filter(inv => 
        !leaseStartDate || inv.due_date >= leaseStartDate
      )
      
      // Recalculate - EXACT same as diagnostic endpoint
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
      
      // Filter - EXACT same as diagnostic endpoint
      const unpaidInvoices = invoicesWithRecalc.filter(inv => 
        inv.status === 'OPEN' && parseFloat(inv.recalculatedBalanceDue as any || 0) > 0
      )
      
      results.push({
        lease_id: lease.id,
        property_address: property.address,
        total_invoices: validInvoices.length,
        unpaid_count: unpaidInvoices.length,
        unpaid_ids: unpaidInvoices.map(inv => inv.id),
        total_owed: unpaidInvoices.reduce((sum, inv) => 
          sum + parseFloat(inv.recalculatedBalanceDue as any || 0), 0
        ),
        all_invoices_detail: invoicesWithRecalc.map(inv => ({
          id: inv.id,
          status: inv.status,
          recalculatedBalanceDue: inv.recalculatedBalanceDue,
          amount_total: inv.amount_total,
          actualPaid: inv.actualPaid,
          is_unpaid: inv.status === 'OPEN' && parseFloat(inv.recalculatedBalanceDue as any || 0) > 0
        }))
      })
    }
    
    return NextResponse.json({
      property: property.address,
      today,
      results
    })
  } catch (error) {
    console.error('Error in test calculation:', error)
    return NextResponse.json(
      { error: 'Failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
