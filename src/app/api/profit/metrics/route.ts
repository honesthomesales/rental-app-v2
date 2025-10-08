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
    
    // Get invoices for rent calculation using the same approach as payments page
    let rentCollected = 0
    let expectedRent = 0
    
    try {
      const invoicesResponse = await fetch(
        `http://localhost:3000/api/invoices?from=${startOfMonth}&to=${endOfMonth}`
      )
      
      if (invoicesResponse.ok) {
        const invoices = await invoicesResponse.json()
        console.log('Successfully fetched', invoices?.length || 0, 'invoices from API')
        
        if (invoices && invoices.length > 0) {
          // Calculate rent collected from paid invoices
          rentCollected = invoices
            .filter(invoice => Number(invoice.amount_paid) > 0)
            .reduce((sum, invoice) => sum + Number(invoice.amount_paid), 0)
          
          // Calculate expected rent from all invoices
          expectedRent = invoices
            .reduce((sum, invoice) => sum + Number(invoice.amount_rent), 0)
        }
      } else {
        console.error('Failed to fetch invoices from API:', invoicesResponse.status, invoicesResponse.statusText)
      }
    } catch (error) {
      console.error('Error fetching invoices from API:', error)
    }
    
    console.log('Rent collected:', rentCollected)
    console.log('Expected rent:', expectedRent)
    
    // For now, set repairs and other expenses to 0 (would need expense tracking table)
    const repairs = 0
    const otherExpenses = 0
    const miscIncome = 0 // Would need to track non-rent income separately
    
    const totalFixedExpenses = totalInsurance + totalTaxes + totalPayments
    const totalDebt = totalFixedExpenses + repairs + otherExpenses
    
    const totalIncome = rentCollected + miscIncome
    
    const collectionRate = expectedRent > 0 ? (rentCollected / expectedRent) * 100 : 0
    
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
        collectionRate: Math.round(collectionRate * 100) / 100
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
