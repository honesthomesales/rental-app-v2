import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { getBusinessDate } from '@/lib/business-date'
import { buildAccountLedger } from '@/lib/portfolio-ledger/service'
import {
  loadInvoicesForLeases,
  loadPaymentsForLeases,
} from '@/lib/portfolio-ledger/repository'

export async function POST(request: Request) {
  try {
    const { invoiceId, leaseId } = await request.json()

    if (!invoiceId || !leaseId) {
      return NextResponse.json({ error: 'Invoice ID and Lease ID are required' }, { status: 400 })
    }

    // Fetch invoice details
    const { data: invoice, error: invoiceError } = await supabaseServer
      .from('RENT_invoices')
      .select('*')
      .eq('id', invoiceId)
      .single()

    if (invoiceError || !invoice) {
      console.error('Error fetching invoice:', invoiceError)
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Fetch lease, property, and tenant details
    const { data: leaseData, error: leaseError } = await supabaseServer
      .from('RENT_leases')
      .select(`
        *,
        RENT_properties(*),
        RENT_tenants(*)
      `)
      .eq('id', leaseId)
      .single()

    if (leaseError || !leaseData) {
      console.error('Error fetching lease, property, or tenant:', leaseError)
      return NextResponse.json({ error: 'Lease, property, or tenant data not found' }, { status: 404 })
    }

    const property = leaseData.RENT_properties
    const tenant = leaseData.RENT_tenants

    // Determine state for appropriate notice template
    const state = property.state?.toUpperCase() || 'SC'
    const isSC = state === 'SC'
    const isNC = state === 'NC'

    // Calculate notice date and deadline
    const noticeDate = new Date()
    const sevenDaysFromNow = new Date()
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7)

    // Format dates
    const dateFormatter = new Intl.DateTimeFormat('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    })
    const noticeDateFormatted = dateFormatter.format(noticeDate)
    const rentDueDateFormatted = dateFormatter.format(new Date(invoice.due_date + 'T12:00:00'))
    const sevenDaysFromNowFormatted = dateFormatter.format(sevenDaysFromNow)

    const [invoicesByLease, paymentsByLease] = await Promise.all([
      loadInvoicesForLeases([leaseId]),
      loadPaymentsForLeases([leaseId]),
    ])
    const account = buildAccountLedger({
      lease: {
        id: leaseData.id,
        property_id: leaseData.property_id,
        tenant_id: leaseData.tenant_id,
        status: leaseData.status,
        rent: Number(leaseData.rent) || 0,
        rent_cadence: leaseData.rent_cadence,
        rent_due_day: leaseData.rent_due_day,
        lease_start_date: leaseData.lease_start_date,
        lease_end_date: leaseData.lease_end_date,
        property_name: property?.name || property?.address || '',
        tenant_name: tenant?.full_name || '',
      },
      invoices: invoicesByLease.get(leaseId) || [],
      payments: paymentsByLease.get(leaseId) || [],
      asOfDate: getBusinessDate(),
    })
    const allUnpaidInvoices = account.invoices
      .filter((inv) => !inv.isFuture && inv.calculatedBalance > 0.009)
      .map((inv) => ({
        amount_rent: inv.storedRent,
        amount_late: inv.storedLateFee,
        amount_other: inv.storedOtherCharges,
        balance_due: inv.calculatedBalance,
        due_date: inv.dueDate,
      }))
    const totalDue = account.totalBalanceDue
    
    // For each invoice, calculate the unpaid portion of each category proportionally
    let rentAmount = 0
    let lateFeeAmount = 0
    let otherAmount = 0
    
    allUnpaidInvoices?.forEach((inv: any) => {
      const invoiceTotal = Number(inv.amount_rent || 0) + Number(inv.amount_late || 0) + Number(inv.amount_other || 0)
      const balanceDue = Number(inv.balance_due || 0)
      
      if (invoiceTotal > 0 && balanceDue > 0) {
        // Calculate unpaid portion of each category proportionally
        const rentPortion = Number(inv.amount_rent || 0) / invoiceTotal
        const latePortion = Number(inv.amount_late || 0) / invoiceTotal
        const otherPortion = Number(inv.amount_other || 0) / invoiceTotal
        
        rentAmount += balanceDue * rentPortion
        lateFeeAmount += balanceDue * latePortion
        otherAmount += balanceDue * otherPortion
      } else if (balanceDue > 0) {
        // If no breakdown, assign all to rent
        rentAmount += balanceDue
      }
    })
    
    // Round to 2 decimal places to ensure they sum correctly
    rentAmount = Math.round(rentAmount * 100) / 100
    lateFeeAmount = Math.round(lateFeeAmount * 100) / 100
    otherAmount = Math.round(otherAmount * 100) / 100
    
    // Adjust for rounding errors - ensure they sum to totalDue
    const sum = rentAmount + lateFeeAmount + otherAmount
    const diff = totalDue - sum
    if (Math.abs(diff) > 0.01) {
      // Add the difference to rent amount
      rentAmount += diff
      rentAmount = Math.round(rentAmount * 100) / 100
    }

    // Generate notice content based on state
    let noticeContent = ''
    let noticeTitle = ''

    if (isSC) {
      // South Carolina Notice Template
      noticeTitle = '7-Day Notice to Pay Rent or Quit - South Carolina'
      noticeContent = `**NOTICE TO PAY RENT OR QUIT - INTENT TO EVICT**

7-DAY NOTICE PURSUANT TO SOUTH CAROLINA CODE ANN. § 27-40-710(B)

**Date Notice Delivered:** ${noticeDateFormatted} 

To: ${tenant.first_name} ${tenant.last_name}
${property.address}
${property.city ? `${property.city}, ` : ''}${property.state} ${property.zip_code}

You are hereby notified that your rent in the amount of $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} for the property located at ${property.address}, ${property.city ? `${property.city}, ` : ''}${property.state} ${property.zip_code} was due on ${rentDueDateFormatted}.

**BREAKDOWN OF AMOUNTS DUE:**
Rent: $${rentAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
${lateFeeAmount > 0 ? `Late Fee: $${lateFeeAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
${otherAmount > 0 ? `Other Charges: $${otherAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
**TOTAL DUE: $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}**

Pursuant to South Carolina law (SC Code Ann. § 27-40-710(B)), you have seven (7) days from the date of this notice (${noticeDateFormatted}) to pay the full amount of rent due or surrender possession of the premises. The deadline for payment or vacating the premises is ${sevenDaysFromNowFormatted}.

**IMPORTANT: Payment in full will stop all eviction proceedings from moving forward.**

This notice is being delivered by physical delivery to the premises.

Failure to comply with this notice by the specified deadline will result in the commencement of eviction proceedings without further notice. This may include legal action to recover possession of the property, unpaid rent, and any other damages or costs as permitted by law.

We urge you to take immediate action to resolve this matter.

**LANDLORD:**
Honest Home Sales, LLC: Member: Billy Rochester
PO Box 705, Cowpens, SC 29330
Text: 864-322-3432 | Email: honesthomesales@gmail.com`
    } else if (isNC) {
      // North Carolina Notice Template
      noticeTitle = '7-Day Notice to Pay Rent or Quit - North Carolina'
      noticeContent = `**NOTICE TO PAY RENT OR QUIT - INTENT TO EVICT**

7-DAY NOTICE PURSUANT TO NORTH CAROLINA GENERAL STATUTES § 42-26

**Date Notice Delivered:** ${noticeDateFormatted} 

To: ${tenant.first_name} ${tenant.last_name}
${property.address}
${property.city ? `${property.city}, ` : ''}${property.state} ${property.zip_code}

You are hereby notified that your rent in the amount of $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} for the property located at ${property.address}, ${property.city ? `${property.city}, ` : ''}${property.state} ${property.zip_code} was due on ${rentDueDateFormatted}.

**BREAKDOWN OF AMOUNTS DUE:**
Rent: $${rentAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
${lateFeeAmount > 0 ? `Late Fee: $${lateFeeAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
${otherAmount > 0 ? `Other Charges: $${otherAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
**TOTAL DUE: $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}**

Pursuant to North Carolina law (NC Gen. Stat. § 42-26), you have seven (7) days from the date of this notice (${noticeDateFormatted}) to pay the full amount of rent due or surrender possession of the premises. The deadline for payment or vacating the premises is ${sevenDaysFromNowFormatted}.

**IMPORTANT: Payment in full will stop all eviction proceedings from moving forward.**

This notice is being delivered by physical delivery to the premises.

Failure to comply with this notice by the specified deadline will result in the commencement of eviction proceedings without further notice. This may include legal action to recover possession of the property, unpaid rent, and any other damages or costs as permitted by law.

We urge you to take immediate action to resolve this matter.

**LANDLORD:**
Honest Home Sales, LLC: Member: Billy Rochester
PO Box 705, Cowpens, SC 29330
Text: 864-322-3432 | Email: honesthomesales@gmail.com`
    } else {
      // Default to SC template for unknown states
      noticeTitle = '7-Day Notice to Pay Rent or Quit'
      noticeContent = `**NOTICE TO PAY RENT OR QUIT - INTENT TO EVICT**

7-DAY NOTICE

**Date Notice Delivered:** ${noticeDateFormatted} 

To: ${tenant.first_name} ${tenant.last_name}
${property.address}
${property.city ? `${property.city}, ` : ''}${property.state} ${property.zip_code}

You are hereby notified that your rent in the amount of $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} for the property located at ${property.address}, ${property.city ? `${property.city}, ` : ''}${property.state} ${property.zip_code} was due on ${rentDueDateFormatted}.

**BREAKDOWN OF AMOUNTS DUE:**
Rent: $${rentAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
${lateFeeAmount > 0 ? `Late Fee: $${lateFeeAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
${otherAmount > 0 ? `Other Charges: $${otherAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
**TOTAL DUE: $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}**

You have seven (7) days from the date of this notice (${noticeDateFormatted}) to pay the full amount of rent due or surrender possession of the premises. The deadline for payment or vacating the premises is ${sevenDaysFromNowFormatted}.

**IMPORTANT: Payment in full will stop all eviction proceedings from moving forward.**

This notice is being delivered by physical delivery to the premises.

Failure to comply with this notice by the specified deadline will result in the commencement of eviction proceedings without further notice. This may include legal action to recover possession of the property, unpaid rent, and any other damages or costs as permitted by law.

We urge you to take immediate action to resolve this matter.

**LANDLORD:**
Honest Home Sales, LLC: Member: Billy Rochester
PO Box 705, Cowpens, SC 29330
Text: 864-322-3432 | Email: honesthomesales@gmail.com`
    }

    return NextResponse.json({ 
      noticeContent, 
      noticeTitle,
      state: state,
      totalDue: totalDue,
      deadline: sevenDaysFromNowFormatted
    })
  } catch (error) {
    console.error('Error in generate notice API:', error)
    return NextResponse.json(
      { error: 'Failed to generate notice', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
