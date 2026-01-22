import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { normalizeCadence } from '@/lib/rent/cadence'

// Cache leases for 60 seconds - they don't change frequently
export const revalidate = 60

export async function GET() {
  try {
    const { data: leases, error } = await supabaseServer
      .from('RENT_leases')
      .select(`
        *,
        RENT_properties(*),
        RENT_tenants(*)
      `)
      .order('created_at', { ascending: false })

    if (error) {
      throw new Error(`Error fetching leases: ${error.message}`)
    }

    return NextResponse.json(leases || [])
  } catch (error) {
    console.error('Error in leases API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch leases' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const leaseData = await request.json()
    
    console.log('Creating lease:', leaseData)
    
    // First, insert the lease with a simple select to avoid join issues
    const { data: insertedLease, error: insertError } = await supabaseServer
      .from('RENT_leases')
      .insert(leaseData)
      .select()
      .single()

    if (insertError) {
      console.error('Error creating lease:', insertError)
      return NextResponse.json(
        { 
          error: 'Failed to create lease', 
          details: insertError.message, 
          hint: insertError.hint, 
          code: insertError.code 
        },
        { status: 500 }
      )
    }

    if (!insertedLease) {
      console.error('Lease insert returned no data')
      return NextResponse.json(
        { error: 'Failed to create lease', details: 'Insert succeeded but no data returned' },
        { status: 500 }
      )
    }

    // Now fetch the full lease with related data
    const { data: fullLease, error: fetchError } = await supabaseServer
      .from('RENT_leases')
      .select(`
        *,
        RENT_properties(*),
        RENT_tenants(*)
      `)
      .eq('id', insertedLease.id)
      .single()

    if (fetchError) {
      console.error('Error fetching lease with relations:', fetchError)
      // Return the basic lease data even if fetch with relations fails
      return NextResponse.json(insertedLease)
    }

    console.log('Lease created successfully:', fullLease)
    return NextResponse.json(fullLease || insertedLease)
  } catch (error) {
    console.error('Error in lease creation API:', error)
    return NextResponse.json(
      { error: 'Failed to create lease', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const { id, ...updateData } = await request.json()
    
    if (!id) {
      return NextResponse.json({ error: 'Lease ID is required' }, { status: 400 })
    }

    // Fetch current lease to compare changes
    const { data: currentLease, error: fetchError } = await supabaseServer
      .from('RENT_leases')
      .select('lease_start_date, rent, rent_cadence, rent_due_day, property_id, tenant_id')
      .eq('id', id)
      .single()

    if (fetchError || !currentLease) {
      return NextResponse.json({ error: 'Lease not found' }, { status: 404 })
    }

    // Check if lease terms that affect invoices have changed
    const leaseTermsChanged = 
      (updateData.lease_start_date && updateData.lease_start_date !== currentLease.lease_start_date) ||
      (updateData.rent !== undefined && updateData.rent !== currentLease.rent) ||
      (updateData.rent_cadence && updateData.rent_cadence !== currentLease.rent_cadence) ||
      (updateData.rent_due_day !== undefined && updateData.rent_due_day !== currentLease.rent_due_day)

    // Determine new lease_start_date (use updated value or current)
    const newLeaseStartDate = updateData.lease_start_date || currentLease.lease_start_date

    // Update lease
    const { data: updatedLease, error: updateError } = await supabaseServer
      .from('RENT_leases')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        RENT_properties(*),
        RENT_tenants(*)
      `)
      .single()

    if (updateError) {
      console.error('Error updating lease:', updateError)
      throw new Error(`Supabase error: ${updateError.message}`)
    }

    // If lease terms changed, delete invoices and regenerate
    if (leaseTermsChanged) {
      console.log('Lease terms changed, deleting invoices and regenerating...')
      
      // 1. Delete all PAID invoices with due_date < new lease_start_date
      // Keep unpaid invoices before new lease (they still need to be paid)
      // This removes historical paid invoices from old lease terms
      const { error: deletePaidBeforeError } = await supabaseServer
        .from('RENT_invoices')
        .delete()
        .eq('lease_id', id)
        .lt('due_date', newLeaseStartDate)
        .eq('status', 'PAID')  // Only delete paid invoices

      if (deletePaidBeforeError) {
        console.error('Error deleting paid invoices before new lease_start_date:', deletePaidBeforeError)
      } else {
        console.log('Deleted paid invoices before new lease_start_date')
      }

      // 2. Delete ALL invoices (paid and unpaid) with due_date >= new lease_start_date
      // These need to be regenerated with new lease terms
      const { error: deleteFutureError } = await supabaseServer
        .from('RENT_invoices')
        .delete()
        .eq('lease_id', id)
        .gte('due_date', newLeaseStartDate)  // All invoices on/after new lease start

      if (deleteFutureError) {
        console.error('Error deleting future invoices:', deleteFutureError)
        // Continue anyway - regeneration will handle duplicates
      } else {
        console.log('Deleted all invoices on/after new lease_start_date')
      }

      // Generate new invoices from new lease_start_date forward
      await generateInvoicesForLease(updatedLease, newLeaseStartDate)
    }

    console.log('Lease updated successfully:', updatedLease)
    return NextResponse.json(updatedLease)
  } catch (error) {
    console.error('Error in lease update API:', error)
    return NextResponse.json(
      { error: 'Failed to update lease', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// Helper function to generate invoices for a lease
async function generateInvoicesForLease(lease: any, startDate: string) {
  const cadence = normalizeCadence(lease.rent_cadence || 'monthly')
  const rentDueDay = lease.rent_due_day || 1
  const rentAmount = lease.rent || 0
  
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
  
  const invoicesToCreate: any[] = []
  const todayDate = new Date(today)
  todayDate.setHours(0, 0, 0, 0)

  if (cadence === 'weekly') {
    // Generate weekly invoices: every 7 days from lease start up to 3 months ahead
    const start = new Date(startDate)
    start.setHours(0, 0, 0, 0)
    const endDateObj = new Date(endDate)
    endDateObj.setHours(23, 59, 59, 999)
    const current = new Date(start)
    
    while (current <= endDateObj) {
      const dueDate = current.toISOString().split('T')[0]
      
      // Only create invoice if due date is on/after lease start and up to end date
      // Skip past invoices - they require approval via generate-missing endpoint
      if (dueDate >= startDate && dueDate <= endDate) {
        const dueDateObj = new Date(dueDate)
        dueDateObj.setHours(0, 0, 0, 0)
        
        // Skip past invoices - they will be handled via approval flow when viewing invoices
        if (dueDateObj < todayDate) {
          current.setDate(current.getDate() + 7)
          continue
        }
        
        // Calculate period: 7 days (period_start to period_start + 6 days)
        const periodStart = dueDate
        const periodEndDate = new Date(current)
        periodEndDate.setDate(periodEndDate.getDate() + 6)
        const periodEnd = periodEndDate.toISOString().split('T')[0]
        
        // Check if invoice already exists
        const { data: existing } = await supabaseServer
          .from('RENT_invoices')
          .select('id')
          .eq('lease_id', lease.id)
          .eq('due_date', dueDate)
          .maybeSingle()

        if (!existing) {
          invoicesToCreate.push({
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
          })
        }
      }
      
      // Move to next week (7 days later)
      current.setDate(current.getDate() + 7)
    }
  } else if (cadence === 'biweekly') {
    // Generate biweekly invoices: every 14 days from lease start up to 3 months ahead
    const start = new Date(startDate)
    start.setHours(0, 0, 0, 0)
    const endDateObj = new Date(endDate)
    endDateObj.setHours(23, 59, 59, 999)
    const current = new Date(start)
    
    while (current <= endDateObj) {
      const dueDate = current.toISOString().split('T')[0]
      
      if (dueDate >= startDate && dueDate <= endDate) {
        const dueDateObj = new Date(dueDate)
        dueDateObj.setHours(0, 0, 0, 0)
        
        // Skip past invoices - they will be handled via approval flow when viewing invoices
        if (dueDateObj < todayDate) {
          current.setDate(current.getDate() + 14)
          continue
        }
        
        // Calculate period: 14 days (period_start to period_start + 13 days)
        const periodStart = dueDate
        const periodEndDate = new Date(current)
        periodEndDate.setDate(periodEndDate.getDate() + 13)
        const periodEnd = periodEndDate.toISOString().split('T')[0]
        
        // Check if invoice already exists
        const { data: existing } = await supabaseServer
          .from('RENT_invoices')
          .select('id')
          .eq('lease_id', lease.id)
          .eq('due_date', dueDate)
          .maybeSingle()

        if (!existing) {
          invoicesToCreate.push({
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
          })
        }
      }
      
      // Move to next biweekly period (14 days later)
      current.setDate(current.getDate() + 14)
    }
  } else if (cadence === 'monthly') {
    // Generate monthly invoices: each month from lease start up to 3 months ahead
    const start = new Date(startDate)
    const current = new Date(start.getFullYear(), start.getMonth(), 1)
    const endDateObj = new Date(endDate)

    while (current <= endDateObj) {
      const year = current.getFullYear()
      const month = current.getMonth()
      const daysInMonth = new Date(year, month + 1, 0).getDate()
      const dueDay = Math.min(rentDueDay, daysInMonth)
      const dueDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`
      
      // Only create invoice if due date is on/after lease start and up to end date
      // Skip past invoices - they require approval via generate-missing endpoint
      if (dueDate >= startDate && dueDate <= endDate) {
        const dueDateObj = new Date(dueDate)
        dueDateObj.setHours(0, 0, 0, 0)
        
        // Skip past invoices - they will be handled via approval flow when viewing invoices
        if (dueDateObj < todayDate) {
          current.setMonth(current.getMonth() + 1)
          continue
        }
        
        const periodStart = `${year}-${String(month + 1).padStart(2, '0')}-01`
        const periodEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
        
        // Check if invoice already exists
        const { data: existing } = await supabaseServer
          .from('RENT_invoices')
          .select('id')
          .eq('lease_id', lease.id)
          .eq('due_date', dueDate)
          .maybeSingle()

        if (!existing) {
          invoicesToCreate.push({
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
          })
        }
      }

      // Move to next month
      current.setMonth(current.getMonth() + 1)
    }
  } else {
    console.log(`Invoice generation doesn't support cadence: ${cadence}`)
    return
  }

  // Insert all new invoices
  if (invoicesToCreate.length > 0) {
    const { error: insertError } = await supabaseServer
      .from('RENT_invoices')
      .insert(invoicesToCreate)

    if (insertError) {
      console.error('Error creating invoices:', insertError)
    } else {
      console.log(`Created ${invoicesToCreate.length} new invoices for lease ${lease.id} (${cadence} cadence)`)
    }
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ error: 'Lease ID is required' }, { status: 400 })
    }

    console.log('Deleting lease:', id)
    
    const { error } = await supabaseServer
      .from('RENT_leases')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting lease:', error)
      throw new Error(`Supabase error: ${error.message}`)
    }

    console.log('Lease deleted successfully')
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in lease delete API:', error)
    return NextResponse.json(
      { error: 'Failed to delete lease', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
