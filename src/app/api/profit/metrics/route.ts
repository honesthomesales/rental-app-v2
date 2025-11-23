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
    
    // Get invoices for rent calculation directly from Supabase
    // First try to get all fields to see what's available
    let rentCollected = 0
    let expectedRent = 0
    
    try {
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
          
          // Try different field name combinations
          // The table might use: amount, amount_paid, amount_total, or amount_rent, amount_late, amount_other
          invoices.forEach((invoice: any) => {
            // For rent collected, use amount_paid if available, otherwise 0
            const paid = Number(invoice.amount_paid) || 0
            rentCollected += paid
            
            // For expected rent, try amount_total first, then amount, then sum of amount_rent + amount_late + amount_other
            const expected = Number(invoice.amount_total) || 
                            Number(invoice.amount) || 
                            ((Number(invoice.amount_rent) || 0) + 
                             (Number(invoice.amount_late) || 0) + 
                             (Number(invoice.amount_other) || 0))
            expectedRent += expected
          })
        } else {
          console.log('No invoices found for date range:', startOfMonth, 'to', endOfMonth)
        }
      }
    } catch (error) {
      console.error('Error fetching invoices:', error)
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
    
    // Calculate repairs (one-time expenses with category containing "repair" or "maintenance")
    const repairs = oneTimeExpenses
      ?.filter(expense => {
        const category = (expense.category || '').toLowerCase()
        const description = (expense.mail_info || '').toLowerCase()
        return category.includes('repair') || 
               category.includes('maintenance') || 
               description.includes('repair') || 
               description.includes('maintenance')
      })
      .reduce((sum, expense) => sum + (Number(expense.amount_owed) || 0), 0) || 0
    
    // Calculate other expenses (one-time expenses that aren't repairs)
    const otherExpenses = oneTimeExpenses
      ?.filter(expense => {
        const category = (expense.category || '').toLowerCase()
        const description = (expense.mail_info || '').toLowerCase()
        return !(category.includes('repair') || 
                 category.includes('maintenance') || 
                 description.includes('repair') || 
                 description.includes('maintenance'))
      })
      .reduce((sum, expense) => sum + (Number(expense.amount_owed) || 0), 0) || 0
    
    // Misc Income: For now, we'll need to identify income vs expenses
    // One-time expenses with positive amounts could be income if they're not expenses
    // For now, set to 0 - this would need a flag or category to distinguish income from expenses
    const miscIncome = 0
    
    const totalFixedExpenses = totalInsurance + totalTaxes + totalPayments
    const totalDebt = totalFixedExpenses + repairs + otherExpenses
    
    const totalIncome = rentCollected + miscIncome
    
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
          repairs: Math.round(repairs * 100) / 100,
          otherExpenses: Math.round(otherExpenses * 100) / 100
        },
        income: {
          miscIncome: Math.round(miscIncome * 100) / 100,
          rentCollected: Math.round(rentCollected * 100) / 100
        },
        totalIncome: Math.round(totalIncome * 100) / 100,
        totalDebt: Math.round(totalDebt * 100) / 100
      },
      rentCollection: {
        collected: Math.round(rentCollected * 100) / 100,
        expected: Math.round(expectedRent * 100) / 100,
        collectionRate: Math.round(collectionRatePercent * 100) / 100, // Percentage for display
        collectionRateDecimal: collectionRate // Decimal 0-1 for gauge
      }
    }
    
    console.log('Calculated metrics:', metrics)
    
    return NextResponse.json(metrics)
  } catch (error) {
    console.error('Error in profit metrics API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch profit metrics', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
