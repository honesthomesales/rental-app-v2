import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

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

    // Calculate total amount due
    const totalDue = parseFloat(invoice.balance_due || 0)
    const rentAmount = parseFloat(invoice.amount_rent || 0)
    const lateFeeAmount = parseFloat(invoice.amount_late || 0)
    const otherAmount = parseFloat(invoice.amount_other || 0)

    // Generate notice content based on state
    let noticeContent = ''
    let noticeTitle = ''

    if (isSC) {
      // South Carolina Notice Template
      noticeTitle = '7-Day Notice to Pay Rent or Quit - South Carolina'
      noticeContent = `**NOTICE TO PAY RENT OR QUIT - INTENT TO EVICT**
7-DAY NOTICE PURSUANT TO SOUTH CAROLINA CODE ANN. § 27-40-710(B)

Date: ${noticeDateFormatted}

${tenant.first_name} ${tenant.last_name}
${property.address}
${property.city ? `${property.city}, ` : ''}${property.state} ${property.zip_code}

You are hereby notified that your rent in the amount of $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} for the property located at ${property.address}, ${property.city ? `${property.city}, ` : ''}${property.state} ${property.zip_code} was due on ${rentDueDateFormatted}.

**BREAKDOWN OF AMOUNTS DUE:**
- Rent: $${rentAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
${lateFeeAmount > 0 ? `- Late Fee: $${lateFeeAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
${otherAmount > 0 ? `- Other Charges: $${otherAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
- **TOTAL DUE: $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}**

As of the date of this notice, the full amount of $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} remains unpaid.

Pursuant to South Carolina law (SC Code Ann. § 27-40-710(B)), you have seven (7) days from the date of this notice (${noticeDateFormatted}) to pay the full amount of rent due or surrender possession of the premises. The deadline for payment or vacating the premises is ${sevenDaysFromNowFormatted}.

**IMPORTANT: Payment in full will stop all eviction proceedings from moving forward.**

This notice is being delivered by physical delivery to the premises.

Failure to comply with this notice by the specified deadline will result in the commencement of eviction proceedings without further notice. This may include legal action to recover possession of the property, unpaid rent, and any other damages or costs as permitted by law.

We urge you to take immediate action to resolve this matter.

Honest Home Sales, LLC: Member: Billy Rochester
PO Box 705
Cowpens, SC 29330
Text: 864-322-3432
Email: honesthomesales@gmail.com

Date Notice Delivered: ${noticeDateFormatted}
Method of Delivery: Physical Delivery to Premises

---
This notice is generated pursuant to South Carolina Code Ann. § 27-40-710(B) and is legally binding.`
    } else if (isNC) {
      // North Carolina Notice Template
      noticeTitle = '7-Day Notice to Pay Rent or Quit - North Carolina'
      noticeContent = `**NOTICE TO PAY RENT OR QUIT - INTENT TO EVICT**
7-DAY NOTICE PURSUANT TO NORTH CAROLINA GENERAL STATUTES § 42-26

Date: ${noticeDateFormatted}

${tenant.first_name} ${tenant.last_name}
${property.address}
${property.city ? `${property.city}, ` : ''}${property.state} ${property.zip_code}

You are hereby notified that your rent in the amount of $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} for the property located at ${property.address}, ${property.city ? `${property.city}, ` : ''}${property.state} ${property.zip_code} was due on ${rentDueDateFormatted}.

**BREAKDOWN OF AMOUNTS DUE:**
- Rent: $${rentAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
${lateFeeAmount > 0 ? `- Late Fee: $${lateFeeAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
${otherAmount > 0 ? `- Other Charges: $${otherAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
- **TOTAL DUE: $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}**

As of the date of this notice, the full amount of $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} remains unpaid.

Pursuant to North Carolina law (NC Gen. Stat. § 42-26), you have seven (7) days from the date of this notice (${noticeDateFormatted}) to pay the full amount of rent due or surrender possession of the premises. The deadline for payment or vacating the premises is ${sevenDaysFromNowFormatted}.

**IMPORTANT: Payment in full will stop all eviction proceedings from moving forward.**

This notice is being delivered by physical delivery to the premises.

Failure to comply with this notice by the specified deadline will result in the commencement of eviction proceedings without further notice. This may include legal action to recover possession of the property, unpaid rent, and any other damages or costs as permitted by law.

We urge you to take immediate action to resolve this matter.

Honest Home Sales, LLC: Member: Billy Rochester
PO Box 705
Cowpens, SC 29330
Text: 864-322-3432
Email: honesthomesales@gmail.com

Date Notice Delivered: ${noticeDateFormatted}
Method of Delivery: Physical Delivery to Premises

---
This notice is generated pursuant to North Carolina General Statutes § 42-26 and is legally binding.`
    } else {
      // Default to SC template for unknown states
      noticeTitle = '7-Day Notice to Pay Rent or Quit'
      noticeContent = `**NOTICE TO PAY RENT OR QUIT - INTENT TO EVICT**
7-DAY NOTICE

Date: ${noticeDateFormatted}

${tenant.first_name} ${tenant.last_name}
${property.address}
${property.city ? `${property.city}, ` : ''}${property.state} ${property.zip_code}

You are hereby notified that your rent in the amount of $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} for the property located at ${property.address}, ${property.city ? `${property.city}, ` : ''}${property.state} ${property.zip_code} was due on ${rentDueDateFormatted}.

**BREAKDOWN OF AMOUNTS DUE:**
- Rent: $${rentAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
${lateFeeAmount > 0 ? `- Late Fee: $${lateFeeAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
${otherAmount > 0 ? `- Other Charges: $${otherAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
- **TOTAL DUE: $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}**

As of the date of this notice, the full amount of $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} remains unpaid.

You have seven (7) days from the date of this notice (${noticeDateFormatted}) to pay the full amount of rent due or surrender possession of the premises. The deadline for payment or vacating the premises is ${sevenDaysFromNowFormatted}.

**IMPORTANT: Payment in full will stop all eviction proceedings from moving forward.**

This notice is being delivered by physical delivery to the premises.

Failure to comply with this notice by the specified deadline will result in the commencement of eviction proceedings without further notice. This may include legal action to recover possession of the property, unpaid rent, and any other damages or costs as permitted by law.

We urge you to take immediate action to resolve this matter.

Honest Home Sales, LLC: Member: Billy Rochester
PO Box 705
Cowpens, SC 29330
Text: 864-322-3432
Email: honesthomesales@gmail.com

Date Notice Delivered: ${noticeDateFormatted}
Method of Delivery: Physical Delivery to Premises

---
This notice is legally binding.`
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
