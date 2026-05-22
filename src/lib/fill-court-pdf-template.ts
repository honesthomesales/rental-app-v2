/**
 * Fill official court PDF templates using embedded AcroForm fields (pdf-lib).
 * Does not rasterize HTML — preserves exact layout, fonts, and page structure.
 */

import { PDFDocument, type PDFForm } from 'pdf-lib'
import type { EjectmentCourtPdfFillData } from '@/types/ejectment-court-pdf'
import {
  COURT_PDF_TEMPLATES,
  NC_EJECTMENT_FIELDS as NC,
  SC_EJECTMENT_FIELDS as SC,
} from '@/lib/court-pdf-field-map'

const SC_COUNTY_OPTIONS = [
  'Abbeville', 'Aiken', 'Allendale', 'Anderson', 'Bamberg', 'Barnwell', 'Beaufort', 'Berkeley',
  'Calhoun', 'Charleston', 'Cherokee', 'Chester', 'Chesterfield', 'Clarendon', 'Colleton',
  'Darlington', 'Dillon', 'Dorchester', 'Edgefield', 'Fairfield', 'Florence', 'Georgetown',
  'Greenville', 'Greenwood', 'Hampton', 'Horry', 'Jasper', 'Kershaw', 'Lancaster', 'Laurens',
  'Lee', 'Lexington', 'Marion', 'Marlboro', 'McCormick', 'Newberry', 'Oconee', 'Orangeburg',
  'Pickens', 'Richland', 'Saluda', 'Spartanburg', 'Sumter', 'Union', 'Williamsburg', 'York',
] as const

/** Normalize app county string to SCCA/732 dropdown option. */
export function normalizeSouthCarolinaCounty(county: string): string {
  const cleaned = county.replace(/\s*county\s*/gi, '').trim().toLowerCase()
  const match = SC_COUNTY_OPTIONS.find((c) => c.toLowerCase() === cleaned)
  if (match) return match
  const title = cleaned.replace(/\b\w/g, (ch) => ch.toUpperCase())
  return SC_COUNTY_OPTIONS.find((c) => c.toLowerCase() === title.toLowerCase()) ?? title
}

/** Load template bytes from public/ (browser: relative fetch to /forms/...). */
export async function loadCourtPdfTemplate(publicPath: string): Promise<Uint8Array> {
  const path = publicPath.startsWith('/') ? publicPath : `/${publicPath}`
  const res = await fetch(path)
  if (!res.ok) {
    throw new Error(`Failed to load court PDF template: ${path} (${res.status})`)
  }
  return new Uint8Array(await res.arrayBuffer())
}

function setTextField(form: PDFForm, fieldName: string, value: string | undefined) {
  if (value == null || String(value).trim() === '') return
  try {
    form.getTextField(fieldName).setText(String(value))
  } catch {
    console.warn(`[court-pdf] Missing or non-text field: ${fieldName}`)
  }
}

function checkField(form: PDFForm, fieldName: string) {
  try {
    form.getCheckBox(fieldName).check()
  } catch {
    console.warn(`[court-pdf] Missing checkbox: ${fieldName}`)
  }
}

function selectCountyDropdown(form: PDFForm, county: string) {
  const option = normalizeSouthCarolinaCounty(county)
  try {
    const dropdown = form.getDropdown(SC.countyDropdown)
    const options = dropdown.getOptions()
    if (options.includes(option)) {
      dropdown.select(option)
    } else {
      console.warn(`[court-pdf] County "${option}" not in SCCA/732 list; leaving blank`)
    }
  } catch {
    console.warn(`[court-pdf] County dropdown not found`)
  }
}

/**
 * Fill SC SCCA/732 Application for Ejectment (official PDF background).
 */
export async function fillSouthCarolinaEjectmentPdf(
  data: EjectmentCourtPdfFillData,
  templateBytes?: Uint8Array
): Promise<Uint8Array> {
  const bytes =
    templateBytes ?? (await loadCourtPdfTemplate(COURT_PDF_TEMPLATES.SC_EJECTMENT))
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = doc.getForm()

  selectCountyDropdown(form, data.propertyCounty)

  setTextField(form, SC.plaintiff, data.plaintiffName)
  setTextField(form, SC.plaintiffName, data.plaintiffName)
  setTextField(form, SC.defendant, data.defendantName)
  setTextField(form, SC.defendantName, data.defendantName)
  setTextField(form, SC.propertyAddress, data.premisesAddress)
  setTextField(form, SC.plaintiffAddress, data.plaintiffStreetAddress)
  setTextField(
    form,
    SC.plaintiffCityStateZip,
    `${data.plaintiffCity}, ${data.plaintiffState} ${data.plaintiffZip}`.replace(/^,\s*/, '')
  )
  setTextField(form, SC.phone, data.plaintiffPhone)
  setTextField(form, SC.email, data.plaintiffEmail)
  setTextField(form, SC.daySworn, String(data.swornDay))
  setTextField(form, SC.monthSworn, data.swornMonth)
  setTextField(form, SC.yearSworn, String(data.swornYear))

  checkField(form, SC.checkLeaseProof)

  if (data.ejectmentReason === 'nonpayment') {
    checkField(form, SC.checkNonpayment)
    setTextField(form, SC.amountOwed, data.totalDueFormatted)
  } else if (data.ejectmentReason === 'endtenancy') {
    checkField(form, SC.checkEndTenancy)
  } else if (data.ejectmentReason === 'violation') {
    checkField(form, SC.checkViolation)
    setTextField(
      form,
      SC.violationDescription,
      data.violationDescription || 'Lease violation'
    )
  }

  form.flatten()
  return doc.save()
}

