import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

// Cache this route for 60 seconds to improve performance
export const revalidate = 60

export async function GET() {
  try {
    // Fetch total properties (excluding retired)
    // Use .neq() to exclude retired - this will include null (not set) and active
    const { data: allProperties, error: propertiesError } = await supabaseServer
      .from('RENT_properties')
      .select('*')
      .neq('status', 'retired')

    if (propertiesError) {
      throw new Error(`Error fetching properties: ${propertiesError.message}`)
    }

    // Fetch occupied properties (properties with active leases based on date range)
    const currentDate = new Date().toISOString().split('T')[0]
    const today = currentDate
    
    // OPTIMIZED: Fetch active leases once with all needed data
    const { data: activeLeases, error: leasesError } = await supabaseServer
      .from('RENT_leases')
      .select('id, property_id, lease_start_date, lease_end_date, rent, rent_cadence')
      .eq('status', 'active')
      .lte('lease_start_date', currentDate)
      .or(`lease_end_date.is.null,lease_end_date.gte.${currentDate}`)

    if (leasesError) {
      throw new Error(`Error fetching leases: ${leasesError.message}`)
    }

    const occupiedProperties = new Set(activeLeases?.map(lease => lease.property_id)).size

    // Calculate monthly income from active leases (potential monthly income)
    console.log('Calculating monthly income from active leases...')

    let monthlyIncome = 0

    if (activeLeases && activeLeases.length > 0) {
      console.log('Active leases found:', activeLeases.length)
      
      // Calculate monthly income based on rent cadence
      activeLeases.forEach(lease => {
        const rent = lease.rent || 0
        const cadence = lease.rent_cadence || 'monthly'
        
        switch (cadence.toLowerCase()) {
          case 'weekly':
            // Weekly rent * 4 weeks per month
            monthlyIncome += rent * 4
            break
          case 'bi-weekly':
          case 'biweekly':
            // Bi-weekly rent * 2 periods per month
            monthlyIncome += rent * 2
            break
          case 'monthly':
          default:
            // Monthly rent as-is
            monthlyIncome += rent
            break
        }
      })
    }

    console.log('Calculated monthly income from active leases:', monthlyIncome)

    // Calculate potential income from unoccupied properties
    let potentialIncome = 0
    const occupiedPropertyIds = new Set(activeLeases?.map(lease => lease.property_id))
    
    // Find properties without active leases that have rent_value set
    const unoccupiedProperties = allProperties?.filter(property => 
      !occupiedPropertyIds.has(property.id) && 
      property.rent_value && 
      property.rent_value > 0
    ) || []

    console.log('Unoccupied properties with rent_value:', unoccupiedProperties.length)
    
    // Sum up the rent_value from unoccupied properties
    potentialIncome = unoccupiedProperties.reduce((sum, property) => 
      sum + (property.rent_value || 0), 0
    )

    console.log('Potential income from unoccupied properties:', potentialIncome)
    console.log('Total potential income:', monthlyIncome + potentialIncome)

    // OPTIMIZED: Fetch late payments using batch query instead of N+1 pattern
    let latePayments = 0
    let totalOwed = 0

    if (activeLeases && activeLeases.length > 0) {
      // Get all lease IDs and their start dates
      const leaseIds = activeLeases.map(lease => lease.id)
      const leaseStartDates = new Map(activeLeases.map(lease => [lease.id, lease.lease_start_date]))
      
      // OPTIMIZED: Single batch query for all unpaid invoices across all active leases
      const { data: allUnpaidInvoices, error: invoicesError } = await supabaseServer
        .from('RENT_invoices')
        .select('id, lease_id, due_date, balance_due, status')
        .in('lease_id', leaseIds)
        .eq('status', 'OPEN')
        .gt('balance_due', 0)
        .lte('due_date', today)

      if (invoicesError) {
        console.error('Error fetching unpaid invoices:', invoicesError)
      } else if (allUnpaidInvoices && allUnpaidInvoices.length > 0) {
        // Filter invoices that are within each lease's start date range
        const validInvoices = allUnpaidInvoices.filter(inv => {
          const leaseStartDate = leaseStartDates.get(inv.lease_id)
          return leaseStartDate && inv.due_date >= leaseStartDate
        })

        // Count late payments (invoices past due with outstanding balance)
        const lateInvoices = validInvoices.filter(inv => 
          new Date(inv.due_date) < new Date(today)
        )
        latePayments = lateInvoices.length
        
        // Calculate total owed
        totalOwed = validInvoices.reduce((sum, inv) => 
          sum + parseFloat(inv.balance_due || 0), 0
        )

        console.log(`Found ${latePayments} late invoices and $${totalOwed.toFixed(2)} total owed across ${activeLeases.length} active leases`)
      }
    }

    // Calculate property type breakdown from allProperties
    const propertyTypeBreakdown = {
      house: 0,
      doublewide: 0,
      singlewide: 0,
      loan: 0
    }

    allProperties?.forEach(property => {
      const type = property.property_type
      if (type === 'house') propertyTypeBreakdown.house++
      else if (type === 'doublewide') propertyTypeBreakdown.doublewide++
      else if (type === 'singlewide') propertyTypeBreakdown.singlewide++
      else if (type === 'loan') propertyTypeBreakdown.loan++
    })

    const metrics = {
      totalProperties: allProperties?.length || 0,
      occupiedProperties,
      monthlyIncome,
      potentialIncome,
      totalPotentialIncome: monthlyIncome + potentialIncome,
      latePayments,
      totalOwed,
      propertyTypeBreakdown
    }

    return NextResponse.json(metrics)
  } catch (error) {
    console.error('Error in dashboard metrics API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch dashboard metrics' },
      { status: 500 }
    )
  }
}
