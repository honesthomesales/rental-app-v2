import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    
    // Parse query parameters
    const tenantId = searchParams.get('tenantId')
    const leaseId = searchParams.get('leaseId')
    const status = searchParams.get('status')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    
    console.log('Fetching invoices with filters:', {
      tenantId,
      leaseId,
      status,
      from,
      to
    })
    
    // Build the query - use RENT_invoices table directly
    let query = supabaseServer
      .from('RENT_invoices')
      .select('*')
    
    // Apply filters
    if (tenantId) {
      query = query.eq('tenant_id', tenantId)
    }
    
    if (leaseId) {
      query = query.eq('lease_id', leaseId)
    }
    
    if (status) {
      query = query.eq('status', status)
    }
    
    if (from) {
      query = query.gte('due_date', from)
    }
    
    if (to) {
      query = query.lte('due_date', to)
    }
    
    // Order by due_date descending (newest first)
    query = query.order('due_date', { ascending: false })
    
    const { data: invoices, error } = await query
    
    console.log('Invoices query result:', { 
      invoices: invoices?.length, 
      error,
      filters: { tenantId, leaseId, status, from, to }
    })

    if (error) {
      console.error('Supabase error:', error)
      throw new Error(`Error fetching invoices: ${error.message}`)
    }

    console.log('Returning invoices:', invoices?.length || 0)
    return NextResponse.json(invoices || [])
  } catch (error) {
    console.error('Error in invoices API:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch invoices', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const invoiceId = searchParams.get('id')
    const body = await request.json()
    
    if (!invoiceId) {
      return NextResponse.json(
        { error: 'Invoice ID is required' },
        { status: 400 }
      )
    }

    console.log('Updating invoice:', invoiceId, body)

    // If amount_paid or amount_late is being updated, recalculate totals
    if (body.amount_paid !== undefined || body.amount_late !== undefined) {
      // Get current invoice to calculate balance
      const { data: currentInvoice, error: fetchError } = await supabaseServer
        .from('RENT_invoices')
        .select('amount_total, amount_rent, amount_late, amount_other, amount_paid')
        .eq('id', invoiceId)
        .single()

      if (fetchError) {
        console.error('Error fetching invoice:', fetchError)
        throw new Error('Failed to fetch invoice')
      }

      // Use updated values or current values
      const amountRent = parseFloat(currentInvoice.amount_rent)
      const amountLate = body.amount_late !== undefined ? parseFloat(body.amount_late) : parseFloat(currentInvoice.amount_late)
      const amountOther = parseFloat(currentInvoice.amount_other || 0)
      const amountPaid = body.amount_paid !== undefined ? parseFloat(body.amount_paid) : parseFloat(currentInvoice.amount_paid)

      // Recalculate total and balance
      const amountTotal = amountRent + amountLate + amountOther
      const balanceDue = amountTotal - amountPaid

      body.amount_total = amountTotal
      body.balance_due = balanceDue
      body.status = balanceDue <= 0 ? 'PAID' : 'OPEN'
      body.paid_in_full_at = balanceDue <= 0 ? new Date().toISOString() : null

      console.log('Calculated invoice totals:', { 
        amountRent, 
        amountLate, 
        amountOther, 
        amountTotal, 
        amountPaid, 
        balanceDue, 
        status: body.status 
      })
    }

    // Update invoice in database
    const { data, error } = await supabaseServer
      .from('RENT_invoices')
      .update(body)
      .eq('id', invoiceId)
      .select()
      .single()

    if (error) {
      console.error('Database error:', error)
      return NextResponse.json(
        { error: 'Failed to update invoice', details: error.message },
        { status: 500 }
      )
    }

    console.log('Invoice updated successfully:', data)

    return NextResponse.json({ 
      success: true,
      invoice: data
    })
  } catch (error) {
    console.error('Error in invoices PUT API:', error)
    return NextResponse.json(
      { error: 'Failed to update invoice', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
