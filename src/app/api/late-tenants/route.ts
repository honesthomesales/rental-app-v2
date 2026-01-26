import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

// Cache this route for 0 seconds to ensure fresh data (disable caching for debugging)
export const revalidate = 0

// Version number to track code deployments
const API_VERSION = 'v3.0-diagnostic-match'

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
    const todayParam = searchParams.get('today')
    const today = todayParam || new Date().toISOString().split('T')[0]
    const todayDate = new Date(today + 'T12:00:00')
    todayDate.setHours(0, 0, 0, 0)
    
    console.log('Fetching late tenants for date:', today)
    
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
    const { data: allInvoices, error: invoicesError } = await supabaseServer
      .from('RENT_invoices')
      .select('*')
      .in('lease_id', leaseIds)
      .lte('due_date', today)  // Same as payments page: /api/invoices?leaseId=...&to=${today}
      .order('due_date', { ascending: false })

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
    
    allInvoices?.forEach(invoice => {
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
      const invoices = invoicesByLease.get(lease.id) || []
      
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
      
      // CRITICAL FIX: Filter out invoices with due_date > today FIRST
      // The Supabase query should have done this, but we need to ensure it's applied
      // This is the EXACT same filter as Payments page: /api/invoices?to=${today}
      const validInvoices = invoices.filter(invoice => {
        const invoiceDueDate = invoice.due_date
        
        // CRITICAL: Only process invoices with due_date <= today (matching Payments page)
        // String comparison works for ISO date strings (YYYY-MM-DD)
        // This MUST match the Payments page filter exactly
        if (invoiceDueDate > today) {
          return false // Skip future invoices - they're not due yet
        }
        
        // Filter by due_date >= leaseStartDate (matching Payments page line 451-453)
        if (leaseStartDate && invoiceDueDate < leaseStartDate) {
          return false
        }
        
        return true
      })
      
      // Debug logging for 5667 N Main St
      if (isMainStProperty) {
        console.log(`\n🔍 FILTER DEBUG for ${address}:`)
        console.log(`  - today value: "${today}"`)
        console.log(`  - invoices before filter: ${invoices.length}`)
        console.log(`  - invoices after filter: ${validInvoices.length}`)
        console.log(`  - leaseStartDate: ${leaseStartDate}`)
        
        // Show which invoices were filtered out
        const filteredOut = invoices.filter(inv => {
          const invDueDate = inv.due_date
          return invDueDate > today || (leaseStartDate && invDueDate < leaseStartDate)
        })
        if (filteredOut.length > 0) {
          console.log(`  - Filtered out ${filteredOut.length} invoices:`)
          filteredOut.forEach(inv => {
            const reason = inv.due_date > today ? 'future' : 'before lease start'
            console.log(`    - ${inv.id.substring(0, 8)}... due_date="${inv.due_date}" (${reason})`)
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
        allInvoiceIdsData = validInvoices.map((inv, idx) => ({
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
      
      // Recalculate balance_due using actual payment totals - EXACT COPY from payments page
      // Payments page lines 551-567: Simple lookup by invoice_id, no allocation logic
      const invoicesWithRecalculatedBalance = validInvoices.map(invoice => {
        // EXACT copy from payments page line 554
        const linkedPayments = paymentsByInvoice.get(invoice.id) || []
        // EXACT copy from payments page line 555-557
        const actualPaid = linkedPayments.reduce((sum: number, payment: any) => 
          sum + parseFloat(payment.amount || 0), 0
        )
        
        // EXACT copy from payments page line 560-561
        const amountTotal = parseFloat(invoice.amount_total as any || 0)
        const recalculatedBalanceDue = amountTotal - actualPaid
        
        // Debug for 5667 N Main St - show payment linking and collect for console
        if (isMainStProperty) {
          const allPaymentsForLease = paymentsByLease.get(lease.id) || []
          const paymentsWithThisInvoiceId = allPaymentsForLease.filter(p => p.invoice_id === invoice.id)
          
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
        }
        
        // EXACT copy from payments page line 563-566
        return {
          ...invoice,
          balance_due: recalculatedBalanceDue // Use recalculated balance
        }
      })

      // Find all unpaid invoices - EXACT COPY from payments page line 571-573
      const allUnpaidInvoices = invoicesWithRecalculatedBalance.filter((inv: Invoice) => {
        // EXACT copy from payments page line 572
        const isUnpaid = inv.status === 'OPEN' && parseFloat(inv.balance_due as any || 0) > 0
        
        // Debug for 5667 N Main St
        if (isMainStProperty) {
          const balanceValue = parseFloat(inv.balance_due as any || 0)
          const filterResult = {
            invoiceId: inv.id,
            status: inv.status,
            isOpen: inv.status === 'OPEN',
            balance_due_raw: inv.balance_due,
            balance_due_type: typeof inv.balance_due,
            balance_due_parsed: balanceValue,
            hasBalance: balanceValue > 0,
            result: isUnpaid,
            included: isUnpaid ? 'YES' : 'NO'
          }
          filterCheckResults.push(filterResult)
        }
        
        return isUnpaid
      })

      // Find late invoices (due before today and not fully paid)
      const lateInvoices = allUnpaidInvoices.filter(invoice => {
        const dueDate = new Date(invoice.due_date + 'T12:00:00')
        dueDate.setHours(0, 0, 0, 0)
        return dueDate < todayDate
      })

      // Calculate total of ALL unpaid invoices (not just late ones) - EXACT COPY from payments page line 576-578
      const totalAllOwedForLease = allUnpaidInvoices.reduce((sum: number, inv: Invoice) => 
        sum + parseFloat(inv.balance_due as any || 0), 0
      )

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
        console.log(`  - Invoices with recalculated balance: ${invoicesWithRecalculatedBalance.length}`)
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
        console.log(`\n  📋 ALL INVOICES FOR THIS LEASE (${validInvoices.length} total):`)
        invoicesWithRecalculatedBalance.forEach((inv, idx) => {
          const balanceValue = parseFloat(inv.balance_due as any || 0)
          const isOpen = inv.status === 'OPEN'
          const hasBalance = balanceValue > 0
          const isIncluded = isOpen && hasBalance
          
          console.log(`    [${idx + 1}] Invoice ${inv.id.substring(0, 8)}...`)
          console.log(`        Due: ${inv.due_date}, Status: ${inv.status}, Amount: $${parseFloat(inv.amount_total || 0)}`)
          console.log(`        Recalculated Balance: $${balanceValue}, Is Open: ${isOpen}, Has Balance: ${hasBalance}`)
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
        lateInvoices: lateInvoices.map(invoice => ({
          id: invoice.id,
          due_date: invoice.due_date,
          period_start: invoice.period_start,
          period_end: invoice.period_end,
          amount_total: parseFloat(invoice.amount_total || 0),
          amount_paid: invoice.actualPaid || parseFloat(invoice.amount_paid || 0), // Use actual paid amount
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
