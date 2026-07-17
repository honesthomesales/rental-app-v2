import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { isAuthError, requireApiAuth } from '@/lib/auth/api-auth'

export async function POST(request: Request) {
  const auth = await requireApiAuth(request, { write: true })
  if (isAuthError(auth)) return auth
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
  const auth = await requireApiAuth(request, { write: true })
  if (isAuthError(auth)) return auth
try {
    // Parse request body first (can only be read once)
    const body = await request.json()
    
    // Handle URL parsing - request.url might not be available in all contexts
    let paymentId: string | null = null
    try {
      const url = new URL(request.url)
      paymentId = url.searchParams.get('id')
    } catch (urlError) {
      console.error('Error parsing URL:', urlError)
      // Fallback: get ID from request body
      paymentId = body.id || null
    }
    
    if (!paymentId) {
      return NextResponse.json(
        { error: 'Payment ID is required. Please provide it as a query parameter (?id=...) or in the request body.' },
        { status: 400 }
      )
    }

    // Validate required fields
    if (body.amount !== undefined && (isNaN(body.amount) || body.amount <= 0)) {
      return NextResponse.json(
        { error: 'Amount must be a positive number' },
        { status: 400 }
      )
    }

    if (body.payment_date !== undefined && !body.payment_date) {
      return NextResponse.json(
        { error: 'Payment date is required' },
        { status: 400 }
      )
    }

    console.log('Updating payment (rent/payments):', { paymentId, body })

    // Build update object - only include defined fields
    const updateData: any = {}
    if (body.payment_date !== undefined) updateData.payment_date = body.payment_date
    if (body.amount !== undefined) updateData.amount = parseFloat(body.amount)
    if (body.payment_type !== undefined) updateData.payment_type = body.payment_type
    if (body.notes !== undefined) updateData.notes = body.notes || ''

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update. Please provide at least one field: payment_date, amount, payment_type, or notes.' },
        { status: 400 }
      )
    }

    console.log('Update data:', updateData)

    // First check if payment exists
    const { data: existingPayment, error: checkError } = await supabaseServer
      .from('RENT_payments')
      .select('id')
      .eq('id', paymentId)
      .single()

    if (checkError || !existingPayment) {
      console.error('Payment not found:', checkError)
      return NextResponse.json(
        { error: 'Payment not found', details: checkError?.message || 'Payment ID does not exist' },
        { status: 404 }
      )
    }

    // Update payment
    const { error } = await supabaseServer
      .from('RENT_payments')
      .update(updateData)
      .eq('id', paymentId)

    if (error) {
      console.error('Database error:', error)
      return NextResponse.json(
        { error: 'Failed to update payment', details: error.message, hint: error.hint, code: error.code },
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
  const auth = await requireApiAuth(request, { write: true })
  if (isAuthError(auth)) return auth
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
