import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    
    if (!propertyId) {
      return NextResponse.json(
        { error: 'Missing required parameter: propertyId' },
        { status: 400 }
      )
    }
    
    console.log('Fetching payments for property:', { propertyId, startDate, endDate })
    
    // Build query for payments
    let query = supabaseServer
      .from('RENT_payments')
      .select('*')
      .eq('property_id', propertyId)
      .order('payment_date', { ascending: false })
    
    // Add date filters if provided
    if (startDate) {
      query = query.gte('payment_date', startDate)
    }
    if (endDate) {
      query = query.lte('payment_date', endDate)
    }
    
    const { data: payments, error } = await query
    
    if (error) {
      console.error('Database error:', error)
      return NextResponse.json(
        { error: 'Failed to fetch payments', details: error.message },
        { status: 500 }
      )
    }
    
    console.log('Found payments for property:', payments?.length || 0)
    
    return NextResponse.json({
      success: true,
      payments: payments || [],
      summary: {
        totalPayments: payments?.length || 0,
        totalAmount: payments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0
      }
    })
  } catch (error) {
    console.error('Error in property payments API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch property payments', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
