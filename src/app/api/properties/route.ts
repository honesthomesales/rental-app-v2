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
    // Use .neq() to exclude retired - this will include null and active status
    if (!includeRetired) {
      try {
        // Filter out retired properties - this will include null (not set) and active
        query = query.neq('status', 'retired')
      } catch (err) {
        // If status column doesn't exist, just get all properties
        // This handles the case where migration hasn't been run yet
        console.warn('Status column may not exist, fetching all properties:', err)
      }
    }
    // If including retired, get all properties regardless of status (no filter)
    
    const { data: properties, error } = await query.order('created_at', { ascending: false })
    
    // If we get an error about the column not existing, return all properties
    if (error && error.message && error.message.includes('column') && error.message.includes('does not exist')) {
      console.warn('Status column does not exist, returning all properties')
      // Retry without the filter
      const { data: allProperties, error: retryError } = await supabaseServer
        .from('RENT_properties')
        .select('*')
        .order('created_at', { ascending: false })
      
      if (retryError) {
        throw new Error(`Error fetching properties: ${retryError.message}`)
      }
      
      // If not including retired, filter out properties with "sold" lease status
      if (!includeRetired) {
        const { data: allLeases } = await supabaseServer
          .from('RENT_leases')
          .select('property_id, status')
        
        const soldPropertyIds = new Set(
          allLeases?.filter(lease => lease.status === 'sold').map(lease => lease.property_id) || []
        )
        
        const filteredProperties = allProperties?.filter(
          property => !soldPropertyIds.has(property.id)
        ) || []
        
        return NextResponse.json(filteredProperties)
      }
      
      return NextResponse.json(allProperties || [])
    }

    console.log('Properties query result:', { properties: properties?.length, error })

    if (error) {
      console.error('Supabase error:', error)
      throw new Error(`Error fetching properties: ${error.message}`)
    }

    // If not including retired, also filter out properties with "sold" lease status
    // This ensures "sold" properties are treated the same as retired properties
    if (!includeRetired) {
      const { data: allLeases } = await supabaseServer
        .from('RENT_leases')
        .select('property_id, status')
      
      const soldPropertyIds = new Set(
        allLeases?.filter(lease => lease.status === 'sold').map(lease => lease.property_id) || []
      )
      
      const filteredProperties = properties?.filter(
        property => !soldPropertyIds.has(property.id)
      ) || []
      
      console.log('Filtered out sold properties:', { 
        before: properties?.length || 0, 
        after: filteredProperties.length,
        soldCount: soldPropertyIds.size
      })
      
      return NextResponse.json(filteredProperties)
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
    if (
      propertyData.property_type === '' ||
      (typeof propertyData.property_type === 'string' &&
        propertyData.property_type.trim() === '')
    ) {
      propertyData.property_type = null
    }
    
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

    // Clean up the update data - ensure numeric fields are properly formatted
    // Use the same logic as PATCH endpoint for consistency
    const cleanedData: any = {}
    Object.keys(updateData).forEach(key => {
      const value = updateData[key]
      // Handle numeric fields - DECIMAL fields need to be numbers, INTEGER fields can be numbers
      if (key === 'tax_paid_amount_current' || key === 'tax_paid_amount_previous' || 
          key === 'tax_owed' || key === 'property_tax' || key === 'insurance_premium' || key === 'rent_value') {
        // DECIMAL(10,2) fields - ensure proper number conversion with 2 decimal precision
        if (value === null || value === undefined || value === '' || value === 'null' || value === 'undefined') {
          cleanedData[key] = null
        } else {
          let numValue: number
          if (typeof value === 'string') {
            numValue = parseFloat(value.replace(/[^0-9.-]/g, '')) // Remove any non-numeric chars except . and -
          } else if (typeof value === 'number') {
            numValue = value
          } else {
            numValue = parseFloat(String(value))
          }
          
          if (isNaN(numValue)) {
            cleanedData[key] = null
          } else {
            // Ensure 2 decimal places for DECIMAL(10,2) fields
            // Round to 2 decimals to match DECIMAL(10,2) precision
            const roundedValue = Math.round(numValue * 100) / 100
            cleanedData[key] = parseFloat(roundedValue.toFixed(2))
          }
        }
      } else if (key === 'tax_color_state') {
        // INTEGER field
        if (value === null || value === undefined || value === '' || value === 'null') {
          cleanedData[key] = null
        } else {
          const intValue = typeof value === 'string' ? parseInt(value, 10) : Math.floor(Number(value))
          cleanedData[key] = isNaN(intValue) ? null : intValue
        }
      } else {
        cleanedData[key] = value
      }
    })
    
    // Filter out undefined values to avoid database errors
    const cleanUpdateData = Object.fromEntries(
      Object.entries(cleanedData).filter(([_, value]) => value !== undefined)
    )

    // Empty string property_type violates CHECK (must be enum value or NULL)
    if (
      Object.prototype.hasOwnProperty.call(cleanUpdateData, 'property_type') &&
      (cleanUpdateData.property_type === '' ||
        (typeof cleanUpdateData.property_type === 'string' &&
          cleanUpdateData.property_type.trim() === ''))
    ) {
      cleanUpdateData.property_type = null
    }

    // Property status is only active | retired (lease uses occupied/empty/sold)
    if (Object.prototype.hasOwnProperty.call(cleanUpdateData, 'status')) {
      const s = cleanUpdateData.status
      if (s === 'occupied' || s === 'empty') {
        cleanUpdateData.status = 'active'
      }
    }
    
    console.log('Updating property:', { id, updateData: cleanUpdateData })
    
    const { data, error } = await supabaseServer
      .from('RENT_properties')
      .update(cleanUpdateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Supabase error updating property:', error)
      console.error('Full error object:', JSON.stringify(error, null, 2))
      console.error('Update data that failed:', JSON.stringify(cleanUpdateData, null, 2))
      
      // Check if the error is about missing column
      if (error.message && (error.message.includes('column') && error.message.includes('does not exist') || error.message.includes('status'))) {
        return NextResponse.json(
          { 
            error: 'Database column missing', 
            details: 'The status column does not exist. Please run the migration script add-property-status-field.sql in your Supabase SQL editor first.' 
          },
          { status: 500 }
        )
      }
      
      // Check if it's a constraint violation
      if (error.message && (error.message.includes('check') || error.message.includes('constraint') || error.message.includes('violates'))) {
        return NextResponse.json(
          { 
            error: 'Database constraint violation', 
            details: error.message,
            hint: 'The property_type value may not be allowed. Please run the SQL script add-other-property-type.sql in your Supabase SQL editor to allow "other" as a property type.'
          },
          { status: 500 }
        )
      }
      
      return NextResponse.json(
        { 
          error: 'Database error', 
          details: error.message,
          code: error.code,
          hint: error.hint
        },
        { status: 500 }
      )
    }
    
    console.log('Property updated successfully:', data)

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
