import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET() {
  try {
    console.log('Fetching tenants from RENT_tenants table...')
    
    // Fetch tenants
    const { data: tenants, error } = await supabaseServer
      .from('RENT_tenants')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Supabase error:', error)
      throw new Error(`Error fetching tenants: ${error.message}`)
    }

    // Fetch all properties
    const { data: allProperties, error: propertiesError } = await supabaseServer
      .from('RENT_properties')
      .select('id, name, address, city, state, zip_code')
      .limit(100) // Add limit to prevent timeout

    if (propertiesError) {
      console.error('Error fetching properties:', propertiesError)
      // Continue without properties rather than failing completely
    }

    // Create a map of properties by ID for faster lookup
    const propertiesMap = new Map()
    if (allProperties && allProperties.length > 0) {
      allProperties.forEach(property => {
        propertiesMap.set(property.id, property)
      })
    }

    // Merge properties with tenants
    const tenantsWithProperties = tenants?.map(tenant => ({
      ...tenant,
      property: tenant.property_id ? propertiesMap.get(tenant.property_id) || null : null
    })) || []
    return NextResponse.json(tenantsWithProperties || [])
  } catch (error) {
    console.error('Error in tenants API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tenants', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const { id, ...updateData } = await request.json()
    
    if (!id) {
      return NextResponse.json({ error: 'Tenant ID is required' }, { status: 400 })
    }

    console.log('Updating tenant:', id, updateData)
    
    const { data, error } = await supabaseServer
      .from('RENT_tenants')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating tenant:', error)
      throw new Error(`Supabase error: ${error.message}`)
    }

    console.log('Tenant updated successfully:', data)
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in tenant update API:', error)
    return NextResponse.json(
      { error: 'Failed to update tenant', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ error: 'Tenant ID is required' }, { status: 400 })
    }

    console.log('Deleting tenant:', id)
    
    const { error } = await supabaseServer
      .from('RENT_tenants')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting tenant:', error)
      throw new Error(`Supabase error: ${error.message}`)
    }

    console.log('Tenant deleted successfully')
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in tenant delete API:', error)
    return NextResponse.json(
      { error: 'Failed to delete tenant', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
