'use client'

import { useState } from 'react'
import {
  sampleNorthCarolinaEjectmentFillData,
  sampleSouthCarolinaEjectmentFillData,
} from '@/lib/build-ejectment-pdf-fill-data'
import { downloadFilledEjectmentCourtPdf } from '@/lib/ejectment-pdf-download'

export default function SampleCourtPdfsDebugPage() {
  const [status, setStatus] = useState('')

  async function downloadSample(kind: 'SC' | 'NC') {
    setStatus(`Generating ${kind} sample court PDF...`)
    try {
      const data =
        kind === 'SC'
          ? sampleSouthCarolinaEjectmentFillData()
          : sampleNorthCarolinaEjectmentFillData()
      await downloadFilledEjectmentCourtPdf(
        data,
        kind === 'SC'
          ? 'sample-filled-SC-SCCA732.pdf'
          : 'sample-filled-NC-AOC-CVM-201.pdf'
      )
      setStatus(`${kind} sample generated from the official blank PDF template.`)
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : 'Failed to generate sample PDF.')
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Sample Court PDFs</h1>
        <p className="mt-2 text-sm text-gray-600">
          These buttons fill the uploaded official templates directly with pdf-lib coordinates.
          They do not use HTML, canvas, or text/Word document generation.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="space-y-2 rounded-lg border p-4">
          <h2 className="font-medium text-gray-900">SC SCCA732</h2>
          <a
            href="/debug/sample-court-pdfs/sc"
            target="_blank"
            className="block w-full rounded-lg bg-slate-600 px-4 py-2 text-center text-white hover:bg-slate-700"
          >
            Preview sample SC SCCA732
          </a>
          <button
            type="button"
            onClick={() => downloadSample('SC')}
            className="w-full rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700"
          >
            Download sample SC SCCA732
          </button>
        </section>
        <section className="space-y-2 rounded-lg border p-4">
          <h2 className="font-medium text-gray-900">NC AOC-CVM-201</h2>
          <a
            href="/debug/sample-court-pdfs/nc"
            target="_blank"
            className="block w-full rounded-lg bg-slate-600 px-4 py-2 text-center text-white hover:bg-slate-700"
          >
            Preview sample NC AOC-CVM-201
          </a>
          <button
            type="button"
            onClick={() => downloadSample('NC')}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Download sample NC AOC-CVM-201
          </button>
        </section>
      </div>

      {status && (
        <p className="rounded border bg-gray-50 p-3 text-sm text-gray-800" role="status">
          {status}
        </p>
      )}
    </main>
  )
}
