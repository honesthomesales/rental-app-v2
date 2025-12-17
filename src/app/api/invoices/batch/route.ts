import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

// Cache batch invoices for 30 seconds
export const revalidate = 30

/**
 * Batch Invoices API
 * 
 * OPTIMIZED: Fetches invoices for multiple leases in a single query
 * instead of making N+1 queries. This significantly improves performance
 * when loading invoices for multiple leases (e.g., payments page).
 * 
 * Query params:
 * - leaseIds: Comma-separated list of lease IDs
 * - from: Start date (optional)
 * - to: End date (optional)
 * - status: Filter by status (optional)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    
    // Parse query parameters
    const leaseIdsParam = searchParams.get('leaseIds')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const status = searchParams.get('status')
    
    if (!leaseIdsParam) {
      return NextResponse.json(
        { error: 'leaseIds parameter is required (comma-separated list of lease IDs)' },
        { status: 400 }
      )
    }

    // Parse lease IDs from comma-separated string
    const leaseIds = leaseIdsParam.split(',').map(id => id.trim()).filter(id => id.length > 0)

    if (leaseIds.length === 0) {
      return NextResponse.json(
        { error: 'At least one lease ID is required' },
        { status: 400 }
      )
    }

    console.log('Batch fetching invoices for leases:', {
      leaseCount: leaseIds.length,
      from,
      to,
      status
    })

    // Build the query - fetch all invoices for all specified leases in one query
    let query = supabaseServer
      .from('RENT_invoices')
      .select('*')
      .in('lease_id', leaseIds)

    // Apply optional filters
    if (from) {
      query = query.gte('due_date', from)
    }

    if (to) {
      query = query.lte('due_date', to)
    }

    if (status) {
      query = query.eq('status', status)
    }

    // Order by due_date descending (newest first)
    query = query.order('due_date', { ascending: false })

    const { data: invoices, error } = await query

    if (error) {
      console.error('Supabase error:', error)
      throw new Error(`Error fetching invoices: ${error.message}`)
    }

    console.log(`Batch query returned ${invoices?.length || 0} invoices for ${leaseIds.length} leases`)

    // Group invoices by lease_id for easier consumption
    const invoicesByLease = new Map<string, any[]>()
    
    invoices?.forEach(invoice => {
      const leaseId = invoice.lease_id
      if (!invoicesByLease.has(leaseId)) {
        invoicesByLease.set(leaseId, [])
      }
      invoicesByLease.get(leaseId)!.push(invoice)
    })

    // Return both grouped and flat formats for flexibility
    return NextResponse.json({
      invoices: invoices || [],
      invoicesByLease: Object.fromEntries(invoicesByLease),
      summary: {
        totalInvoices: invoices?.length || 0,
        leasesWithInvoices: invoicesByLease.size,
        leaseIds: leaseIds
      }
    })
  } catch (error) {
    console.error('Error in batch invoices API:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch invoices', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}


