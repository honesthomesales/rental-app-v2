import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    if (!id) {
      return NextResponse.json(
        { error: 'Invoice ID is required' },
        { status: 400 }
      )
    }

    console.log('Fetching invoice with ID:', id)

    // First, get the invoice header from RENT_invoice_status_v with tenant and property info
    const { data: invoice, error: invoiceError } = await supabaseServer
      .from('RENT_invoice_status_v')
      .select(`
        *,
        RENT_tenants!inner(
          id,
          full_name,
          first_name,
          last_name,
          email,
          phone
        ),
        RENT_properties!inner(
          id,
          name,
          address,
          city,
          state,
          zip_code
        )
      `)
      .eq('id', id)
      .single()

    if (invoiceError) {
      console.error('Error fetching invoice:', invoiceError)
      if (invoiceError.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Invoice not found' },
          { status: 404 }
        )
      }
      throw new Error(`Error fetching invoice: ${invoiceError.message}`)
    }

    // Payment allocations are not currently used - returning empty array
    const allocations: any[] = []

    // Transform the invoice data
    const transformedInvoice = {
      ...invoice,
      tenant_name: invoice.RENT_tenants?.full_name || 
                  `${invoice.RENT_tenants?.first_name || ''} ${invoice.RENT_tenants?.last_name || ''}`.trim(),
      tenant_email: invoice.RENT_tenants?.email,
      tenant_phone: invoice.RENT_tenants?.phone,
      property_name: invoice.RENT_properties?.name,
      property_address: invoice.RENT_properties?.address,
      property_city: invoice.RENT_properties?.city,
      property_state: invoice.RENT_properties?.state,
      property_zip: invoice.RENT_properties?.zip_code,
      // Remove the joined objects to clean up the response
      RENT_tenants: undefined,
      RENT_properties: undefined
    }

    // Transform allocations data to match requested format
    const transformedAllocations = allocations?.map(allocation => ({
      allocationId: allocation.id,
      paymentId: allocation.payment_id,
      appliedAt: allocation.applied_at,
      amountToRent: allocation.amount_to_rent || 0,
      amountToLateFee: allocation.amount_to_late_fee || 0,
      amountToOther: 0, // Placeholder for future use
      receivedAt: allocation.RENT_payments?.payment_date,
      memo: allocation.RENT_payments?.memo || allocation.RENT_payments?.notes || null
    })) || []

    const response = {
      invoice: transformedInvoice,
      allocations: transformedAllocations
    }

    console.log('Returning invoice data:', {
      invoiceId: transformedInvoice.id,
      allocationsCount: transformedAllocations.length
    })

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error in invoice [id] API:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch invoice',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    if (!id) {
      return NextResponse.json(
        { error: 'Invoice ID is required' },
        { status: 400 }
      )
    }

    console.log('Deleting invoice with ID:', id)

    // Expected invoices (virtual invoices) cannot be deleted - they don't exist in the database
    if (id.startsWith('expected-')) {
      return NextResponse.json(
        { 
          error: 'Cannot delete expected invoice', 
          details: 'Expected invoices are virtual invoices that don\'t exist in the database. To remove them, create a real invoice for the period or wait until the invoice is generated automatically.' 
        },
        { status: 400 }
      )
    }

    // Check if invoice has payments linked to it
    const { data: payments, error: paymentsError } = await supabaseServer
      .from('RENT_payments')
      .select('id, amount')
      .eq('invoice_id', id)

    if (paymentsError) {
      console.error('Error checking payments:', paymentsError)
      return NextResponse.json(
        { error: 'Failed to check invoice payments', details: paymentsError.message },
        { status: 500 }
      )
    }

    if (payments && payments.length > 0) {
      return NextResponse.json(
        { 
          error: 'Cannot delete invoice with linked payments', 
          details: `This invoice has ${payments.length} payment(s) linked to it. Please remove payments first.` 
        },
        { status: 400 }
      )
    }

    // Delete the invoice
    const { error: deleteError } = await supabaseServer
      .from('RENT_invoices')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('Error deleting invoice:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete invoice', details: deleteError.message },
        { status: 500 }
      )
    }

    console.log('Invoice deleted successfully:', id)

    return NextResponse.json({ 
      success: true
    })
  } catch (error) {
    console.error('Error in invoice DELETE API:', error)
    return NextResponse.json(
      {
        error: 'Failed to delete invoice',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}