import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    let month = searchParams.get('month') || new Date().toISOString().slice(0, 7) // YYYY-MM format
    
    // If no month specified, use current month
    if (!searchParams.get('month')) {
      month = new Date().toISOString().slice(0, 7)
    }
    
    console.log('Fetching profit metrics for month:', month)
    
    // Get start and end of month
    const startOfMonth = `${month}-01`
    const year = parseInt(month.split('-')[0])
    const monthNum = parseInt(month.split('-')[1]) - 1 // JavaScript months are 0-indexed
    const endOfMonth = new Date(year, monthNum + 1, 0).toISOString().slice(0, 10)
    
    console.log('Date range:', startOfMonth, 'to', endOfMonth)
    
    // Fetch all properties for insurance and tax calculations (same as dashboard)
    const { data: properties, error: propertiesError } = await supabaseServer
      .from('RENT_properties')
      .select('*')
    
    if (propertiesError) {
      console.error('Error fetching properties:', propertiesError)
      throw propertiesError
    }
    
    console.log('Properties found:', properties?.length || 0)
    
    // Calculate total insurance (full annual premium) - same as dashboard
    const totalInsurance = properties
      ?.reduce((sum, p) => sum + (Number(p.insurance_premium) || 0), 0) || 0
    
    // Calculate total taxes (full annual tax) - same as dashboard
    const totalTaxes = properties
      ?.reduce((sum, p) => sum + (Number(p.property_tax) || 0), 0) || 0
    
    console.log('Total insurance:', totalInsurance)
    console.log('Total taxes:', totalTaxes)
    
    // Get total payments from expenses table (all expenses, not filtered by month)
    const { data: expenses, error: expensesError } = await supabaseServer
      .from('RENT_expenses')
      .select('amount')
    
    if (expensesError) {
      console.error('Error fetching expenses:', expensesError)
      throw expensesError
    }
    
    const totalPayments = expenses
      ?.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0) || 0
    
    console.log('Expenses found:', expenses?.length || 0)
    console.log('Total payments from expenses:', totalPayments)
    
    // Get rent collected from payments (more reliable than invoices)
    let rentCollected = 0
    let expectedRent = 0
    
    try {
      // Get payments for the month
      const { data: payments, error: paymentsError } = await supabaseServer
        .from('RENT_payments')
        .select('amount, payment_date, payment_type')
        .gte('payment_date', startOfMonth)
        .lte('payment_date', endOfMonth)
      
      if (paymentsError) {
        console.error('Error fetching payments:', paymentsError)
      } else {
        console.log('Successfully fetched', payments?.length || 0, 'payments')
        
        if (payments && payments.length > 0) {
          // Sum all payments as rent collected
          rentCollected = payments.reduce((sum, payment: any) => {
            return sum + (Number(payment.amount) || 0)
          }, 0)
        }
      }
      
      // Get expected rent from invoices (due in this month)
      const { data: invoices, error: invoicesError } = await supabaseServer
        .from('RENT_invoices')
        .select('*')
        .gte('due_date', startOfMonth)
        .lte('due_date', endOfMonth)
      
      if (invoicesError) {
        console.error('Error fetching invoices:', invoicesError)
        console.error('Error details:', JSON.stringify(invoicesError, null, 2))
      } else {
        console.log('Successfully fetched', invoices?.length || 0, 'invoices')
        
        if (invoices && invoices.length > 0) {
          // Log first invoice to see structure
          console.log('Sample invoice structure:', JSON.stringify(invoices[0], null, 2))
          
          // Try different field name combinations for expected rent
          invoices.forEach((invoice: any) => {
            // Try amount_total first, then amount, then sum of amount_rent + amount_late + amount_other
            const expected = Number(invoice.amount_total) || 
                            Number(invoice.amount) || 
                            ((Number(invoice.amount_rent) || 0) + 
                             (Number(invoice.amount_late) || 0) + 
                             (Number(invoice.amount_other) || 0))
            expectedRent += expected
          })
        } else {
          console.log('No invoices found for date range:', startOfMonth, 'to', endOfMonth)
          // If no invoices, try to get expected rent from leases
          const { data: leases, error: leasesError } = await supabaseServer
            .from('RENT_leases')
            .select('rent, rent_cadence, lease_start_date, lease_end_date')
            .eq('status', 'active')
          
          if (!leasesError && leases) {
            // Calculate expected rent based on active leases and their cadence
            leases.forEach((lease: any) => {
              const leaseStart = new Date(lease.lease_start_date)
              const leaseEnd = lease.lease_end_date ? new Date(lease.lease_end_date) : new Date(endOfMonth)
              const monthStart = new Date(startOfMonth)
              const monthEnd = new Date(endOfMonth)
              
              // Only count if lease is active during this month
              if (leaseStart <= monthEnd && leaseEnd >= monthStart) {
                const rent = Number(lease.rent) || 0
                const cadence = lease.rent_cadence?.toLowerCase()
                
                // Approximate expected rent based on cadence
                if (cadence === 'monthly') {
                  expectedRent += rent
                } else if (cadence === 'biweekly') {
                  expectedRent += rent * 2 // Approximately 2 payments per month
                } else if (cadence === 'weekly') {
                  expectedRent += rent * 4 // Approximately 4 payments per month
                }
              }
            })
          }
        }
      }
    } catch (error) {
      console.error('Error fetching rent data:', error)
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack')
    }
    
    console.log('Rent collected:', rentCollected)
    console.log('Expected rent:', expectedRent)
    
    // Get one-time expenses for the month to calculate repairs, other expenses, and misc income
    const { data: oneTimeExpenses, error: oneTimeError } = await supabaseServer
      .from('RENT_expenses')
      .select('category, amount_owed, last_paid_date, mail_info')
      .eq('interest_rate', -9.9999) // One-time expenses are marked with -9.9999
      .gte('last_paid_date', startOfMonth)
      .lte('last_paid_date', endOfMonth)
    
    if (oneTimeError) {
      console.error('Error fetching one-time expenses:', oneTimeError)
    }
    
    console.log('One-time expenses found:', oneTimeExpenses?.length || 0)
    
    // Calculate other expenses (all one-time expenses)
    const otherExpenses = oneTimeExpenses
      ?.reduce((sum, expense) => sum + (Number(expense.amount_owed) || 0), 0) || 0
    
    // Get misc income from expenses with interest_rate = -888
    const { data: miscIncomeExpenses, error: miscIncomeError } = await supabaseServer
      .from('RENT_expenses')
      .select('amount_owed, last_paid_date')
      .eq('interest_rate', 9.9999) // Misc income is marked with 9.9999 (one-time expenses use -9.9999)
      .gte('last_paid_date', startOfMonth)
      .lte('last_paid_date', endOfMonth)
    
    if (miscIncomeError) {
      console.error('Error fetching misc income:', miscIncomeError)
    }
    
    console.log('Misc income expenses found:', miscIncomeExpenses?.length || 0)
    
    const miscIncome = miscIncomeExpenses
      ?.reduce((sum, expense) => sum + (Number(expense.amount_owed) || 0), 0) || 0
    
    const totalFixedExpenses = totalInsurance + totalTaxes + totalPayments
    const totalDebt = totalFixedExpenses + otherExpenses
    
    const totalIncome = rentCollected + miscIncome
    
    // Get property-level details for income and rent
    const propertyDetails: any[] = []
    
    try {
      // Get all properties
      const { data: allProperties, error: propsError } = await supabaseServer
        .from('RENT_properties')
        .select('id, name, address')
      
      if (!propsError && allProperties) {
        // Get payments grouped by property
        const { data: paymentsByProperty, error: paymentsError } = await supabaseServer
          .from('RENT_payments')
          .select('property_id, amount')
          .gte('payment_date', startOfMonth)
          .lte('payment_date', endOfMonth)
        
        // Get invoices with lease info to get property_id
        const { data: invoicesData, error: invoicesError } = await supabaseServer
          .from('RENT_invoices')
          .select(`
            id,
            lease_id,
            property_id,
            amount_total,
            amount,
            amount_rent,
            amount_late,
            amount_other,
            due_date
          `)
          .gte('due_date', startOfMonth)
          .lte('due_date', endOfMonth)
        
        // Get leases to map invoice lease_id to property_id
        const { data: leases, error: leasesError } = await supabaseServer
          .from('RENT_leases')
          .select('id, property_id')
        
        // Create a map of lease_id to property_id
        const leaseToPropertyMap = new Map<string, string>()
        leases?.forEach((lease: any) => {
          if (lease.property_id) {
            leaseToPropertyMap.set(lease.id, lease.property_id)
          }
        })
        
        // Map invoices to include property_id from lease
        const invoicesWithLeases = invoicesData?.map((inv: any) => ({
          ...inv,
          property_id: inv.property_id || leaseToPropertyMap.get(inv.lease_id) || null
        })) || []
        
        // Get misc income grouped by property
        const { data: miscIncomeByProperty, error: miscError } = await supabaseServer
          .from('RENT_expenses')
          .select('property_id, amount_owed')
          .eq('interest_rate', 9.9999)
          .gte('last_paid_date', startOfMonth)
          .lte('last_paid_date', endOfMonth)
        
        // Get active leases for this property to calculate expected rent if no invoices
        const { data: activeLeases, error: leasesError2 } = await supabaseServer
          .from('RENT_leases')
          .select('id, property_id, rent, rent_cadence, lease_start_date, lease_end_date')
          .eq('status', 'active')
        
        // Build property details
        console.log('Building property details. Total properties:', allProperties?.length || 0)
        console.log('Payments by property count:', paymentsByProperty?.length || 0)
        console.log('Invoices with leases count:', invoicesWithLeases?.length || 0)
        console.log('Misc income by property count:', miscIncomeByProperty?.length || 0)
        
        allProperties.forEach((property: any) => {
          const propertyPayments = paymentsByProperty?.filter((p: any) => p.property_id === property.id) || []
          // Get invoices for this property (check both direct property_id and through lease)
          const propertyInvoices = invoicesWithLeases?.filter((i: any) => 
            i.property_id === property.id
          ) || []
          const propertyMiscIncome = miscIncomeByProperty?.filter((m: any) => m.property_id === property.id) || []
          
          const rentCollectedForProperty = propertyPayments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0)
          
          let expectedRentForProperty = propertyInvoices.reduce((sum: number, inv: any) => {
            const expected = Number(inv.amount_total) || 
                            Number(inv.amount) || 
                            ((Number(inv.amount_rent) || 0) + 
                             (Number(inv.amount_late) || 0) + 
                             (Number(inv.amount_other) || 0))
            return sum + expected
          }, 0)
          
          // If no invoices, calculate from active leases for this property
          if (expectedRentForProperty === 0 && activeLeases) {
            const propertyLeases = activeLeases.filter((l: any) => l.property_id === property.id)
            propertyLeases.forEach((lease: any) => {
              const leaseStart = new Date(lease.lease_start_date)
              const leaseEnd = lease.lease_end_date ? new Date(lease.lease_end_date) : new Date(endOfMonth)
              const monthStart = new Date(startOfMonth)
              const monthEnd = new Date(endOfMonth)
              
              if (leaseStart <= monthEnd && leaseEnd >= monthStart) {
                const rent = Number(lease.rent) || 0
                const cadence = lease.rent_cadence?.toLowerCase()
                
                if (cadence === 'monthly') {
                  expectedRentForProperty += rent
                } else if (cadence === 'biweekly') {
                  expectedRentForProperty += rent * 2
                } else if (cadence === 'weekly') {
                  expectedRentForProperty += rent * 4
                }
              }
            })
          }
          
          const miscIncomeForProperty = propertyMiscIncome.reduce((sum: number, m: any) => sum + (Number(m.amount_owed) || 0), 0)
          
          // Include property if it has any activity (rent, expected rent, or misc income)
          if (rentCollectedForProperty > 0 || expectedRentForProperty > 0 || miscIncomeForProperty > 0) {
            propertyDetails.push({
              property_id: property.id,
              property_name: property.name,
              property_address: property.address,
              expected_rent: expectedRentForProperty,
              rent_collected: rentCollectedForProperty,
              misc_income: miscIncomeForProperty
            })
          }
        })
        
        console.log('Property details built. Count:', propertyDetails.length)
      }
    } catch (error) {
      console.error('Error fetching property details:', error)
    }
    
    // Collection rate as percentage (0-100)
    const collectionRatePercent = expectedRent > 0 ? (rentCollected / expectedRent) * 100 : 0
    // Collection rate as decimal (0-1) for gauge
    const collectionRate = expectedRent > 0 ? (rentCollected / expectedRent) : 0
    
    const metrics = {
      fixedExpenses: {
        insurance: Math.round(totalInsurance * 100) / 100,
        taxes: Math.round(totalTaxes * 100) / 100,
        totalPayments: Math.round(totalPayments * 100) / 100,
        total: Math.round(totalFixedExpenses * 100) / 100
      },
      oneTimeExpenseIncome: {
        expenses: {
          otherExpenses: Math.round(otherExpenses * 100) / 100
        },
        income: {
          miscIncome: Math.round(miscIncome * 100) / 100
        },
        totalIncome: Math.round(totalIncome * 100) / 100,
        totalDebt: Math.round(totalDebt * 100) / 100
      },
      propertyDetails: propertyDetails.map((p: any) => ({
        property_id: p.property_id,
        property_name: p.property_name,
        property_address: p.property_address,
        expected_rent: Math.round(p.expected_rent * 100) / 100,
        rent_collected: Math.round(p.rent_collected * 100) / 100,
        misc_income: Math.round(p.misc_income * 100) / 100
      })),
      rentCollection: {
        collected: Math.round(rentCollected * 100) / 100,
        expected: Math.round(expectedRent * 100) / 100,
        collectionRate: Math.round(collectionRatePercent * 100) / 100, // Percentage for display
        collectionRateDecimal: collectionRate // Decimal 0-1 for gauge
      }
    }
    
    console.log('Calculated metrics:', JSON.stringify(metrics, null, 2))
    console.log('Property details in response:', metrics.propertyDetails?.length || 0)
    
    return NextResponse.json(metrics)
  } catch (error) {
    console.error('Error in profit metrics API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch profit metrics', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
