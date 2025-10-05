import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { createPaymentMaps, getPaymentsForLease } from '@/lib/rent/paymentBucket'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const month = searchParams.get('month') || new Date().toISOString().slice(0, 7) // YYYY-MM format
    
    console.log('Fetching profit metrics for month:', month)
    
    // Get start and end of month
    const startOfMonth = `${month}-01`
    const endOfMonth = new Date(new Date(startOfMonth).getFullYear(), new Date(startOfMonth).getMonth() + 1, 0)
      .toISOString().slice(0, 10)
    
    console.log('Date range:', startOfMonth, 'to', endOfMonth)
    
    // Fetch rent payments for the month using the same approach as payments grid
    const { data: payments, error: paymentsError } = await supabaseServer
      .from('RENT_payments')
      .select('*')
      .gte('payment_date', startOfMonth)
      .lte('payment_date', endOfMonth)
    
    if (paymentsError) {
      console.error('Error fetching payments:', paymentsError)
      throw paymentsError
    }
    
    console.log('Payments found:', payments?.length || 0)
    console.log('Sample payment:', payments?.[0])
    console.log('Payment types found:', payments?.map(p => p.payment_type))
    
    // Fetch all properties for insurance and tax calculations
    const { data: properties, error: propertiesError } = await supabaseServer
      .from('RENT_properties')
      .select('*')
    
    if (propertiesError) {
      console.error('Error fetching properties:', propertiesError)
      throw propertiesError
    }
    
    console.log('Properties found:', properties?.length || 0)
    
    // Use the same payment processing approach as payments grid
    const paymentMaps = createPaymentMaps(payments || [])
    
    // Calculate totals using consistent approach
    const rentCollected = payments
      ?.filter(p => p.payment_type?.toLowerCase().includes('rent'))
      ?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0
    
    const miscIncome = payments
      ?.filter(p => !p.payment_type?.toLowerCase().includes('rent'))
      ?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0
    
    console.log('Rent payments found:', payments?.filter(p => p.payment_type?.toLowerCase().includes('rent')).length)
    console.log('Rent collected calculated:', rentCollected)
    console.log('Misc income calculated:', miscIncome)
    console.log('All payment amounts:', payments?.map(p => ({ 
      type: p.payment_type, 
      amount: p.amount, 
      amountType: typeof p.amount,
      date: p.payment_date 
    })))
    
    
    const totalIncome = rentCollected + miscIncome
    
    // Calculate monthly insurance (annual premium / 12)
    const monthlyInsurance = properties
      ?.reduce((sum, p) => sum + ((Number(p.insurance_premium) || 0) / 12), 0) || 0
    
    // Calculate monthly taxes (annual tax / 12)
    const monthlyTaxes = properties
      ?.reduce((sum, p) => sum + ((Number(p.property_tax) || 0) / 12), 0) || 0
    
    // For now, set repairs and other expenses to 0 (would need expense tracking table)
    const repairs = 0
    const otherExpenses = 0
    const totalPayments = 0 // Would need debt/payment tracking
    
    const totalFixedExpenses = monthlyInsurance + monthlyTaxes + totalPayments
    const totalDebt = totalFixedExpenses + repairs + otherExpenses
    
    // Calculate expected rent using the same approach as payments grid
    const { data: activeLeases, error: leasesError } = await supabaseServer
      .from('RENT_leases')
      .select(`
        *,
        RENT_properties(*),
        RENT_tenants(*)
      `)
      .eq('status', 'active')
      .lte('lease_start_date', endOfMonth)
      .or(`lease_end_date.is.null,lease_end_date.gte.${startOfMonth}`)
    
    if (leasesError) {
      console.error('Error fetching leases:', leasesError)
    }
    
    const expectedRent = activeLeases
      ?.reduce((sum, lease) => {
        const rent = Number(lease.rent) || 0
        // Convert to monthly amount based on cadence
        if (lease.rent_cadence?.toLowerCase() === 'weekly') {
          return sum + (rent * 4.33) // Average weeks per month
        } else if (lease.rent_cadence?.toLowerCase().includes('bi')) {
          return sum + (rent * 2.17) // Average bi-weekly periods per month
        } else {
          return sum + rent // Monthly
        }
      }, 0) || 0
    
    console.log('Active leases found:', activeLeases?.length || 0)
    console.log('Expected rent calculated:', expectedRent)
    
    // Also check if we can match any payments to leases using the utility functions
    if (activeLeases && activeLeases.length > 0) {
      const sampleLease = activeLeases[0]
      const leasePayments = getPaymentsForLease(sampleLease, paymentMaps)
      console.log('Sample lease payments using utility:', {
        leaseId: sampleLease.id,
        property: sampleLease.RENT_properties?.name,
        paymentCount: leasePayments.length,
        totalAmount: leasePayments.reduce((sum, p) => sum + (p.amount || 0), 0)
      })
    }
    
    const collectionRate = expectedRent > 0 ? (rentCollected / expectedRent) * 100 : 0
    
    const metrics = {
      fixedExpenses: {
        insurance: Math.round(monthlyInsurance * 100) / 100,
        taxes: Math.round(monthlyTaxes * 100) / 100,
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
