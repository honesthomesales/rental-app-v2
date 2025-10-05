import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(request: Request) {
  try {
    const paymentData = await request.json()
    
    console.log('Adding payment:', paymentData)
    
    // Validate required fields
    if (!paymentData.amount || !paymentData.payment_date) {
      return NextResponse.json(
        { error: 'Missing required fields: amount and payment_date' },
        { status: 400 }
      )
    }
    
    // Insert payment into database
    const { data, error } = await supabaseServer
      .from('RENT_payments')
      .insert([{
        lease_id: paymentData.lease_id,
        property_id: paymentData.property_id,
        tenant_id: paymentData.tenant_id,
        payment_date: paymentData.payment_date,
        amount: paymentData.amount,
        payment_type: paymentData.payment_type || 'Rent',
        notes: paymentData.notes || ''
      }])
      .select()
    
    if (error) {
      console.error('Database error:', error)
      return NextResponse.json(
        { error: 'Failed to insert payment', details: error.message },
        { status: 500 }
      )
    }
    
    console.log('Payment inserted successfully:', data)
    
    return NextResponse.json({ 
      success: true, 
      payment: data[0],
      message: 'Payment added successfully'
    })
  } catch (error) {
    console.error('Error in payments API:', error)
    return NextResponse.json(
      { error: 'Failed to add payment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const paymentId = searchParams.get('id')
    const body = await request.json()
    
    if (!paymentId) {
      return NextResponse.json(
        { error: 'Payment ID is required' },
        { status: 400 }
      )
    }

    console.log('Updating payment (rent/payments):', paymentId, body)

    // Build update object
    const updateData: any = {}
    if (body.payment_date) updateData.payment_date = body.payment_date
    if (body.amount !== undefined) updateData.amount = body.amount
    if (body.payment_type) updateData.payment_type = body.payment_type
    if (body.notes !== undefined) updateData.notes = body.notes

    // Update payment - no select to avoid trigger issues
    const { error } = await supabaseServer
      .from('RENT_payments')
      .update(updateData)
      .eq('id', paymentId)

    if (error) {
      console.error('Database error:', error)
      return NextResponse.json(
        { error: 'Failed to update payment', details: error.message },
        { status: 500 }
      )
    }

    console.log('Payment updated successfully')

    return NextResponse.json({ 
      success: true,
      message: 'Payment updated successfully'
    })
  } catch (error) {
    console.error('Error in payments PUT API:', error)
    return NextResponse.json(
      { error: 'Failed to update payment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { id } = await request.json()
    
    console.log('Deleting payment:', id)
    
    if (!id) {
      return NextResponse.json(
        { error: 'Missing required field: id' },
        { status: 400 }
      )
    }
    
    // Delete payment from database
    const { error } = await supabaseServer
      .from('RENT_payments')
      .delete()
      .eq('id', id)
    
    if (error) {
      console.error('Database error:', error)
      return NextResponse.json(
        { error: 'Failed to delete payment', details: error.message },
        { status: 500 }
      )
    }
    
    console.log('Payment deleted successfully')
    
    return NextResponse.json({ 
      success: true,
      message: 'Payment deleted successfully'
    })
  } catch (error) {
    console.error('Error in payments DELETE API:', error)
    return NextResponse.json(
      { error: 'Failed to delete payment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
