import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { isAuthError, requireApiAuth } from '@/lib/auth/api-auth'

// Cache deals for 60 seconds
export const revalidate = 60

export async function GET(request: Request) {
  const auth = await requireApiAuth(request)
  if (isAuthError(auth)) return auth
try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')
    
    console.log('Fetching deals...', { search })
    
    let query = supabaseServer
      .from('RENT_deals')
      .select('*')
      .order('date_purchased', { ascending: false })
    
    // Apply search filter if provided
    if (search) {
      query = query.or(`address.ilike.%${search}%,seller_name.ilike.%${search}%,seller_phone.ilike.%${search}%`)
    }
    
    const { data: deals, error } = await query
    
    if (error) {
      console.error('Error fetching deals:', error)
      throw new Error(`Error fetching deals: ${error.message}`)
    }
    
    return NextResponse.json(deals || [])
  } catch (error) {
    console.error('Error in deals GET API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch deals', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const auth = await requireApiAuth(request, { write: true })
  if (isAuthError(auth)) return auth
try {
    const dealData = await request.json()
    
    console.log('Creating deal:', dealData)
    
    // Validate required fields
    if (!dealData.address || !dealData.date_purchased || dealData.sell_price === undefined || dealData.sell_price === null) {
      return NextResponse.json(
        { error: 'Address, date_purchased, and sell_price are required' },
        { status: 400 }
      )
    }
    
    // Helper function to convert empty strings to null
    const nullIfEmpty = (value: any) => {
      if (value === undefined || value === null) return null
      if (typeof value === 'string' && value.trim() === '') return null
      return value
    }
    
    // Prepare deal record
    const newDeal: any = {
      address: dealData.address.trim(),
      seller_name: nullIfEmpty(dealData.seller_name),
      seller_phone: nullIfEmpty(dealData.seller_phone),
      sell_price: parseFloat(dealData.sell_price),
      date_purchased: dealData.date_purchased,
      "Soteris_$": dealData["Soteris_$"] !== undefined && dealData["Soteris_$"] !== null ? parseFloat(dealData["Soteris_$"]) : null,
      notes: nullIfEmpty(dealData.notes)
    }
    
    const { data, error } = await supabaseServer
      .from('RENT_deals')
      .insert([newDeal])
      .select()
      .single()
    
    if (error) {
      console.error('Error creating deal:', {
        error,
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        newDeal
      })
      return NextResponse.json(
        { 
          error: 'Failed to create deal', 
          details: error.message,
          hint: error.hint,
          code: error.code
        },
        { status: 500 }
      )
    }
    
    if (!data) {
      console.error('Deal created but no data returned')
      return NextResponse.json(
        { error: 'Deal created but no data returned' },
        { status: 500 }
      )
    }
    
    console.log('Deal created successfully:', data)
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in deal create API:', error)
    return NextResponse.json(
      { 
        error: 'Failed to create deal', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  const auth = await requireApiAuth(request, { write: true })
  if (isAuthError(auth)) return auth
try {
    const { id, ...updateData } = await request.json()
    
    if (!id) {
      return NextResponse.json({ error: 'Deal ID is required' }, { status: 400 })
    }

    console.log('Updating deal:', id, updateData)
    
    // Helper function to convert empty strings to null
    const nullIfEmpty = (value: any) => {
      if (value === undefined || value === null) return undefined // Don't update if not provided
      if (typeof value === 'string' && value.trim() === '') return null
      if (typeof value === 'string') return value.trim()
      return value
    }
    
    // Clean up updateData
    const cleanedUpdateData: any = {}
    Object.keys(updateData).forEach(key => {
      const value = updateData[key as keyof typeof updateData]
      if (key === 'address') {
        cleanedUpdateData[key] = typeof value === 'string' ? value.trim() : value
      } else if (key === 'seller_name' || key === 'seller_phone' || key === 'notes') {
        cleanedUpdateData[key] = nullIfEmpty(value)
      } else if (key === 'sell_price' || key === 'Soteris_$') {
        cleanedUpdateData[key] = value !== undefined && value !== null ? parseFloat(value as string) : null
      } else {
        cleanedUpdateData[key] = value
      }
    })
    
    const { data, error } = await supabaseServer
      .from('RENT_deals')
      .update(cleanedUpdateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating deal:', {
        error,
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        cleanedUpdateData,
        id
      })
      return NextResponse.json(
        { 
          error: 'Failed to update deal', 
          details: error.message,
          hint: error.hint,
          code: error.code
        },
        { status: 500 }
      )
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Deal not found' },
        { status: 404 }
      )
    }

    console.log('Deal updated successfully:', data)
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in deal update API:', error)
    return NextResponse.json(
      { error: 'Failed to update deal', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiAuth(request, { write: true })
  if (isAuthError(auth)) return auth
try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ error: 'Deal ID is required' }, { status: 400 })
    }

    console.log('Deleting deal:', id)
    
    const { error } = await supabaseServer
      .from('RENT_deals')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting deal:', error)
      throw new Error(`Supabase error: ${error.message}`)
    }

    console.log('Deal deleted successfully')
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in deal delete API:', error)
    return NextResponse.json(
      { error: 'Failed to delete deal', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}




