import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

// Cache leases for 60 seconds - they don't change frequently
export const revalidate = 60

export async function GET() {
  try {
    const { data: leases, error } = await supabaseServer
      .from('RENT_leases')
      .select(`
        *,
        RENT_properties(*),
        RENT_tenants(*)
      `)
      .order('created_at', { ascending: false })

    if (error) {
      throw new Error(`Error fetching leases: ${error.message}`)
    }

    return NextResponse.json(leases || [])
  } catch (error) {
    console.error('Error in leases API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch leases' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const leaseData = await request.json()
    
    console.log('Creating lease:', leaseData)
    
    // First, insert the lease with a simple select to avoid join issues
    const { data: insertedLease, error: insertError } = await supabaseServer
      .from('RENT_leases')
      .insert(leaseData)
      .select()
      .single()

    if (insertError) {
      console.error('Error creating lease:', insertError)
      return NextResponse.json(
        { 
          error: 'Failed to create lease', 
          details: insertError.message, 
          hint: insertError.hint, 
          code: insertError.code 
        },
        { status: 500 }
      )
    }

    if (!insertedLease) {
      console.error('Lease insert returned no data')
      return NextResponse.json(
        { error: 'Failed to create lease', details: 'Insert succeeded but no data returned' },
        { status: 500 }
      )
    }

    // Now fetch the full lease with related data
    const { data: fullLease, error: fetchError } = await supabaseServer
      .from('RENT_leases')
      .select(`
        *,
        RENT_properties(*),
        RENT_tenants(*)
      `)
      .eq('id', insertedLease.id)
      .single()

    if (fetchError) {
      console.error('Error fetching lease with relations:', fetchError)
      // Return the basic lease data even if fetch with relations fails
      return NextResponse.json(insertedLease)
    }

    console.log('Lease created successfully:', fullLease)
    return NextResponse.json(fullLease || insertedLease)
  } catch (error) {
    console.error('Error in lease creation API:', error)
    return NextResponse.json(
      { error: 'Failed to create lease', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const { id, ...updateData } = await request.json()
    
    if (!id) {
      return NextResponse.json({ error: 'Lease ID is required' }, { status: 400 })
    }

    console.log('Updating lease:', id, updateData)
    
    const { data, error } = await supabaseServer
      .from('RENT_leases')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        RENT_properties(*),
        RENT_tenants(*)
      `)
      .single()

    if (error) {
      console.error('Error updating lease:', error)
      throw new Error(`Supabase error: ${error.message}`)
    }

    console.log('Lease updated successfully:', data)
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in lease update API:', error)
    return NextResponse.json(
      { error: 'Failed to update lease', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ error: 'Lease ID is required' }, { status: 400 })
    }

    console.log('Deleting lease:', id)
    
    const { error } = await supabaseServer
      .from('RENT_leases')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting lease:', error)
      throw new Error(`Supabase error: ${error.message}`)
    }

    console.log('Lease deleted successfully')
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in lease delete API:', error)
    return NextResponse.json(
      { error: 'Failed to delete lease', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
