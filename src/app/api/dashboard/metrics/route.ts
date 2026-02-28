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

    // Fetch occupied properties (properties with active leases)
    // Match Payments page logic: filter by status only, no date range check
    const currentDate = new Date().toISOString().split('T')[0]
    const today = currentDate
    
    // OPTIMIZED: Fetch occupied leases once with all needed data
    // Handle both new status ('occupied') and legacy status ('active'), plus 'sold'
    // Match Payments page: filter by status only, no date range
    const { data: activeLeases, error: leasesError } = await supabaseServer
      .from('RENT_leases')
      .select('id, property_id, lease_start_date, lease_end_date, rent, rent_cadence')
      .in('status', ['occupied', 'active', 'sold'])

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

    // Fetch late payments by recalculating balance from actual RENT_payments
    // (matches Payments page logic instead of trusting stored balance_due)
    let latePayments = 0
    let totalOwed = 0

    if (activeLeases && activeLeases.length > 0) {
      const leaseIds = activeLeases.map(lease => lease.id)
      const leaseStartDates = new Map(activeLeases.map(lease => [lease.id, lease.lease_start_date]))
      
      // Fetch OPEN invoices and all payments for these leases in parallel
      const [invoicesResult, paymentsResult] = await Promise.all([
        supabaseServer
          .from('RENT_invoices')
          .select('id, lease_id, due_date, amount_total, status')
          .in('lease_id', leaseIds)
          .eq('status', 'OPEN')
          .lte('due_date', today),
        supabaseServer
          .from('RENT_payments')
          .select('invoice_id, amount')
          .in('lease_id', leaseIds)
          .not('invoice_id', 'is', null)
      ])

      if (invoicesResult.error) {
        console.error('Error fetching unpaid invoices:', invoicesResult.error)
      } else if (invoicesResult.data && invoicesResult.data.length > 0) {
        // Group payments by invoice_id to recalculate actual paid amounts
        const paymentsByInvoice = new Map<string, number>()
        if (paymentsResult.data) {
          paymentsResult.data.forEach((p: any) => {
            if (p.invoice_id) {
              paymentsByInvoice.set(
                p.invoice_id,
                (paymentsByInvoice.get(p.invoice_id) || 0) + (parseFloat(p.amount) || 0)
              )
            }
          })
        }

        // Filter to valid invoices and recalculate balance_due from payments
        const validInvoices = invoicesResult.data
          .filter(inv => {
            const leaseStartDate = leaseStartDates.get(inv.lease_id)
            return leaseStartDate && inv.due_date >= leaseStartDate
          })
          .map(inv => {
            const actualPaid = paymentsByInvoice.get(inv.id) || 0
            const amountTotal = parseFloat(inv.amount_total as any || 0)
            return { ...inv, recalculated_balance: amountTotal - actualPaid }
          })
          .filter(inv => inv.recalculated_balance > 0)

        latePayments = validInvoices.length
        totalOwed = validInvoices.reduce((sum, inv) => sum + inv.recalculated_balance, 0)

        console.log(`Found ${latePayments} late invoices and $${totalOwed.toFixed(2)} total owed across ${activeLeases.length} active leases (recalculated from payments)`)
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

    // Calculate total debt (same as profit page)
    // Total debt = totalFixedExpenses + otherExpenses
    // totalFixedExpenses = totalInsurance + totalTaxes + totalPayments
    // Note: Insurance and taxes are annual, so we use them as-is (they represent monthly equivalent)
    const totalInsurance = allProperties
      ?.reduce((sum, p) => sum + (Number(p.insurance_premium) || 0), 0) || 0
    
    const totalTaxes = allProperties
      ?.reduce((sum, p) => sum + (Number(p.property_tax) || 0), 0) || 0
    
    // Get total payments from expenses table (all expenses, not filtered by month)
    const { data: expenses, error: expensesError } = await supabaseServer
      .from('RENT_expenses')
      .select('amount, interest_rate')
    
    if (expensesError) {
      console.error('Error fetching expenses for debt calculation:', expensesError)
    }
    
    const totalPayments = expenses
      ?.filter(exp => exp.interest_rate !== -9.9999) // Exclude one-time expenses
      .reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0) || 0
    
    const totalFixedExpenses = totalInsurance + totalTaxes + totalPayments
    
    // Get one-time expenses (interest_rate = -9.9999) - these are otherExpenses
    // For dashboard, we'll use all one-time expenses (not filtered by month like profit page)
    // This gives us a total debt picture
    const otherExpenses = expenses
      ?.filter(exp => exp.interest_rate === -9.9999)
      .reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0) || 0
    
    const totalDebt = totalFixedExpenses + otherExpenses

    // Calculate profit
    // Current profit = monthly income - total debt
    // Potential profit = (monthly income + potential income) - total debt
    const currentProfit = monthlyIncome - totalDebt
    const potentialProfit = (monthlyIncome + potentialIncome) - totalDebt
    
    console.log('Debt calculation:', {
      totalInsurance,
      totalTaxes,
      totalPayments,
      totalFixedExpenses,
      otherExpenses,
      totalDebt,
      monthlyIncome,
      potentialIncome,
      currentProfit,
      potentialProfit
    })

    const metrics = {
      totalProperties: allProperties?.length || 0,
      occupiedProperties,
      monthlyIncome,
      potentialIncome,
      totalPotentialIncome: monthlyIncome + potentialIncome,
      latePayments,
      totalOwed,
      propertyTypeBreakdown,
      totalDebt,
      currentProfit,
      potentialProfit
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
