import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    
    // Parse query parameters
    const leaseId = searchParams.get('leaseId')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    
    console.log('Fetching period invoices with filters:', {
      leaseId,
      from,
      to
    })
    
    if (!leaseId) {
      return NextResponse.json(
        { error: 'leaseId is required' },
        { status: 400 }
      )
    }
    
    // Build the query for RENT_period_invoice_map_v
    console.log('Querying RENT_period_invoice_map_v with:', { leaseId, from, to });
    let query = supabaseServer
      .from('RENT_period_invoice_map_v')
      .select('*')
      .eq('lease_id', leaseId)
    
    // Apply date filters if provided
    if (from) {
      query = query.gte('period_due_date', from)
    }
    
    if (to) {
      query = query.lte('period_due_date', to)
    }
    
    // Order by period due date
    query = query.order('period_due_date', { ascending: true })
    
    const { data: periodInvoices, error } = await query
    
    console.log('Period invoices query result:', { 
      periodInvoices: periodInvoices?.length, 
      error: error ? {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      } : null,
      filters: { leaseId, from, to }
    })

    if (error) {
      console.error('Supabase error details:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      
      return NextResponse.json(
        { 
          error: 'Failed to fetch period invoices', 
          details: error.message,
          code: error.code
        },
        { status: 500 }
      )
    }

    console.log('Returning period invoices:', periodInvoices?.length || 0)
    return NextResponse.json(periodInvoices || [])
  } catch (error) {
    console.error('Error in by-period invoices API:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch period invoices', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
