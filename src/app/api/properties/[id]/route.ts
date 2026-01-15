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
      // Handle numeric fields
      if (key === 'tax_paid_amount_current' || key === 'tax_paid_amount_previous' || 
          key === 'property_tax' || key === 'tax_color_state' ||
          key === 'insurance_premium' || key === 'rent_value') {
        if (value === null || value === undefined || value === '') {
          cleanedData[key] = null
        } else {
          const numValue = typeof value === 'string' ? parseFloat(value) : value
          cleanedData[key] = isNaN(numValue) ? null : numValue
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
      console.error('Supabase error updating property:', {
        error,
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        updateData: cleanedData,
        id
      })
      return NextResponse.json(
        { 
          error: 'Failed to update property', 
          details: error.message,
          hint: error.hint,
          code: error.code
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
