import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

interface ManualAllocationRequest {
  paymentId: string
  allocations: {
    invoiceId: string
    amount: number
    appliedAt?: string
  }[]
}

export async function POST(request: Request) {
  try {
    const requestData: ManualAllocationRequest = await request.json()
    
    console.log('Processing manual allocation:', requestData)
    
    // Validate required fields
    const { paymentId, allocations } = requestData
    
    if (!paymentId) {
      return NextResponse.json(
        { error: 'Missing required field: paymentId' },
        { status: 400 }
      )
    }

    if (!allocations || !Array.isArray(allocations) || allocations.length === 0) {
      return NextResponse.json(
        { error: 'Missing or empty allocations array' },
        { status: 400 }
      )
    }

    // Validate each allocation
    for (const allocation of allocations) {
      if (!allocation.invoiceId || !allocation.amount) {
        return NextResponse.json(
          { error: 'Each allocation must have invoiceId and amount' },
          { status: 400 }
        )
      }
      
      if (allocation.amount <= 0) {
        return NextResponse.json(
          { error: 'Allocation amounts must be greater than 0' },
          { status: 400 }
        )
      }
    }

    // Verify payment exists
    const { data: payment, error: paymentError } = await supabaseServer
      .from('RENT_payments')
      .select('id, amount, tenant_id, lease_id, property_id')
      .eq('id', paymentId)
      .single()

    if (paymentError || !payment) {
      console.error('Error fetching payment:', paymentError)
      return NextResponse.json(
        { error: 'Payment not found' },
        { status: 404 }
      )
    }

    // Validate total allocation doesn't exceed payment amount
    const totalAllocated = allocations.reduce((sum, alloc) => sum + alloc.amount, 0)
    if (totalAllocated > payment.amount) {
      return NextResponse.json(
        { error: `Total allocation (${totalAllocated}) exceeds payment amount (${payment.amount})` },
        { status: 400 }
      )
    }

    console.log('Payment validated:', {
      paymentId: payment.id,
      paymentAmount: payment.amount,
      totalAllocated
    })

    // Payment allocations are not currently used - returning success without processing
    console.log('Manual allocations not processed (allocations not used)')
    const insertedAllocations: any[] = []

    // Step 3: Call rent_invoice_recalc_one for each affected invoice
    const affectedInvoiceIds = [...new Set(allocations.map(alloc => alloc.invoiceId))]
    const recalcResults = []
    const recalcErrors = []

    for (const invoiceId of affectedInvoiceIds) {
      try {
        console.log('Recalculating invoice:', invoiceId)
        
        const { data: recalcResult, error: recalcError } = await supabaseServer
          .rpc('rent_invoice_recalc_one', {
            invoice_id: invoiceId
          })

        if (recalcError) {
          console.error(`Error recalculating invoice ${invoiceId}:`, recalcError)
          recalcErrors.push({
            invoiceId,
            error: recalcError.message
          })
        } else {
          recalcResults.push({
            invoiceId,
            result: recalcResult
          })
        }
      } catch (error) {
        console.error(`Exception recalculating invoice ${invoiceId}:`, error)
        recalcErrors.push({
          invoiceId,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    console.log('Invoice recalculation completed:', {
      successful: recalcResults.length,
      failed: recalcErrors.length
    })

    // Step 4: Fetch updated invoice data
    const { data: updatedInvoices, error: invoiceError } = await supabaseServer
      .from('RENT_invoice_status_v')
      .select(`
        *,
        RENT_tenants!inner(
          id,
          full_name,
          first_name,
          last_name,
          email
        ),
        RENT_properties!inner(
          id,
          name,
          address,
          city,
          state
        )
      `)
      .in('id', affectedInvoiceIds)

    if (invoiceError) {
      console.error('Error fetching updated invoices:', invoiceError)
      // Don't fail the request, just log the error
    }

    // Transform invoice data
    const transformedInvoices = updatedInvoices?.map(invoice => ({
      ...invoice,
      tenant_name: invoice.RENT_tenants?.full_name || 
                  `${invoice.RENT_tenants?.first_name || ''} ${invoice.RENT_tenants?.last_name || ''}`.trim(),
      tenant_email: invoice.RENT_tenants?.email,
      property_name: invoice.RENT_properties?.name,
      property_address: invoice.RENT_properties?.address,
      property_city: invoice.RENT_properties?.city,
      property_state: invoice.RENT_properties?.state,
      // Remove the joined objects
      RENT_tenants: undefined,
      RENT_properties: undefined
    })) || []

    // Payment allocations are not currently used - returning empty array
    const completeAllocations: any[] = []
    const transformedAllocations = completeAllocations?.map(allocation => ({
      ...allocation,
      payment: {
        id: allocation.RENT_payments?.id,
        payment_date: allocation.RENT_payments?.payment_date,
        amount: allocation.RENT_payments?.amount,
        payment_type: allocation.RENT_payments?.payment_type,
        payment_method: allocation.RENT_payments?.payment_method,
        status: allocation.RENT_payments?.status
      },
      RENT_payments: undefined
    })) || []

    const response = {
      success: true,
      payment: payment,
      invoices: transformedInvoices,
      allocations: transformedAllocations,
      recalculation: {
        successful: recalcResults.length,
        failed: recalcErrors.length,
        errors: recalcErrors.length > 0 ? recalcErrors : undefined
      }
    }

    console.log('Manual allocation completed successfully:', {
      paymentId,
      allocationsCreated: insertedAllocations?.length,
      invoicesUpdated: transformedInvoices.length,
      recalcSuccessful: recalcResults.length,
      recalcFailed: recalcErrors.length
    })

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error in manual allocation API:', error)
    return NextResponse.json(
      {
        error: 'Failed to process manual allocation',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
