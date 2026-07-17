import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { normalizeCadence } from '@/lib/rent/cadence'
import { isAuthError, requireApiAuth } from '@/lib/auth/api-auth'
import { getBusinessDate } from '@/lib/business-date'
import {
  applyPreviewSafetyToScheduleInput,
  isRejectedPreviewDueDate,
} from '@/lib/lease-preview-safety'

/**
 * Validates if an invoice's period matches the expected cadence
 */
function validateInvoiceCadence(
  invoice: { period_start: string; period_end: string; due_date: string },
  cadence: string,
  rentDueDay: number
): boolean {
  const periodStart = new Date(invoice.period_start + 'T00:00:00')
  const periodEnd = new Date(invoice.period_end + 'T00:00:00')
  const dueDate = new Date(invoice.due_date + 'T00:00:00')
  
  // Calculate period length in days
  const periodLengthDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
  
  if (cadence === 'weekly') {
    // Weekly: period should be exactly 7 days
    return periodLengthDays === 7
  } else if (cadence === 'biweekly') {
    // Biweekly: period should be exactly 14 days
    return periodLengthDays === 14
  } else if (cadence === 'monthly') {
    // Monthly: period should span the full month
    // period_start should be the 1st of the month
    // period_end should be the last day of the month
    // due_date should match rent_due_day (or last day of month if rent_due_day is later)
    const expectedPeriodStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), 1)
    const expectedPeriodEnd = new Date(dueDate.getFullYear(), dueDate.getMonth() + 1, 0)
    const daysInMonth = expectedPeriodEnd.getDate()
    const expectedDueDay = Math.min(rentDueDay, daysInMonth)
    
    const periodStartMatches = periodStart.getTime() === expectedPeriodStart.getTime()
    const periodEndMatches = periodEnd.getTime() === expectedPeriodEnd.getTime()
    const dueDayMatches = dueDate.getDate() === expectedDueDay
    
    return periodStartMatches && periodEndMatches && dueDayMatches
  }
  
  return false
}

/**
 * API endpoint to automatically generate missing invoices for a lease
 * This ensures invoices always exist up to 3 months ahead
 * Called automatically when viewing invoices to fill any gaps
 */
export async function POST(request: Request) {
  const auth = await requireApiAuth(request, { write: true })
  if (isAuthError(auth)) return auth
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

    const safety = applyPreviewSafetyToScheduleInput({
      leaseId,
      rentCadence: lease.rent_cadence,
      rentAmount: lease.rent,
    })

    const cadence = normalizeCadence(safety.rentCadence || 'monthly')
    const rentDueDay = lease.rent_due_day || 1
    const rentAmount = Number(safety.rentAmount ?? lease.rent ?? 0)
    const leaseStartDate = lease.lease_start_date

    const businessDate = getBusinessDate()
    const todayStr = businessDate
    const todayDate = new Date(businessDate + 'T00:00:00')
    todayDate.setHours(0, 0, 0, 0)
    
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
      const threeMonthsAhead = new Date(businessDate + 'T00:00:00')
      threeMonthsAhead.setMonth(threeMonthsAhead.getMonth() + 3)
      endDate = threeMonthsAhead.toISOString().split('T')[0]
    }

    // Fetch existing invoices to find gaps and validate cadence
    const { data: existingInvoices, error: invoicesError } = await supabaseServer
      .from('RENT_invoices')
      .select('id, due_date, period_start, period_end')
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

    // Validate that all existing invoices match the lease cadence
    if (existingInvoices && existingInvoices.length > 0) {
      const mismatchedInvoices: any[] = []
      
      for (const invoice of existingInvoices) {
        if (!validateInvoiceCadence(invoice, cadence || 'monthly', rentDueDay)) {
          mismatchedInvoices.push({
            id: invoice.id,
            due_date: invoice.due_date,
            period_start: invoice.period_start,
            period_end: invoice.period_end,
            period_length_days: Math.round(
              (new Date(invoice.period_end + 'T00:00:00').getTime() - 
               new Date(invoice.period_start + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24)
            ) + 1
          })
        }
      }
      
      if (mismatchedInvoices.length > 0) {
        console.error(`Found ${mismatchedInvoices.length} invoices with incorrect cadence for lease ${leaseId} (expected: ${cadence})`)
        return NextResponse.json(
          {
            error: 'Existing invoices have incorrect cadence',
            details: `Found ${mismatchedInvoices.length} invoice(s) that do not match the lease cadence (${cadence}). Please delete these invoices before generating new ones.`,
            mismatchedInvoices: mismatchedInvoices,
            expectedCadence: cadence,
            leaseCadence: lease.rent_cadence
          },
          { status: 400 }
        )
      }
    }

    const existingDueDates = new Set(
      (existingInvoices || []).map((inv: any) => inv.due_date?.split('T')[0] || inv.due_date)
    )

    const invoicesToCreate: any[] = []
    const pastInvoicesToApprove: any[] = []

    const shouldSkipDueDate = (dueDate: string) =>
      isRejectedPreviewDueDate(leaseId, dueDate)

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
          if (shouldSkipDueDate(dueDate)) {
            current.setDate(current.getDate() + 7)
            continue
          }
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
          if (shouldSkipDueDate(dueDate)) {
            current.setDate(current.getDate() + 14)
            continue
          }
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
          if (shouldSkipDueDate(dueDate)) {
            current.setMonth(current.getMonth() + 1)
            continue
          }
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
