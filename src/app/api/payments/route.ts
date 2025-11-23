import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(request: Request) {
  try {
    const paymentData = await request.json()
    
    console.log('Processing payment with allocation:', paymentData)
    
    // Support both camelCase and snake_case field names
    const tenantId = paymentData.tenantId || paymentData.tenant_id
    const leaseId = paymentData.leaseId || paymentData.lease_id
    const propertyId = paymentData.propertyId || paymentData.property_id
    const amount = paymentData.amount
    const receivedAt = paymentData.receivedAt || paymentData.payment_date
    const memo = paymentData.memo || paymentData.notes
    const paymentType = paymentData.payment_type || paymentData.paymentType || 'Rent'
    const invoiceId = paymentData.invoice_id || paymentData.invoiceId
    
    // Validate required fields
    if (!tenantId || !leaseId || !amount) {
      return NextResponse.json(
        { error: 'Missing required fields: tenantId/tenant_id, leaseId/lease_id, and amount are required' },
        { status: 400 }
      )
    }

    // Validate amount is positive
    if (amount <= 0) {
      return NextResponse.json(
        { error: 'Amount must be greater than 0' },
        { status: 400 }
      )
    }
    
    // Get property_id if not provided
    let finalPropertyId = propertyId
    if (!finalPropertyId) {
      const { data: lease, error: leaseError } = await supabaseServer
        .from('RENT_leases')
        .select('property_id')
        .eq('id', leaseId)
        .single()
      
      if (leaseError || !lease) {
        console.error('Error fetching lease:', leaseError)
        return NextResponse.json(
          { error: 'Invalid lease ID or lease not found' },
          { status: 400 }
        )
      }
      finalPropertyId = lease.property_id
    }
    
    // Use receivedAt if provided, otherwise current timestamp
    const paymentDate = receivedAt || new Date().toISOString()
    
    // Insert payment into database
    const paymentRecord: any = {
      tenant_id: tenantId,
      lease_id: leaseId,
      property_id: finalPropertyId,
      payment_date: paymentDate,
      amount: amount,
      payment_type: paymentType,
      payment_method: 'Manual Entry',
      status: 'completed',
      notes: memo || ''
    }
    
    // Add invoice_id if provided
    if (invoiceId) {
      paymentRecord.invoice_id = invoiceId
    }
    
    const { data: payment, error: paymentError } = await supabaseServer
      .from('RENT_payments')
      .insert([paymentRecord])
      .select()
      .single()
    
    if (paymentError) {
      console.error('Error inserting payment:', paymentError)
      return NextResponse.json(
        { error: 'Failed to insert payment', details: paymentError.message },
        { status: 500 }
      )
    }
    
    console.log('Payment inserted successfully:', payment.id)
    
    // Call Supabase RPC function to allocate payment using FIFO
    const { data: allocations, error: rpcError } = await supabaseServer
      .rpc('rent_apply_payment_fifo', {
        payment_id: payment.id,
        received_at: paymentDate
      })
    
    if (rpcError) {
      console.error('Error calling rent_apply_payment_fifo RPC:', rpcError)
      // Don't fail the entire request if allocation fails - payment is still recorded
      console.warn('Payment recorded but allocation failed. Manual allocation may be needed.')
      
      return NextResponse.json({
        payment: payment,
        allocations: [],
        warning: 'Payment recorded but automatic allocation failed. Manual allocation may be required.',
        error: rpcError.message
      })
    }
    
    console.log('Payment allocated successfully:', {
      paymentId: payment.id,
      allocationsCount: allocations?.length || 0
    })
    
    return NextResponse.json({
      payment: payment,
      allocations: allocations || []
    })
  } catch (error) {
    console.error('Error in payments API:', error)
    return NextResponse.json(
      { 
        error: 'Failed to process payment', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    
    // Parse query parameters for filtering
    const tenantId = searchParams.get('tenantId')
    const leaseId = searchParams.get('leaseId')
    const propertyId = searchParams.get('propertyId')
    const invoiceId = searchParams.get('invoiceId')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const limit = searchParams.get('limit')
    
    console.log('Fetching payments with filters:', {
      tenantId,
      leaseId,
      propertyId,
      invoiceId,
      from,
      to,
      limit
    })
    
    // Special handling for invoiceId: fetch invoice details first, then get all related payments
    let payments: any[] = []
    let error: any = null
    
    if (invoiceId) {
      // First, get the invoice to find its lease_id and period dates
      const { data: invoice, error: invoiceError } = await supabaseServer
        .from('RENT_invoices')
        .select('id, lease_id, period_start, period_end, due_date')
        .eq('id', invoiceId)
        .single()
      
      if (invoiceError) {
        console.error('Error fetching invoice:', invoiceError)
        error = invoiceError
      } else if (invoice) {
        // Fetch payments in two ways:
        // 1. Payments directly linked to this invoice
        // 2. Payments for the same lease within the invoice period (even if not linked)
        const { data: linkedPayments, error: linkedError } = await supabaseServer
          .from('RENT_payments')
          .select(`
            *,
            RENT_tenants(
              id,
              full_name,
              first_name,
              last_name,
              email
            ),
            RENT_properties(
              id,
              name,
              address
            ),
            RENT_leases(
              id,
              rent,
              status
            )
          `)
          .eq('invoice_id', invoiceId)
          .order('payment_date', { ascending: false })
        
        if (linkedError) {
          console.error('Error fetching linked payments:', linkedError)
        }
        
        // Also fetch payments for the same lease within the invoice period
        let periodPayments: any[] = []
        if (invoice.lease_id && invoice.period_start && invoice.period_end) {
          const { data: periodPaymentsData, error: periodError } = await supabaseServer
            .from('RENT_payments')
            .select(`
              *,
              RENT_tenants(
                id,
                full_name,
                first_name,
                last_name,
                email
              ),
              RENT_properties(
                id,
                name,
                address
              ),
              RENT_leases(
                id,
                rent,
                status
              )
            `)
            .eq('lease_id', invoice.lease_id)
            .gte('payment_date', invoice.period_start)
            .lte('payment_date', invoice.period_end)
            .is('invoice_id', null) // Only get payments not already linked
            .order('payment_date', { ascending: false })
          
          if (periodError) {
            console.error('Error fetching period payments:', periodError)
          } else {
            periodPayments = periodPaymentsData || []
          }
        }
        
        // Combine and deduplicate by payment id
        const allPayments = [...(linkedPayments || []), ...periodPayments]
        const uniquePayments = Array.from(
          new Map(allPayments.map(p => [p.id, p])).values()
        )
        payments = uniquePayments
      }
    } else {
      // Build the query for non-invoice queries
      let query = supabaseServer
        .from('RENT_payments')
        .select(`
          *,
          RENT_tenants(
            id,
            full_name,
            first_name,
            last_name,
            email
          ),
          RENT_properties(
            id,
            name,
            address
          ),
          RENT_leases(
            id,
            rent,
            status
          )
        `)
      
      // Apply filters
      if (tenantId) {
        query = query.eq('tenant_id', tenantId)
      }
      
      if (leaseId) {
        query = query.eq('lease_id', leaseId)
      }
      
      if (propertyId) {
        query = query.eq('property_id', propertyId)
      }
      
      if (from) {
        query = query.gte('payment_date', from)
      }
      
      if (to) {
        query = query.lte('payment_date', to)
      }
      
      // Order by payment date descending (newest first)
      query = query.order('payment_date', { ascending: false })
      
      // Apply limit if specified
      if (limit) {
        const limitNum = parseInt(limit, 10)
        if (!isNaN(limitNum) && limitNum > 0) {
          query = query.limit(limitNum)
        }
      }
      
      const result = await query
      payments = result.data || []
      error = result.error
    }
    
    if (error) {
      console.error('Error fetching payments:', error)
      throw new Error(`Error fetching payments: ${error.message}`)
    }

    // Transform the data to include joined information
    const transformedPayments = (payments || []).map(payment => ({
      ...payment,
      tenant_name: payment.RENT_tenants?.full_name || 
                  `${payment.RENT_tenants?.first_name || ''} ${payment.RENT_tenants?.last_name || ''}`.trim(),
      tenant_email: payment.RENT_tenants?.email,
      property_name: payment.RENT_properties?.name,
      property_address: payment.RENT_properties?.address,
      lease_rent: payment.RENT_leases?.rent,
      lease_status: payment.RENT_leases?.status,
      // Remove the joined objects to clean up the response
      RENT_tenants: undefined,
      RENT_properties: undefined,
      RENT_leases: undefined
    })) || []

    console.log('Returning payments:', transformedPayments.length)
    return NextResponse.json(transformedPayments)
  } catch (error) {
    console.error('Error in payments GET API:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch payments', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json()
    const paymentId = body.id
    
    if (!paymentId) {
      return NextResponse.json(
        { error: 'Payment ID is required' },
        { status: 400 }
      )
    }

    console.log('Deleting payment:', paymentId)

    // Delete payment from database
    const { error: deleteError } = await supabaseServer
      .from('RENT_payments')
      .delete()
      .eq('id', paymentId)

    if (deleteError) {
      console.error('Database delete error:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete payment', details: deleteError.message, hint: deleteError.hint, code: deleteError.code },
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

    console.log('Updating payment:', paymentId, body)

    // Build update object with only defined fields
    const updateData: any = {}
    if (body.payment_date !== undefined) updateData.payment_date = body.payment_date
    if (body.amount !== undefined) updateData.amount = body.amount
    if (body.payment_type !== undefined) updateData.payment_type = body.payment_type
    if (body.notes !== undefined) updateData.notes = body.notes

    console.log('Update data:', updateData)

    // Update payment in database - don't select to avoid FK issues
    const { error: updateError } = await supabaseServer
      .from('RENT_payments')
      .update(updateData)
      .eq('id', paymentId)

    if (updateError) {
      console.error('Database update error:', updateError)
      return NextResponse.json(
        { error: 'Failed to update payment', details: updateError.message, hint: updateError.hint, code: updateError.code },
        { status: 500 }
      )
    }

    console.log('Payment updated successfully')

    // Fetch the updated payment separately (simple query, no joins)
    const { data: updatedPayment, error: fetchError } = await supabaseServer
      .from('RENT_payments')
      .select('id, lease_id, property_id, tenant_id, invoice_id, payment_date, amount, payment_type, payment_method, status, notes, created_at')
      .eq('id', paymentId)
      .limit(1)

    if (fetchError) {
      console.warn('Could not fetch updated payment:', fetchError)
    }

    return NextResponse.json({ 
      success: true,
      payment: updatedPayment && updatedPayment.length > 0 ? updatedPayment[0] : { id: paymentId }
    })
  } catch (error) {
    console.error('Error in payments PUT API:', error)
    return NextResponse.json(
      { error: 'Failed to update payment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
