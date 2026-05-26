'use client'

import { useState } from 'react'
import {
  sampleNorthCarolinaEjectmentFillData,
  sampleSouthCarolinaEjectmentFillData,
} from '@/lib/build-ejectment-pdf-fill-data'
import {
  downloadFilledEjectmentCourtPdf,
  openFilledEjectmentCourtPdfPreview,
} from '@/lib/ejectment-pdf-download'

export default function CourtPdfTestPage() {
  const [status, setStatus] = useState<string>('')

  async function run(kind: 'SC' | 'NC', action: 'download' | 'preview') {
    setStatus(`Generating ${kind}…`)
    try {
      const data =
        kind === 'SC'
          ? sampleSouthCarolinaEjectmentFillData()
          : sampleNorthCarolinaEjectmentFillData()
      if (action === 'download') {
        await downloadFilledEjectmentCourtPdf(
          data,
          kind === 'SC' ? 'test-SCCA732-filled.pdf' : 'test-NC-AOC-CVM-201-filled.pdf'
        )
      } else {
        await openFilledEjectmentCourtPdfPreview(data)
      }
      setStatus(`${kind} ${action} OK — compare to public/forms/${kind === 'SC' ? 'SCCA732.pdf' : 'NC_eviction.pdf'}`)
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`)
      console.error(e)
    }
  }

  return (
    <div className="max-w-xl mx-auto p-8 space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Court PDF template test</h1>
      <p className="text-sm text-gray-600">
        Fills official AcroForm fields on the blank templates in{' '}
        <code className="bg-gray-100 px-1">public/forms/</code>. Open the blank and filled PDFs
        side-by-side to verify alignment.
      </p>

      <div className="space-y-4">
        <section className="border rounded-lg p-4">
          <h2 className="font-medium mb-2">South Carolina — SCCA/732</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="px-3 py-2 bg-green-600 text-white rounded"
              onClick={() => run('SC', 'download')}
            >
              Download sample SC PDF
            </button>
            <button
              type="button"
              className="px-3 py-2 bg-blue-600 text-white rounded"
              onClick={() => run('SC', 'preview')}
            >
              Preview sample SC PDF
            </button>
          </div>
        </section>

        <section className="border rounded-lg p-4">
          <h2 className="font-medium mb-2">North Carolina — AOC-CVM-201</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="px-3 py-2 bg-green-600 text-white rounded"
              onClick={() => run('NC', 'download')}
            >
              Download sample NC PDF
            </button>
            <button
              type="button"
              className="px-3 py-2 bg-blue-600 text-white rounded"
              onClick={() => run('NC', 'preview')}
            >
              Preview sample NC PDF
            </button>
          </div>
        </section>
      </div>

      {status && (
        <p className="text-sm text-gray-800 bg-gray-50 border rounded p-3" role="status">
          {status}
        </p>
      )}
    </div>
  )
}
