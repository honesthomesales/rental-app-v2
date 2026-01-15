import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const updateData = await request.json()
    const { id } = await params
    
    if (!id) {
      return NextResponse.json({ error: 'Property ID is required' }, { status: 400 })
    }

    console.log('Updating property field:', id, updateData)
    
    // Clean up the update data - ensure numeric fields are properly formatted
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
    
    console.log('Cleaned update data:', cleanedData)
    
    // Only send fields that have values (or explicitly null)
    const fieldsToUpdate: any = {}
    Object.keys(cleanedData).forEach(key => {
      // Always include the field, even if null (to allow clearing values)
      fieldsToUpdate[key] = cleanedData[key]
    })

    console.log('Fields to update:', fieldsToUpdate)

    const { data, error } = await supabaseServer
      .from('RENT_properties')
      .update(fieldsToUpdate)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      const errorInfo = {
        error: error.message || 'Unknown error',
        details: error.details || 'No additional details',
        hint: error.hint || 'No hint provided',
        code: error.code || 'UNKNOWN',
        originalUpdateData: updateData,
        cleanedData: cleanedData,
        fieldsToUpdate: fieldsToUpdate,
        propertyId: id
      }
      console.error('Supabase error updating property:', JSON.stringify(errorInfo, null, 2))
      
      // Return detailed error information for debugging
      return NextResponse.json(
        { 
          error: 'Failed to update property', 
          details: error.message || 'Unknown database error',
          hint: error.hint || '',
          code: error.code || '',
          // Include debug info in development or if explicitly requested
          ...(process.env.NODE_ENV === 'development' && { debug: errorInfo })
        },
        { status: 500 }
      )
    }

    console.log('Property field updated successfully:', data)
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in property field update API:', error)
    return NextResponse.json(
      { error: 'Failed to update property', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
