import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const paymentId = params.id
    const body = await request.json()
    const { amount, payment_type, notes } = body

    if (!amount || !payment_type) {
      return NextResponse.json(
        { error: 'Amount and payment type are required' },
        { status: 400 }
      )
    }

    // Update the payment
    const { data: updatedPayment, error } = await supabaseServer
      .from('RENT_payments')
      .update({
        amount,
        payment_type,
        notes: notes || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', paymentId)
      .select()
      .single()

    if (error) {
      console.error('Error updating payment:', error)
      return NextResponse.json(
        { error: 'Failed to update payment' },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      success: true, 
      payment: updatedPayment 
    })

  } catch (error) {
    console.error('Error in PUT /api/rent/payments/[id]:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const paymentId = params.id

    // Delete the payment
    const { error } = await supabaseServer
      .from('RENT_payments')
      .delete()
      .eq('id', paymentId)

    if (error) {
      console.error('Error deleting payment:', error)
      return NextResponse.json(
        { error: 'Failed to delete payment' },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      success: true 
    })

  } catch (error) {
    console.error('Error in DELETE /api/rent/payments/[id]:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
