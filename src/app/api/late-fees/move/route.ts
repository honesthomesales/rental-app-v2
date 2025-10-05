import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  try {
    const { invoiceId, newAmount } = await request.json()

    if (!invoiceId || newAmount === undefined) {
      return NextResponse.json({ error: 'Invoice ID and new amount are required' }, { status: 400 })
    }

    if (newAmount < 0) {
      return NextResponse.json({ error: 'Late fee amount cannot be negative' }, { status: 400 })
    }

    // Check if this is a virtual invoice
    if (invoiceId.startsWith('virtual-')) {
      // For virtual invoices, we can't update them in the database
      // Instead, we'll return success and let the frontend handle the display
      return NextResponse.json({ 
        success: true, 
        message: 'Virtual invoice late fee updated (display only)',
        isVirtual: true,
        newAmount
      })
    }

    // Get the current invoice to calculate the new totals
    const { data: invoice, error: fetchError } = await supabaseServer
      .from('RENT_invoices')
      .select('amount_rent, amount_other, amount_paid')
      .eq('id', invoiceId)
      .single()

    if (fetchError || !invoice) {
      console.error('Error fetching invoice:', fetchError)
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Calculate new totals
    const newAmountTotal = parseFloat(invoice.amount_rent) + parseFloat(invoice.amount_other) + newAmount
    const newBalanceDue = newAmountTotal - parseFloat(invoice.amount_paid)

    // Update the invoice with new late fee amount
    const { error: updateError } = await supabaseServer
      .from('RENT_invoices')
      .update({ 
        amount_late: newAmount,
        amount_total: newAmountTotal,
        balance_due: newBalanceDue
      })
      .eq('id', invoiceId)

    if (updateError) {
      console.error('Error updating invoice:', updateError)
      return NextResponse.json({ error: 'Failed to update late fee' }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Late fee updated successfully',
      newAmount,
      newAmountTotal,
      newBalanceDue
    })
  } catch (error) {
    console.error('Error in move late fees API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
