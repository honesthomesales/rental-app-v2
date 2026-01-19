import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { getMagistrateDistrict, getMagistrateCourtAddress } from '@/lib/magistrate-lookup'

export async function POST(request: Request) {
  try {
    const { tenantId, county, formType, ejectmentReason, violationDescription, leaseId } = await request.json()

    if (!county || !leaseId) {
      return NextResponse.json({ error: 'County and lease ID are required' }, { status: 400 })
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

    // Determine magistrate from address
    const magistrateDistrict = getMagistrateDistrict(
      county,
      property.city,
      property.zip_code || property.postal_code
    )

    // Get today's date
    const today = new Date()
    const todayDate = new Date(today.toISOString().split('T')[0])

    // Fetch all unpaid invoices for this lease
    const { data: unpaidInvoices, error: invoicesError } = await supabaseServer
      .from('RENT_invoices')
      .select('*')
      .eq('lease_id', leaseId)
      .eq('status', 'OPEN')
      .gt('balance_due', 0)
      .order('due_date', { ascending: true })

    if (invoicesError) {
      console.error('Error fetching invoices:', invoicesError)
      return NextResponse.json({ error: 'Failed to fetch invoice data' }, { status: 500 })
    }

    // Calculate totals
    const totalDue = unpaidInvoices?.reduce((sum, inv) => sum + parseFloat(inv.balance_due || 0), 0) || 0
    const rentAmount = unpaidInvoices?.reduce((sum, inv) => sum + parseFloat(inv.amount_rent || 0), 0) || 0
    const lateFeeAmount = unpaidInvoices?.reduce((sum, inv) => sum + parseFloat(inv.amount_late || 0), 0) || 0
    const numberOfPeriods = unpaidInvoices?.length || 0

    // Format dates
    const dateFormatter = new Intl.DateTimeFormat('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    })
    const currentDate = dateFormatter.format(today)
    const todayFormatted = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const day = today.getDate()
    const month = today.toLocaleDateString('en-US', { month: 'long' })
    const year = today.getFullYear()

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

**IMPORTANT: Payment in full will stop all eviction proceedings from moving forward.**

This notice is being delivered by physical delivery to the premises.

Failure to comply with this notice by the specified deadline will result in the commencement of eviction proceedings without further notice. This may include legal action to recover possession of the property, unpaid rent, and any other damages or costs as permitted by law.

We urge you to take immediate action to resolve this matter.

**LANDLORD:**
Honest Home Sales, LLC: Member: Billy Rochester
PO Box 705, Cowpens, SC 29330
Text: 864-322-3432 | Email: honesthomesales@gmail.com

**NOTICE DELIVERY:**
Date Notice Delivered: ${currentDate}
Method of Delivery: Physical Delivery to Premises

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
COUNTY OF ${county.toUpperCase()}

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
        // Format: Description/text on left, then spaces, then dollar amount aligned right
        // Match exact SC form layout - each line ends with a dollar sign
        const maxItems = 5
        const invoiceItems: string[] = []
        const lineWidth = 80 // Characters per line for proper alignment
        
        if (unpaidInvoices && unpaidInvoices.length > 0) {
          unpaidInvoices.slice(0, maxItems).forEach((inv) => {
            const dueDate = new Date(inv.due_date + 'T12:00:00')
            const formattedDueDate = dueDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            const amount = parseFloat(inv.balance_due || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            // Format: description text on left, spaces in middle, $amount aligned right
            const description = `Rent due ${formattedDueDate}`
            const amountStr = `$${amount}`
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

        // Format TOTAL line with proper alignment (matches form layout)
        const totalAmount = `$${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        const totalLabel = 'TOTAL'
        const totalSpaces = lineWidth - totalLabel.length - totalAmount.length
        const totalPadding = totalSpaces > 0 ? ' '.repeat(totalSpaces) : ' '

        forms.affidavit = `AFFIDAVIT AND ITEMIZATION OF ACCOUNTS

STATE OF SOUTH CAROLINA
COUNTY OF ${county.toUpperCase()}

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

    return NextResponse.json(forms)
  } catch (error) {
    console.error('Error generating forms:', error)
    return NextResponse.json(
      { error: 'Failed to generate forms', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
