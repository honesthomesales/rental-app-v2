import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { normalizeCadence } from '@/lib/rent/cadence'
import { isAuthError, requireApiAuth } from '@/lib/auth/api-auth'

// Always serve live invoice amounts (prospective rent changes must appear immediately).
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  const auth = await requireApiAuth(request)
  if (isAuthError(auth)) return auth
try {
    const { searchParams } = new URL(request.url)
    
    // Parse query parameters
    const tenantId = searchParams.get('tenantId')
    const leaseId = searchParams.get('leaseId')
    const status = searchParams.get('status')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    
    console.log('Fetching invoices with filters:', {
      tenantId,
      leaseId,
      status,
      from,
      to
    })
    
    // Build the query - use RENT_invoices table directly
    let query = supabaseServer
      .from('RENT_invoices')
      .select('*')
    
    // Apply filters
    if (tenantId) {
      query = query.eq('tenant_id', tenantId)
    }
    
    if (leaseId) {
      query = query.eq('lease_id', leaseId)
    }
    
    if (status) {
      query = query.eq('status', status)
    }
    
    if (from) {
      query = query.gte('due_date', from)
    }
    
    if (to) {
      query = query.lte('due_date', to)
    }
    
    // Order by due_date descending (newest first)
    query = query.order('due_date', { ascending: false })
    
    const { data: invoices, error } = await query
    
    console.log('Invoices query result:', { 
      invoices: invoices?.length, 
      error,
      filters: { tenantId, leaseId, status, from, to }
    })

    if (error) {
      console.error('Supabase error:', error)
      throw new Error(`Error fetching invoices: ${error.message}`)
    }

    console.log('Returning invoices:', invoices?.length || 0)
    return NextResponse.json(invoices || [], {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  } catch (error) {
    console.error('Error in invoices API:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch invoices', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    )
  }
}

export async function POST(request: Request) {
  const auth = await requireApiAuth(request, { write: true })
  if (isAuthError(auth)) return auth
try {
    const invoiceData = await request.json()
    
    console.log('Creating invoice:', invoiceData)
    
    // Validate required fields
    if (!invoiceData.lease_id || !invoiceData.due_date) {
      return NextResponse.json(
        { error: 'lease_id and due_date are required' },
        { status: 400 }
      )
    }
    
    // Fetch lease to validate invoice matches lease expectations
    const { data: lease, error: leaseError } = await supabaseServer
      .from('RENT_leases')
      .select('id, rent, rent_cadence, rent_due_day, lease_start_date, lease_end_date, property_id, tenant_id')
      .eq('id', invoiceData.lease_id)
      .single()
    
    if (leaseError || !lease) {
      console.error('Lease not found:', leaseError)
      return NextResponse.json(
        { error: 'Lease not found', details: leaseError?.message },
        { status: 404 }
      )
    }
    
    // Validate invoice matches lease expectations
    const validationErrors: string[] = []
    const warnings: string[] = []
    
    // Normalize cadence
    const cadence = normalizeCadence(lease.rent_cadence)
    
    // Calculate or validate period_start and period_end for monthly leases
    let periodStart = invoiceData.period_start
    let periodEnd = invoiceData.period_end
    const dueDate = new Date(invoiceData.due_date)
    
    // Validate due_date matches lease expectations
    if (cadence === 'monthly' && lease.rent_due_day) {
      const expectedDay = Math.min(lease.rent_due_day, new Date(dueDate.getFullYear(), dueDate.getMonth() + 1, 0).getDate())
      
      if (dueDate.getDate() !== expectedDay) {
        validationErrors.push(
          `Due date (${dueDate.getDate()}) does not match lease rent_due_day (${lease.rent_due_day}). Expected day ${expectedDay} for month ${dueDate.getMonth() + 1}/${dueDate.getFullYear()}`
        )
      }
    }
    
    if (cadence === 'monthly') {
      // Calculate expected period dates from due_date
      const expectedPeriodStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), 1)
      const expectedPeriodEnd = new Date(dueDate.getFullYear(), dueDate.getMonth() + 1, 0)
      
      // If period_start/period_end not provided, calculate them
      if (!periodStart) {
        periodStart = expectedPeriodStart.toISOString().split('T')[0]
      }
      if (!periodEnd) {
        periodEnd = expectedPeriodEnd.toISOString().split('T')[0]
      }
      
      // Validate if provided
      if (invoiceData.period_start) {
        const providedPeriodStart = new Date(invoiceData.period_start)
        if (providedPeriodStart.getTime() !== expectedPeriodStart.getTime()) {
          validationErrors.push(
            `period_start (${providedPeriodStart.toISOString().split('T')[0]}) should be the first day of the month (${expectedPeriodStart.toISOString().split('T')[0]})`
          )
        }
      }
      
      if (invoiceData.period_end) {
        const providedPeriodEnd = new Date(invoiceData.period_end)
        if (providedPeriodEnd.getTime() !== expectedPeriodEnd.getTime()) {
          validationErrors.push(
            `period_end (${providedPeriodEnd.toISOString().split('T')[0]}) should be the last day of the month (${expectedPeriodEnd.toISOString().split('T')[0]})`
          )
        }
      }
    }
    
    // Validate invoice is within lease period
    const leaseStart = new Date(lease.lease_start_date)
    const leaseEnd = lease.lease_end_date ? new Date(lease.lease_end_date) : null
    
    if (dueDate < leaseStart) {
      validationErrors.push(
        `Due date (${dueDate.toISOString().split('T')[0]}) is before lease start date (${leaseStart.toISOString().split('T')[0]})`
      )
    }
    
    if (leaseEnd && dueDate > leaseEnd) {
      validationErrors.push(
        `Due date (${dueDate.toISOString().split('T')[0]}) is after lease end date (${leaseEnd.toISOString().split('T')[0]})`
      )
    }
    
    // Warn if amount_rent doesn't match lease rent (but don't block)
    const amountRent = parseFloat(invoiceData.amount_rent || 0)
    const leaseRent = parseFloat(lease.rent || 0)
    if (amountRent > 0 && Math.abs(amountRent - leaseRent) > 0.01) {
      warnings.push(
        `Invoice amount_rent ($${amountRent.toFixed(2)}) does not match lease rent ($${leaseRent.toFixed(2)})`
      )
    }
    
    // Use lease property_id and tenant_id if not provided
    const propertyId = invoiceData.property_id || lease.property_id
    const tenantId = invoiceData.tenant_id || lease.tenant_id
    
    // Return validation errors if any
    if (validationErrors.length > 0) {
      console.error('Invoice validation errors:', validationErrors)
      return NextResponse.json(
        { 
          error: 'Invoice does not match lease expectations', 
          details: validationErrors,
          warnings: warnings.length > 0 ? warnings : undefined
        },
        { status: 400 }
      )
    }
    
    // Calculate totals if not provided
    const amountLate = parseFloat(invoiceData.amount_late || 0)
    const amountOther = parseFloat(invoiceData.amount_other || 0)
    const amountTotal = invoiceData.amount_total || (amountRent + amountLate + amountOther)
    const amountPaid = parseFloat(invoiceData.amount_paid || 0)
    const balanceDue = amountTotal - amountPaid
    
    // Prepare invoice record
    const invoiceRecord: any = {
      lease_id: invoiceData.lease_id,
      property_id: propertyId,
      tenant_id: tenantId,
      due_date: invoiceData.due_date,
      period_start: periodStart,
      period_end: periodEnd,
      amount_rent: amountRent || leaseRent, // Use lease rent if amount_rent not provided
      amount_late: amountLate,
      amount_other: amountOther,
      amount_total: amountTotal || (leaseRent + amountLate + amountOther),
      amount_paid: amountPaid,
      balance_due: balanceDue,
      status: balanceDue <= 0 ? 'PAID' : 'OPEN',
      paid_in_full_at: balanceDue <= 0 ? new Date().toISOString() : null
    }
    
    // Insert invoice into database
    const { data, error } = await supabaseServer
      .from('RENT_invoices')
      .insert([invoiceRecord])
      .select()
      .single()
    
    if (error) {
      console.error('Database error:', error)
      return NextResponse.json(
        { error: 'Failed to create invoice', details: error.message },
        { status: 500 }
      )
    }
    
    console.log('Invoice created successfully:', data)
    if (warnings.length > 0) {
      console.warn('Invoice creation warnings:', warnings)
    }
    
    return NextResponse.json({ 
      success: true,
      invoice: data,
      warnings: warnings.length > 0 ? warnings : undefined
    })
  } catch (error) {
    console.error('Error in invoices POST API:', error)
    return NextResponse.json(
      { error: 'Failed to create invoice', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  const auth = await requireApiAuth(request, { write: true })
  if (isAuthError(auth)) return auth
try {
    const { searchParams } = new URL(request.url)
    const invoiceId = searchParams.get('id')
    const body = await request.json()
    
    if (!invoiceId) {
      return NextResponse.json(
        { error: 'Invoice ID is required' },
        { status: 400 }
      )
    }

    console.log('Updating invoice:', invoiceId, body)

    // If amount_paid or amount_late is being updated, recalculate totals
    if (body.amount_paid !== undefined || body.amount_late !== undefined) {
      // Get current invoice to calculate balance
      const { data: currentInvoice, error: fetchError } = await supabaseServer
        .from('RENT_invoices')
        .select('amount_total, amount_rent, amount_late, amount_other, amount_paid')
        .eq('id', invoiceId)
        .single()

      if (fetchError) {
        console.error('Error fetching invoice:', fetchError)
        throw new Error('Failed to fetch invoice')
      }

      // Use updated values or current values
      const amountRent = parseFloat(currentInvoice.amount_rent)
      const amountLate = body.amount_late !== undefined ? parseFloat(body.amount_late) : parseFloat(currentInvoice.amount_late)
      const amountOther = parseFloat(currentInvoice.amount_other || 0)
      const amountPaid = body.amount_paid !== undefined ? parseFloat(body.amount_paid) : parseFloat(currentInvoice.amount_paid)

      // Recalculate total and balance
      const amountTotal = amountRent + amountLate + amountOther
      const balanceDue = amountTotal - amountPaid

      body.amount_total = amountTotal
      body.balance_due = balanceDue
      body.status = balanceDue <= 0 ? 'PAID' : 'OPEN'
      body.paid_in_full_at = balanceDue <= 0 ? new Date().toISOString() : null

      console.log('Calculated invoice totals:', { 
        amountRent, 
        amountLate, 
        amountOther, 
        amountTotal, 
        amountPaid, 
        balanceDue, 
        status: body.status 
      })
    }

    // Update invoice in database
    const { data, error } = await supabaseServer
      .from('RENT_invoices')
      .update(body)
      .eq('id', invoiceId)
      .select()
      .single()

    if (error) {
      console.error('Database error:', error)
      return NextResponse.json(
        { error: 'Failed to update invoice', details: error.message },
        { status: 500 }
      )
    }

    console.log('Invoice updated successfully:', data)

    return NextResponse.json({ 
      success: true,
      invoice: data
    })
  } catch (error) {
    console.error('Error in invoices PUT API:', error)
    return NextResponse.json(
      { error: 'Failed to update invoice', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
