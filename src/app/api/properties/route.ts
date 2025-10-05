import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET() {
  try {
    console.log('Fetching properties from RENT_properties table...')
    
    const { data: properties, error } = await supabaseServer
      .from('RENT_properties')
      .select('*')
      .order('created_at', { ascending: false })

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
