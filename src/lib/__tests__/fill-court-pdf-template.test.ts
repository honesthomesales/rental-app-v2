import { readFileSync } from 'fs'
import { join } from 'path'
import { PDFDocument } from 'pdf-lib'
import {
  fillNorthCarolinaSummaryEjectmentPdf,
  fillSouthCarolinaEjectmentPdf,
  normalizeSouthCarolinaCounty,
} from '../fill-court-pdf-template'
import { sampleNorthCarolinaEjectmentFillData, sampleSouthCarolinaEjectmentFillData } from '../build-ejectment-pdf-fill-data'

describe('fill-court-pdf-template', () => {
  it('normalizes SC county names for SCCA/732 dropdown', () => {
    expect(normalizeSouthCarolinaCounty('spartanburg county')).toBe('Spartanburg')
    expect(normalizeSouthCarolinaCounty('GREENVILLE')).toBe('Greenville')
  })

  it('fills SC template and preserves page count', async () => {
    const template = readFileSync(join(process.cwd(), 'public/forms/SCCA732.pdf'))
    const filled = await fillSouthCarolinaEjectmentPdf(
      sampleSouthCarolinaEjectmentFillData(),
      template
    )
    const doc = await PDFDocument.load(filled)
    const blank = await PDFDocument.load(template)
    expect(doc.getPageCount()).toBe(blank.getPageCount())
    expect(filled.byteLength).toBeGreaterThan(10000)
  })

  it('fills NC template and preserves page count', async () => {
    const template = readFileSync(join(process.cwd(), 'public/forms/NC_eviction.pdf'))
    const filled = await fillNorthCarolinaSummaryEjectmentPdf(
      sampleNorthCarolinaEjectmentFillData(),
      template
    )
    const doc = await PDFDocument.load(filled)
    const blank = await PDFDocument.load(template)
    expect(doc.getPageCount()).toBe(blank.getPageCount())
    expect(filled.byteLength).toBeGreaterThan(10000)
  })
})
