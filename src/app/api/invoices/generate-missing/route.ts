import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { normalizeCadence } from '@/lib/rent/cadence'

/**
 * API endpoint to automatically generate missing invoices for a lease
 * This ensures invoices always exist up to 3 months ahead
 * Called automatically when viewing invoices to fill any gaps
 */
export async function POST(request: Request) {
  try {
    const { leaseId } = await request.json()
    
    if (!leaseId) {
      return NextResponse.json(
        { error: 'leaseId is required' },
        { status: 400 }
      )
    }

    console.log('Generating missing invoices for lease:', leaseId)

    // Fetch lease details
    const { data: lease, error: leaseError } = await supabaseServer
      .from('RENT_leases')
      .select('id, rent, rent_cadence, rent_due_day, lease_start_date, lease_end_date, property_id, tenant_id, status')
      .eq('id', leaseId)
      .single()

    if (leaseError || !lease) {
      console.error('Lease not found:', leaseError)
      return NextResponse.json(
        { error: 'Lease not found', details: leaseError?.message },
        { status: 404 }
      )
    }

    // Only generate invoices for leases with tenants
    if (lease.status !== 'occupied') {
      return NextResponse.json(
        { error: 'Can only generate invoices for occupied leases' },
        { status: 400 }
      )
    }

    const cadence = normalizeCadence(lease.rent_cadence || 'monthly')
    const rentDueDay = lease.rent_due_day || 1
    const rentAmount = lease.rent || 0
    const leaseStartDate = lease.lease_start_date

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split('T')[0]
    
    // Generate invoices for the full active period of the lease
    // If lease has an end date, generate up to that date
    // If no end date (month-to-month), generate up to 3 months ahead (continuously maintained)
    let endDate: string
    if (lease.lease_end_date) {
      const leaseEnd = new Date(lease.lease_end_date)
      leaseEnd.setHours(0, 0, 0, 0)
      // Generate invoices up to lease_end_date (full active period)
      endDate = lease.lease_end_date
    } else {
      // No end date (month-to-month) - generate up to 3 months ahead
      // This will be continuously maintained as invoices are viewed
      const threeMonthsAhead = new Date(today)
      threeMonthsAhead.setMonth(today.getMonth() + 3)
      endDate = threeMonthsAhead.toISOString().split('T')[0]
    }

    // Fetch existing invoices to find gaps
    const { data: existingInvoices, error: invoicesError } = await supabaseServer
      .from('RENT_invoices')
      .select('due_date')
      .eq('lease_id', leaseId)
      .gte('due_date', leaseStartDate)
      .lte('due_date', endDate)
      .order('due_date', { ascending: true })

    if (invoicesError) {
      console.error('Error fetching existing invoices:', invoicesError)
      return NextResponse.json(
        { error: 'Failed to fetch existing invoices', details: invoicesError.message },
        { status: 500 }
      )
    }

    const existingDueDates = new Set(
      (existingInvoices || []).map((inv: any) => inv.due_date?.split('T')[0] || inv.due_date)
    )

    const invoicesToCreate: any[] = []
    const pastInvoicesToApprove: any[] = []

    // Separate invoices into past (need approval) and future (auto-create)
    const todayDate = new Date(today)
    todayDate.setHours(0, 0, 0, 0)

    if (cadence === 'weekly') {
      // Generate weekly invoices: every 7 days from lease start up to 3 months ahead
      const start = new Date(leaseStartDate)
      start.setHours(0, 0, 0, 0)
      const endDateObj = new Date(endDate)
      endDateObj.setHours(23, 59, 59, 999)
      const current = new Date(start)
      
      while (current <= endDateObj) {
        const dueDate = current.toISOString().split('T')[0]
        
        // Only create invoice if due date is on/after lease start and up to end date
        if (dueDate >= leaseStartDate && dueDate <= endDate && !existingDueDates.has(dueDate)) {
          // Calculate period: 7 days (period_start to period_start + 6 days)
          const periodStart = dueDate
          const periodEndDate = new Date(current)
          periodEndDate.setDate(periodEndDate.getDate() + 6)
          const periodEnd = periodEndDate.toISOString().split('T')[0]
          
          const invoiceData = {
            lease_id: lease.id,
            property_id: lease.property_id,
            tenant_id: lease.tenant_id,
            due_date: dueDate,
            period_start: periodStart,
            period_end: periodEnd,
            amount_rent: rentAmount,
            amount_late: 0,
            amount_other: 0,
            amount_total: rentAmount,
            amount_paid: 0,
            balance_due: rentAmount,
            status: 'OPEN'
          }
          
          // Check if due date is in the past
          const dueDateObj = new Date(dueDate)
          dueDateObj.setHours(0, 0, 0, 0)
          if (dueDateObj < todayDate) {
            pastInvoicesToApprove.push(invoiceData)
          } else {
            invoicesToCreate.push(invoiceData)
          }
        }
        
        // Move to next week (7 days later)
        current.setDate(current.getDate() + 7)
      }
    } else if (cadence === 'biweekly') {
      // Generate biweekly invoices: every 14 days from lease start up to 3 months ahead
      const start = new Date(leaseStartDate)
      start.setHours(0, 0, 0, 0)
      const endDateObj = new Date(endDate)
      endDateObj.setHours(23, 59, 59, 999)
      const current = new Date(start)
      
      while (current <= endDateObj) {
        const dueDate = current.toISOString().split('T')[0]
        
        if (dueDate >= leaseStartDate && dueDate <= endDate && !existingDueDates.has(dueDate)) {
          // Calculate period: 14 days (period_start to period_start + 13 days)
          const periodStart = dueDate
          const periodEndDate = new Date(current)
          periodEndDate.setDate(periodEndDate.getDate() + 13)
          const periodEnd = periodEndDate.toISOString().split('T')[0]
          
          const invoiceData = {
            lease_id: lease.id,
            property_id: lease.property_id,
            tenant_id: lease.tenant_id,
            due_date: dueDate,
            period_start: periodStart,
            period_end: periodEnd,
            amount_rent: rentAmount,
            amount_late: 0,
            amount_other: 0,
            amount_total: rentAmount,
            amount_paid: 0,
            balance_due: rentAmount,
            status: 'OPEN'
          }
          
          // Check if due date is in the past
          const dueDateObj = new Date(dueDate)
          dueDateObj.setHours(0, 0, 0, 0)
          if (dueDateObj < todayDate) {
            pastInvoicesToApprove.push(invoiceData)
          } else {
            invoicesToCreate.push(invoiceData)
          }
        }
        
        // Move to next biweekly period (14 days later)
        current.setDate(current.getDate() + 14)
      }
    } else if (cadence === 'monthly') {
      // Generate monthly invoices: each month from lease start up to 3 months ahead
      const start = new Date(leaseStartDate)
      const current = new Date(start.getFullYear(), start.getMonth(), 1)
      const endDateObj = new Date(endDate)

      while (current <= endDateObj) {
        const year = current.getFullYear()
        const month = current.getMonth()
        const daysInMonth = new Date(year, month + 1, 0).getDate()
        const dueDay = Math.min(rentDueDay, daysInMonth)
        const dueDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`
        
        // Only create invoice if due date is on/after lease start and up to end date
        if (dueDate >= leaseStartDate && dueDate <= endDate && !existingDueDates.has(dueDate)) {
          const periodStart = `${year}-${String(month + 1).padStart(2, '0')}-01`
          const periodEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
          
          const invoiceData = {
            lease_id: lease.id,
            property_id: lease.property_id,
            tenant_id: lease.tenant_id,
            due_date: dueDate,
            period_start: periodStart,
            period_end: periodEnd,
            amount_rent: rentAmount,
            amount_late: 0,
            amount_other: 0,
            amount_total: rentAmount,
            amount_paid: 0,
            balance_due: rentAmount,
            status: 'OPEN'
          }
          
          // Check if due date is in the past
          const dueDateObj = new Date(dueDate)
          dueDateObj.setHours(0, 0, 0, 0)
          if (dueDateObj < todayDate) {
            pastInvoicesToApprove.push(invoiceData)
          } else {
            invoicesToCreate.push(invoiceData)
          }
        }

        // Move to next month
        current.setMonth(current.getMonth() + 1)
      }
    } else {
      return NextResponse.json(
        { error: `Invoice generation doesn't support cadence: ${cadence}` },
        { status: 400 }
      )
    }

    // Create future invoices automatically (no approval needed)
    let futureCreated = 0
    if (invoicesToCreate.length > 0) {
      const { data: createdInvoices, error: insertError } = await supabaseServer
        .from('RENT_invoices')
        .insert(invoicesToCreate)
        .select()

      if (insertError) {
        // If error is due to unique constraint violation, that's okay - invoice already exists
        if (insertError.code === '23505') {
          console.log('Some invoices already exist (unique constraint), skipping duplicates')
        } else {
          console.error('Error creating future invoices:', insertError)
          return NextResponse.json(
            { error: 'Failed to create future invoices', details: insertError.message },
            { status: 500 }
          )
        }
      } else {
        futureCreated = createdInvoices?.length || 0
        console.log(`Created ${futureCreated} future invoices for lease ${leaseId} (${cadence} cadence)`)
      }
    }

    // If there are past invoices that need approval, return them for user approval
    if (pastInvoicesToApprove.length > 0) {
      return NextResponse.json({
        success: true,
        requiresApproval: true,
        pastInvoices: pastInvoicesToApprove,
        futureCreated: futureCreated,
        message: `${pastInvoicesToApprove.length} past-dated invoice(s) require approval`
      })
    }

    // No past invoices, return success
    return NextResponse.json({
      success: true,
      requiresApproval: false,
      created: futureCreated,
      message: futureCreated > 0 ? `Created ${futureCreated} new invoice(s)` : 'No missing invoices found'
    })
  } catch (error) {
    console.error('Error in generate-missing invoices API:', error)
    return NextResponse.json(
      {
        error: 'Failed to generate missing invoices',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
