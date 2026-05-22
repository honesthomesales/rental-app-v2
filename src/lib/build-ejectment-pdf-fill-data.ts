import type { EjectmentCourtPdfFillData, EjectmentReason } from '@/types/ejectment-court-pdf'

const PLAINTIFF = {
  name: 'Honest Home Sales, LLC',
  street: 'PO Box 705',
  city: 'Cowpens',
  state: 'SC',
  zip: '29330',
  phone: '864-322-3432',
  email: 'honesthomesales@gmail.com',
  agent: 'Billy Rochester',
} as const

function formatMdY(date: Date): string {
  const m = date.getMonth() + 1
  const d = date.getDate()
  const y = date.getFullYear()
  return `${m}/${d}/${y}`
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export interface BuildEjectmentPdfFillParams {
  formKind: 'SC' | 'NC'
  propertyCounty: string
  tenantFirstName: string
  tenantLastName: string
  propertyAddress: string
  propertyCity?: string
  propertyState?: string
  propertyZip?: string
  ejectmentReason: EjectmentReason
  totalDue: number
  violationDescription?: string
  swornDay: number
  swornMonth: string
  swornYear: number
  swornDate: Date
  earliestUnpaidDueDate?: string | null
  leaseEndDate?: string | null
  monthlyRent?: number | null
  rentCadence?: string | null
  hasWrittenLease?: boolean
}

export function buildEjectmentCourtPdfFillData(
  params: BuildEjectmentPdfFillParams
): EjectmentCourtPdfFillData {
  const defendantName = `${params.tenantFirstName} ${params.tenantLastName}`.trim()
  const premisesAddress = [
    params.propertyAddress,
    params.propertyCity,
    params.propertyState,
    params.propertyZip,
  ]
    .filter(Boolean)
    .join(', ')

  const cadence = (params.rentCadence || 'monthly').toLowerCase()
  const rentPeriod: 'month' | 'week' = cadence.includes('week') ? 'week' : 'month'

  let rentDueDateFormatted: string | undefined
  if (params.earliestUnpaidDueDate) {
    rentDueDateFormatted = formatMdY(new Date(params.earliestUnpaidDueDate + 'T12:00:00'))
  }

  let leaseEndDateFormatted: string | undefined
  if (params.leaseEndDate) {
    leaseEndDateFormatted = formatMdY(new Date(params.leaseEndDate + 'T12:00:00'))
  }

  const rentRateFormatted =
    params.monthlyRent != null && params.monthlyRent > 0
      ? formatCurrency(params.monthlyRent)
      : undefined

  return {
    formKind: params.formKind,
    propertyCounty: params.propertyCounty,
    plaintiffName: PLAINTIFF.name,
    plaintiffStreetAddress: PLAINTIFF.street,
    plaintiffCity: PLAINTIFF.city,
    plaintiffState: PLAINTIFF.state,
    plaintiffZip: PLAINTIFF.zip,
    plaintiffPhone: PLAINTIFF.phone,
    plaintiffEmail: PLAINTIFF.email,
    defendantName,
    defendantStreetAddress: params.propertyAddress,
    defendantCity: params.propertyCity || '',
    defendantState: params.propertyState || '',
    defendantZip: params.propertyZip || '',
    premisesAddress,
    ejectmentReason: params.ejectmentReason,
    totalDueFormatted: formatCurrency(params.totalDue),
    violationDescription: params.violationDescription,
    swornDay: params.swornDay,
    swornMonth: params.swornMonth,
    swornYear: params.swornYear,
    signDateFormatted: formatMdY(params.swornDate),
    rentDueDateFormatted,
    leaseEndDateFormatted,
    rentRateFormatted,
    rentPeriod,
    hasWrittenLease: params.hasWrittenLease !== false,
    agentName: PLAINTIFF.agent,
  }
}

/** Sample payloads for /dev/court-pdf-test */
export function sampleSouthCarolinaEjectmentFillData(): EjectmentCourtPdfFillData {
  const today = new Date()
  return buildEjectmentCourtPdfFillData({
    formKind: 'SC',
    propertyCounty: 'Spartanburg',
    tenantFirstName: 'John',
    tenantLastName: 'Doe',
    propertyAddress: '123 Main Street',
    propertyCity: 'Spartanburg',
    propertyState: 'SC',
    propertyZip: '29301',
    ejectmentReason: 'nonpayment',
    totalDue: 1500,
    swornDay: today.getDate(),
    swornMonth: today.toLocaleDateString('en-US', { month: 'long' }),
    swornYear: today.getFullYear(),
    swornDate: today,
    earliestUnpaidDueDate: '2026-04-01',
    monthlyRent: 750,
    rentCadence: 'monthly',
  })
}

export function sampleNorthCarolinaEjectmentFillData(): EjectmentCourtPdfFillData {
  const today = new Date()
  return buildEjectmentCourtPdfFillData({
    formKind: 'NC',
    propertyCounty: 'Gaston',
    tenantFirstName: 'Jane',
    tenantLastName: 'Tenant',
    propertyAddress: '456 Oak Avenue',
    propertyCity: 'Gastonia',
    propertyState: 'NC',
    propertyZip: '28052',
    ejectmentReason: 'nonpayment',
    totalDue: 1350,
    swornDay: today.getDate(),
    swornMonth: today.toLocaleDateString('en-US', { month: 'long' }),
    swornYear: today.getFullYear(),
    swornDate: today,
    earliestUnpaidDueDate: '2026-04-01',
    monthlyRent: 675,
    rentCadence: 'monthly',
  })
}
