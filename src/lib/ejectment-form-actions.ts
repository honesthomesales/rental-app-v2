/**
 * Shared download / print actions for generated ejectment forms.
 */

import { downloadAsWord } from '@/lib/form-downloads'
import {
  downloadFilledEjectmentCourtPdf,
  ejectmentPdfFilename,
  openFilledEjectmentCourtPdfPreview,
} from '@/lib/ejectment-pdf-download'
import type { EjectmentCourtPdfFillData } from '@/types/ejectment-court-pdf'

export type GeneratedEjectmentForms = {
  ejectment?: string
  ejectmentFormKind?: 'SC' | 'NC'
  ejectmentPdfFillData?: EjectmentCourtPdfFillData
  affidavit?: string
  affidavitHTML?: string
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
    throw new Error(
      'Court PDF template data is missing. Ejectment PDFs must be generated from the official court templates.'
    )
  }

  await downloadAsWord(textPacket, `${base}.docx`)
}

export async function previewEjectmentForm(forms: GeneratedEjectmentForms): Promise<void> {
  if (forms.ejectmentPdfFillData) {
    await openFilledEjectmentCourtPdfPreview(forms.ejectmentPdfFillData)
    return
  }
  alert('Court PDF template data is missing. Generate the form again before previewing.')
}

export async function printEjectmentForm(forms: GeneratedEjectmentForms): Promise<void> {
  if (forms.ejectmentPdfFillData) {
    await openFilledEjectmentCourtPdfPreview(forms.ejectmentPdfFillData)
    return
  }
  alert('Court PDF template data is missing. Generate the form again before printing.')
}

export function canPreviewEjectmentForm(forms: GeneratedEjectmentForms): boolean {
  return Boolean(forms.ejectmentPdfFillData)
}
