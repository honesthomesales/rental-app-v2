import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET(request: NextRequest) {
  try {
    console.log('API route called')
    const { searchParams } = new URL(request.url)
    const leaseId = searchParams.get('leaseId')
    const periodStart = searchParams.get('periodStart')
    const periodEnd = searchParams.get('periodEnd')

    console.log('Parameters:', { leaseId, periodStart, periodEnd })

    if (!leaseId || !periodStart || !periodEnd) {
      console.log('Missing parameters')
      return NextResponse.json({ 
        success: false, 
        error: 'Missing required parameters: leaseId, periodStart, periodEnd' 
      }, { status: 400 })
    }

    console.log('Fetching payments for period:', { leaseId, periodStart, periodEnd })

    // Fetch payments for this lease within the specified period, including invoice information
    const { data: payments, error } = await supabaseServer
      .from('RENT_payments')
      .select(`
        id,
        amount,
        payment_date,
        payment_method,
        payment_type,
        notes,
        status,
        created_at,
        invoice_id,
        RENT_invoices(
          id,
          due_date,
          period_start,
          period_end,
          amount_total,
          amount_paid,
          balance_due
        )
      `)
      .eq('lease_id', leaseId)
      .gte('payment_date', periodStart)
      .lte('payment_date', periodEnd)
      .order('payment_date', { ascending: false })

    if (error) {
      console.error('Error fetching payments:', error)
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to fetch payments' 
      }, { status: 500 })
    }

    console.log('Found payments:', payments?.length || 0)

    // Transform the data to match the expected format
    const transformedPayments = payments?.map(payment => ({
      id: payment.id,
      amount: parseFloat(payment.amount || 0),
      date: payment.payment_date,
      method: payment.payment_method || 'Unknown',
      type: payment.payment_type || 'Payment',
      notes: payment.notes,
      status: payment.status,
      createdAt: payment.created_at,
      invoiceId: payment.invoice_id,
      invoice: payment.RENT_invoices ? {
        id: payment.RENT_invoices.id,
        dueDate: payment.RENT_invoices.due_date,
        periodStart: payment.RENT_invoices.period_start,
        periodEnd: payment.RENT_invoices.period_end,
        amountTotal: parseFloat(payment.RENT_invoices.amount_total || 0),
        amountPaid: parseFloat(payment.RENT_invoices.amount_paid || 0),
        balanceDue: parseFloat(payment.RENT_invoices.balance_due || 0)
      } : null
    })) || []

    return NextResponse.json({
      success: true,
      payments: transformedPayments
    })

  } catch (error) {
    console.error('Error in payments by period API:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}
