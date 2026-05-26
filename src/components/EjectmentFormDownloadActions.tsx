'use client'

import {
  canPreviewEjectmentForm,
  downloadEjectmentForm,
  previewEjectmentForm,
  printEjectmentForm,
  type GeneratedEjectmentForms,
} from '@/lib/ejectment-form-actions'

type Props = {
  forms: GeneratedEjectmentForms
  downloadFormat?: 'pdf' | 'docx'
}

export function EjectmentFormDownloadActions({ forms }: Props) {
  async function handleDownload() {
    try {
      await downloadEjectmentForm(forms, 'pdf')
    } catch (error) {
      console.error(error)
      alert(error instanceof Error ? error.message : 'Unable to download court form PDF.')
    }
  }

  return (
    <>
      <p className="mt-2 text-xs text-gray-500">
        PDF download uses the official court form template with filled fields (not HTML).
      </p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => previewEjectmentForm(forms)}
          disabled={!canPreviewEjectmentForm(forms)}
          className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Print preview
        </button>
        <button
          type="button"
          onClick={() => printEjectmentForm(forms)}
          disabled={!canPreviewEjectmentForm(forms)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Print
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
        >
          Download Court Ejectment Form
        </button>
      </div>
    </>
  )
}
