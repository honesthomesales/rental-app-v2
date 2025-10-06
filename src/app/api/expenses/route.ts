import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { Expense } from '@/types/database'

export async function GET() {
  try {
    console.log('Fetching expenses from RENT_expenses table...')
    
    const { data: expenses, error } = await supabaseServer
      .from('RENT_expenses')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching expenses:', error)
      return NextResponse.json({ error: 'Failed to fetch expenses' }, { status: 500 })
    }

    console.log('Expenses query result:', { expenses: expenses?.length || 0, error: null })
    console.log('Returning expenses:', expenses?.length || 0)

    return NextResponse.json(expenses || [])
  } catch (error) {
    console.error('Error in expenses API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    console.log('Creating new expense:', body)
    
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
    
    console.log('Updating expense:', id, updateData)
    
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
    
    console.log('Deleting expense:', id)
    
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
