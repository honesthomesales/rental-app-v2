import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { getMagistrateDistrict, getMagistrateCourtAddress } from '@/lib/magistrate-lookup'

export async function POST(request: Request) {
  try {
    const { tenantId, county, formType, ejectmentReason, violationDescription, evictionReasons, leaseId } = await request.json()

    if (!leaseId) {
      return NextResponse.json({ error: 'Lease ID is required' }, { status: 400 })
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
      console.error('Error fetching lease data:', leaseError)
      return NextResponse.json({ error: 'Lease, property, or tenant data not found' }, { status: 404 })
    }

    const property = leaseData.RENT_properties
    const tenant = leaseData.RENT_tenants

    // Get county from property (same source as dashboard property tax overview)
    const propertyCounty = property.county || county || ''
    if (!propertyCounty) {
      return NextResponse.json({ error: 'County information not found for this property. Please ensure the property has a county set.' }, { status: 400 })
    }

    // Determine magistrate from address
    const magistrateDistrict = getMagistrateDistrict(
      propertyCounty,
      property.city,
      property.zip_code || property.postal_code
    )

    // Get today's date for filtering invoices (matching payments page logic)
    const today = new Date().toISOString().split('T')[0]
    const todayDate = new Date(today + 'T12:00:00')
    todayDate.setHours(0, 0, 0, 0)
    
    // Fetch all invoices for this lease (matching payments page logic)
    const { data: allInvoices, error: invoicesError } = await supabaseServer
      .from('RENT_invoices')
      .select('*')
      .eq('lease_id', leaseId)
      .lte('due_date', todayDate.toISOString().split('T')[0])
      .order('due_date', { ascending: true })

    if (invoicesError) {
      console.error('Error fetching invoices:', invoicesError)
      return NextResponse.json({ error: 'Failed to fetch invoice data' }, { status: 500 })
    }

    // Fetch all payments for this lease to recalculate balance_due (matching payments page logic)
    const { data: allPayments, error: paymentsError } = await supabaseServer
      .from('RENT_payments')
      .select('*')
      .eq('lease_id', leaseId)
      .order('payment_date', { ascending: true })

    if (paymentsError) {
      console.error('Error fetching payments:', paymentsError)
      // Continue without payments - will use invoice.amount_paid as fallback
    }

    // Group payments by invoice_id to calculate actual paid amounts (matching payments page logic)
    const paymentsByInvoice = new Map<string, any[]>()
    allPayments?.forEach(payment => {
      if (payment.invoice_id) {
        if (!paymentsByInvoice.has(payment.invoice_id)) {
          paymentsByInvoice.set(payment.invoice_id, [])
        }
        paymentsByInvoice.get(payment.invoice_id)!.push(payment)
      }
    })

    // Filter invoices within lease start date range (matching payments page logic)
    const leaseStartDate = leaseData.lease_start_date
    const validInvoices = allInvoices?.filter(invoice => 
      !leaseStartDate || invoice.due_date >= leaseStartDate
    ) || []

    // Recalculate balance_due using actual payment totals (EXACT same as payments page)
    const invoicesWithRecalculatedBalance = validInvoices.map(invoice => {
      // Get actual payments linked to this invoice
      const linkedPayments = paymentsByInvoice.get(invoice.id) || []
      const actualPaid = linkedPayments.reduce((sum, payment) => 
        sum + parseFloat(payment.amount || 0), 0
      )
      
      // Recalculate balance_due using actual paid amount (matching payments page logic)
      const amountTotal = parseFloat(invoice.amount_total || 0)
      const recalculatedBalanceDue = amountTotal - actualPaid
      
      return {
        ...invoice,
        actualPaid,
        balance_due: recalculatedBalanceDue // Use recalculated balance
      }
    })

    // Find ALL unpaid invoices (not just late ones) - EXACT same logic as payments page
    // Only count invoices with status='OPEN' and balance_due > 0 (matching payments page logic)
    const allUnpaidInvoices = invoicesWithRecalculatedBalance.filter(invoice => 
      invoice.status === 'OPEN' && parseFloat(invoice.balance_due as any || 0) > 0
    )

    // Calculate totals using EXACT same logic as payments page
    // totalDue = sum of recalculated balance_due from ALL unpaid invoices (matching payments page)
    const totalDue = allUnpaidInvoices.reduce((sum, invoice) => 
      sum + parseFloat(invoice.balance_due as any || 0), 0
    )
    // totalLateFees = sum of amount_late from ALL unpaid invoices
    const lateFeeAmount = allUnpaidInvoices.reduce((sum, invoice) => 
      sum + parseFloat(invoice.amount_late || 0), 0
    )
    // Rent amount = sum of amount_rent from ALL unpaid invoices
    const rentAmount = allUnpaidInvoices.reduce((sum, invoice) => 
      sum + parseFloat(invoice.amount_rent || 0), 0
    )
    // Number of rent cycles = count of ALL unpaid invoices (matching payments page)
    const numberOfPeriods = allUnpaidInvoices.length
    
    // Use allUnpaidInvoices for all form generation (matching payments page)
    const unpaidInvoices = allUnpaidInvoices

    // Format dates
    const dateFormatter = new Intl.DateTimeFormat('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    })
    const currentDate = dateFormatter.format(todayDate)
    const todayFormatted = todayDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const day = todayDate.getDate()
    const month = todayDate.toLocaleDateString('en-US', { month: 'long' })
    const year = todayDate.getFullYear()

    const forms: any = {}

    // Generate 7-Day Notice if requested
    if (formType === 'notice' || formType === 'both') {
      const sevenDaysFromNow = new Date()
      sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7)
      const sevenDaysFromNowFormatted = dateFormatter.format(sevenDaysFromNow)

      forms.notice = `**NOTICE TO PAY RENT OR QUIT - INTENT TO EVICT**

7-DAY NOTICE PURSUANT TO SOUTH CAROLINA CODE ANN. § 27-40-710(B)

Date: ${currentDate}

To: ${tenant.first_name} ${tenant.last_name}
Property: ${property.address}
${property.city ? `${property.city}, ` : ''}${property.state} ${property.zip_code}

You are hereby notified that your rent in the amount of $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} for the property located at ${property.address}, ${property.city ? `${property.city}, ` : ''}${property.state} ${property.zip_code} was due.

**BREAKDOWN OF AMOUNTS DUE:**
Rent: $${rentAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
${lateFeeAmount > 0 ? `Late Fee: $${lateFeeAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
**TOTAL DUE: $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}**

As of the date of this notice, the full amount of $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} remains unpaid.

Pursuant to South Carolina law (SC Code Ann. § 27-40-710(B)), you have seven (7) days from the date of this notice (${currentDate}) to pay the full amount of rent due or surrender possession of the premises. The deadline for payment or vacating the premises is ${sevenDaysFromNowFormatted}.

${evictionReasons && evictionReasons.length > 0 ? evictionReasons.map((reason: string) => {
  if (reason === 'overdue') {
    return 'Failure to Pay Rent:\nTenant has failed to pay rent and/or other amounts due under the lease agreement. As of the date of this notice, the account remains past due.'
  } else if (reason === 'holdover') {
    return 'Holdover Tenancy / Expired Lease:\nThe lease agreement has expired, and Tenant remains in possession of the premises without a valid lease or written authorization from the Landlord.'
  } else if (reason === 'inspection') {
    return 'Failure to Provide Access:\nTenant has failed to allow reasonable access to the premises for inspection, maintenance, or repairs after proper notice, as required under the lease and applicable law.'
  } else if (reason === 'communication') {
    return 'Failure to Communicate / Non-Responsiveness:\nTenant has failed to respond to reasonable attempts at communication regarding tenancy matters, including rent, access, or lease compliance.'
  } else if (reason === 'freeform') {
    return 'Tenant has failed to comply with the terms and conditions of the lease agreement and/or applicable law.'
  }
  return ''
}).filter(Boolean).join('\n\n') + '\n\n' : ''}***OPTIONS***

Please contact us by text at 864-322-3432. We will respond by phone shortly.

You must choose ONE of the following options:

1) Voluntary Move-Out Agreement
Sign paperwork agreeing to move out and surrender possession of the property, including turning over all keys. This option includes an agreement not to pursue collections and not to file a judgment, provided the property is left in good condition.

2) Payment in Full
Make payment in full to bring your rent account current.

