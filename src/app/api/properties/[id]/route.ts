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
          key === 'property_tax' || key === 'insurance_premium' || key === 'rent_value') {
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
            cleanedData[key] = parseFloat(numValue.toFixed(2))
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
    
    const { data, error } = await supabaseServer
      .from('RENT_properties')
      .update(cleanedData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      const errorInfo = {
        error: error.message || 'Unknown error',
        details: error.details || 'No additional details',
        hint: error.hint || 'No hint provided',
        code: error.code || 'UNKNOWN',
        updateData: cleanedData,
        propertyId: id
      }
      console.error('Supabase error updating property:', errorInfo)
      
      return NextResponse.json(
        { 
          error: 'Failed to update property', 
          details: error.message || 'Unknown database error',
          hint: error.hint || '',
          code: error.code || '',
          debug: process.env.NODE_ENV === 'development' ? errorInfo : undefined
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
