/** Grounds for ejectment / summary ejectment (matches API + UI). */
export type EjectmentReason = 'nonpayment' | 'endtenancy' | 'violation'

/**
 * Structured data used to fill official court PDF templates (SCCA/732, AOC-CVM-201).
 * Built server-side in generate-ejectment-forms; consumed client-side for PDF download.
 */
export interface EjectmentCourtPdfFillData {
  formKind: 'SC' | 'NC'
  propertyCounty: string
  plaintiffName: string
  plaintiffStreetAddress: string
  plaintiffCity: string
  plaintiffState: string
  plaintiffZip: string
  plaintiffPhone: string
  plaintiffEmail: string
  defendantName: string
  defendantStreetAddress: string
  defendantCity: string
  defendantState: string
  defendantZip: string
  premisesAddress: string
  ejectmentReason: EjectmentReason
  /** Currency formatted without $ (e.g. "1,234.56") */
  totalDueFormatted: string
  violationDescription?: string
  numberOfPeriods?: number
  swornDay: number
  swornMonth: string
  swornYear: number
  /** MM/DD/YYYY for NC signature date */
  signDateFormatted: string
  /** MM/DD/YYYY — earliest unpaid rent due date */
  rentDueDateFormatted?: string
  /** MM/DD/YYYY — lease end if applicable */
  leaseEndDateFormatted?: string
  /** Monthly rent amount formatted without $ */
  rentRateFormatted?: string
  /** Rent period: month vs week (NC checkboxes) */
  rentPeriod: 'month' | 'week'
  hasWrittenLease: boolean
  agentName?: string
}
