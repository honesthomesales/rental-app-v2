import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

// Cache properties for 60 seconds - they don't change frequently
export const revalidate = 60

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const includeRetired = searchParams.get('includeRetired') === 'true'
    
    console.log('Fetching properties from RENT_properties table...', { includeRetired })
    
    let query = supabaseServer
      .from('RENT_properties')
      .select('*')
    
    // By default, exclude retired properties unless explicitly requested
    if (!includeRetired) {
      query = query.or('status.is.null,status.eq.active')
    }
    
    const { data: properties, error } = await query.order('created_at', { ascending: false })

    console.log('Properties query result:', { properties: properties?.length, error })

    if (error) {
      console.error('Supabase error:', error)
      throw new Error(`Error fetching properties: ${error.message}`)
    }

    console.log('Returning properties:', properties?.length || 0)
    return NextResponse.json(properties || [])
  } catch (error) {
    console.error('Error in properties API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch properties', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const propertyData = await request.json()
    
    console.log('Creating new property:', propertyData)
    
    const { data, error } = await supabaseServer
      .from('RENT_properties')
      .insert(propertyData)
      .select()
      .single()

    if (error) {
      console.error('Supabase error creating property:', error)
      return NextResponse.json(
        { error: 'Database error', details: error.message },
        { status: 500 }
      )
    }

    console.log('Property created successfully:', data)
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in property creation API:', error)
    return NextResponse.json(
      { error: 'Failed to create property', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const { id, ...updateData } = await request.json()
    
    if (!id) {
      return NextResponse.json({ error: 'Property ID is required' }, { status: 400 })
    }

    // Filter out undefined values to avoid database errors
    const cleanUpdateData = Object.fromEntries(
      Object.entries(updateData).filter(([_, value]) => value !== undefined)
    )
    
    const { data, error } = await supabaseServer
      .from('RENT_properties')
      .update(cleanUpdateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Supabase error updating property:', error)
      return NextResponse.json(
        { error: 'Database error', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in property update API:', error)
    return NextResponse.json(
      { error: 'Failed to update property', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ error: 'Property ID is required' }, { status: 400 })
    }

    console.log('Deleting property:', id)
    
    const { error } = await supabaseServer
      .from('RENT_properties')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting property:', error)
      throw new Error(`Supabase error: ${error.message}`)
    }

    console.log('Property deleted successfully')
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in property delete API:', error)
    return NextResponse.json(
      { error: 'Failed to delete property', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
