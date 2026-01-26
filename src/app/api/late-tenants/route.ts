import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { calculateUnpaidInvoices, type Invoice, type Payment } from '@/lib/invoice-calculations'

// Cache this route for 0 seconds to ensure fresh data (disable caching for debugging)
export const revalidate = 0

// Version number to track code deployments - UPDATE THIS ON EVERY RELEASE
const API_VERSION = 'v4.3-consistent-today-usage-throughout'

/**
 * Late Tenants API
 * 
 * Identifies leases with overdue invoices using the new invoice system.
 * Consistent with the payment grid data and invoice-based approach.
 * OPTIMIZED: Uses batch queries instead of N+1 pattern.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    // CRITICAL: Use the EXACT same date calculation as Payments page (line 436)
    // Payments page: const today = new Date().toISOString().split('T')[0]
    // The Payments page calculates today on the CLIENT side and passes it to /api/invoices?to=${today}
    // We MUST use the client's date (from the 'today' parameter) to match exactly
    const todayParam = searchParams.get('today')
    // If today parameter is provided, use it (matches Payments page client-side calculation)
    // Otherwise fall back to server date (shouldn't happen if client sends it)
    const today = todayParam || new Date().toISOString().split('T')[0]
    // Use 'today' from client (same as Payments page) - no need for actualToday variable
    const todayDate = new Date(today + 'T12:00:00')
    todayDate.setHours(0, 0, 0, 0)
    
    console.log('🔍 ========== TODAY VALUE DEBUG ==========')
    const todayParamFromURL = searchParams.get('today')
    console.log(`  today param from URL: "${todayParamFromURL}" (using this - matches Payments page client-side calculation)`)
    console.log(`  today value used: "${today}" (from client, same as Payments page)`)
    console.log(`  today type: ${typeof today}`)
    console.log(`  today length: ${today.length}`)
    console.log(`  today char codes: ${Array.from(today).map(c => c.charCodeAt(0)).join(',')}`)
    console.log(`  Current date (new Date().toISOString().split('T')[0]): "${new Date().toISOString().split('T')[0]}"`)
    console.log(`  Comparison test: "2026-01-14" > "${today}" = ${"2026-01-14" > today}`)
    console.log(`  Comparison test: "2025-12-17" > "${today}" = ${"2025-12-17" > today}`)
    console.log(`  Comparison test: "2025-01-15" > "${today}" = ${"2025-01-15" > today}`)
    console.log('🔍 ========== END TODAY VALUE DEBUG ==========')
    
    // Fetch active leases with property and tenant data
    const { data: leases, error: leasesError } = await supabaseServer
      .from('RENT_leases')
      .select(`
        *,
        RENT_properties(*),
        RENT_tenants(*)
      `)
      .eq('status', 'active')

    if (leasesError) {
      throw new Error(`Error fetching leases: ${leasesError.message}`)
    }

    console.log('Found active leases:', leases?.length || 0)
    
    // Check for multiple leases per property (could cause double counting)
    const leasesByProperty = new Map<string, any[]>()
    leases?.forEach(lease => {
      const propertyId = lease.property_id
      if (!leasesByProperty.has(propertyId)) {
        leasesByProperty.set(propertyId, [])
      }
      leasesByProperty.get(propertyId)!.push(lease)
    })
    
    // Log properties with multiple leases
    const propertiesWithMultipleLeases = Array.from(leasesByProperty.entries())
      .filter(([propertyId, leaseList]) => leaseList.length > 1)
      .map(([propertyId, leaseList]) => ({
        propertyId,
        leaseCount: leaseList.length,
        leaseIds: leaseList.map(l => l.id),
        address: leaseList[0]?.RENT_properties?.address
      }))
    
    if (propertiesWithMultipleLeases.length > 0) {
      console.log('⚠️ PROPERTIES WITH MULTIPLE ACTIVE LEASES:', propertiesWithMultipleLeases)
    }

    if (!leases || leases.length === 0) {
      return NextResponse.json({
        summary: {
          lateLeases: 0,
          totalLateOwed: 0,
          totalAllOwed: 0,
          thirtyPlusLate: 0,
          avgDaysLate: 0
        },
        rows: []
      })
    }

    // OPTIMIZED: Batch fetch all invoices for all active leases in a single query
    // Fetch ALL invoices (not just due_date <= today) to build complete paymentsByInvoice map
    // This ensures payments linked to older/future invoices are included in the map
    const leaseIds = leases.map(lease => lease.id)
    const leaseStartDates = new Map(leases.map(lease => [lease.id, lease.lease_start_date]))
    
    // Fetch ALL invoices to build complete paymentsByInvoice map
    const { data: allInvoicesForPaymentsMap, error: allInvoicesError } = await supabaseServer
      .from('RENT_invoices')
      .select('*')
      .in('lease_id', leaseIds)
      .order('due_date', { ascending: false })
    
    // Fetch invoices with due_date <= today for processing (matching payments page)
    // CRITICAL: The Payments page calls /api/invoices?leaseId=...&to=${today}
    // which uses .lte('due_date', to) - this MUST match exactly
    // The invoices API route does: if (to) { query = query.lte('due_date', to) }
    console.log(`🔍 Fetching invoices with due_date <= "${today}" for ${leaseIds.length} leases`)
    
    // Use the EXACT same query as /api/invoices route (lines 49-50)
    // CRITICAL: The Payments page calls /api/invoices?to=${today} where today is calculated client-side
    // The /api/invoices route does: if (to) { query = query.lte('due_date', to) }
    // We MUST use the same 'today' value that the client sends (from Payments page calculation)
    const { data: allInvoicesRaw, error: invoicesError } = await supabaseServer
      .from('RENT_invoices')
      .select('*')
      .in('lease_id', leaseIds)
      .lte('due_date', today)  // Use 'today' from client (same as Payments page /api/invoices?to=${today})
      .order('due_date', { ascending: false })
    
    // CRITICAL: Filter out ANY invoices with future dates IMMEDIATELY (safety check)
    // This ensures we only process invoices with due_date <= today, regardless of what Supabase returns
    // Use 'today' (from client) to match Payments page exactly
    const allInvoices = (allInvoicesRaw || []).filter(inv => {
      const invDueDate = String(inv.due_date || '').split('T')[0] // Handle potential timestamp format
      const isFuture = invDueDate > today
      return !isFuture
    })
    
    // CRITICAL DEBUG: Check if query returned invoices with future dates
    if (allInvoicesRaw && allInvoicesRaw.length > 0) {
      const futureInvoices = allInvoicesRaw.filter(inv => {
        const invDueDate = String(inv.due_date || '').split('T')[0]
        return invDueDate > today // Use 'today' from client
      })
      if (futureInvoices.length > 0) {
        console.error(`⚠️ SUPABASE QUERY RETURNED ${futureInvoices.length} INVOICES WITH FUTURE DATES! (Filtered out)`)
        console.error(`  Query used: .lte('due_date', "${today}")`)
        console.error(`  today type: ${typeof today}, value: "${today}"`)
        console.error(`  Future invoices (filtered):`, futureInvoices.slice(0, 5).map(inv => {
          const invDueDate = String(inv.due_date || '').split('T')[0]
          return {
            id: inv.id.substring(0, 8) + '...',
            due_date: inv.due_date,
            due_date_parsed: invDueDate,
            comparison: `${invDueDate} > ${today} = ${invDueDate > today}`,
            lease_id: inv.lease_id
          }
        }))
      }
    }
    
    console.log(`✅ Fetched ${allInvoices.length} invoices (after filtering future dates) from ${allInvoicesRaw?.length || 0} total`)

    if (invoicesError) {
      console.error('Error fetching invoices:', invoicesError)
      throw new Error(`Error fetching invoices: ${invoicesError.message}`)
    }

    // OPTIMIZED: Batch fetch all payments for all active leases in a single query
    const { data: allPayments, error: paymentsError } = await supabaseServer
      .from('RENT_payments')
      .select('*')
      .in('lease_id', leaseIds)
      .order('payment_date', { ascending: true })

    if (paymentsError) {
      console.error('Error fetching payments:', paymentsError)
      // Don't throw - payments are optional for display
    }

    // Group invoices and payments by lease_id for efficient lookup
    const invoicesByLease = new Map<string, any[]>()
    const paymentsByLease = new Map<string, any[]>()
    // Group payments by invoice_id to calculate actual paid amounts (matching payments page logic)
    const paymentsByInvoice = new Map<string, any[]>()
    
    // Check for duplicate invoice IDs in the raw query result
    const invoiceIdCounts = new Map<string, number>()
    allInvoices?.forEach(invoice => {
      const count = invoiceIdCounts.get(invoice.id) || 0
      invoiceIdCounts.set(invoice.id, count + 1)
    })
    
    // Log any duplicate invoice IDs found
    const duplicateInvoiceIds = Array.from(invoiceIdCounts.entries())
      .filter(([id, count]) => count > 1)
      .map(([id, count]) => ({ id, count }))
    
    if (duplicateInvoiceIds.length > 0) {
      console.error('⚠️ DUPLICATE INVOICE IDs FOUND IN QUERY RESULT:', duplicateInvoiceIds)
    }
    
    // CRITICAL: Filter out future invoices AGAIN before grouping by lease
    // This is a safety check to ensure no future invoices make it into invoicesByLease
    // Use 'today' from client to match Payments page exactly
    const allInvoicesFiltered = (allInvoices || []).filter(inv => {
      const invDueDate = String(inv.due_date || '').split('T')[0]
      const isFuture = invDueDate > today
      if (isFuture) {
        console.error(`  ⚠️ PRE-GROUPING FILTER: Removing future invoice: ${inv.id.substring(0, 8)}... due_date="${invDueDate}" > today="${today}"`)
      }
      return !isFuture
    })
    
    allInvoicesFiltered.forEach(invoice => {
      const leaseId = invoice.lease_id
      if (!invoicesByLease.has(leaseId)) {
        invoicesByLease.set(leaseId, [])
      }
      invoicesByLease.get(leaseId)!.push(invoice)
    })
    
    // Log invoice grouping for debugging
    console.log(`Grouped ${allInvoices?.length || 0} invoices across ${invoicesByLease.size} leases`)
    
    // Check if any invoice ID appears in multiple lease groups (shouldn't happen)
    const invoiceIdToLeaseIds = new Map<string, string[]>()
    invoicesByLease.forEach((invoiceList, leaseId) => {
      invoiceList.forEach(invoice => {
        if (!invoiceIdToLeaseIds.has(invoice.id)) {
          invoiceIdToLeaseIds.set(invoice.id, [])
        }
        invoiceIdToLeaseIds.get(invoice.id)!.push(leaseId)
      })
    })
    
    const invoicesInMultipleLeases = Array.from(invoiceIdToLeaseIds.entries())
      .filter(([invoiceId, leaseIds]) => leaseIds.length > 1)
      .map(([invoiceId, leaseIds]) => ({ invoiceId, leaseIds }))
    
    if (invoicesInMultipleLeases.length > 0) {
      console.error('⚠️ INVOICES APPEARING IN MULTIPLE LEASE GROUPS:', invoicesInMultipleLeases)
    }

    // Build paymentsByInvoice map using ALL invoices (including those with due_date > today)
    // This ensures payments linked to older/future invoices are included
    // Payments are linked by invoice_id, so we need all invoice IDs in the map
    const allInvoiceIds = new Set((allInvoicesForPaymentsMap || []).map(inv => inv.id))
    
    allPayments?.forEach(payment => {
      const leaseId = payment.lease_id
      if (!paymentsByLease.has(leaseId)) {
        paymentsByLease.set(leaseId, [])
      }
      paymentsByLease.get(leaseId)!.push(payment)
      
      // Also group by invoice_id to calculate actual paid amounts (matching payments page logic)
      // Include payments even if the invoice_id isn't in allInvoices (due_date > today)
      // This handles cases where payments are linked to older invoices
      if (payment.invoice_id) {
        if (!paymentsByInvoice.has(payment.invoice_id)) {
          paymentsByInvoice.set(payment.invoice_id, [])
        }
        paymentsByInvoice.get(payment.invoice_id)!.push(payment)
      }
    })

    // Process each lease to identify late tenants using the same logic as payments page
    const lateTenantsRows: any[] = []
    let totalAllOwed = 0 // Track all unpaid invoices (like dashboard)

    for (const lease of leases) {
      // Get invoices for this lease (already filtered by date range)
      let invoices = invoicesByLease.get(lease.id) || []
      
      // CRITICAL FIX: Filter out future invoices IMMEDIATELY before any processing
      // Use 'today' from client to match Payments page exactly
      const invoicesBeforeFutureFilter = invoices.length
      invoices = invoices.filter(inv => {
        const invDueDate = String(inv.due_date || '').split('T')[0]
        const isFuture = invDueDate > today
        return !isFuture
      })
      if (invoicesBeforeFutureFilter !== invoices.length) {
        console.error(`⚠️ CRITICAL: Filtered out ${invoicesBeforeFutureFilter - invoices.length} future invoices from lease ${lease.id} before processing`)
        console.error(`  today="${today}" (from client, same as Payments page)`)
      }
      
      // Verify all invoices belong to this lease (safety check)
      const invoicesWithWrongLease = invoices.filter(inv => inv.lease_id !== lease.id)
      if (invoicesWithWrongLease.length > 0) {
        console.error(`⚠️ INVOICES WITH MISMATCHED lease_id for lease ${lease.id}:`, invoicesWithWrongLease.map(inv => ({
          invoice_id: inv.id,
          invoice_lease_id: inv.lease_id,
          expected_lease_id: lease.id
        })))
      }
      
      // Filter invoices EXACTLY as Payments page does (lines 451-453):
      // 1. Filter by due_date >= leaseStartDate
      // 2. Only process invoices with due_date <= today (matching /api/invoices?to=${today})
      const leaseStartDate = leaseStartDates.get(lease.id)
      const address = lease.RENT_properties?.address || 'unknown'
      const isMainStProperty = address.toLowerCase().includes('5667') || address.toLowerCase().includes('main')
      
      // Declare debug data variable BEFORE it's used
      let invoiceFilterDebugData: any = null
      
      // CRITICAL FIX: Filter out invoices with due_date > today FIRST
      // The Supabase query should have done this, but we need to ensure it's applied
      // This is the EXACT same filter as Payments page: /api/invoices?to=${today}
      // Payments page line 444: `/api/invoices?leaseId=${leaseData.id}&to=${today}`
      // This filters due_date <= today
      // 
      // IMPORTANT: The Payments page ONLY processes invoices returned by the API
      // which already filters due_date <= today. We must do the same here.
      
      // CRITICAL DEBUG: Log ALL invoice due dates and comparisons for this lease
      if (isMainStProperty) {
        console.log(`\n🔍 ========== INVOICE FILTER DEBUG FOR ${address} ==========`)
        console.log(`  today="${today}" (type: ${typeof today}, length: ${today.length})`)
        console.log(`  leaseStartDate="${leaseStartDate}"`)
        console.log(`  Total invoices before filter: ${invoices.length}`)
        console.log(`  Invoices with due dates:`)
        
        // Collect debug data for API response
        invoiceFilterDebugData = {
          today: today,
          todayType: typeof today,
          todayLength: today.length,
          todayCharCodes: Array.from(today).map(c => c.charCodeAt(0)),
          currentDate: new Date().toISOString().split('T')[0],
          leaseStartDate: leaseStartDate,
          totalInvoicesBeforeFilter: invoices.length,
          invoices: invoices.map((inv, idx) => {
            const rawDueDate = inv.due_date
            const normalizedDueDate = String(rawDueDate || '').split('T')[0]
            const isFuture = normalizedDueDate > today
            const beforeLeaseStart = leaseStartDate && normalizedDueDate < leaseStartDate
            const willBeExcluded = isFuture || beforeLeaseStart
            
            console.log(`    [${idx + 1}] Invoice ${inv.id.substring(0, 8)}...`)
            console.log(`        due_date raw: "${rawDueDate}" (type: ${typeof rawDueDate})`)
            console.log(`        due_date normalized: "${normalizedDueDate}"`)
            console.log(`        comparison: "${normalizedDueDate}" > "${today}" = ${isFuture}`)
            console.log(`        before lease start: ${beforeLeaseStart}`)
            console.log(`        will be ${willBeExcluded ? 'EXCLUDED' : 'INCLUDED'}`)
            
            return {
              index: idx + 1,
              invoice_id: inv.id,
              invoice_id_short: inv.id.substring(0, 8),
              due_date_raw: rawDueDate,
              due_date_raw_type: typeof rawDueDate,
              due_date_normalized: normalizedDueDate,
              comparison: `${normalizedDueDate} > ${today}`,
              comparison_result: isFuture,
              before_lease_start: beforeLeaseStart,
              will_be_excluded: willBeExcluded,
              will_be_included: !willBeExcluded
            }
          })
        }
      }
      
      // CRITICAL: Use currentDate (actual server date) instead of today parameter
      // This ensures we always filter based on the actual current date, not a potentially incorrect parameter
      const validInvoices = invoices.filter(invoice => {
        // CRITICAL: Normalize due_date to YYYY-MM-DD format for comparison
        const invoiceDueDate = String(invoice.due_date || '').split('T')[0]
        
        // CRITICAL: Only process invoices with due_date <= today (matching Payments page)
        // Payments page line 436: const today = new Date().toISOString().split('T')[0]
        // Payments page line 444: /api/invoices?leaseId=${leaseData.id}&to=${today}
        // This filters due_date <= today at the API level
        // String comparison works for ISO date strings (YYYY-MM-DD format)
        // Example: "2026-01-14" > "2025-01-15" = true (correctly excludes future dates)
        const isFuture = invoiceDueDate > today
        if (isFuture) {
          if (isMainStProperty) {
            console.error(`  ⚠️ FILTER: Excluding future invoice: ${invoice.id.substring(0, 8)}... due_date="${invoiceDueDate}" > today="${today}"`)
            console.error(`    Comparison: "${invoiceDueDate}" > "${today}" = ${isFuture}`)
          }
          return false // Skip future invoices - they're not due yet
        }
        
        // Filter by due_date >= leaseStartDate (matching Payments page line 451-453)
        if (leaseStartDate && invoiceDueDate < leaseStartDate) {
          return false
        }
        
        return true
      })
      
      if (isMainStProperty && invoiceFilterDebugData) {
        invoiceFilterDebugData.totalInvoicesAfterFilter = validInvoices.length
        invoiceFilterDebugData.validInvoices = validInvoices.map(inv => ({
          invoice_id: inv.id,
          invoice_id_short: inv.id.substring(0, 8),
          due_date: inv.due_date,
          due_date_normalized: String(inv.due_date || '').split('T')[0]
        }))
        console.log(`  Total invoices after filter: ${validInvoices.length}`)
        console.log(`🔍 ========== END INVOICE FILTER DEBUG ==========\n`)
      }
      
      // CRITICAL VALIDATION: Ensure no future invoices passed the filter
      // This is a safety check - the filter above should have already excluded them
      const futureInvoicesInValid = validInvoices.filter(inv => {
        const invDueDate = inv.due_date
        const isFuture = invDueDate > today
        return isFuture
      })
      if (futureInvoicesInValid.length > 0) {
        console.error(`⚠️ CRITICAL ERROR: ${futureInvoicesInValid.length} future invoices passed the filter!`)
        console.error(`  today="${today}"`)
        console.error(`  Future invoices:`, futureInvoicesInValid.map(inv => ({
          id: inv.id.substring(0, 8) + '...',
          due_date: inv.due_date,
          comparison: `${inv.due_date} > ${today} = ${inv.due_date > today}`,
          type_inv: typeof inv.due_date,
          type_today: typeof today
        })))
        // CRITICAL FIX: Remove them explicitly by creating a new array
        const filteredValidInvoices = validInvoices.filter(inv => {
          const invDueDate = inv.due_date
          const isFuture = invDueDate > today
          if (isFuture) {
            console.error(`  Removing future invoice: ${inv.id.substring(0, 8)}... due_date="${invDueDate}" > today="${today}"`)
          }
          return !isFuture
        })
        // Replace the array contents
        validInvoices.length = 0
        validInvoices.push(...filteredValidInvoices)
        console.error(`  After removal: ${validInvoices.length} invoices remain`)
      }
      
      // Debug logging for 5667 N Main St
      if (isMainStProperty) {
        console.log(`\n🔍 FILTER DEBUG for ${address}:`)
        console.log(`  - today value: "${today}"`)
        console.log(`  - invoices before filter: ${invoices.length}`)
        console.log(`  - invoices after filter: ${validInvoices.length}`)
        console.log(`  - leaseStartDate: ${leaseStartDate}`)
        
        // Show which invoices were filtered out
        const filteredOut = invoices.filter(inv => {
          const invDueDate = String(inv.due_date || '').split('T')[0]
          return invDueDate > today || (leaseStartDate && invDueDate < leaseStartDate)
        })
        if (filteredOut.length > 0) {
          console.log(`  - Filtered out ${filteredOut.length} invoices:`)
          filteredOut.forEach(inv => {
            const invDueDate = String(inv.due_date || '').split('T')[0]
            const reason = invDueDate > today ? 'future' : 'before lease start'
            console.log(`    - ${inv.id.substring(0, 8)}... due_date="${invDueDate}" (${reason})`)
          })
        }
        console.log(`🔍 END FILTER DEBUG\n`)
      }

      // Debug logging for 5667 N Main St - collect filter results for console output
      const filterCheckResults: any[] = []
      const paymentCheckResults: any[] = []
      
      // Log all payments for this lease to see what invoice_ids they have - collect for console output
      let allPaymentsData: any = null
      let allInvoiceIdsData: any = null
      let paymentsMapData: any = null
      
      if (isMainStProperty) {
        const allPaymentsForLease = paymentsByLease.get(lease.id) || []
        allPaymentsData = allPaymentsForLease.map((p, idx) => ({
          index: idx + 1,
          payment_id: p.id,
          payment_id_short: p.id?.substring(0, 8) || 'no-id',
          amount: p.amount,
          invoice_id: p.invoice_id || null,
          invoice_id_type: typeof p.invoice_id,
          invoice_id_is_null: p.invoice_id === null,
          invoice_id_is_undefined: p.invoice_id === undefined,
          payment_date: p.payment_date,
          lease_id: p.lease_id
        }))
        
        // Show all invoice IDs from invoices
        // CRITICAL: Only include invoices with due_date <= today (validation check)
        // Normalize due_date for comparison
        // Use 'today' from client (same as Payments page)
        const validInvoicesForDebug = validInvoices.filter(inv => {
          const invDueDate = String(inv.due_date || '').split('T')[0]
          const isFuture = invDueDate > today
          if (isFuture) {
            console.error(`  ⚠️ DEBUG: Excluding future invoice from debug output: ${inv.id.substring(0, 8)}... due_date="${invDueDate}" > today="${today}"`)
            console.error(`    Comparison: "${invDueDate}" > "${today}" = ${isFuture}`)
          }
          return !isFuture
        })
        allInvoiceIdsData = validInvoicesForDebug.map((inv, idx) => ({
          index: idx + 1,
          invoice_id: inv.id,
          invoice_id_short: inv.id.substring(0, 8),
          invoice_id_type: typeof inv.id,
          due_date: inv.due_date,
          amount_total: inv.amount_total
        }))
        
        // Show paymentsByInvoice map contents
        const invoiceIdsInMap = Array.from(paymentsByInvoice.keys())
        paymentsMapData = {
          total_invoice_ids_in_map: invoiceIdsInMap.length,
          invoice_ids: invoiceIdsInMap.map(invId => {
            const payments = paymentsByInvoice.get(invId) || []
            return {
              invoice_id: invId,
              invoice_id_short: invId.substring(0, 8),
              payment_count: payments.length,
              payments: payments.map(p => ({
                payment_id: p.id,
                amount: p.amount,
                payment_date: p.payment_date
              }))
            }
          })
        }
        
        console.log(`\n💰 ALL PAYMENTS FOR LEASE ${lease.id} (${allPaymentsForLease.length} total):`)
        allPaymentsForLease.forEach((p, idx) => {
          console.log(`  [${idx + 1}] Payment ${p.id?.substring(0, 8) || 'no-id'}...`)
          console.log(`      Amount: $${p.amount}, Invoice ID: ${p.invoice_id || 'NULL'}, Date: ${p.payment_date}`)
          console.log(`      Invoice ID type: ${typeof p.invoice_id}, Invoice ID === null: ${p.invoice_id === null}, Invoice ID === undefined: ${p.invoice_id === undefined}`)
        })
        
        console.log(`\n📋 ALL INVOICE IDs FOR THIS LEASE (${validInvoices.length} total):`)
        validInvoices.forEach((inv, idx) => {
          console.log(`  [${idx + 1}] Invoice ${inv.id.substring(0, 8)}... (type: ${typeof inv.id})`)
        })
        
        console.log(`\n🗺️ PAYMENTS BY INVOICE MAP CONTENTS:`)
        console.log(`  Total invoice IDs in map: ${invoiceIdsInMap.length}`)
        invoiceIdsInMap.forEach(invId => {
          const payments = paymentsByInvoice.get(invId) || []
          console.log(`  - Invoice ${invId.substring(0, 8)}...: ${payments.length} payment(s)`)
        })
      }

      // CRITICAL DEBUG: Verify paymentsByInvoice map before processing
      if (isMainStProperty) {
        console.log(`\n🔍 VERIFYING paymentsByInvoice MAP BEFORE PROCESSING:`)
        console.log(`  - Total invoices to process: ${validInvoices.length}`)
        console.log(`  - Total invoice IDs in paymentsByInvoice map: ${paymentsByInvoice.size}`)
        const first10InvoiceIds = validInvoices.slice(0, 10).map(inv => inv.id)
        console.log(`  - First 10 invoice IDs to check:`, first10InvoiceIds)
        first10InvoiceIds.forEach(invId => {
          const payments = paymentsByInvoice.get(invId) || []
          console.log(`    - Invoice ${invId.substring(0, 8)}...: ${payments.length} payment(s) in map`)
        })
        // Check if any payments have invoice_ids that match these invoices
        const allPaymentInvoiceIds = new Set<string>()
        const allPaymentsForLease = paymentsByLease.get(lease.id) || []
        allPaymentsForLease.forEach(p => {
          if (p.invoice_id) allPaymentInvoiceIds.add(p.invoice_id)
        })
        console.log(`  - All payment invoice_ids for this lease:`, Array.from(allPaymentInvoiceIds))
        const matchingPaymentIds = first10InvoiceIds.filter(id => allPaymentInvoiceIds.has(id))
        console.log(`  - First 10 invoice IDs that match payment invoice_ids: ${matchingPaymentIds.length} (${matchingPaymentIds.map(id => id.substring(0, 8)).join(', ')})`)
      }
      
      // CRITICAL: Final check - ensure no future invoices before processing
      // This is a safety check after the validation above
      // Use 'today' from client (same as Payments page)
      const finalValidInvoices = validInvoices.filter(inv => {
        const invDueDate = String(inv.due_date || '').split('T')[0]
        const isFuture = invDueDate > today
        if (isFuture) {
          console.error(`  ⚠️ FINAL CHECK: Removing future invoice: ${inv.id.substring(0, 8)}... due_date="${invDueDate}" > today="${today}"`)
        }
        return !isFuture
      })
      
      // Get payments for this lease
      const leasePayments = paymentsByLease.get(lease.id) || []
      
      // Use shared calculation function - ensures EXACT match with Payments page
      // Pass 'today' to filter out future invoices (matching Payments page /api/invoices?to=${today})
      const { unpaidInvoices: allUnpaidInvoices, totalOwed: totalAllOwedForLease } = calculateUnpaidInvoices(
        finalValidInvoices as Invoice[],
        leasePayments as Payment[],
        leaseStartDate || undefined,
        today // Pass 'today' from client (same as Payments page)
      )
      
      // Debug for 5667 N Main St - collect filter results
      if (isMainStProperty) {
        allUnpaidInvoices.forEach(inv => {
          const balanceValue = parseFloat(inv.balance_due as any || 0)
          const filterResult = {
            invoiceId: inv.id,
            status: inv.status,
            isOpen: inv.status === 'OPEN',
            balance_due_raw: inv.balance_due,
            balance_due_type: typeof inv.balance_due,
            balance_due_parsed: balanceValue,
            hasBalance: balanceValue > 0,
            result: true,
            included: 'YES'
          }
          filterCheckResults.push(filterResult)
        })
        
        // Collect payment check results
        finalValidInvoices.forEach(invoice => {
          const allPaymentsForLease = paymentsByLease.get(lease.id) || []
          const paymentsWithThisInvoiceId = allPaymentsForLease.filter(p => p.invoice_id === invoice.id)
          const linkedPayments = paymentsByInvoice.get(invoice.id) || []
          const actualPaid = linkedPayments.reduce((sum: number, payment: any) => 
            sum + parseFloat(payment.amount || 0), 0
          )
          
          const paymentCheck = {
            invoiceId: invoice.id,
            invoiceId_short: invoice.id.substring(0, 8) + '...',
            amountTotal: parseFloat(invoice.amount_total || 0),
            linkedPaymentsCount: linkedPayments.length,
            actualPaid: actualPaid,
            paymentsInMap: linkedPayments.map(p => ({
              payment_id: p.id,
              amount: p.amount,
              invoice_id: p.invoice_id,
              payment_date: p.payment_date
            })),
            totalPaymentsForLease: allPaymentsForLease.length,
            paymentsWithInvoiceId: paymentsWithThisInvoiceId.length,
            paymentsNotInMap: paymentsWithThisInvoiceId.length > 0 ? paymentsWithThisInvoiceId.map(p => ({
              payment_id: p.id,
              amount: p.amount,
              invoice_id: p.invoice_id,
              invoice_id_type: typeof p.invoice_id,
              invoice_id_matches: p.invoice_id === invoice.id,
              invoice_id_strict_eq: p.invoice_id === invoice.id
            })) : []
          }
          paymentCheckResults.push(paymentCheck)
        })
      }

      // Find late invoices (due before today and not fully paid)
      const lateInvoices = allUnpaidInvoices.filter(invoice => {
        const dueDate = new Date(invoice.due_date + 'T12:00:00')
        dueDate.setHours(0, 0, 0, 0)
        return dueDate < todayDate
      })

      if (lateInvoices.length === 0) {
        // Even if no late invoices, we still want to track totalAllOwed for the summary
        // But don't create a row if there are no late invoices
        totalAllOwed += totalAllOwedForLease
        continue // Skip creating row if no late invoices
      }
      
      // Add to total all owed summary - EXACT same calculation as payments page
      totalAllOwed += totalAllOwedForLease

      // Calculate days late for the oldest late invoice
      const oldestLateInvoice = lateInvoices.reduce((oldest, current) => {
        const oldestDate = new Date(oldest.due_date)
        const currentDate = new Date(current.due_date)
        return currentDate < oldestDate ? current : oldest
      })
      
      const daysLate = Math.floor((todayDate.getTime() - new Date(oldestLateInvoice.due_date).getTime()) / (1000 * 60 * 60 * 24))
      
      // Calculate totals using balance_due - EXACT same as payments page
      const totalLateAmount = lateInvoices.reduce((sum, invoice) => 
        sum + parseFloat(invoice.balance_due as any || 0), 0
      )
      const totalLateFees = lateInvoices.reduce((sum, invoice) => 
        sum + parseFloat(invoice.amount_late || 0), 0
      )
      const totalLatePeriods = lateInvoices.length
      
      // Debug logging for 5667 N Main St
      if (isMainStProperty) {
        console.log(`\n🔍 ========== DETAILED DEBUG for ${address} ==========`)
        console.log(`  - Lease ID: ${lease.id}`)
        console.log(`  - Property ID: ${lease.property_id}`)
        console.log(`  - Lease Start Date: ${lease.lease_start_date}`)
        console.log(`  - Total invoices fetched for this lease: ${invoices.length}`)
        console.log(`  - Valid invoices (after lease_start_date filter): ${validInvoices.length}`)
        console.log(`  - Final valid invoices (after future date filter): ${finalValidInvoices.length}`)
        console.log(`  - All unpaid invoices (status=OPEN && recalculatedBalanceDue>0): ${allUnpaidInvoices.length}`)
        console.log(`  - Total All Owed for this lease: $${totalAllOwedForLease}`)
        
        // Check for duplicate invoice IDs in unpaid invoices
        const unpaidInvoiceIds = allUnpaidInvoices.map(inv => inv.id)
        const uniqueUnpaidIds = new Set(unpaidInvoiceIds)
        if (unpaidInvoiceIds.length !== uniqueUnpaidIds.size) {
          console.error(`  ⚠️ DUPLICATE INVOICE IDs IN UNPAID INVOICES! Total: ${unpaidInvoiceIds.length}, Unique: ${uniqueUnpaidIds.size}`)
          const duplicateIds = unpaidInvoiceIds.filter((id, index) => unpaidInvoiceIds.indexOf(id) !== index)
          console.error(`  - Duplicate IDs: ${duplicateIds.join(', ')}`)
        }
        
        // Show ALL invoices with their filter results
        console.log(`\n  📋 ALL INVOICES FOR THIS LEASE (${finalValidInvoices.length} total):`)
        finalValidInvoices.forEach((inv: Invoice, idx: number) => {
          const balanceValue = parseFloat(inv.balance_due as any || 0)
          const isOpen = inv.status === 'OPEN'
          const hasBalance = balanceValue > 0
          const isIncluded = isOpen && hasBalance
          
          console.log(`    [${idx + 1}] Invoice ${inv.id.substring(0, 8)}...`)
          console.log(`        Due: ${inv.due_date}, Status: ${inv.status}, Amount: $${parseFloat(String(inv.amount_total || 0))}`)
          console.log(`        Balance: $${balanceValue}, Is Open: ${isOpen}, Has Balance: ${hasBalance}`)
          console.log(`        ${isIncluded ? '✅ INCLUDED' : '❌ EXCLUDED'} in unpaid count`)
        })
        
        console.log(`\n  ✅ UNPAID INVOICE IDs (${allUnpaidInvoices.length}):`, allUnpaidInvoices.map(inv => inv.id).join(', '))
        console.log(`🔍 ========== END DEBUG for ${address} ==========\n`)
      }

      // Get payments for this lease (already fetched in batch)
      const payments = paymentsByLease.get(lease.id) || []

      // Create late tenant row
      const lateTenantRow = {
        leaseId: lease.id,
        property: lease.RENT_properties,
        tenant: lease.RENT_tenants,
        lease: {
          id: lease.id,
          rent: lease.rent,
          rent_cadence: lease.rent_cadence,
          lease_start_date: lease.lease_start_date,
          lease_end_date: lease.lease_end_date,
          rent_due_day: lease.rent_due_day,
          grace_days: lease.grace_days,
          late_fee_amount: lease.late_fee_amount
        },
        daysLate,
        totalOwedLate: totalLateAmount, // Sum of late invoices only
        totalAllOwed: totalAllOwedForLease, // Sum of ALL unpaid invoices (matches payments page)
        totalLateFees,
        totalLatePeriods,
        unpaidInvoiceIds: allUnpaidInvoices.map(inv => inv.id), // Debug: invoice IDs being counted
        unpaidInvoiceCount: allUnpaidInvoices.length, // Debug: count of unpaid invoices
        // Verify no duplicates in unpaidInvoiceIds
        unpaidInvoiceIdsUnique: Array.from(new Set(allUnpaidInvoices.map(inv => inv.id))), // Unique IDs only
        unpaidInvoiceIdsUniqueCount: new Set(allUnpaidInvoices.map(inv => inv.id)).size, // Unique count
        // Debug: filter check results for console output
        filterCheckResults: isMainStProperty ? filterCheckResults : undefined,
        paymentCheckResults: isMainStProperty ? paymentCheckResults : undefined,
        allPaymentsData: isMainStProperty ? allPaymentsData : undefined,
        allInvoiceIdsData: isMainStProperty ? allInvoiceIdsData : undefined,
        paymentsMapData: isMainStProperty ? paymentsMapData : undefined,
        invoiceFilterDebug: isMainStProperty ? invoiceFilterDebugData : undefined,
        lateInvoices: lateInvoices.map(invoice => ({
          id: invoice.id,
          due_date: invoice.due_date,
          period_start: invoice.period_start,
          period_end: invoice.period_end,
          amount_total: parseFloat(String(invoice.amount_total || 0)),
          amount_paid: invoice.actualPaid || parseFloat(String(invoice.amount_paid || 0)), // Use actual paid amount
          balance_due: parseFloat(invoice.balance_due as any || 0), // Use balance_due - EXACT same as payments page
          amount_late: parseFloat(invoice.amount_late || 0),
          status: invoice.status,
          days_late: Math.floor((todayDate.getTime() - new Date(invoice.due_date).getTime()) / (1000 * 60 * 60 * 24))
        })),
        lastPaymentDate: payments && payments.length > 0 ? 
          payments[payments.length - 1].payment_date : null,
        totalPayments: payments.length,
        totalPaid: payments.reduce((sum, payment) => sum + parseFloat(payment.amount || 0), 0)
      }
      
      lateTenantsRows.push(lateTenantRow)
    }

    // Calculate summary metrics
    const summary = {
      lateLeases: lateTenantsRows.length,
      totalLateOwed: lateTenantsRows.reduce((sum, row) => sum + row.totalOwedLate, 0),
      totalAllOwed: totalAllOwed, // All unpaid invoices (like dashboard)
      thirtyPlusLate: lateTenantsRows.filter(row => row.daysLate >= 30).length,
      avgDaysLate: lateTenantsRows.length > 0 ? 
        Math.round(lateTenantsRows.reduce((sum, row) => sum + row.daysLate, 0) / lateTenantsRows.length) : 0
    }

    // Sort by total owed (highest first)
    lateTenantsRows.sort((a, b) => b.totalOwedLate - a.totalOwedLate)

    console.log('Late tenants summary:', summary)
    console.log('Late tenants rows:', lateTenantsRows.length)
    
    // Log specific tenant for debugging - check ALL rows for this property
    const mainStRows = lateTenantsRows.filter(row => 
      row.property?.address?.toLowerCase().includes('5667') || 
      row.property?.address?.toLowerCase().includes('main')
    )
    if (mainStRows.length > 0) {
      console.log(`\n🔍 ========== FINAL API RESPONSE for 5667 N Main St ==========`)
      console.log(`  Found ${mainStRows.length} row(s) for this property`)
      
      mainStRows.forEach((row, idx) => {
        console.log(`\n  Row ${idx + 1}:`)
        console.log(`    Lease ID: ${row.leaseId}`)
        console.log(`    Property Address: ${row.property?.address}`)
        console.log(`    Total All Owed: $${row.totalAllOwed}`)
        console.log(`    Unpaid Invoice Count: ${row.unpaidInvoiceCount}`)
        console.log(`    Unique Invoice Count: ${row.unpaidInvoiceIdsUniqueCount}`)
        console.log(`    Invoice IDs: ${row.unpaidInvoiceIds?.join(', ') || 'none'}`)
        
        if (row.unpaidInvoiceCount !== row.unpaidInvoiceIdsUniqueCount) {
          console.error(`    ⚠️ DUPLICATE DETECTED: unpaidInvoiceCount=${row.unpaidInvoiceCount}, uniqueCount=${row.unpaidInvoiceIdsUniqueCount}`)
        }
      })
      
      // If multiple rows, show combined totals
      if (mainStRows.length > 1) {
        const combinedTotal = mainStRows.reduce((sum, row) => sum + (row.totalAllOwed || 0), 0)
        const combinedCount = mainStRows.reduce((sum, row) => sum + (row.unpaidInvoiceCount || 0), 0)
        const allInvoiceIds = mainStRows.flatMap(row => row.unpaidInvoiceIds || [])
        const uniqueInvoiceIds = new Set(allInvoiceIds)
        
        console.log(`\n  📊 COMBINED TOTALS (if viewing as single property):`)
        console.log(`    Total All Owed: $${combinedTotal}`)
        console.log(`    Combined Invoice Count: ${combinedCount}`)
        console.log(`    Unique Invoice Count: ${uniqueInvoiceIds.size}`)
        console.log(`    All Invoice IDs: ${allInvoiceIds.join(', ')}`)
        
        if (combinedCount !== uniqueInvoiceIds.size) {
          console.error(`    ⚠️ DUPLICATES ACROSS LEASES: Combined count=${combinedCount}, Unique count=${uniqueInvoiceIds.size}`)
        }
      }
      
      console.log(`🔍 ========== END FINAL API RESPONSE ==========\n`)
    }

    return NextResponse.json({
      version: API_VERSION,
      debug: {
        today,
        todayType: typeof today,
        totalInvoicesFetched: allInvoices?.length || 0,
        totalInvoicesRaw: allInvoicesRaw?.length || 0,
        totalLeases: leases.length,
        currentDate: new Date().toISOString().split('T')[0]
      },
      summary,
      rows: lateTenantsRows
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })
  } catch (error) {
    console.error('Error in late tenants API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch late tenants', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
