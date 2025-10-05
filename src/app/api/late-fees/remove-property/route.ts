import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  try {
    const { leaseId, currentDate } = await request.json()

    if (!leaseId || !currentDate) {
      return NextResponse.json({ error: 'Lease ID and current date are required' }, { status: 400 })
    }

    // First, get all invoices for this specific lease that have late fees
    const { data: invoices, error: fetchError } = await supabaseServer
      .from('RENT_invoices')
      .select('id, amount_rent, amount_other, amount_paid')
      .eq('lease_id', leaseId)
      .lte('due_date', currentDate)
      .gt('amount_late', 0)

    if (fetchError) {
      console.error('Error fetching invoices:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 })
    }

    if (!invoices || invoices.length === 0) {
      return NextResponse.json({ success: true, message: 'No late fees to remove for this property' })
    }

    // Update each invoice individually
    for (const invoice of invoices) {
      const newAmountTotal = parseFloat(invoice.amount_rent) + parseFloat(invoice.amount_other)
      const newBalanceDue = newAmountTotal - parseFloat(invoice.amount_paid)

      const { error: updateError } = await supabaseServer
        .from('RENT_invoices')
        .update({ 
          amount_late: 0,
          amount_total: newAmountTotal,
          balance_due: newBalanceDue
        })
        .eq('id', invoice.id)

      if (updateError) {
        console.error('Error updating invoice:', updateError)
        return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 })
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: `Late fees removed for property (${invoices.length} invoices updated)`,
      invoicesUpdated: invoices.length
    })
  } catch (error) {
    console.error('Error in remove-property late fees API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