3) Eviction Proceedings
If neither option above is completed, we will proceed with eviction. You will be responsible for all rent owed, court costs, and legal fees. We reserve the right to pursue any unpaid balance through a judgment.

**LANDLORD:**
Honest Home Sales, LLC: Member: Billy Rochester
PO Box 705, Cowpens, SC 29330
Text: 864-322-3432 | Email: honesthomesales@gmail.com

**NOTICE DELIVERY:**
Date Notice Delivered: ${currentDate}
Method of Delivery: Physical Delivery to Premises and Mailed

---
This notice is generated pursuant to South Carolina Code Ann. § 27-40-710(B) and is legally binding.`
    }

    // Generate Application for Ejectment if requested
    if (formType === 'ejectment' || formType === 'both') {
      let reasonDescription = ''
      if (ejectmentReason === 'nonpayment') {
        reasonDescription = `The tenant fails or refuses to pay the rent when due or when demanded. The amount owed is $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} and the tenant is ${numberOfPeriods} rent cycle(s) behind.`
      } else if (ejectmentReason === 'endtenancy') {
        reasonDescription = `The term of tenancy or occupancy has ended.`
      } else if (ejectmentReason === 'violation') {
        reasonDescription = `The terms or conditions of the lease have been violated as follows: ${violationDescription}`
      }

      // Format ejectment form exactly as SC form (SCCA/732) - matching exact layout from official form
      let checkbox1 = '[ ]'
      let checkbox2 = '[ ]'
      let checkbox3 = '[ ]'
      let violationLine = '_________________________'
      
      if (ejectmentReason === 'nonpayment') {
        checkbox1 = '[X]'
      } else if (ejectmentReason === 'endtenancy') {
        checkbox2 = '[X]'
      } else {
        checkbox3 = '[X]'
        violationLine = violationDescription
      }

      // Build grounds section with proper formatting
      let groundsText = ''
      if (ejectmentReason === 'nonpayment') {
        groundsText = `${checkbox1} The tenant fails or refuses to pay the rent when due or when demanded; or

