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
    
    // Fetch all leases to identify properties with "sold" status (matching dashboard)
    const { data: allLeases, error: allLeasesError } = await supabaseServer
      .from('RENT_leases')
      .select('id, property_id, status')

    if (allLeasesError) {
      console.error('Error fetching all leases:', allLeasesError)
    }

    // Create a set of property IDs that have "sold" status leases
    const soldPropertyIds = new Set(
      allLeases
        ?.filter(lease => lease.status === 'sold')
        .map(lease => lease.property_id)
    )

    // Filter out properties with "sold" status leases and "other" property type (matching dashboard)
    const validProperties = properties?.filter(
      property => !soldPropertyIds.has(property.id) && property.property_type !== 'other'
    ) || []
    
    // Calculate total insurance (annual premium, not divided by 12)
    // Use all properties that are NOT sold (exclude sold properties only)
    const nonSoldProperties = properties?.filter(
      property => !soldPropertyIds.has(property.id)
    ) || []
    
    const totalInsurance = nonSoldProperties
      ?.reduce((sum, p) => sum + (Number(p.insurance_premium) || 0), 0) || 0
    
    // Calculate total taxes (annual tax, not divided by 12)
    // Use all properties that are NOT sold (exclude sold properties only)
    const totalTaxes = nonSoldProperties
      ?.reduce((sum, p) => sum + (Number(p.property_tax) || 0), 0) || 0
    
    console.log('Total insurance:', totalInsurance)
    console.log('Total taxes:', totalTaxes)
    
    // Total payments: match Expenses page regular-expense totals (footer "Amount Owed" column).
    // Same rules: exclude one-time rows (interest_rate === -9.9999); sum amount_owed (not amount).
    const { data: expenses, error: expensesError } = await supabaseServer
      .from('RENT_expenses')
      .select('amount, amount_owed, balance, interest_rate')
    
    if (expensesError) {
      console.error('Error fetching expenses:', expensesError)
      throw expensesError
    }

    const recurringExpenses = expenses?.filter(
      (expense) => expense.interest_rate !== -9.9999
    ) || []

    const totalPayments = recurringExpenses.reduce(
      (sum, expense) => sum + (Number(expense.amount_owed) || 0),
      0
    )

    // Potential payments: same basis as totalPayments, exclude rows with balance > 0
    const potentialPayments = recurringExpenses
      .filter((expense) => (Number(expense.balance) || 0) <= 0)
      .reduce((sum, expense) => sum + (Number(expense.amount_owed) || 0), 0)
    
    console.log('Expenses found:', expenses?.length || 0)
    console.log('Total payments from expenses:', totalPayments)
    console.log('Potential payments (excluding balance > 0):', potentialPayments)
    
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
      
      // Calculate expected rent from active leases (matching dashboard logic exactly)
      // Match Payments page logic: filter by status only, no date range check
      // Only include 'occupied' status (exclude 'sold' for money calculations)
      const { data: leases, error: leasesError } = await supabaseServer
        .from('RENT_leases')
        .select('rent, rent_cadence')
        .in('status', ['occupied'])
      
      if (!leasesError && leases) {
        // Calculate expected rent based on active leases and their cadence
        // Match Dashboard logic EXACTLY: weekly * 4, biweekly * 2, monthly * 1
        leases.forEach((lease: any) => {
          const rent = Number(lease.rent) || 0
          const cadence = lease.rent_cadence?.toLowerCase() || 'monthly'
          
          // Match dashboard calculation exactly
          switch (cadence) {
            case 'weekly':
              expectedRent += rent * 4 // Weekly rent * 4 weeks per month
              break
            case 'bi-weekly':
            case 'biweekly':
              expectedRent += rent * 2 // Bi-weekly rent * 2 periods per month
              break
            case 'monthly':
            default:
              expectedRent += rent // Monthly rent as-is
              break
          }
        })
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
    const potentialFixedExpenses = totalInsurance + totalTaxes + potentialPayments
    const totalDebt = totalFixedExpenses + otherExpenses
    const potentialDebt = potentialFixedExpenses + otherExpenses
    
    const totalIncome = rentCollected + miscIncome
    
    // Get property-level details for income and rent
    const propertyDetails: any[] = []
    
    try {
      // Use validProperties (already filtered to exclude sold and other type)
      // This ensures we only show properties that match dashboard logic
      if (validProperties && validProperties.length > 0) {
        // OPTIMIZED: Fetch all data in parallel
        const [paymentsResult, invoicesResult, leasesResult, miscIncomeResult] = await Promise.all([
          supabaseServer
            .from('RENT_payments')
            .select('property_id, lease_id, tenant_id, invoice_id, amount')
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
          
          // Filter leases with tenants for expected rent calculation
          // Only include 'occupied' status (exclude 'sold' for money calculations)
          const activeLeases = allLeases.filter((l: any) => l.status === 'occupied')
        
          // Map invoice_id -> property_id (payments page attributes via lease, not payment.property_id alone)
          const invoiceToPropertyMap = new Map<string, string>()
          invoicesWithLeases.forEach((inv: any) => {
            if (inv.id && inv.property_id) {
              invoiceToPropertyMap.set(inv.id, inv.property_id)
            }
          })

          const resolvePaymentPropertyId = (payment: {
            property_id?: string | null
            lease_id?: string | null
            tenant_id?: string | null
            invoice_id?: string | null
          }): string | null => {
            if (payment.property_id) return payment.property_id
            if (payment.lease_id) {
              const fromLease = leaseToPropertyMap.get(payment.lease_id)
              if (fromLease) return fromLease
            }
            if (payment.invoice_id) {
              const fromInvoice = invoiceToPropertyMap.get(payment.invoice_id)
              if (fromInvoice) return fromInvoice
            }
            return null
          }

          // OPTIMIZED: Use Maps for O(1) lookups instead of filtering arrays
          const paymentsByPropertyMap = new Map<string, number>()
          paymentsByProperty?.forEach((p: any) => {
            const propId = resolvePaymentPropertyId(p)
            if (!propId) return
            paymentsByPropertyMap.set(
              propId,
              (paymentsByPropertyMap.get(propId) || 0) + (parseFloat(p.amount) || 0)
            )
          })
          
          // Don't use invoices for expected rent - calculate from leases instead (matching dashboard)
          // This ensures we match the dashboard calculation exactly
          const invoicesByPropertyMap = new Map<string, number>()
          
          const miscIncomeByPropertyMap = new Map<string, number>()
          miscIncomeByProperty?.forEach((m: any) => {
            const propId = m.property_id || 'no-property'
            miscIncomeByPropertyMap.set(propId, (miscIncomeByPropertyMap.get(propId) || 0) + (Number(m.amount_owed) || 0))
          })
          
          // Build property details using efficient Map lookups
          // Calculate expected rent from active leases (matching dashboard logic exactly)
          console.log('Building property details. Total valid properties:', validProperties?.length || 0)
          console.log('Payments by property count:', paymentsByProperty?.length || 0)
          console.log('Misc income by property count:', miscIncomeByProperty?.length || 0)
          
          validProperties.forEach((property: any) => {
            const rentCollectedForProperty = paymentsByPropertyMap.get(property.id) || 0
            let expectedRentForProperty = 0
            const miscIncomeForProperty = miscIncomeByPropertyMap.get(property.id) || 0
            
            // Calculate expected rent from active leases for this property (matching dashboard logic)
            if (activeLeases) {
              const propertyLeases = activeLeases.filter((l: any) => l.property_id === property.id)
              propertyLeases.forEach((lease: any) => {
                const leaseStart = new Date(lease.lease_start_date)
                const leaseEnd = lease.lease_end_date ? new Date(lease.lease_end_date) : new Date(endOfMonth)
                const monthStart = new Date(startOfMonth)
                const monthEnd = new Date(endOfMonth)
                
                // Only include if lease is active during this month
                if (leaseStart <= monthEnd && leaseEnd >= monthStart) {
                  const rent = Number(lease.rent) || 0
                  const cadence = lease.rent_cadence?.toLowerCase() || 'monthly'
                  
                  // Match dashboard calculation exactly
                  switch (cadence) {
                    case 'weekly':
                      expectedRentForProperty += rent * 4 // Weekly rent * 4 weeks per month
                      break
                    case 'bi-weekly':
                    case 'biweekly':
                      expectedRentForProperty += rent * 2 // Bi-weekly rent * 2 periods per month
                      break
                    case 'monthly':
                    default:
                      expectedRentForProperty += rent // Monthly rent as-is
                      break
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
    
    // Calculate potential profit if House Debt is paid (expenses with balance > 0 reduced to zero)
    const potentialProfit = totalIncome - potentialDebt
    
    const metrics = {
      fixedExpenses: {
        insurance: Math.round(totalInsurance * 100) / 100,
        taxes: Math.round(totalTaxes * 100) / 100,
        totalPayments: Math.round(totalPayments * 100) / 100,
        total: Math.round(totalFixedExpenses * 100) / 100,
        potential: Math.round(potentialFixedExpenses * 100) / 100
      },
      oneTimeExpenseIncome: {
        expenses: {
          otherExpenses: Math.round(otherExpenses * 100) / 100
        },
        income: {
          miscIncome: Math.round(miscIncome * 100) / 100
        },
        totalIncome: Math.round(totalIncome * 100) / 100,
        totalDebt: Math.round(totalDebt * 100) / 100,
        potentialDebt: Math.round(potentialDebt * 100) / 100
      },
      potentialProfit: Math.round(potentialProfit * 100) / 100,
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
