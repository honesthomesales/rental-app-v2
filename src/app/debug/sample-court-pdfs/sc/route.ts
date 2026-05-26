import { readFile } from 'fs/promises'
import { join } from 'path'
import { sampleSouthCarolinaEjectmentFillData } from '@/lib/build-ejectment-pdf-fill-data'
import { fillSouthCarolinaEjectmentPdf } from '@/lib/court-pdf-fillers'

export async function GET() {
  const template = await readFile(join(process.cwd(), 'public/forms/SCCA732.pdf'))
  const pdfBytes = await fillSouthCarolinaEjectmentPdf(
    sampleSouthCarolinaEjectmentFillData(),
    template
  )

  return new Response(pdfBytes as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="sample-filled-SC-SCCA732.pdf"',
    },
  })
}
