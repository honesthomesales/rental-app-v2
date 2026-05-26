/**
 * Client-side download / preview for official court ejectment PDFs (template-filled).
 */

import type { EjectmentCourtPdfFillData } from '@/types/ejectment-court-pdf'
import { fillEjectmentCourtPdf } from '@/lib/court-pdf-fillers'

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export async function buildFilledEjectmentPdfBlob(
  data: EjectmentCourtPdfFillData
): Promise<Blob> {
  const bytes = await fillEjectmentCourtPdf(data)
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}

/** Download filled official court ejectment PDF (no html2canvas). */
export async function downloadFilledEjectmentCourtPdf(
  data: EjectmentCourtPdfFillData,
  filename: string
): Promise<void> {
  const blob = await buildFilledEjectmentPdfBlob(data)
  triggerBlobDownload(blob, filename)
}

/** Open filled PDF in a new tab for print preview. */
export async function openFilledEjectmentCourtPdfPreview(
  data: EjectmentCourtPdfFillData
): Promise<void> {
  const blob = await buildFilledEjectmentPdfBlob(data)
  const url = URL.createObjectURL(blob)
  const w = window.open(url, '_blank')
  if (!w) {
    alert('Please allow pop-ups to preview the court PDF.')
    URL.revokeObjectURL(url)
    return
  }
  setTimeout(() => URL.revokeObjectURL(url), 600_000)
}

export function ejectmentPdfFilename(formKind: 'SC' | 'NC'): string {
  return formKind === 'NC'
    ? 'Complaint-Summary-Ejectment-NC.pdf'
    : 'Application-for-Ejectment.pdf'
}
