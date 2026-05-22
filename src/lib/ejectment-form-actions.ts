/**
 * Shared download / print actions for generated ejectment forms.
 */

import { downloadAsPDF, downloadAsWord } from '@/lib/form-downloads'
import {
  downloadFilledEjectmentCourtPdf,
  ejectmentPdfFilename,
  openFilledEjectmentCourtPdfPreview,
} from '@/lib/ejectment-pdf-download'
import { getEjectmentPacketPrintHtml } from '@/lib/combine-html-print'
import type { EjectmentCourtPdfFillData } from '@/types/ejectment-court-pdf'

export type GeneratedEjectmentForms = {
  ejectment?: string
  ejectmentFormKind?: 'SC' | 'NC'
  ejectmentHTML?: string
  ejectmentPdfFillData?: EjectmentCourtPdfFillData
  affidavit?: string
  affidavitHTML?: string
  ejectmentAndLedgerPrintHTML?: string
}

export function getEjectmentDownloadBaseName(formKind?: 'SC' | 'NC'): string {
  return formKind === 'NC' ? 'Complaint-Summary-Ejectment-NC' : 'Application-for-Ejectment'
}

/** Court ejectment PDF uses official template; affidavit / notice may still use HTML path. */
export async function downloadEjectmentForm(
  forms: GeneratedEjectmentForms,
  format: 'pdf' | 'docx'
): Promise<void> {
  const base = getEjectmentDownloadBaseName(forms.ejectmentFormKind)
  const textPacket =
    forms.affidavit && forms.ejectment
      ? `${forms.ejectment}\n\n---\n\n${forms.affidavit}`
      : forms.ejectment || ''

  if (format === 'pdf' && forms.ejectmentPdfFillData) {
    await downloadFilledEjectmentCourtPdf(
      forms.ejectmentPdfFillData,
      ejectmentPdfFilename(forms.ejectmentPdfFillData.formKind)
    )
    return
  }

  if (format === 'pdf') {
    const packetHtml = getEjectmentPacketPrintHtml(forms)
    const pdfHtml = packetHtml ?? forms.ejectmentHTML
    await downloadAsPDF(textPacket, `${base}.pdf`, pdfHtml)
    return
  }

  await downloadAsWord(textPacket, `${base}.docx`)
}

export async function previewEjectmentForm(forms: GeneratedEjectmentForms): Promise<void> {
  if (forms.ejectmentPdfFillData) {
    await openFilledEjectmentCourtPdfPreview(forms.ejectmentPdfFillData)
    return
  }
  const { openPrintPreview } = await import('@/lib/print-form')
  const { generateNoticeHTML } = await import('@/lib/form-html-generator')
  const html = getEjectmentPacketPrintHtml(forms) ?? forms.ejectmentHTML
  if (html) {
    openPrintPreview(html)
  } else if (forms.ejectment) {
    openPrintPreview(generateNoticeHTML(forms.ejectment))
  }
}

export async function printEjectmentForm(forms: GeneratedEjectmentForms): Promise<void> {
  if (forms.ejectmentPdfFillData) {
    await openFilledEjectmentCourtPdfPreview(forms.ejectmentPdfFillData)
    return
  }
  const { printFormDocument } = await import('@/lib/print-form')
  const html = getEjectmentPacketPrintHtml(forms) ?? forms.ejectmentHTML
  if (html) {
    printFormDocument(html)
  }
}

export function canPreviewEjectmentForm(forms: GeneratedEjectmentForms): boolean {
  return Boolean(forms.ejectmentPdfFillData || getEjectmentPacketPrintHtml(forms) || forms.ejectmentHTML)
}
