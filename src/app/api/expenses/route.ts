import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { Expense } from '@/types/database'

export async function GET() {
  try {
    const { data: expenses, error } = await supabaseServer
      .from('RENT_expenses')
      .select(`
        *,
        property:property_id(name, address)
      `)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching expenses:', error)
      return NextResponse.json({ error: 'Failed to fetch expenses' }, { status: 500 })
    }

    // Process expenses to add property_name
    const processedExpenses = expenses?.map(expense => ({
      ...expense,
      property_name: expense.property?.name || 'Unknown Property',
      property_address: expense.property?.address || ''
    })) || []

    return NextResponse.json(processedExpenses)
  } catch (error) {
    console.error('Error in expenses API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const { data, error } = await supabaseServer
      .from('RENT_expenses')
      .insert([body])
      .select()
      .single()

    if (error) {
      console.error('Error creating expense:', error)
      return NextResponse.json({ error: 'Failed to create expense' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in create expense API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, ...updateData } = body
    
    // Filter out undefined values
    const filteredData = Object.fromEntries(
      Object.entries(updateData).filter(([_, value]) => value !== undefined)
    )
    
    const { data, error } = await supabaseServer
      .from('RENT_expenses')
      .update(filteredData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating expense:', error)
      return NextResponse.json({ error: 'Failed to update expense' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in update expense API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ error: 'Expense ID is required' }, { status: 400 })
    }
    
    const { error } = await supabaseServer
      .from('RENT_expenses')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting expense:', error)
      return NextResponse.json({ error: 'Failed to delete expense' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in delete expense API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
