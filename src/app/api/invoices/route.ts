import { NextResponse } from 'next/server'
import { isAuthError, requireApiAuth } from '@/lib/auth/api-auth'
import { supabaseServer } from '@/lib/supabase-server'
import { normalizeCadence } from '@/lib/rent/cadence'

// Always serve live invoice amounts (prospective rent changes must appear immediately).
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
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

    const dateOnly = (value: unknown): string => {
      const text = String(value || '').split('T')[0]
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
    }

    // Compare calendar dates only. Date objects treat "YYYY-MM-DD" as UTC
    // midnight and shift the day, which rejects the first month of a new lease.
    const dueDateStr = dateOnly(invoiceData.due_date)
    if (!dueDateStr) {
      return NextResponse.json(
        { error: 'due_date must be YYYY-MM-DD' },
        { status: 400 },
      )
    }
    const dueUtc = new Date(`${dueDateStr}T12:00:00Z`)
    const leaseStartStr = dateOnly(lease.lease_start_date)
    const leaseEndStr = dateOnly(lease.lease_end_date)
    const openingMonth =
      cadence === 'monthly' &&
      Boolean(leaseStartStr) &&
      dueDateStr.slice(0, 7) === leaseStartStr.slice(0, 7)

    let periodStart = dateOnly(invoiceData.period_start)
    let periodEnd = dateOnly(invoiceData.period_end)

    if (cadence === 'monthly' && lease.rent_due_day && !openingMonth) {
      const monthEndDay = new Date(Date.UTC(dueUtc.getUTCFullYear(), dueUtc.getUTCMonth() + 1, 0)).getUTCDate()
      const expectedDay = Math.min(Number(lease.rent_due_day), monthEndDay)

      if (dueUtc.getUTCDate() !== expectedDay) {
        validationErrors.push(
          `Due date (${dueUtc.getUTCDate()}) does not match lease rent_due_day (${lease.rent_due_day}). Expected day ${expectedDay} for month ${dueUtc.getUTCMonth() + 1}/${dueUtc.getUTCFullYear()}`
        )
      }
    }

    if (cadence === 'monthly') {
      const year = dueUtc.getUTCFullYear()
      const monthIndex = dueUtc.getUTCMonth()
      const expectedPeriodStart = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`
      const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
      const expectedPeriodEnd = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

      if (!periodStart) periodStart = expectedPeriodStart
      if (!periodEnd) periodEnd = expectedPeriodEnd

      if (dateOnly(invoiceData.period_start) && dateOnly(invoiceData.period_start) !== expectedPeriodStart) {
        validationErrors.push(
          `period_start (${dateOnly(invoiceData.period_start)}) should be the first day of the month (${expectedPeriodStart})`
        )
      }

      if (dateOnly(invoiceData.period_end) && dateOnly(invoiceData.period_end) !== expectedPeriodEnd) {
        validationErrors.push(
          `period_end (${dateOnly(invoiceData.period_end)}) should be the last day of the month (${expectedPeriodEnd})`
        )
      }
    }

    // Opening calendar month is allowed even when its due day is before the lease start.
    if (leaseStartStr && dueDateStr < leaseStartStr && !openingMonth) {
      validationErrors.push(
        `Due date (${dueDateStr}) is before lease start date (${leaseStartStr})`
      )
    }

    if (leaseEndStr && dueDateStr > leaseEndStr) {
      validationErrors.push(
        `Due date (${dueDateStr}) is after lease end date (${leaseEndStr})`
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
  try {
    const auth = await requireApiAuth(request, { write: true })
    if (isAuthError(auth)) return auth

    const { searchParams } = new URL(request.url)
    const invoiceId = searchParams.get('id')
    const body = await request.json()
    
    if (!invoiceId) {
      return NextResponse.json(
        { error: 'Invoice ID is required' },
        { status: 400 }
      )
    }

    // Late-fee and balance mutations must use transactional correction/waive RPCs.
    if (
      body.amount_late !== undefined ||
      body.amount_paid !== undefined ||
      body.amount_rent !== undefined ||
      body.amount_other !== undefined ||
      body.amount_total !== undefined ||
      body.balance_due !== undefined ||
      body.late_fee_waived !== undefined ||
      body.status !== undefined
    ) {
      return NextResponse.json(
        {
          error:
            'Financial invoice fields must be updated via Edit Invoice or Waive Fee endpoints.',
          writePerformed: false,
        },
        { status: 409 },
      )
    }

    console.log('Updating invoice:', invoiceId, body)

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
