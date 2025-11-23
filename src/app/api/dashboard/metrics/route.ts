import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET() {
  try {
    // Fetch total properties
    const { data: allProperties, error: propertiesError } = await supabaseServer
      .from('RENT_properties')
      .select('*')

    if (propertiesError) {
      throw new Error(`Error fetching properties: ${propertiesError.message}`)
    }

    // Fetch occupied properties (properties with active leases based on date range)
    const currentDate = new Date().toISOString().split('T')[0]
    
    const { data: occupiedLeases, error: leasesError } = await supabaseServer
      .from('RENT_leases')
      .select('property_id, lease_start_date, lease_end_date')
      .eq('status', 'active')
      .lte('lease_start_date', currentDate)
      .or(`lease_end_date.is.null,lease_end_date.gte.${currentDate}`)

    if (leasesError) {
      throw new Error(`Error fetching leases: ${leasesError.message}`)
    }

    const occupiedProperties = new Set(occupiedLeases?.map(lease => lease.property_id)).size

    // Calculate monthly income from active leases (potential monthly income)
    console.log('Calculating monthly income from active leases...')

    let monthlyIncome = 0

    if (occupiedLeases && occupiedLeases.length > 0) {
      // Get lease details for occupied properties (already filtered by date range and status)
      const { data: activeLeases, error: activeLeasesError } = await supabaseServer
        .from('RENT_leases')
        .select('rent, rent_cadence, lease_start_date, lease_end_date')
        .eq('status', 'active')
        .lte('lease_start_date', currentDate)
        .or(`lease_end_date.is.null,lease_end_date.gte.${currentDate}`)

      if (activeLeasesError) {
        console.error('Error fetching active leases:', activeLeasesError)
        monthlyIncome = 0
      } else {
        console.log('Active leases found:', activeLeases?.length || 0)
        
        // Calculate monthly income based on rent cadence
        activeLeases?.forEach(lease => {
          const rent = lease.rent || 0
          const cadence = lease.rent_cadence || 'monthly'
          
          console.log(`Processing lease: rent=${rent}, cadence=${cadence}`)
          
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
    }

    console.log('Calculated monthly income from active leases:', monthlyIncome)

    // Calculate potential income from unoccupied properties
    let potentialIncome = 0
    const occupiedPropertyIds = new Set(occupiedLeases?.map(lease => lease.property_id))
    
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

    // Fetch late payments using the current invoice system approach
    const today = new Date().toISOString().split('T')[0]
    
    // Get all active leases first
    const { data: activeLeases, error: activeLeasesError2 } = await supabaseServer
      .from('RENT_leases')
      .select('id, lease_start_date')
      .eq('status', 'active')
      .lte('lease_start_date', today)
      .or(`lease_end_date.is.null,lease_end_date.gte.${today}`)

    let latePayments = 0
    let totalOwed = 0

    if (activeLeasesError2) {
      console.error('Error fetching active leases:', activeLeasesError2)
    } else if (activeLeases && activeLeases.length > 0) {
      // For each active lease, get unpaid invoices
      for (const lease of activeLeases) {
        const { data: unpaidInvoices, error: invoicesError } = await supabaseServer
          .from('RENT_invoices')
          .select('id, due_date, balance_due, status')
          .eq('lease_id', lease.id)
          .gte('due_date', lease.lease_start_date)
          .lte('due_date', today)
          .eq('status', 'OPEN')
          .gt('balance_due', 0)

        if (!invoicesError && unpaidInvoices) {
          // Count late payments (invoices past due with outstanding balance)
          const lateInvoices = unpaidInvoices.filter(inv => 
            new Date(inv.due_date) < new Date(today)
          )
          latePayments += lateInvoices.length
          
          // Add to total owed
          totalOwed += unpaidInvoices.reduce((sum, inv) => 
            sum + parseFloat(inv.balance_due), 0
          )
        }
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
