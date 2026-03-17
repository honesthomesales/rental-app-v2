import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

// Cache documents for 60 seconds - they don't change frequently
export const revalidate = 60

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''
    const propertyId = searchParams.get('property_id')
    const tenantId = searchParams.get('tenant_id')
    const leaseId = searchParams.get('lease_id')
    const expenseId = searchParams.get('expense_id')
    const dealId = searchParams.get('deal_id')
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    let query = supabaseServer
      .from('RENT_documents')
      .select('*')
      .order('created_at', { ascending: false })

    if (search) {
      const term = `%${search}%`
      query = query.or(`title.ilike.${term},notes.ilike.${term}`)
    }

    if (propertyId) {
      query = query.eq('property_id', propertyId)
    }
    if (tenantId) {
      query = query.eq('tenant_id', tenantId)
    }
    if (leaseId) {
      query = query.eq('lease_id', leaseId)
    }
    if (expenseId) {
      query = query.eq('expense_id', expenseId)
    }
    if (dealId) {
      query = query.eq('deal_id', dealId)
    }

    if (from) {
      query = query.gte('created_at', from)
    }
    if (to) {
      query = query.lte('created_at', to)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching documents:', error)
      return NextResponse.json(
        { error: 'Failed to fetch documents', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json(data || [])
  } catch (error) {
    console.error('Error in documents GET API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch documents', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      title,
      file_url,
      file_size,
      property_id,
      tenant_id,
      lease_id,
      expense_id,
      deal_id,
      notes,
    } = body || {}

    if (!title || !file_url) {
      return NextResponse.json(
        { error: 'Title and file_url are required' },
        { status: 400 }
      )
    }

    const insertData: any = {
      title,
      file_url,
      notes: notes ?? null,
      file_size: typeof file_size === 'number' ? file_size : null,
      property_id: property_id || null,
      tenant_id: tenant_id || null,
      lease_id: lease_id || null,
      expense_id: expense_id || null,
      deal_id: deal_id || null,
    }

    const { data, error } = await supabaseServer
      .from('RENT_documents')
      .insert([insertData])
      .select()
      .single()

    if (error) {
      console.error('Error creating document record:', error)
      return NextResponse.json(
        { error: 'Failed to create document', details: error.message, hint: error.hint, code: error.code },
        { status: 500 }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in documents POST API:', error)
    return NextResponse.json(
      { error: 'Failed to create document', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

