import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { calculateUnpaidInvoices, type Invoice, type Payment } from '@/lib/invoice-calculations'

// Cache this route for 0 seconds to ensure fresh data (disable caching for debugging)
export const revalidate = 0

// Version number to track code deployments - UPDATE THIS ON EVERY RELEASE
const API_VERSION = 'v5.3-use-server-date-validation'

/**
 * Late Tenants API
 * 
 * Identifies leases with overdue invoices using the EXACT same flow as Payments page.
 * 
 * CRITICAL: This API now processes leases EXACTLY like the Payments page:
 * 1. For each lease, call /api/invoices?leaseId=${leaseId}&to=${today}
 * 2. Filter invoices by due_date >= leaseStartDate (JavaScript filter)
 * 3. Call /api/payments?leaseId=${leaseId}
 * 4. Group payments by invoice_id
 * 5. Recalculate balance_due
 * 6. Filter unpaid: status === 'OPEN' && balance_due > 0
 * 
 * This ensures 100% consistency with the Payments page.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    // CRITICAL: Use the EXACT same date calculation as Payments page (line 436)
    // Payments page: const today = new Date().toISOString().split('T')[0]
    // The Payments page calculates today on the CLIENT side and passes it to /api/invoices?to=${today}
    // However, we should use the SERVER's actual current date to ensure accuracy
    // If client date is provided and seems reasonable (within 1 day of server date), use it
    // Otherwise use server date (more reliable)
    const todayParam = searchParams.get('today')
    const serverToday = new Date().toISOString().split('T')[0]
    
    // Validate client date: if provided, check if it's within 1 day of server date
    let today = serverToday // Default to server date (most reliable)
    if (todayParam) {
      const clientDate = new Date(todayParam)
      const serverDate = new Date(serverToday)
      const diffDays = Math.abs((clientDate.getTime() - serverDate.getTime()) / (1000 * 60 * 60 * 24))
      
      // If client date is within 1 day of server date, use it (timezone differences are OK)
      // Otherwise, use server date (client clock might be wrong)
      if (diffDays <= 1) {
        today = todayParam
      } else {
        console.warn(`⚠️ Client date "${todayParam}" differs from server date "${serverToday}" by ${diffDays.toFixed(1)} days. Using server date.`)
      }
    }
    
    console.log('🔍 ========== TODAY VALUE DEBUG ==========')
    console.log(`  today param from URL: "${todayParam}"`)
    console.log(`  server date: "${serverToday}"`)
    console.log(`  today value used: "${today}" (${today === todayParam ? 'from client' : 'from server'})`)
    console.log('🔍 ========== END TODAY VALUE DEBUG ==========')
    
    // Fetch leases with tenants with property and tenant data
    // Match Payments page logic: filter by status only
    // Only include 'occupied' status (exclude 'sold' for money calculations)
    const { data: leases, error: leasesError } = await supabaseServer
      .from('RENT_leases')
      .select(`
        *,
        RENT_properties(*),
        RENT_tenants(*)
      `)
      .in('status', ['occupied'])

    if (leasesError) {
      throw new Error(`Error fetching leases: ${leasesError.message}`)
    }

    console.log('Found active leases:', leases?.length || 0)
    
    // Match Payments page logic: filter by status only, no date range or property status filter
    const activePropertyLeases = leases || []
    
    console.log('Active leases (matching payments page logic):', activePropertyLeases.length)
    
    // Process each lease EXACTLY like Payments page does (lines 441-603)
    const lateTenantsRows: any[] = []
    let totalAllOwed = 0
    
    for (const lease of activePropertyLeases) {
      const leaseId = lease.id
      const leaseStartDate = lease.lease_start_date
      const address = lease.RENT_properties?.address || 'unknown'
      const isMainStProperty = address.toLowerCase().includes('5667') || address.toLowerCase().includes('main')
      
      try {
        // STEP 1: Fetch invoices EXACTLY like Payments page does
        // Payments page line 444: fetch(`/api/invoices?leaseId=${leaseData.id}&to=${today}`)
        // Instead of calling the API, we'll do the same Supabase query directly for performance
        // This matches /api/invoices route lines 37-50
        const { data: invoicesData, error: invoicesError } = await supabaseServer
          .from('RENT_invoices')
          .select('*')
          .eq('lease_id', leaseId)
          .lte('due_date', today)  // Same as /api/invoices?to=${today}
          .order('due_date', { ascending: false })
        
        if (invoicesError) {
          console.error(`Error fetching invoices for lease ${leaseId}:`, invoicesError)
          continue
        }
        
        const invoices = Array.isArray(invoicesData) ? invoicesData : []
        
        if (isMainStProperty) {
          console.log(`\n🔍 Payments Page Flow - Lease ${leaseId} (${address}):`)
          console.log(`  Step 1: Fetched ${invoices.length} invoices (due_date <= ${today})`)
        }
        
        // STEP 2: Filter invoices EXACTLY like Payments page (lines 451-453)
        // Payments page: validInvoices = invoices.filter((invoice: Invoice) => 
        //   !leaseStartDate || invoice.due_date >= leaseStartDate
        // )
        const validInvoices = invoices.filter((invoice: Invoice) => 
          !leaseStartDate || invoice.due_date >= leaseStartDate
        )
        
        if (isMainStProperty) {
          console.log(`  Step 2: Filtered to ${validInvoices.length} valid invoices (due_date >= leaseStartDate)`)
        }
        
        // STEP 3: Fetch payments EXACTLY like Payments page does
        // Payments page line 536: fetch(`/api/payments?leaseId=${leaseData.id}`)
        // Instead of calling the API, we'll do the same Supabase query directly for performance
        // This matches /api/payments route lines 603-604
        const { data: paymentsData, error: paymentsError } = await supabaseServer
          .from('RENT_payments')
          .select('*')
          .eq('lease_id', leaseId)
          .order('payment_date', { ascending: false })
        
        if (paymentsError) {
          console.error(`Error fetching payments for lease ${leaseId}:`, paymentsError)
          // Continue with empty payments array
        }
        
        const payments = Array.isArray(paymentsData) ? paymentsData : []
        
        if (isMainStProperty) {
          console.log(`  Step 3: Fetched ${payments.length} payments`)
        }
        
        // STEP 4: Use shared calculation function - ensures EXACT match with Payments page
        // This function does:
        // - Groups payments by invoice_id (Payments page lines 541-548)
        // - Recalculates balance_due (Payments page lines 552-567)
        // - Filters unpaid: status === 'OPEN' && balance_due > 0 (Payments page lines 571-573)
        // - Calculates total (Payments page lines 576-578)
        const { unpaidInvoices, totalOwed, unpaidCount } = calculateUnpaidInvoices(
          validInvoices as Invoice[],
          payments as Payment[],
          leaseStartDate || undefined,
          today // Pass 'today' to filter future invoices (matching Payments page /api/invoices?to=${today})
        )
        
        if (isMainStProperty) {
          console.log(`  Step 4: calculateUnpaidInvoices returned ${unpaidCount} unpaid invoices, totalOwed=${totalOwed}`)
          console.log(`  Unpaid invoice IDs:`, unpaidInvoices.map(inv => inv.id).join(', '))
        }
        
        // CRITICAL: Only include leases with unpaid invoices (matching Late Tenants page expectation)
        // Skip leases with no unpaid invoices
        if (unpaidCount === 0 || totalOwed === 0) {
          if (isMainStProperty) {
            console.log(`  ⚠️ Skipping lease ${leaseId} - no unpaid invoices (unpaidCount=${unpaidCount}, totalOwed=${totalOwed})`)
          }
          continue
        }
        
        totalAllOwed += totalOwed

        // Calculate days late for the oldest unpaid invoice
        let daysLate = 0
        if (unpaidInvoices.length > 0) {
          const oldestUnpaid = unpaidInvoices.reduce((oldest, inv) => {
            const invDate = new Date(inv.due_date)
            const oldestDate = new Date(oldest.due_date)
            return invDate < oldestDate ? inv : oldest
          })
          
          const dueDate = new Date(oldestUnpaid.due_date)
          const todayDate = new Date(today + 'T12:00:00')
          const diffTime = todayDate.getTime() - dueDate.getTime()
          daysLate = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)))
        }

        lateTenantsRows.push({
          leaseId: lease.id,
          property: lease.RENT_properties || {},
          tenant: lease.RENT_tenants || {},
          lease: {
            id: lease.id,
            rent: lease.rent,
            rent_cadence: lease.rent_cadence,
            lease_start_date: lease.lease_start_date,
            lease_end_date: lease.lease_end_date
          },
          totalAllOwed,
          totalOwedLate: totalOwed,
          unpaidCount,
          unpaidInvoiceCount: unpaidCount,
          unpaidInvoiceIds: unpaidInvoices.map(inv => inv.id),
          daysLate,
          lateInvoices: unpaidInvoices.map(inv => ({
            id: inv.id,
            due_date: inv.due_date,
            amount_total: inv.amount_total,
            balance_due: inv.balance_due,
            status: inv.status
          }))
        })
      } catch (error) {
        console.error(`Error processing lease ${leaseId}:`, error)
        // Continue with other leases
      }
    }

    // Sort by days late (descending)
    lateTenantsRows.sort((a, b) => b.daysLate - a.daysLate)

    return NextResponse.json({
      version: API_VERSION,
      rows: lateTenantsRows,
      total: lateTenantsRows.length,
      totalAllOwed,
      debug: {
        today,
        todayType: typeof today,
        totalLeases: leases?.length || 0,
        currentDate: new Date().toISOString().split('T')[0]
      }
    })
  } catch (error) {
    console.error('Error in late-tenants API:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch late tenants', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
