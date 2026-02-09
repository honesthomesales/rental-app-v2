import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

// Cache profit metrics for 60 seconds - historical data doesn't change
export const revalidate = 60

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
      // Get payments for the month - ONLY payments linked to invoices
      const { data: payments, error: paymentsError } = await supabaseServer
        .from('RENT_payments')
        .select('amount, payment_date, payment_type')
        .not('invoice_id', 'is', null)  // Only include payments with invoice_id
        .gte('payment_date', startOfMonth)
        .lte('payment_date', endOfMonth)
      
      if (paymentsError) {
        console.error('Error fetching payments:', paymentsError)
      } else {
        console.log('Successfully fetched', payments?.length || 0, 'payments')
        
        if (payments && payments.length > 0) {
          // Sum all payments as rent collected - EXACT same calculation as payments page
          // Only payments with invoice_id are included (matching payments page logic)
          rentCollected = payments.reduce((sum, payment: any) => {
            return sum + (parseFloat(payment.amount) || 0)
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
            .in('status', ['occupied', 'active'])
          
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
                  
                  // Calculate monthly equivalent based on cadence
                  if (cadence === 'monthly') {
                    expectedRent += rent
                  } else if (cadence === 'biweekly') {
                    expectedRent += (rent * 26) / 12 // 26 payments per year / 12 months
                  } else if (cadence === 'weekly') {
                    expectedRent += (rent * 52) / 12 // 52 payments per year / 12 months
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
        // OPTIMIZED: Fetch all data in parallel
        const [paymentsResult, invoicesResult, leasesResult, miscIncomeResult] = await Promise.all([
          supabaseServer
            .from('RENT_payments')
            .select('property_id, amount')
            .not('invoice_id', 'is', null)  // Only include payments with invoice_id
            .gte('payment_date', startOfMonth)
            .lte('payment_date', endOfMonth),
          supabaseServer
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
            .lte('due_date', endOfMonth),
          supabaseServer
            .from('RENT_leases')
            .select('id, property_id, rent, rent_cadence, lease_start_date, lease_end_date, status'),
          supabaseServer
            .from('RENT_expenses')
            .select('property_id, amount_owed')
            .eq('interest_rate', 9.9999)
            .gte('last_paid_date', startOfMonth)
            .lte('last_paid_date', endOfMonth)
        ])

        const { data: paymentsByProperty, error: paymentsError } = paymentsResult
        const { data: invoicesData, error: invoicesError } = invoicesResult
        const { data: allLeases, error: leasesError } = leasesResult
        const { data: miscIncomeByProperty, error: miscError } = miscIncomeResult

        if (paymentsError) {
          console.error('Error fetching payments:', paymentsError)
        }
        if (invoicesError) {
          console.error('Error fetching invoices:', invoicesError)
        }
        if (leasesError) {
          console.error('Error fetching leases:', leasesError)
        }
        if (miscError) {
          console.error('Error fetching misc income:', miscError)
        }

        if (allLeases) {
          // Create a map of lease_id to property_id for invoice mapping
          const leaseToPropertyMap = new Map<string, string>()
          allLeases.forEach((lease: any) => {
            if (lease.property_id) {
              leaseToPropertyMap.set(lease.id, lease.property_id)
            }
          })
          
          // Map invoices to include property_id from lease
          const invoicesWithLeases = invoicesData?.map((inv: any) => ({
            ...inv,
            property_id: inv.property_id || leaseToPropertyMap.get(inv.lease_id) || null
          })) || []
          
          // Filter active leases for expected rent calculation
          const activeLeases = allLeases.filter((l: any) => l.status === 'occupied' || l.status === 'active')
        
          // OPTIMIZED: Use Maps for O(1) lookups instead of filtering arrays
          const paymentsByPropertyMap = new Map<string, number>()
          paymentsByProperty?.forEach((p: any) => {
            const propId = p.property_id || 'no-property'
            // Use parseFloat to match payments page calculation exactly
            paymentsByPropertyMap.set(propId, (paymentsByPropertyMap.get(propId) || 0) + (parseFloat(p.amount) || 0))
          })
          
          const invoicesByPropertyMap = new Map<string, number>()
          invoicesWithLeases?.forEach((inv: any) => {
            const propId = inv.property_id || 'no-property'
            const expected = Number(inv.amount_total) || 
                            Number(inv.amount) || 
                            ((Number(inv.amount_rent) || 0) + 
                             (Number(inv.amount_late) || 0) + 
                             (Number(inv.amount_other) || 0))
            invoicesByPropertyMap.set(propId, (invoicesByPropertyMap.get(propId) || 0) + expected)
          })
          
          const miscIncomeByPropertyMap = new Map<string, number>()
          miscIncomeByProperty?.forEach((m: any) => {
            const propId = m.property_id || 'no-property'
            miscIncomeByPropertyMap.set(propId, (miscIncomeByPropertyMap.get(propId) || 0) + (Number(m.amount_owed) || 0))
          })
          
          // Build property details using efficient Map lookups
          console.log('Building property details. Total properties:', allProperties?.length || 0)
          console.log('Payments by property count:', paymentsByProperty?.length || 0)
          console.log('Invoices with leases count:', invoicesWithLeases?.length || 0)
          console.log('Misc income by property count:', miscIncomeByProperty?.length || 0)
          
          allProperties.forEach((property: any) => {
            const rentCollectedForProperty = paymentsByPropertyMap.get(property.id) || 0
            let expectedRentForProperty = invoicesByPropertyMap.get(property.id) || 0
            const miscIncomeForProperty = miscIncomeByPropertyMap.get(property.id) || 0
            
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
                  
                  // Calculate monthly equivalent based on cadence
                  if (cadence === 'monthly') {
                    expectedRentForProperty += rent
                  } else if (cadence === 'biweekly') {
                    expectedRentForProperty += (rent * 26) / 12 // 26 payments per year / 12 months
                  } else if (cadence === 'weekly') {
                    expectedRentForProperty += (rent * 52) / 12 // 52 payments per year / 12 months
                  }
                }
              })
            }
            
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
      }
    } catch (error) {
      console.error('Error fetching property details:', error)
    }
    
    // Collection rate as percentage (0-100)
    const collectionRatePercent = expectedRent > 0 ? (rentCollected / expectedRent) * 100 : 0
    // Collection rate as decimal (0-1) for gauge
    const collectionRate = expectedRent > 0 ? (rentCollected / expectedRent) : 0
    
    // Calculate average profit for previous 12 months
    let averageProfit12Months = 0
    try {
      const profitAmounts: number[] = []
      const currentMonth = new Date(year, monthNum, 1)
      
      // Calculate profit for each of the previous 12 months
      for (let i = 1; i <= 12; i++) {
        const pastMonth = new Date(currentMonth)
        pastMonth.setMonth(pastMonth.getMonth() - i)
        const pastMonthStr = `${pastMonth.getFullYear()}-${String(pastMonth.getMonth() + 1).padStart(2, '0')}`
        
        const pastStartOfMonth = `${pastMonthStr}-01`
        const pastYear = pastMonth.getFullYear()
        const pastMonthNum = pastMonth.getMonth()
        const pastEndOfMonth = new Date(pastYear, pastMonthNum + 1, 0).toISOString().slice(0, 10)
        
        // Fetch payments for that month
        const { data: pastPayments } = await supabaseServer
          .from('RENT_payments')
          .select('amount')
          .not('invoice_id', 'is', null)
          .gte('payment_date', pastStartOfMonth)
          .lte('payment_date', pastEndOfMonth)
        
        // Use parseFloat to match payments page calculation exactly
        const pastRentCollected = pastPayments?.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0) || 0
        
        // Fetch misc income for that month
        const { data: pastMiscIncome } = await supabaseServer
          .from('RENT_expenses')
          .select('amount_owed')
          .eq('interest_rate', 9.9999)
          .gte('last_paid_date', pastStartOfMonth)
          .lte('last_paid_date', pastEndOfMonth)
        
        const pastMiscIncomeAmount = pastMiscIncome?.reduce((sum, e) => sum + (Number(e.amount_owed) || 0), 0) || 0
        
        // Fetch one-time expenses for that month
        const { data: pastOneTimeExpenses } = await supabaseServer
          .from('RENT_expenses')
          .select('amount_owed')
          .eq('interest_rate', -9.9999)
          .gte('last_paid_date', pastStartOfMonth)
          .lte('last_paid_date', pastEndOfMonth)
        
        const pastOtherExpenses = pastOneTimeExpenses?.reduce((sum, e) => sum + (Number(e.amount_owed) || 0), 0) || 0
        
        // Calculate profit for that month (income - expenses)
        const pastTotalIncome = pastRentCollected + pastMiscIncomeAmount
        const pastTotalExpenses = totalInsurance + totalTaxes + totalPayments + pastOtherExpenses
        const pastProfit = pastTotalIncome - pastTotalExpenses
        
        profitAmounts.push(pastProfit)
      }
      
      // Calculate average
      if (profitAmounts.length > 0) {
        averageProfit12Months = profitAmounts.reduce((sum, p) => sum + p, 0) / profitAmounts.length
      }
    } catch (error) {
      console.error('Error calculating average profit:', error)
      // Continue with 0 if calculation fails
    }
    
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
      },
      averageProfit12Months: Math.round(averageProfit12Months * 100) / 100
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
