import { readFile } from 'fs/promises'
import { join } from 'path'
import { sampleNorthCarolinaEjectmentFillData } from '@/lib/build-ejectment-pdf-fill-data'
import { fillNorthCarolinaSummaryEjectmentPdf } from '@/lib/court-pdf-fillers'

export async function GET() {
  const template = await readFile(join(process.cwd(), 'public/forms/NC_eviction.pdf'))
  const pdfBytes = await fillNorthCarolinaSummaryEjectmentPdf(
    sampleNorthCarolinaEjectmentFillData(),
    template
  )

  return new Response(pdfBytes as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="sample-filled-NC-AOC-CVM-201.pdf"',
    },
  })
}
