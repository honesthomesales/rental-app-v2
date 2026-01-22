import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API endpoint to create approved past-dated invoices
 * Called after user approves individual past-dated invoices
 */
export async function POST(request: Request) {
  try {
    const { invoices } = await request.json()
    
    if (!invoices || !Array.isArray(invoices) || invoices.length === 0) {
      return NextResponse.json(
        { error: 'Invoices array is required' },
        { status: 400 }
      )
    }

    console.log('Creating approved past-dated invoices:', invoices.length)

    // Insert approved invoices
    const { data: createdInvoices, error: insertError } = await supabaseServer
      .from('RENT_invoices')
      .insert(invoices)
      .select()

    if (insertError) {
      // If error is due to unique constraint violation, that's okay - invoice already exists
      if (insertError.code === '23505') {
        console.log('Some invoices already exist (unique constraint), skipping duplicates')
        return NextResponse.json({
          success: true,
          message: 'Some invoices already exist',
          created: 0,
          skipped: invoices.length
        })
      }
      
      console.error('Error creating approved invoices:', insertError)
      return NextResponse.json(
        { error: 'Failed to create approved invoices', details: insertError.message },
        { status: 500 }
      )
    }

    console.log(`Created ${createdInvoices?.length || 0} approved past-dated invoices`)
    
    return NextResponse.json({
      success: true,
      message: `Created ${createdInvoices?.length || 0} approved invoice(s)`,
      created: createdInvoices?.length || 0
    })
  } catch (error) {
    console.error('Error in create-approved invoices API:', error)
    return NextResponse.json(
      {
        error: 'Failed to create approved invoices',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
