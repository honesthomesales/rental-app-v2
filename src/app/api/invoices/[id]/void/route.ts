import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

interface VoidInvoiceRequest {
  reason: string
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: invoiceId } = await params
    const requestData: VoidInvoiceRequest = await request.json()
    
    console.log('Processing invoice void request:', { invoiceId, requestData })
    
    // Validate required fields
    if (!invoiceId) {
      return NextResponse.json(
        { error: 'Invoice ID is required' },
        { status: 400 }
      )
    }

    if (!requestData.reason || requestData.reason.trim() === '') {
      return NextResponse.json(
        { error: 'Void reason is required' },
        { status: 400 }
      )
    }

    // Verify invoice exists and get current status
    const { data: invoice, error: invoiceError } = await supabaseServer
      .from('RENT_invoice_status_v')
      .select('id, status, amount, due_date, tenant_id, lease_id, property_id')
      .eq('id', invoiceId)
      .single()

    if (invoiceError || !invoice) {
      console.error('Error fetching invoice:', invoiceError)
      if (invoiceError?.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Invoice not found' },
          { status: 404 }
        )
      }
      return NextResponse.json(
        { error: 'Failed to fetch invoice', details: invoiceError?.message },
        { status: 500 }
      )
    }

    // Check if invoice is already voided
    if (invoice.status?.toUpperCase() === 'VOID') {
      return NextResponse.json(
        { error: 'Invoice is already voided' },
        { status: 400 }
      )
    }

    console.log('Invoice found:', {
      id: invoice.id,
      status: invoice.status,
      amount: invoice.amount
    })

    // Payment allocations are not currently used - proceeding with void
    console.log('Proceeding with void (allocations not used)')

    // Update invoice status to VOID
    // Note: We're assuming the invoice data is stored in a table that allows updates
    // If RENT_invoice_status_v is a view, we might need to update the underlying table
    const { data: updatedInvoice, error: updateError } = await supabaseServer
      .from('RENT_invoices') // Assuming this is the base table
      .update({
        status: 'VOID',
        void_reason: requestData.reason.trim(),
        voided_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', invoiceId)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating invoice status:', updateError)
      
      // If the RENT_invoices table doesn't exist, try updating through the view
      // This might not work depending on database setup, but worth trying
      const { data: viewUpdate, error: viewError } = await supabaseServer
        .from('RENT_invoice_status_v')
        .update({
          status: 'VOID',
          void_reason: requestData.reason.trim(),
          voided_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', invoiceId)
        .select()
        .single()

      if (viewError) {
        console.error('Error updating invoice through view:', viewError)
        return NextResponse.json(
          { 
            error: 'Failed to void invoice', 
            details: `Update failed: ${updateError.message}. View update also failed: ${viewError.message}` 
          },
          { status: 500 }
        )
      }

      console.log('Invoice voided through view update')
    } else {
      console.log('Invoice voided through direct table update')
    }

    // Fetch the updated invoice with full details
    const { data: finalInvoice, error: fetchError } = await supabaseServer
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
      .eq('id', invoiceId)
      .single()

    if (fetchError) {
      console.error('Error fetching updated invoice:', fetchError)
      // Don't fail the request since the void operation succeeded
      console.warn('Invoice voided successfully but failed to fetch updated data')
    }

    // Transform the response data
    const transformedInvoice = finalInvoice ? {
      ...finalInvoice,
      tenant_name: finalInvoice.RENT_tenants?.full_name || 
                  `${finalInvoice.RENT_tenants?.first_name || ''} ${finalInvoice.RENT_tenants?.last_name || ''}`.trim(),
      tenant_email: finalInvoice.RENT_tenants?.email,
      property_name: finalInvoice.RENT_properties?.name,
      property_address: finalInvoice.RENT_properties?.address,
      property_city: finalInvoice.RENT_properties?.city,
      property_state: finalInvoice.RENT_properties?.state,
      // Remove the joined objects
      RENT_tenants: undefined,
      RENT_properties: undefined
    } : null

    const response = {
      success: true,
      message: 'Invoice voided successfully',
      invoice: transformedInvoice || {
        id: invoiceId,
        status: 'VOID',
        void_reason: requestData.reason.trim(),
        voided_at: new Date().toISOString()
      },
      void_reason: requestData.reason.trim(),
      voided_at: new Date().toISOString()
    }

    console.log('Invoice void completed successfully:', {
      invoiceId,
      reason: requestData.reason.trim()
    })

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error in invoice void API:', error)
    return NextResponse.json(
      {
        error: 'Failed to void invoice',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