/**
 * Fill NC AOC-CVM-201 Complaint in Summary Ejectment (official PDF; page 2 instructions unchanged).
 */
export async function fillNorthCarolinaSummaryEjectmentPdf(
  data: EjectmentCourtPdfFillData,
  templateBytes?: Uint8Array
): Promise<Uint8Array> {
  const bytes =
    templateBytes ?? (await loadCourtPdfTemplate(COURT_PDF_TEMPLATES.NC_EJECTMENT))
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = doc.getForm()

  const countyDisplay = data.propertyCounty.replace(/\s*county\s*/gi, '').trim()

  setTextField(form, NC.countyName, countyDisplay)
  setTextField(form, NC.plaintiffName, data.plaintiffName)
  setTextField(form, NC.plaintiffStreet, data.plaintiffStreetAddress)
  setTextField(form, NC.plaintiffMail, data.plaintiffStreetAddress)
  setTextField(form, NC.plaintiffCity, data.plaintiffCity)
  setTextField(form, NC.plaintiffState, data.plaintiffState)
  setTextField(form, NC.plaintiffZip, data.plaintiffZip)
  setTextField(form, NC.plaintiffPhone, data.plaintiffPhone)

  checkField(form, NC.defendantIndividual)
  setTextField(form, NC.defendantName, data.defendantName)
  setTextField(form, NC.defendantStreet, data.defendantStreetAddress)
  setTextField(form, NC.defendantCity, data.defendantCity)
  setTextField(form, NC.defendantState, data.defendantState)
  setTextField(form, NC.defendantZip, data.defendantZip)

  setTextField(form, NC.premises, data.premisesAddress)
  setTextField(form, NC.rentPastDue, data.totalDueFormatted)
  setTextField(form, NC.amountDue, data.totalDueFormatted)
  setTextField(form, NC.signDate, data.signDateFormatted)
  setTextField(form, NC.plaintiffSignName, data.plaintiffName)
  if (data.agentName) {
    setTextField(form, NC.agentName, data.agentName)
  }

  if (data.rentRateFormatted) {
    setTextField(form, NC.rentRate, data.rentRateFormatted)
  }
  if (data.rentDueDateFormatted) {
    setTextField(form, NC.rentDueDate, data.rentDueDateFormatted)
  }
  if (data.leaseEndDateFormatted) {
    setTextField(form, NC.leaseEndDate, data.leaseEndDateFormatted)
  }

  checkField(form, NC.checkConventional)
  checkField(form, NC.checkNoInterpreter)

  if (data.hasWrittenLease) {
    checkField(form, NC.checkWritten)
  } else {
    checkField(form, NC.checkOral)
  }

  if (data.rentPeriod === 'week') {
    checkField(form, NC.checkRentWeek)
  } else {
    checkField(form, NC.checkRentMonth)
  }

  if (data.ejectmentReason === 'nonpayment') {
    checkField(form, NC.checkFailedPayRent)
    // Per form instructions: written lease + nonpayment → breach/re-entry + failure to pay rent
    if (data.hasWrittenLease) {
      checkField(form, NC.checkBreached)
      setTextField(
        form,
        NC.breachDescription,
        data.violationDescription?.trim() || 'Failure to pay rent when due'
      )
    }
  } else if (data.ejectmentReason === 'endtenancy') {
    checkField(form, NC.checkLeaseEnded)
  } else if (data.ejectmentReason === 'violation') {
    checkField(form, NC.checkBreached)
    setTextField(
      form,
      NC.breachDescription,
      data.violationDescription || 'Breach of lease'
    )
  }

  form.flatten()
  return doc.save()
}

export async function fillEjectmentCourtPdf(data: EjectmentCourtPdfFillData): Promise<Uint8Array> {
  return data.formKind === 'SC'
    ? fillSouthCarolinaEjectmentPdf(data)
    : fillNorthCarolinaSummaryEjectmentPdf(data)
}
