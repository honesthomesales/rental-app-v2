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
    
    const { data, error } = await supabaseServer
      .from('RENT_properties')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating property:', error)
      throw new Error(`Supabase error: ${error.message}`)
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
