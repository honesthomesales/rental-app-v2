import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  try {
    const { currentDate } = await request.json()

    if (!currentDate) {
      return NextResponse.json({ error: 'Current date is required' }, { status: 400 })
    }

    // First, get all invoices that need to be updated
    const { data: invoices, error: fetchError } = await supabaseServer
      .from('RENT_invoices')
      .select('id, amount_rent, amount_other, amount_paid')
      .lte('due_date', currentDate)
      .gt('amount_late', 0)

    if (fetchError) {
      console.error('Error fetching invoices:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 })
    }

    if (!invoices || invoices.length === 0) {
      return NextResponse.json({ success: true, message: 'No late fees to remove' })
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

    return NextResponse.json({ success: true, message: 'All late fees removed successfully' })
  } catch (error) {
    console.error('Error in remove-all late fees API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
