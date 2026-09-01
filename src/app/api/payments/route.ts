import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { supabaseServer } from '@/lib/supabase-server'
import { isAuthError, requireApiAuth } from '@/lib/auth/api-auth'import {
  allocationGroupNote,
  getDeferredSelectedInvoiceId,
  planNewestFirstAllocation,
  planSelectedInvoiceForwardAllocation,
  withDeferredSelectedInvoiceNote,
  withoutDeferredSelectedInvoiceNote,
} from '@/lib/payments/post-allocated-payment'

export async function POST(request: Request) {
  const auth = await requireApiAuth(request, { write: true })
  if (isAuthError(auth)) return auth
try {
    const paymentData = await request.json()
    
    console.log('Processing payment with allocation:', paymentData)
    
    // Support both camelCase and snake_case field names
    const tenantId = paymentData.tenantId || paymentData.tenant_id
    const leaseId = paymentData.leaseId || paymentData.lease_id
    const propertyId = paymentData.propertyId || paymentData.property_id
    const amount = paymentData.amount
    const receivedAt = paymentData.receivedAt || paymentData.payment_date
    const memo = paymentData.memo || paymentData.notes
    const paymentType = paymentData.payment_type || paymentData.paymentType || 'Rent'
    let invoiceId = paymentData.invoice_id || paymentData.invoiceId
    
    // Handle expected invoices (frontend-generated IDs like "expected-YYYY-MM-DD")
    // If invoiceId starts with "expected-", create the actual invoice first
    if (invoiceId && typeof invoiceId === 'string' && invoiceId.startsWith('expected-')) {
      console.log('Detected expected invoice ID, creating invoice first:', invoiceId)
      
      // Extract due_date from expected invoice ID (format: expected-YYYY-MM-DD)
      const dueDate = invoiceId.replace('expected-', '')
      
      // Fetch lease to get required data for invoice creation
      const { data: lease, error: leaseError } = await supabaseServer
        .from('RENT_leases')
        .select('id, rent, rent_cadence, rent_due_day, property_id, tenant_id, lease_start_date, lease_end_date')
        .eq('id', leaseId)
        .single()
      
      if (leaseError || !lease) {
        console.error('Error fetching lease for invoice creation:', leaseError)
        return NextResponse.json(
          { error: 'Lease not found. Cannot create invoice for expected invoice.', details: leaseError?.message },
          { status: 404 }
        )
      }
      
      // Validate and calculate period dates from due_date (for monthly leases)
      const dueDateObj = new Date(dueDate)
      
      // For monthly leases, validate due_date matches rent_due_day
      const cadence = lease.rent_cadence?.toLowerCase() || 'monthly'
      if (cadence === 'monthly' && lease.rent_due_day) {
        const expectedDay = Math.min(lease.rent_due_day, new Date(dueDateObj.getFullYear(), dueDateObj.getMonth() + 1, 0).getDate())
        if (dueDateObj.getDate() !== expectedDay) {
          console.warn(`Due date (${dueDateObj.getDate()}) does not match lease rent_due_day (${lease.rent_due_day}). Using provided due date anyway.`)
        }
      }
      
      const periodStart = new Date(dueDateObj.getFullYear(), dueDateObj.getMonth(), 1).toISOString().split('T')[0]
      const periodEnd = new Date(dueDateObj.getFullYear(), dueDateObj.getMonth() + 1, 0).toISOString().split('T')[0]
      
      // Check if invoice already exists for this lease and due_date
      const { data: existingInvoice, error: checkError } = await supabaseServer
        .from('RENT_invoices')
        .select('id')
        .eq('lease_id', leaseId)
        .eq('due_date', dueDate)
        .maybeSingle()
      
      if (checkError) {
        console.error('Error checking for existing invoice:', checkError)
        // Continue anyway - might be a transient error
      }
      
      if (existingInvoice?.id) {
        console.log('Invoice already exists for this lease and due date, using existing invoice:', existingInvoice.id)
        invoiceId = existingInvoice.id
      } else {
        // Calculate invoice totals
        const amountRent = parseFloat(lease.rent || 0)
        const amountLate = 0
        const amountOther = 0
        const amountTotal = amountRent + amountLate + amountOther
        const amountPaid = 0
        const balanceDue = amountTotal - amountPaid
        
        // Create invoice record directly in database
        const invoiceRecord: any = {
          lease_id: leaseId,
          property_id: propertyId || lease.property_id,
          tenant_id: tenantId || lease.tenant_id,
          due_date: dueDate,
          period_start: periodStart,
          period_end: periodEnd,
          amount_rent: amountRent,
          amount_late: amountLate,
          amount_other: amountOther,
          amount_total: amountTotal,
          amount_paid: amountPaid,
          balance_due: balanceDue,
          status: balanceDue <= 0 ? 'PAID' : 'OPEN',
          paid_in_full_at: balanceDue <= 0 ? new Date().toISOString() : null
        }
        
        console.log('Creating invoice with data:', invoiceRecord)
        
        // Insert invoice into database
        const { data: createdInvoice, error: invoiceError } = await supabaseServer
          .from('RENT_invoices')
          .insert([invoiceRecord])
          .select()
          .single()
        
        if (invoiceError || !createdInvoice) {
          console.error('Failed to create invoice for expected invoice:', {
            error: invoiceError,
            invoiceRecord,
            leaseId,
            dueDate
          })
          return NextResponse.json(
            { 
              error: 'Failed to create invoice for expected invoice', 
              details: invoiceError?.message || 'Unknown error',
              hint: invoiceError?.hint || undefined,
              code: invoiceError?.code || undefined
            },
            { status: 500 }
          )
        }
        
        if (!createdInvoice.id) {
          console.error('Invoice created but no ID returned:', createdInvoice)
          return NextResponse.json(
            { 
              error: 'Invoice created but no ID returned. Cannot link payment to invoice.',
              details: 'Database returned invoice without ID'
            },
            { status: 500 }
          )
        }
        
        invoiceId = createdInvoice.id
        console.log('Invoice created successfully for expected invoice:', invoiceId)
      }
    }
    
    // Final safety check: don't allow expected invoice IDs in payment record
    if (invoiceId && typeof invoiceId === 'string' && invoiceId.startsWith('expected-')) {
      console.error('Expected invoice ID still present after processing:', invoiceId)
      return NextResponse.json(
        { 
          error: 'Invalid invoice ID. Expected invoice was not created properly.',
          details: `Invoice ID "${invoiceId}" is not a valid UUID`
        },
        { status: 400 }
      )
    }
    
    // Validate required fields
    if (!tenantId || !leaseId || !amount) {
      return NextResponse.json(
        { error: 'Missing required fields: tenantId/tenant_id, leaseId/lease_id, and amount are required' },
        { status: 400 }
      )
    }

    // Validate amount is positive
    if (amount <= 0) {
      return NextResponse.json(
        { error: 'Amount must be greater than 0' },
        { status: 400 }
      )
    }
    
    // Get property_id if not provided
    let finalPropertyId = propertyId
    if (!finalPropertyId) {
      const { data: lease, error: leaseError } = await supabaseServer
        .from('RENT_leases')
        .select('property_id')
        .eq('id', leaseId)
        .single()
      
      if (leaseError || !lease) {
        console.error('Error fetching lease:', leaseError)
        return NextResponse.json(
          { error: 'Invalid lease ID or lease not found' },
          { status: 400 }
        )
      }
      finalPropertyId = lease.property_id
    }
    
    // Use receivedAt if provided, otherwise current timestamp
    const paymentDate = receivedAt || new Date().toISOString()
    const paymentDateOnly = String(paymentDate).split('T')[0]
    const paymentMethod =
      paymentData.payment_method ||
      paymentData.paymentMethod ||
      'Manual Entry'

    const baseRecord: Record<string, unknown> = {
      tenant_id: tenantId,
      lease_id: leaseId,
      property_id: finalPropertyId,
      payment_date: paymentDate,
      amount: amount,
      payment_type: paymentType,
      payment_method: paymentMethod,
      status: 'completed',
      notes: memo || '',
    }

    const { data: openInvoices, error: invoiceLoadError } = await supabaseServer
      .from('RENT_invoices')
      .select(
        'id, due_date, period_start, period_end, balance_due, amount_total, amount_paid, status',
      )
      .eq('lease_id', leaseId)

    if (invoiceLoadError) {
      console.error('Error loading invoices for allocation:', invoiceLoadError)
      return NextResponse.json(
        {
          error: 'Failed to load invoices for payment allocation',
          details: invoiceLoadError.message,
        },
        { status: 500 },
      )
    }

    const selectedInvoice = invoiceId
      ? (openInvoices || []).find(
          (invoice) => String(invoice.id) === String(invoiceId),
        )
      : null
    if (invoiceId && !selectedInvoice) {
      return NextResponse.json(
        { error: 'Selected invoice does not belong to this lease' },
        { status: 400 },
      )
    }
    if (
      selectedInvoice &&
      ['VOID', 'CANCELLED', 'CANCELED'].includes(
        String(selectedInvoice.status || '').toUpperCase(),
      )
    ) {
      return NextResponse.json(
        { error: 'Selected invoice is void or cancelled' },
        { status: 400 },
      )
    }

    // Selected staff invoice first, then later due dates. Requests without an
    // invoice selection retain the automatic newest-eligible-first fallback.
    // Production truth remains RENT_payments.invoice_id + DB triggers; waterfall
    // splits become one payment row per invoice leg (same logical payment).
    const allocationStrategy = invoiceId ? 'selected_forward' : 'newest_first'
    const plan = invoiceId
      ? planSelectedInvoiceForwardAllocation({
          paymentAmount: Number(amount),
          selectedInvoiceId: String(invoiceId),
          invoices: openInvoices || [],
        })
      : planNewestFirstAllocation({
          paymentAmount: Number(amount),
          paymentEffectiveDate: paymentDateOnly,
          invoices: openInvoices || [],
        })

    // No eligible invoices: still record the payment unallocated.
    if (plan.splits.length === 0) {
      const { data: payment, error: paymentError } = await supabaseServer
        .from('RENT_payments')
        .insert([baseRecord])
        .select()
        .single()

      if (paymentError) {
        console.error('Error inserting unallocated payment:', paymentError)
        return NextResponse.json(
          { error: 'Failed to insert payment', details: paymentError.message },
          { status: 500 },
        )
      }

      return NextResponse.json({
        payment,
        allocations: [],
        unallocatedAmount: plan.unallocatedAmount,
      })
    }

    const groupId = randomUUID()
    const legCount =
      plan.splits.length + (plan.unallocatedAmount > 0.009 ? 1 : 0)
    const rows = plan.splits.map((split, index) => ({
      ...baseRecord,
      amount: split.amount,
      invoice_id: split.invoiceId,
      notes: [
        memo || '',
        allocationGroupNote(groupId, index + 1, legCount, allocationStrategy),
      ]
        .filter(Boolean)
        .join(' | '),
    }))
    if (plan.unallocatedAmount > 0.009) {
      rows.push({
        ...baseRecord,
        amount: plan.unallocatedAmount,
        notes: [
          memo || '',
          allocationGroupNote(groupId, legCount, legCount, allocationStrategy),
          'unallocated_remainder',
        ]
          .filter(Boolean)
          .join(' | '),
      })
    }

    const { data: inserted, error: paymentError } = await supabaseServer
      .from('RENT_payments')
      .insert(rows)
      .select()

    if (paymentError || !inserted?.length) {
      console.error('Error inserting allocated payment(s):', paymentError)
      return NextResponse.json(
        {
          error: 'Failed to insert payment',
          details: paymentError?.message || 'No rows returned',
        },
        { status: 500 },
      )
    }

    const payment = inserted[0]
    console.log('Payment recorded with allocation:', {
      paymentId: payment.id,
      groupId,
      allocationStrategy,
      splits: plan.splits,
    })

    return NextResponse.json({
      payment,
      payments: inserted,
      allocationGroupId: groupId,
      allocationStrategy,
      allocations: inserted.map((row) => ({
        invoice_id: row.invoice_id,
        amount: row.amount,
        payment_id: row.id,
      })),
      unallocatedAmount: plan.unallocatedAmount,
      requestedInvoiceId: invoiceId || null,
    })
  } catch (error) {
    console.error('Error in payments API:', error)
    return NextResponse.json(
      { 
        error: 'Failed to process payment', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  const auth = await requireApiAuth(request)
  if (isAuthError(auth)) return auth
try {
    const { searchParams } = new URL(request.url)
    
    // Parse query parameters for filtering
    const tenantId = searchParams.get('tenantId')
    const leaseId = searchParams.get('leaseId')
    const propertyId = searchParams.get('propertyId')
    const invoiceId = searchParams.get('invoiceId')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const limit = searchParams.get('limit')
    
    console.log('Fetching payments with filters:', {
      tenantId,
      leaseId,
      propertyId,
      invoiceId,
      from,
      to,
      limit
    })
    
    // Handle expected invoices FIRST before any database queries
    if (invoiceId && typeof invoiceId === 'string' && invoiceId.startsWith('expected-')) {
      console.log('Expected invoice ID provided, returning empty payments array:', invoiceId)
      // Return empty array for expected invoices - they don't have payments yet
      return NextResponse.json([])
    }
    
    // Special handling for invoiceId: fetch invoice details first, then get all related payments
    let payments: any[] = []
    let error: any = null
    
    if (invoiceId) {
      
      // First, get the invoice to find its lease_id and period dates
      const { data: invoice, error: invoiceError } = await supabaseServer
        .from('RENT_invoices')
        .select('id, lease_id, period_start, period_end, due_date')
        .eq('id', invoiceId)
        .single()
      
      console.log('Fetching invoice for invoiceId:', invoiceId)
      
      if (invoiceError) {
        console.error('Error fetching invoice:', invoiceError)
        error = invoiceError
      } else if (invoice) {
        console.log('Invoice found:', { 
          id: invoice.id, 
          lease_id: invoice.lease_id, 
          period_start: invoice.period_start, 
          period_end: invoice.period_end,
          due_date: invoice.due_date 
        })
        
        // Fetch payments in two ways:
        // 1. Payments directly linked to this invoice
        // 2. Payments for the same lease within the invoice period (even if not linked)
        const { data: linkedPayments, error: linkedError } = await supabaseServer
          .from('RENT_payments')
          .select(`
            *,
            RENT_tenants(
              id,
              full_name,
              first_name,
              last_name,
              email
            ),
            RENT_properties(
              id,
              name,
              address
            ),
            RENT_leases(
              id,
              rent,
              status
            )
          `)
          .eq('invoice_id', invoiceId)
          .order('payment_date', { ascending: false })
        
        // Handle linked payments - use empty array if error
        const safeLinkedPayments = linkedError ? [] : (linkedPayments || [])
        
        console.log('Linked payments result:', { 
          count: safeLinkedPayments.length, 
          payments: safeLinkedPayments.map(p => ({ id: p.id, amount: p.amount, date: p.payment_date })),
          error: linkedError 
        })
        
        if (linkedError) {
          console.error('Error fetching linked payments (will continue with period payments):', linkedError)
        }
        
        // Also fetch payments for the same lease within the invoice period
        // Fallback to all lease payments if period search finds nothing
        let periodPayments: any[] = []
        let allLeasePayments: any[] = []
        
        if (invoice.lease_id) {
          // Get the property_id from the lease
          const { data: leaseData, error: leaseError } = await supabaseServer
            .from('RENT_leases')
            .select('property_id')
            .eq('id', invoice.lease_id)
            .single()
          
          const propertyId = leaseData?.property_id
          
          // OPTION 3: Hybrid approach - Use period_start and period_end for date range
          // If period dates exist, use them; otherwise fall back to month of due_date
          let startDateStr: string
          let endDateStr: string
          
          if (invoice.period_start && invoice.period_end) {
            // Use invoice period dates
            startDateStr = invoice.period_start
            endDateStr = invoice.period_end
            console.log('Using invoice period dates:', {
              period_start: startDateStr,
              period_end: endDateStr
            })
          } else {
            // Fallback to month of due_date
            const dueDate = invoice.due_date ? new Date(invoice.due_date) : new Date()
            const startDate = new Date(dueDate.getFullYear(), dueDate.getMonth(), 1)
            const endDate = new Date(dueDate.getFullYear(), dueDate.getMonth() + 1, 0)
            startDateStr = startDate.toISOString().split('T')[0]
            endDateStr = endDate.toISOString().split('T')[0]
            console.log('Using month of due_date as fallback:', {
              due_date: invoice.due_date,
              month_start: startDateStr,
              month_end: endDateStr
            })
          }
          
          console.log('Fetching payments for lease/property in period:', {
            lease_id: invoice.lease_id,
            property_id: propertyId,
            period_start: startDateStr,
            period_end: endDateStr
          })
          
          // First, get all payments within the period without joins to avoid filtering issues
          let periodQuery = supabaseServer
            .from('RENT_payments')
            .select('*')
            .gte('payment_date', startDateStr)
            .lte('payment_date', endDateStr)
            .order('payment_date', { ascending: false })
          
          // Use OR condition: payments matching lease_id OR property_id
          if (propertyId) {
            periodQuery = periodQuery.or(`lease_id.eq.${invoice.lease_id},property_id.eq.${propertyId}`)
          } else {
            periodQuery = periodQuery.eq('lease_id', invoice.lease_id)
          }
          
          const { data: periodPaymentsData, error: periodError } = await periodQuery
          
          console.log('Period payments query result (raw):', { 
            count: periodPaymentsData?.length || 0,
            payments: periodPaymentsData?.map(p => ({ 
              id: p.id, 
              amount: p.amount, 
              date: p.payment_date, 
              invoice_id: p.invoice_id,
              lease_id: p.lease_id,
              property_id: p.property_id
            })),
            error: periodError 
          })
          
          if (periodError) {
            console.error('Error fetching period payments:', periodError)
          } else if (periodPaymentsData && periodPaymentsData.length > 0) {
            // Now fetch the related data for these payments
            const paymentIds = periodPaymentsData.map(p => p.id)
            const { data: enrichedPayments, error: enrichError } = await supabaseServer
              .from('RENT_payments')
              .select(`
                *,
                RENT_tenants(
                  id,
                  full_name,
                  first_name,
                  last_name,
                  email
                ),
                RENT_properties(
                  id,
                  name,
                  address
                ),
                RENT_leases(
                  id,
                  rent,
                  status
                )
              `)
              .in('id', paymentIds)
            
            if (enrichError) {
              console.error('Error enriching payments:', enrichError)
              // Use raw payments if enrichment fails
              periodPayments = periodPaymentsData
            } else {
              // Filter out payments that are already in linkedPayments
              const linkedPaymentIds = new Set(safeLinkedPayments.map(p => p.id))
              periodPayments = (enrichedPayments || []).filter(p => !linkedPaymentIds.has(p.id))
            }
            
            console.log(`Found ${periodPayments.length} period payments (after filtering duplicates) for invoice ${invoiceId}`)
          }
          
          // FALLBACK: If no payments found in period, fetch ALL payments for the lease
          if (periodPayments.length === 0 && safeLinkedPayments.length === 0) {
            console.log('No payments found in period, fetching ALL payments for lease as fallback')
            
            let allLeaseQuery = supabaseServer
              .from('RENT_payments')
              .select('*')
              .order('payment_date', { ascending: false })
              .limit(100) // Limit to prevent huge queries
            
            // Use OR condition: payments matching lease_id OR property_id
            if (propertyId) {
              allLeaseQuery = allLeaseQuery.or(`lease_id.eq.${invoice.lease_id},property_id.eq.${propertyId}`)
            } else {
              allLeaseQuery = allLeaseQuery.eq('lease_id', invoice.lease_id)
            }
            
            const { data: allLeasePaymentsData, error: allLeaseError } = await allLeaseQuery
            
            if (allLeaseError) {
              console.error('Error fetching all lease payments:', allLeaseError)
            } else if (allLeasePaymentsData && allLeasePaymentsData.length > 0) {
              // Enrich the payments
              const allPaymentIds = allLeasePaymentsData.map(p => p.id)
              const { data: enrichedAllPayments, error: enrichAllError } = await supabaseServer
                .from('RENT_payments')
                .select(`
                  *,
                  RENT_tenants(
                    id,
                    full_name,
                    first_name,
                    last_name,
                    email
                  ),
                  RENT_properties(
                    id,
                    name,
                    address
                  ),
                  RENT_leases(
                    id,
                    rent,
                    status
                  )
                `)
                .in('id', allPaymentIds)
              
              if (enrichAllError) {
                console.error('Error enriching all lease payments:', enrichAllError)
                allLeasePayments = allLeasePaymentsData
              } else {
                allLeasePayments = enrichedAllPayments || []
              }
              
              console.log(`Found ${allLeasePayments.length} total payments for lease (fallback)`)
            }
          }
        }
        
        // Combine and deduplicate by payment id
        // Priority: linked payments > period payments > all lease payments (fallback)
        const allPayments = [...safeLinkedPayments, ...periodPayments, ...allLeasePayments]
        const uniquePayments = Array.from(
          new Map(allPayments.map(p => [p.id, p])).values()
        )
        payments = uniquePayments
        
        console.log('Final combined payments:', {
          linkedCount: safeLinkedPayments.length,
          periodCount: periodPayments.length,
          fallbackCount: allLeasePayments.length,
          totalUnique: uniquePayments.length,
          paymentIds: uniquePayments.map(p => p.id),
          paymentAmounts: uniquePayments.map(p => ({ 
            id: p.id, 
            amount: p.amount, 
            date: p.payment_date,
            invoice_id: p.invoice_id,
            isLinked: p.invoice_id === invoiceId
          }))
        })
        
        console.log(`Invoice ${invoiceId}: Found ${safeLinkedPayments.length} linked payments, ${periodPayments.length} period payments, ${allLeasePayments.length} fallback payments, ${uniquePayments.length} total unique payments`)
      }
    } else {
      // Build the query for non-invoice queries
      let query = supabaseServer
        .from('RENT_payments')
        .select(`
          *,
          RENT_tenants(
            id,
            full_name,
            first_name,
            last_name,
            email
          ),
          RENT_properties(
            id,
            name,
            address
          ),
          RENT_leases(
            id,
            rent,
            status
          )
        `)
      
      // Apply filters
      if (tenantId) {
        query = query.eq('tenant_id', tenantId)
      }
      
      if (leaseId) {
        query = query.eq('lease_id', leaseId)
      }
      
      if (propertyId) {
        query = query.eq('property_id', propertyId)
      }
      
      if (from) {
        query = query.gte('payment_date', from)
      }
      
      if (to) {
        query = query.lte('payment_date', to)
      }
      
      // Order by payment date descending (newest first)
      query = query.order('payment_date', { ascending: false })
      
      // Apply limit if specified
      if (limit) {
        const limitNum = parseInt(limit, 10)
        if (!isNaN(limitNum) && limitNum > 0) {
          query = query.limit(limitNum)
        }
      }
      
      const result = await query
      payments = result.data || []
      error = result.error
    }
    
    if (error) {
      console.error('Error fetching payments:', error)
      throw new Error(`Error fetching payments: ${error.message}`)
    }

    // Transform the data to include joined information
    const transformedPayments = (payments || []).map(payment => ({
      ...payment,
      notes: withoutDeferredSelectedInvoiceNote(payment.notes),
      tenant_name: payment.RENT_tenants?.full_name || 
                  `${payment.RENT_tenants?.first_name || ''} ${payment.RENT_tenants?.last_name || ''}`.trim(),
      tenant_email: payment.RENT_tenants?.email,
      property_name: payment.RENT_properties?.name,
      property_address: payment.RENT_properties?.address,
      lease_rent: payment.RENT_leases?.rent,
      lease_status: payment.RENT_leases?.status,
      // Remove the joined objects to clean up the response
      RENT_tenants: undefined,
      RENT_properties: undefined,
      RENT_leases: undefined
    })) || []

    console.log('Returning payments:', transformedPayments.length)
    return NextResponse.json(transformedPayments)
  } catch (error) {
    console.error('Error in payments GET API:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch payments', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiAuth(request, { write: true })
  if (isAuthError(auth)) return auth
try {
    const body = await request.json()
    const paymentId = typeof body?.id === 'string' ? body.id.trim() : ''

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

    if (!paymentId || !uuidPattern.test(paymentId)) {
      return NextResponse.json(
        { error: 'A valid payment UUID is required' },
        { status: 400 },
      )
    }

    console.log('Deleting payment:', paymentId)

    const { data: existing, error: lookupError } = await supabaseServer
      .from('RENT_payments')
      .select('id')
      .eq('id', paymentId)
      .maybeSingle()

    if (lookupError) {
      console.error('Payment lookup error:', lookupError)
      return NextResponse.json(
        { error: 'Failed to verify payment', details: lookupError.message },
        { status: 500 },
      )
    }

    if (!existing) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    // Delete payment from database
    const { error: deleteError } = await supabaseServer
      .from('RENT_payments')
      .delete()
      .eq('id', paymentId)

    if (deleteError) {
      console.error('Database delete error:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete payment', details: deleteError.message, hint: deleteError.hint, code: deleteError.code },
        { status: 500 }
      )
    }

    console.log('Payment deleted successfully')
    return NextResponse.json({ 
      success: true,
      message: 'Payment deleted successfully'
    })
  } catch (error) {
    console.error('Error in payments DELETE API:', error)
    return NextResponse.json(
      { error: 'Failed to delete payment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  const auth = await requireApiAuth(request, { write: true })
  if (isAuthError(auth)) return auth
try {
    const { searchParams } = new URL(request.url)
    const paymentId = searchParams.get('id')
    const body = await request.json()
    
    if (!paymentId) {
      return NextResponse.json(
        { error: 'Payment ID is required' },
        { status: 400 }
      )
    }

    console.log('Updating payment:', paymentId, body)

    // Build update object with only defined fields
    const updateData: any = {}
    if (body.payment_date !== undefined) updateData.payment_date = body.payment_date
    if (body.amount !== undefined) updateData.amount = body.amount
    if (body.payment_type !== undefined) updateData.payment_type = body.payment_type
    if (body.notes !== undefined) {
      const { data: existingPayment } = await supabaseServer
        .from('RENT_payments')
        .select('notes')
        .eq('id', paymentId)
        .maybeSingle()
      const deferredInvoiceId = existingPayment
        ? getDeferredSelectedInvoiceId(existingPayment.notes)
        : null
      updateData.notes = deferredInvoiceId
        ? withDeferredSelectedInvoiceNote(String(body.notes || ''), deferredInvoiceId)
        : body.notes
    }

    console.log('Update data:', updateData)

    // Update payment in database - don't select to avoid FK issues
    const { error: updateError } = await supabaseServer
      .from('RENT_payments')
      .update(updateData)
      .eq('id', paymentId)

    if (updateError) {
      console.error('Database update error:', updateError)
      return NextResponse.json(
        { error: 'Failed to update payment', details: updateError.message, hint: updateError.hint, code: updateError.code },
        { status: 500 }
      )
    }

    console.log('Payment updated successfully')

    // Fetch the updated payment separately (simple query, no joins)
    const { data: updatedPayment, error: fetchError } = await supabaseServer
      .from('RENT_payments')
      .select('id, lease_id, property_id, tenant_id, invoice_id, payment_date, amount, payment_type, payment_method, status, notes, created_at')
      .eq('id', paymentId)
      .limit(1)

    if (fetchError) {
      console.warn('Could not fetch updated payment:', fetchError)
    }

    return NextResponse.json({ 
      success: true,
      payment: updatedPayment && updatedPayment.length > 0 ? updatedPayment[0] : { id: paymentId }
    })
  } catch (error) {
    console.error('Error in payments PUT API:', error)
    return NextResponse.json(
      { error: 'Failed to update payment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