The tenant fails or refuses to pay the rent when due or when demanded. The amount owed is $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} and the tenant is ${numberOfPeriods} rent cycle(s) behind.

${checkbox2} The term of tenancy or occupancy has ended; or

${checkbox3} The terms or conditions of the lease have been violated as follows:`
      } else if (ejectmentReason === 'endtenancy') {
        groundsText = `${checkbox1} The tenant fails or refuses to pay the rent when due or when demanded; or

${checkbox2} The term of tenancy or occupancy has ended; or

${checkbox3} The terms or conditions of the lease have been violated as follows:`
      } else {
        groundsText = `${checkbox1} The tenant fails or refuses to pay the rent when due or when demanded; or

${checkbox2} The term of tenancy or occupancy has ended; or

${checkbox3} The terms or conditions of the lease have been violated as follows: ${violationLine}`
      }

      forms.ejectment = `APPLICATION FOR EJECTMENT (Eviction)

STATE OF SOUTH CAROLINA
COUNTY OF ${propertyCounty.toUpperCase()}

PLAINTIFF(S): Honest Home Sales, LLC

VS.

DEFENDANT(S): ${tenant.first_name} ${tenant.last_name}

CIVIL CASE NUMBER: _________________________

IN THE MAGISTRATE'S COURT

I, Honest Home Sales, LLC, plaintiff in this action, do hereby state that I am the landlord-lessor of premises within the jurisdiction of ${magistrateDistrict}, which is described as: (address and description of premises - apartment, house, etc.) ${property.address}${property.city ? `, ${property.city}` : ''}${property.state ? `, ${property.state}` : ''}${property.zip_code ? ` ${property.zip_code}` : ''}.

I further state that, with regard to the above described premises, a landlord-tenant relationship exists between myself and the defendant ${tenant.first_name} ${tenant.last_name}, the tenant-lessee, as evidenced by the following: (Attach lease papers or other written proof.)

GROUNDS FOR EJECTMENT:

${groundsText}

WHEREFORE, the plaintiff demands possession of the premises, damages, costs, and such other relief as the Court may deem just and proper.

Sworn to before me this ${day} day of ${month}, ${year}.

_________________________
Magistrate or Notary Public for South Carolina

My Commission expires: _________________________

PLAINTIFF (or his attorney): _________________________

Address: PO Box 705, Cowpens, SC 29330

City/State/Zip: Cowpens, SC 29330

Phone Number: 864-322-3432

Email: honesthomesales@gmail.com

