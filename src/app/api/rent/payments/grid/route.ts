import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { generateFridayColumns, generatePeriodsForLease } from '@/lib/rent/periods'
import { bucketPaymentsForPeriod, createPaymentMaps, getPaymentsForLease, bucketMonthlyPayments } from '@/lib/rent/paymentBucket'
import { toUTC, debug, ymdKey } from '@/lib/dateSafe'
import { normalizeCadence } from '@/lib/rent/cadence'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const weekOffset = parseInt(searchParams.get('weekOffset') || '0')
    
    // Accept rangeStart/rangeEnd or default to current "4 weeks before/after" logic
    const rangeStart = searchParams.get('rangeStart')
    const rangeEnd = searchParams.get('rangeEnd')
    
    let startDate: string
    let endDate: string
    
    if (rangeStart && rangeEnd) {
      startDate = rangeStart
      endDate = rangeEnd
    } else {
      // Default logic: 4 weeks before/after based on weekOffset
      const today = new Date()
      const currentDay = today.getDay()
      const daysToFriday = (5 - currentDay + 7) % 7
      const currentFriday = new Date(today)
      currentFriday.setDate(today.getDate() + daysToFriday)
      
      const adjustedFriday = new Date(currentFriday)
      adjustedFriday.setDate(currentFriday.getDate() + (weekOffset * 4 * 7))
      
      const startFriday = new Date(adjustedFriday)
      startFriday.setDate(adjustedFriday.getDate() - (4 * 7))
      
      const endFriday = new Date(adjustedFriday)
      endFriday.setDate(adjustedFriday.getDate() + (4 * 7))
      
      startDate = startFriday.toISOString().split('T')[0]
      endDate = endFriday.toISOString().split('T')[0]
    }
    
    console.log('Date range:', { startDate, endDate })

    // Generate Friday columns for the date range
    const fridays = generateFridayColumns(startDate, endDate)
    console.log('Generated Fridays:', fridays)

    // Fetch active leases with property and tenant data (with retry logic)
    let leases: any[] = [];
    let leasesError: any = null;
    let retryCount = 0;
    const maxRetries = 2;
    
    while (retryCount <= maxRetries) {
      try {
        const result = await supabaseServer
          .from('RENT_leases')
          .select(`
            *,
            RENT_properties(*),
            RENT_tenants(*)
          `)
          .eq('status', 'active')
          .lte('lease_start_date', endDate)
          .or(`lease_end_date.is.null,lease_end_date.gte.${startDate}`)
        
        leases = result.data || [];
        leasesError = result.error;
        break;
      } catch (err) {
        retryCount++;
        if (retryCount > maxRetries) {
          leasesError = { message: `Network error after ${maxRetries} retries: ${err}` };
        } else {
          console.log(`Retry ${retryCount}/${maxRetries} for leases fetch...`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        }
      }
    }

    if (leasesError) {
      throw new Error(`Error fetching leases: ${leasesError.message}`)
    }

    console.log('Found active leases:', leases?.length || 0)
    
    // Debug: Show all lease cadences
    if (process.env.NEXT_PUBLIC_DEBUG_PAYMENTS === 'true') {
      console.log('Lease cadences found:', leases?.map(l => ({
        id: l.id,
        cadence: l.rent_cadence,
        normalized: normalizeCadence(l.rent_cadence),
        start: l.lease_start_date,
        end: l.lease_end_date,
        rent_due_day: l.rent_due_day
      })) || [])
      
      const monthlyLeases = leases?.filter(l => normalizeCadence(l.rent_cadence) === 'monthly') || []
      console.log('Monthly leases count:', monthlyLeases.length)
      console.log('Monthly leases details:', monthlyLeases.map(l => ({
        id: l.id,
        cadence: l.rent_cadence,
        rent_due_day: l.rent_due_day,
        property: l.RENT_properties?.name
      })))
    }

    // Fetch payments for the extended date range (±7 days for edge windows)
    const paymentStartDate = new Date(startDate)
    paymentStartDate.setDate(paymentStartDate.getDate() - 7)
    const paymentEndDate = new Date(endDate)
    paymentEndDate.setDate(paymentEndDate.getDate() + 7)

    // Also fetch payments for the entire year for total owed calculation
    const currentYear = new Date().getFullYear()
    const yearStart = new Date(currentYear, 0, 1)
    const yearEnd = new Date(currentYear, 11, 31)

    const { data: payments, error: paymentsError } = await supabaseServer
      .from('RENT_payments')
      .select('*')
      .gte('payment_date', yearStart.toISOString().split('T')[0])
      .lte('payment_date', yearEnd.toISOString().split('T')[0])

    if (paymentsError) {
      throw new Error(`Error fetching payments: ${paymentsError.message}`)
    }

    console.log('Found payments:', payments?.length || 0)

    // Create optimized payment maps for efficient lookup
    const paymentMaps = createPaymentMaps(payments || [])
    const todayUTC = toUTC(new Date().toISOString().split('T')[0])

    // Process each lease using new deterministic logic
    const rows = leases?.map(lease => {
      const cadence = normalizeCadence(lease.rent_cadence);
      
      // Debug cadence normalization - ALWAYS log this
      console.log(`🔥 CADENCE DEBUG - Lease ${lease.id}:`, {
        raw: lease.rent_cadence,
        normalized: cadence,
        property: lease.RENT_properties?.name,
        isMonthly: cadence === 'monthly'
      });
      
      // Special debug for monthly leases
      if (cadence === 'monthly') {
        console.log(`🔥 MONTHLY LEASE PROCESSING - Starting for lease ${lease.id}:`, {
          raw: lease.rent_cadence,
          normalized: cadence,
          property: lease.RENT_properties?.name,
          rent_due_day: lease.rent_due_day,
          rent: lease.rent
        });
      }
      
      debug(`Processing lease ${lease.id}:`, {
        property: lease.RENT_properties?.name,
        tenant: lease.RENT_tenants?.full_name,
        raw_cadence: lease.rent_cadence,
        normalized_cadence: cadence,
        rent_due_day: lease.rent_due_day,
        rent: lease.rent
      })
      
      // Generate periods for this lease using new logic (for display)
      const allPeriods = generatePeriodsForLease(lease, fridays)
      
      // Generate periods for the entire year for total owed calculation
      const currentYear = new Date().getFullYear()
      const yearStart = new Date(currentYear, 0, 1) // January 1st of current year
      const yearEnd = new Date(currentYear, 11, 31) // December 31st of current year
      const yearFridays = generateFridayColumns(
        yearStart.toISOString().split('T')[0], 
        yearEnd.toISOString().split('T')[0]
      )
      const yearPeriods = generatePeriodsForLease(lease, yearFridays)
      
      // Debug: Log year periods for this lease
      if (cadence === 'monthly') {
        const activeYearPeriods = yearPeriods.filter(p => p.isActive)
        debug(`Year periods for lease ${lease.id}:`, {
          totalYearPeriods: yearPeriods.length,
          activeYearPeriods: activeYearPeriods.length,
          activePeriodDates: activeYearPeriods.map(p => p.fridayKey)
        })
      }
      
      // Debug monthly periods specifically
      if (cadence === 'monthly') {
        const activePeriods = allPeriods.filter(p => p.isActive)
        debug(`Monthly lease ${lease.id} generated periods:`, {
          totalPeriods: allPeriods.length,
          activePeriods: activePeriods.length,
          activePeriodDates: activePeriods.map(p => p.fridayKey)
        })
      }
      
      // Get all payments for this lease
      const leasePayments = getPaymentsForLease(lease, paymentMaps)
      
      // For MONTHLY cadence with the fix enabled, use new bucketing logic
      let monthlyPaymentBuckets: Map<string, any> | null = null
      if (cadence === 'monthly' && process.env.NEXT_PUBLIC_USE_CADENCE_FIX === 'true') {
        // Use year periods for total owed calculation to ensure all months are considered
        monthlyPaymentBuckets = bucketMonthlyPayments(lease, yearPeriods, leasePayments)
        debug(`Monthly bucketing results for lease ${lease.id}:`, 
          Array.from(monthlyPaymentBuckets.entries()).map(([key, bucket]) => ({
            fridayKey: key,
            amountPaid: bucket.amountPaid,
            paymentCount: bucket.payments.length
          }))
        );
      }
      
      // Match periods by string date keys (not Date equality)
      const matchPeriod = (periods: any[], cellFridayUTC: Date) => {
        const cellFridayKey = ymdKey(cellFridayUTC)
        return periods.find((p: any) => p.fridayKey === cellFridayKey)
      }
      
      const cells = fridays.map((headerFriday, index) => {
        const cellFridayUTC = toUTC(headerFriday)
        const period = matchPeriod(allPeriods, cellFridayUTC)
        
        // Debug logging for monthly matching
        if (cadence === 'monthly' && process.env.NEXT_PUBLIC_DEBUG_PAYMENTS === 'true') {
          const cellFridayKey = ymdKey(cellFridayUTC)
          debug(`Monthly header alignment check:`, {
            headerIndex: index,
            headerFriday: headerFriday,
            cellFridayKey: cellFridayKey,
            periodFound: !!period,
            periodActive: period?.isActive || false,
            periodFridayKey: period?.fridayKey || 'none'
          })
        }
        
        if (!period) {
          // No period found for this Friday - return inactive cell
          return {
            dueDate: cellFridayUTC.toISOString().split('T')[0],
            windowStart: cellFridayUTC.toISOString(),
            windowEnd: cellFridayUTC.toISOString(),
            status: 'inactive',
            expectedAmount: lease.rent,
            amountPaid: 0,
            payments: [],
            isLocked: true,
            fridayUTC: cellFridayUTC
          }
        }
        
        // Process the matched period
        let bucketedPayments;
        if (cadence === 'monthly' && monthlyPaymentBuckets) {
          // Use pre-computed monthly bucketing (active Friday only logic)
          bucketedPayments = monthlyPaymentBuckets.get(period.fridayKey) || { amountPaid: 0, payments: [] };
        } else if (cadence === 'monthly') {
          // Fallback to old logic when flag is off
          if (!period.isActive) {
            // Inactive monthly Fridays get no payments (prevent duplication)
            bucketedPayments = { amountPaid: 0, payments: [] };
          } else {
            // Active monthly Friday gets normal bucketing
            bucketedPayments = bucketPaymentsForPeriod(
              lease,
              period.windowStart,
              period.windowEnd,
              leasePayments
            );
          }
        } else {
          // Weekly/bi-weekly periods get normal bucketing
          bucketedPayments = bucketPaymentsForPeriod(
            lease,
            period.windowStart,
            period.windowEnd,
            leasePayments
          );
        }
        
        debug(`Processing period ${period.fridayKey}:`, {
          isActive: period.isActive,
          expectedAmount: period.expectedAmount,
          amountPaid: bucketedPayments.amountPaid,
          dueDate: period.dueDateUTC.toISOString(),
          cadence: period.cadence
        })
        
        // Calculate status based on exact rules
        let status: string
        let isLocked = false
        
        // Check if outside lease window first
        const leaseStart = toUTC(lease.lease_start_date)
        const leaseEnd = lease.lease_end_date ? toUTC(lease.lease_end_date) : null
        const isWithinLease = period.friday >= leaseStart && (leaseEnd ? period.friday <= leaseEnd : true)
        
        if (!isWithinLease) {
          status = 'outside_lease'
          isLocked = true
        } else if (period.isActive) {
          // Active period logic
          if (bucketedPayments.amountPaid >= period.expectedAmount) {
            status = 'paid'
          } else if (bucketedPayments.amountPaid > 0) {
            status = 'partial'
          } else if (todayUTC < period.dueDate) {
            status = 'upcoming'
          } else {
            status = 'owed'
          }
          isLocked = false
        } else {
          // Inactive within lease logic
          if (cadence === 'monthly') {
            // Monthly cadence: inactive Fridays are ALWAYS locked, never show payments
            status = 'inactive'
            isLocked = true
          } else {
            // Weekly/bi-weekly: non-active Fridays inside lease
            if (bucketedPayments.amountPaid > 0) {
              status = 'paid'
              isLocked = false
            } else {
              status = 'inactive'
              isLocked = true
            }
          }
        }
        
        const cell = {
          dueDate: period.dueDate.toISOString().split('T')[0],
          windowStart: period.windowStart.toISOString(),
          windowEnd: period.windowEnd.toISOString(),
          status,
          expectedAmount: period.expectedAmount,
          amountPaid: bucketedPayments.amountPaid,
          payments: bucketedPayments.payments,
          isLocked,
          fridayUTC: cellFridayUTC
        }
        
        debug(`Final cell status:`, {
          friday: period.fridayKey,
          status,
          isLocked,
          amountPaid: bucketedPayments.amountPaid,
          expectedAmount: period.expectedAmount,
          cadence
        })
        
        return cell
      })
      
      // Calculate total owed from lease start date until current period
      const leaseStartUTC = toUTC(lease.lease_start_date)
      const yearStartUTC = toUTC(yearStart)
      
      // Use the later of lease start date or year start date
      const calculationStartUTC = leaseStartUTC > yearStartUTC ? leaseStartUTC : yearStartUTC
      
      // For monthly leases, calculate expected amount based on months from lease start to current date
      let totalExpected = 0
      if (cadence === 'monthly') {
        // Calculate number of months from lease start to current date
        const leaseStart = new Date(lease.lease_start_date)
        const currentDate = new Date()
        
        // Calculate months between lease start and current date
        const yearDiff = currentDate.getFullYear() - leaseStart.getFullYear()
        const monthDiff = currentDate.getMonth() - leaseStart.getMonth()
        const totalMonths = yearDiff * 12 + monthDiff + 1 // +1 to include current month
        
        totalExpected = totalMonths * lease.rent
      } else {
        // For weekly/biweekly, use the year periods
        totalExpected = yearPeriods
          .filter(period => period.isActive && period.dueDate >= calculationStartUTC && period.dueDate <= todayUTC)
          .reduce((sum, period) => sum + (period.expectedAmount || 0), 0)
      }
      
      // Calculate total payments for the entire lease period
      const totalPayments = leasePayments.reduce((sum, payment) => sum + payment.amount, 0)
      
      // Debug: Log payment details
      debug(`Payment details for lease ${lease.id}:`, {
        totalLeasePayments: leasePayments.length,
        totalPayments,
        paymentDetails: leasePayments.map(p => ({
          id: p.id,
          date: p.payment_date,
          amount: p.amount,
          lease_id: p.lease_id
        }))
      })
      
      // Calculate total owed as expected minus paid
      const totalOwed = Math.max(0, totalExpected - totalPayments)
      
      // Debug: Log the calculation details
      
      debug(`Total owed calculation for lease ${lease.id}:`, {
        yearStart: yearStartUTC.toISOString().split('T')[0],
        leaseStart: leaseStartUTC.toISOString().split('T')[0],
        calculationStart: calculationStartUTC.toISOString().split('T')[0],
        today: todayUTC.toISOString().split('T')[0],
        activePeriodsInRange: yearPeriods.filter(p => p.isActive && p.dueDate >= calculationStartUTC && p.dueDate <= todayUTC).length,
        totalExpected,
        totalPayments,
        totalOwed,
        cadence
      });
      
      return {
        property: {
          id: lease.RENT_properties?.id,
          name: lease.RENT_properties?.name,
          address: lease.RENT_properties?.address,
          city: lease.RENT_properties?.city,
          state: lease.RENT_properties?.state,
          zip: lease.RENT_properties?.zip
        },
        tenant: {
          id: lease.RENT_tenants?.id,
          full_name: lease.RENT_tenants?.full_name,
          email: lease.RENT_tenants?.email,
          phone: lease.RENT_tenants?.phone
        },
        lease: {
          id: lease.id,
          lease_start_date: lease.lease_start_date,
          lease_end_date: lease.lease_end_date,
          rent_cadence: lease.rent_cadence,
          rent: lease.rent,
          rent_due_day: lease.rent_due_day,
          status: lease.status
        },
        totalOwed,
        cells
      }
    }) || []

    // Debug summary
    if (process.env.NEXT_PUBLIC_DEBUG_PAYMENTS === 'true') {
      const monthlyRows = rows.filter(r => normalizeCadence(r.lease.rent_cadence) === 'monthly');
      console.log(`🔥 FINAL RESULTS - Monthly leases in output:`, {
        totalRows: rows.length,
        monthlyRows: monthlyRows.length,
        monthlyLeaseIds: monthlyRows.map(r => r.lease.id),
        monthlyLeaseNames: monthlyRows.map(r => r.property.name)
      });
      
      debug('Grid generation summary:', {
        dateRange: `${startDate} to ${endDate}`,
        fridayCount: fridays.length,
        leaseCount: leases?.length || 0,
        paymentCount: payments?.length || 0,
        rowCount: rows.length,
        monthlyLeases: monthlyRows.length
      });
    }

    return NextResponse.json({
      dateRange: { startDate, endDate },
      fridays,
      rows,
      debug: {
        leaseCount: leases?.length || 0,
        paymentCount: payments?.length || 0,
        useCadenceFix: process.env.NEXT_PUBLIC_USE_CADENCE_FIX === 'true'
      }
    })

  } catch (error) {
    console.error('Error in payments grid API:', error)
    return NextResponse.json(
      { error: 'Failed to generate payments grid', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}