import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

// Cache tenants for 60 seconds - they don't change frequently
export const revalidate = 60

export async function GET() {
  try {
    console.log('Fetching tenants from leases...')
    
    // Fetch all leases with their tenant and property data (this is the source of truth)
    const { data: allLeases, error: leasesError } = await supabaseServer
      .from('RENT_leases')
      .select(`
        *,
        RENT_properties(*),
        RENT_tenants(*)
      `)
      .order('created_at', { ascending: false })

    if (leasesError) {
      console.error('Error fetching leases:', leasesError)
      throw new Error(`Error fetching leases: ${leasesError.message}`)
    }

    // Create a map to store the most relevant lease for each tenant
    const currentDate = new Date()
    const tenantMap = new Map()
    
    if (allLeases && allLeases.length > 0) {
      allLeases.forEach(lease => {
        if (!lease.tenant_id || !lease.RENT_tenants) return
        
        const tenantId = lease.tenant_id
        const startDate = new Date(lease.lease_start_date)
        const endDate = lease.lease_end_date ? new Date(lease.lease_end_date) : null
        const isWithinLeasePeriod = currentDate >= startDate && (!endDate || currentDate <= endDate)
        const isActive = lease.status === 'active'
        
        // Build tenant object from lease data
        const tenantData = {
          id: tenantId,
          first_name: lease.RENT_tenants.first_name,
          last_name: lease.RENT_tenants.last_name,
          full_name: lease.RENT_tenants.full_name,
          email: lease.RENT_tenants.email,
          phone: lease.RENT_tenants.phone,
          is_active: lease.RENT_tenants.is_active ?? isActive,
          notes: lease.RENT_tenants.notes,
          lease_start_date: lease.lease_start_date,
          lease_end_date: lease.lease_end_date,
          property_id: lease.property_id,
          property: lease.RENT_properties || null,
          created_at: lease.RENT_tenants.created_at,
          updated_at: lease.RENT_tenants.updated_at
        }
        
        // Decide if we should use this lease for the tenant
        const existingTenant = tenantMap.get(tenantId)
        if (!existingTenant) {
          // First lease for this tenant
          tenantMap.set(tenantId, tenantData)
        } else {
          // Prefer active leases within the lease period
          const existingIsActive = existingTenant.lease_start_date && existingTenant.lease_end_date ?
            (currentDate >= new Date(existingTenant.lease_start_date) && 
             currentDate <= new Date(existingTenant.lease_end_date || '9999-12-31')) : false
          
          if (isWithinLeasePeriod && isActive && !existingIsActive) {
            tenantMap.set(tenantId, tenantData)
          } else if (isActive && !existingIsActive) {
            // Prefer active leases even if not currently in period
            tenantMap.set(tenantId, tenantData)
          }
        }
      })
    }
    
    // Convert map to array
    const tenantsWithDetails = Array.from(tenantMap.values())
    
    return NextResponse.json(tenantsWithDetails || [])
  } catch (error) {
    console.error('Error in tenants API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tenants', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const tenantData = await request.json()
    
    console.log('Creating tenant:', tenantData)
    
    // Validate required fields
    if (!tenantData.first_name || !tenantData.last_name) {
      return NextResponse.json(
        { error: 'First name and last name are required' },
        { status: 400 }
      )
    }
    
    // Auto-generate full_name if not provided
    if (!tenantData.full_name) {
      tenantData.full_name = `${tenantData.first_name} ${tenantData.last_name}`.trim()
    }
    
    // Set defaults
    const newTenant = {
      first_name: tenantData.first_name,
      last_name: tenantData.last_name,
      full_name: tenantData.full_name,
      email: tenantData.email || null,
      phone: tenantData.phone || null,
      is_active: tenantData.is_active !== undefined ? tenantData.is_active : true,
      notes: tenantData.notes || null
    }
    
    const { data, error } = await supabaseServer
      .from('RENT_tenants')
      .insert([newTenant])
      .select()
      .single()

    if (error) {
      console.error('Error creating tenant:', error)
      throw new Error(`Supabase error: ${error.message}`)
    }

    console.log('Tenant created successfully:', data)
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in tenant create API:', error)
    return NextResponse.json(
      { error: 'Failed to create tenant', details: error instanceof Error ? error.message : 'Unknown error' },
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
    
    // Auto-generate full_name if first_name or last_name changed
    if (updateData.first_name || updateData.last_name) {
      // Get current tenant data to merge
      const { data: currentTenant } = await supabaseServer
        .from('RENT_tenants')
        .select('first_name, last_name, full_name')
        .eq('id', id)
        .single()
      
      const firstName = updateData.first_name || currentTenant?.first_name || ''
      const lastName = updateData.last_name || currentTenant?.last_name || ''
      
      // Only update full_name if it wasn't explicitly provided
      if (!updateData.full_name && (firstName || lastName)) {
        updateData.full_name = `${firstName} ${lastName}`.trim()
      }
    }
    
    const { data, error } = await supabaseServer
      .from('RENT_tenants')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating tenant:', error)
      return NextResponse.json(
        { 
          error: 'Failed to update tenant', 
          details: error.message,
          hint: error.hint,
          code: error.code
        },
        { status: 500 }
      )
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Tenant not found' },
        { status: 404 }
      )
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