SCCA/732 (Amended 05/2008)`
    }

      // Generate Affidavit of Item of Account if late rent - formatted exactly as SC form (SCCA/716)
      if ((formType === 'ejectment' || formType === 'both') && ejectmentReason === 'nonpayment') {
        // Create itemization lines (form shows exactly 5 lines with dollar signs at the end)
        // IMPORTANT: Itemization shows only RENT amounts (amount_rent), not balance_due (which includes late fees)
        // The TOTAL shows totalDue (which includes all balances with late fees)
        const maxItems = 5
        const invoiceItems: string[] = []
        const lineWidth = 80 // Characters per line for proper alignment
        
        if (unpaidInvoices && unpaidInvoices.length > 0) {
          unpaidInvoices.slice(0, maxItems).forEach((inv) => {
            const dueDate = new Date(inv.due_date + 'T12:00:00')
            const formattedDueDate = dueDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            // Use amount_rent (base rent only) for itemization, NOT balance_due
            const rentAmount = parseFloat(inv.amount_rent || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            // Format: description text on left, spaces in middle, $amount aligned right
            const description = `Rent due ${formattedDueDate}`
            const amountStr = `$${rentAmount}`
            // Calculate padding to align dollar amounts to the right
            const spacesNeeded = lineWidth - description.length - amountStr.length
            const padding = spacesNeeded > 0 ? ' '.repeat(spacesNeeded) : ' '
            invoiceItems.push(`${description}${padding}${amountStr}`)
          })
        }
        
        // Fill remaining lines if less than maxItems (form always shows exactly 5 lines)
        while (invoiceItems.length < maxItems) {
          // Empty line with just dollar sign at the end (aligned right)
          const padding = ' '.repeat(lineWidth - 1)
          invoiceItems.push(`${padding}$`)
        }

        // Format TOTAL line with proper alignment - TOTAL includes all amounts (rent + late fees)
        const totalAmount = `$${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        const totalLabel = 'TOTAL'
        const totalSpaces = lineWidth - totalLabel.length - totalAmount.length
        const totalPadding = totalSpaces > 0 ? ' '.repeat(totalSpaces) : ' '

        forms.affidavit = `AFFIDAVIT AND ITEMIZATION OF ACCOUNTS

STATE OF SOUTH CAROLINA
COUNTY OF ${propertyCounty.toUpperCase()}

CIVIL CASE NUMBER: _________________________

IN THE MAGISTRATE'S COURT

PLAINTIFF(S): Honest Home Sales, LLC

VS.

DEFENDANT(S): ${tenant.first_name} ${tenant.last_name}

Plaintiff, Honest Home Sales, LLC, personally appearing before me, who, being duly sworn, states that he is the plaintiff in this action, and that the itemization of accounts which follows is true and correct.

He further states that no part of the sum included in the itemization below has been paid or satisfied in any fashion, and is today due and owed to him.

ITEMIZATION OF ACCOUNTS

${invoiceItems.join('\n')}

${totalLabel}${totalPadding}${totalAmount}

(Copies of bills, papers or other proof of any of the above accounts should be attached to this document.)

Sworn to and Subscribed before me this ${day} day of ${month}, ${year}.

_________________________
Magistrate or Notary Public for South Carolina

My Commission expires: _________________________

PLAINTIFF (or his attorney): _________________________

SCCA/716 (Amended 05/2008)`
      }

    // Also include HTML versions for better formatting
    const formsWithHTML: any = { ...forms }
    
    if (forms.ejectment) {
      const { generateEjectmentHTML } = await import('@/lib/form-html-generator')
      formsWithHTML.ejectmentHTML = generateEjectmentHTML(
        propertyCounty,
        'Honest Home Sales, LLC',
        `${tenant.first_name} ${tenant.last_name}`,
        magistrateDistrict,
        `${property.address}${property.city ? `, ${property.city}` : ''}${property.state ? `, ${property.state}` : ''}${property.zip_code ? ` ${property.zip_code}` : ''}`,
        ejectmentReason,
        ejectmentReason === 'nonpayment' ? `The amount owed is $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} and the tenant is ${numberOfPeriods} rent cycle(s) behind.` : 
        ejectmentReason === 'violation' ? violationDescription : '',
        day,
        month,
        year,
        'PO Box 705, Cowpens, SC 29330',
        'Cowpens, SC 29330',
        '864-322-3432',
        'honesthomesales@gmail.com'
      )
    }
    
    if (forms.affidavit) {
      const { generateAffidavitHTML } = await import('@/lib/form-html-generator')
      // Use amount_rent for itemization (not balance_due)
      const invoiceItemsForHTML = unpaidInvoices?.slice(0, 5).map((inv) => {
        const dueDate = new Date(inv.due_date + 'T12:00:00')
        const formattedDueDate = dueDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        // Itemization shows only rent amounts, not late fees
        const rentAmount = parseFloat(inv.amount_rent || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        return {
          description: `Rent due ${formattedDueDate}`,
          amount: rentAmount
        }
      }) || []
      
      formsWithHTML.affidavitHTML = generateAffidavitHTML(
        propertyCounty,
        'Honest Home Sales, LLC',
        `${tenant.first_name} ${tenant.last_name}`,
        invoiceItemsForHTML,
        totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        day,
        month,
        year
      )
    }

    return NextResponse.json(formsWithHTML)
  } catch (error) {
    console.error('Error generating forms:', error)
    return NextResponse.json(
      { error: 'Failed to generate forms', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
