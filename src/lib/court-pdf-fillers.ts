import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import type { EjectmentCourtPdfFillData } from '@/types/ejectment-court-pdf'
import {
  NC_EVICTION_COORDS,
  SCCA732_COORDS,
  type CourtPdfCheckboxCoord,
  type CourtPdfTextCoord,
} from '@/lib/court-pdf-coordinates'

const TEMPLATE_PATHS = {
  SC: '/forms/SCCA732.pdf',
  NC: '/forms/NC_eviction.pdf',
} as const

const NOTICE_TEXT_GUARD = '7-DAY NOTICE TO PAY RENT OR QUIT'

async function loadTemplateBytes(path: string): Promise<Uint8Array> {
  console.log('COURT FORM PDF TEMPLATE PATH USED:', path)
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`Failed to load court PDF template ${path}: ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

function assertNoNoticeContent(label: string, content: unknown) {
  const text =
    typeof content === 'string'
      ? content
      : content instanceof Uint8Array
        ? new TextDecoder().decode(content)
        : JSON.stringify(content)

  if (text?.includes(NOTICE_TEXT_GUARD)) {
    throw new Error(
      `${label} unexpectedly contains "${NOTICE_TEXT_GUARD}". Refusing to download a notice as a court form.`
    )
  }
}

function valueOrBlank(value: string | number | undefined | null): string {
  if (value == null) return ''
  return String(value).trim()
}

function drawText(
  pages: PDFPage[],
  font: PDFFont,
  coord: CourtPdfTextCoord,
  value: string | number | undefined | null
) {
  const text = valueOrBlank(value)
  if (!text) return

  const page = pages[coord.page]
  if (!page) throw new Error(`Court PDF coordinate references missing page ${coord.page}`)

  const maxWidth = coord.maxWidth
  const lineHeight = coord.lineHeight ?? coord.size + 2
  const lines = maxWidth ? wrapText(text, font, coord.size, maxWidth) : [text]

  lines.forEach((line, index) => {
    page.drawText(line, {
      x: coord.x,
      y: coord.y - index * lineHeight,
      size: coord.size,
      font,
    })
  })
}

function markCheckbox(pages: PDFPage[], font: PDFFont, coord: CourtPdfCheckboxCoord) {
  const page = pages[coord.page]
  if (!page) throw new Error(`Court PDF coordinate references missing page ${coord.page}`)
  page.drawText('X', {
    x: coord.x,
    y: coord.y,
    size: coord.size,
    font,
  })
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next
      continue
    }
    if (current) lines.push(current)
    current = word
  }

  if (current) lines.push(current)
  return lines
}

function cityStateZip(data: EjectmentCourtPdfFillData): string {
  return [data.plaintiffCity, data.plaintiffState, data.plaintiffZip]
    .filter(Boolean)
    .join(', ')
    .replace(', SC,', ', SC')
}

function countyWithoutSuffix(county: string): string {
  return county.replace(/\s*county\s*/gi, '').trim()
}

function dollars(amountWithoutDollar: string | undefined): string {
  const amount = valueOrBlank(amountWithoutDollar)
  return amount ? `$${amount}` : ''
}

async function loadPdfForDrawing(
  formKind: 'SC' | 'NC',
  templateBytes?: Uint8Array
): Promise<{ pdfDoc: PDFDocument; pages: PDFPage[]; font: PDFFont }> {
  const templatePath = TEMPLATE_PATHS[formKind]
  if (templateBytes) {
    console.log('COURT FORM PDF TEMPLATE PATH USED:', templatePath)
  }
  const bytes = templateBytes ?? (await loadTemplateBytes(templatePath))
  assertNoNoticeContent('Court PDF template bytes', bytes)
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true })

  // Remove interactive blank widgets so our direct page content is what prints/downloads.
  try {
    pdfDoc.getForm().flatten()
  } catch {
    // Some future template revisions may be non-interactive; direct drawing still works.
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  return { pdfDoc, pages: pdfDoc.getPages(), font }
}

export async function fillSouthCarolinaEjectmentPdf(
  data: EjectmentCourtPdfFillData,
  templateBytes?: Uint8Array
): Promise<Uint8Array> {
  assertNoNoticeContent('South Carolina court form data', data)
  const { pdfDoc, pages, font } = await loadPdfForDrawing('SC', templateBytes)
  const c = SCCA732_COORDS

  drawText(pages, font, c.county, countyWithoutSuffix(data.propertyCounty))
  drawText(pages, font, c.plaintiff, data.plaintiffName)
  drawText(pages, font, c.defendant, data.defendantName)
  drawText(pages, font, c.plaintiffAddress, data.plaintiffStreetAddress)
  drawText(pages, font, c.cityStateZip, cityStateZip(data))
  drawText(pages, font, c.phone, data.plaintiffPhone)
  drawText(pages, font, c.email, data.plaintiffEmail)
  drawText(pages, font, c.plaintiffName, data.plaintiffName)
  drawText(pages, font, c.propertyAddress, data.premisesAddress)
  drawText(pages, font, c.tenantNames, data.defendantName)
  drawText(pages, font, c.swornDay, data.swornDay)
  drawText(pages, font, c.swornMonth, data.swornMonth)
  drawText(pages, font, c.swornYear, data.swornYear)
  drawText(pages, font, c.plaintiffSignatureName, data.plaintiffName)

  markCheckbox(pages, font, c.leaseCheckbox)

  if (data.ejectmentReason === 'nonpayment') {
    markCheckbox(pages, font, c.nonpaymentCheckbox)
    drawText(pages, font, c.amountOwed, dollars(data.totalDueFormatted))
  } else if (data.ejectmentReason === 'endtenancy') {
    markCheckbox(pages, font, c.expiredTenancyCheckbox)
  } else {
    markCheckbox(pages, font, c.violationCheckbox)
    drawText(pages, font, c.violationDescription, data.violationDescription || 'Lease violation')
  }

  const pdfBytes = await pdfDoc.save()
  assertNoNoticeContent('South Carolina filled court PDF bytes', pdfBytes)
  return pdfBytes
}

export async function fillNorthCarolinaSummaryEjectmentPdf(
  data: EjectmentCourtPdfFillData,
  templateBytes?: Uint8Array
): Promise<Uint8Array> {
  assertNoNoticeContent('North Carolina court form data', data)
  const { pdfDoc, pages, font } = await loadPdfForDrawing('NC', templateBytes)
  const c = NC_EVICTION_COORDS

  drawText(pages, font, c.county, countyWithoutSuffix(data.propertyCounty))
  drawText(pages, font, c.plaintiffName, data.plaintiffName)
  drawText(pages, font, c.plaintiffStreet, data.plaintiffStreetAddress)
  drawText(pages, font, c.plaintiffMail, data.plaintiffStreetAddress)
  drawText(pages, font, c.plaintiffCity, data.plaintiffCity)
  drawText(pages, font, c.plaintiffState, data.plaintiffState)
  drawText(pages, font, c.plaintiffZip, data.plaintiffZip)
  drawText(pages, font, c.plaintiffPhone, data.plaintiffPhone)

  markCheckbox(pages, font, c.defendantIndividual)
  drawText(pages, font, c.defendantName, data.defendantName)
  drawText(pages, font, c.defendantStreet, data.defendantStreetAddress)
  drawText(pages, font, c.defendantMail, data.defendantStreetAddress)
  drawText(pages, font, c.defendantCity, data.defendantCity)
  drawText(pages, font, c.defendantState, data.defendantState)
  drawText(pages, font, c.defendantZip, data.defendantZip)

  drawText(pages, font, c.premisesAddress, data.premisesAddress)
  markCheckbox(pages, font, c.conventionalCheckbox)
  markCheckbox(pages, font, c.noInterpreterCheckbox)

  drawText(pages, font, c.rentRate, dollars(data.rentRateFormatted))
  if (data.rentPeriod === 'week') {
    markCheckbox(pages, font, c.rentWeekCheckbox)
  } else {
    markCheckbox(pages, font, c.rentMonthCheckbox)
  }
  drawText(pages, font, c.rentDueDate, data.rentDueDateFormatted)
  drawText(pages, font, c.leaseEndDate, data.leaseEndDateFormatted)

  if (data.hasWrittenLease) {
    markCheckbox(pages, font, c.writtenLeaseCheckbox)
  } else {
    markCheckbox(pages, font, c.oralLeaseCheckbox)
  }

  if (data.ejectmentReason === 'nonpayment') {
    markCheckbox(pages, font, c.failedPayRentCheckbox)
    if (data.hasWrittenLease) {
      markCheckbox(pages, font, c.breachedCheckbox)
      drawText(
        pages,
        font,
        c.breachDescription,
        data.violationDescription?.trim() || 'Failure to pay rent when due'
      )
    }
  } else if (data.ejectmentReason === 'endtenancy') {
    markCheckbox(pages, font, c.leaseEndedCheckbox)
  } else {
    markCheckbox(pages, font, c.breachedCheckbox)
    drawText(pages, font, c.breachDescription, data.violationDescription || 'Breach of lease')
  }

  drawText(pages, font, c.rentPastDue, dollars(data.totalDueFormatted))
  drawText(pages, font, c.totalAmountDue, dollars(data.totalDueFormatted))
  drawText(pages, font, c.signDate, data.signDateFormatted)
  drawText(pages, font, c.plaintiffSignatureName, data.plaintiffName)
  drawText(pages, font, c.agentName, data.agentName)

  const pdfBytes = await pdfDoc.save()
  assertNoNoticeContent('North Carolina filled court PDF bytes', pdfBytes)
  return pdfBytes
}

export async function fillEjectmentCourtPdf(data: EjectmentCourtPdfFillData): Promise<Uint8Array> {
  return data.formKind === 'SC'
    ? fillSouthCarolinaEjectmentPdf(data)
    : fillNorthCarolinaSummaryEjectmentPdf(data)
}
