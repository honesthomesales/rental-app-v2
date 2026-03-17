'use client'

import { useEffect, useState } from 'react'
import { Document } from '@/types/database'

interface DocumentWithSignedUrl extends Document {
  signed_url?: string | null
  download_url?: string | null
}

interface DocumentViewerProps {
  documentId: string | null
  onClose: () => void
}

export function DocumentViewer({ documentId, onClose }: DocumentViewerProps) {
  const [doc, setDoc] = useState<DocumentWithSignedUrl | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const fetchDoc = async () => {
      if (!documentId) return
      setLoading(true)
      try {
        const res = await fetch(`/api/documents/${documentId}`)
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}))
          throw new Error(errorData.error || 'Failed to load document')
        }
        const data = (await res.json()) as DocumentWithSignedUrl
        setDoc(data)
      } catch (error) {
        console.error('Error loading document:', error)
        alert(error instanceof Error ? error.message : 'Failed to load document.')
        onClose()
      } finally {
        setLoading(false)
      }
    }
    fetchDoc()
  }, [documentId, onClose])

  if (!documentId) return null

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-5xl max-h-[95vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {doc?.title || 'Document'}
            </h2>
            {doc && (
              <p className="text-xs text-gray-500">
                Uploaded {doc.created_at ? new Date(doc.created_at).toLocaleString() : '–'}
              </p>
            )}
          </div>
          <div className="flex items-center space-x-3">
            {doc?.download_url && (
              <a
                href={doc.download_url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Download PDF
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex-1 flex overflow-hidden">
          <div className="w-64 border-r border-gray-200 p-4 overflow-y-auto">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Details</h3>
            {loading && <p className="text-xs text-gray-500">Loading…</p>}
            {doc && (
              <div className="space-y-2 text-xs text-gray-700">
                {doc.notes && (
                  <div>
                    <div className="font-medium text-gray-800 mb-0.5">Notes</div>
                    <p className="whitespace-pre-wrap">{doc.notes}</p>
                  </div>
                )}
                <div>
                  <div className="font-medium text-gray-800 mb-0.5">File</div>
                  <p className="break-all text-gray-600 text-[11px]">{doc.file_url}</p>
                  {doc.file_size && (
                    <p className="text-gray-500">
                      {(doc.file_size / 1024).toFixed(1)} KB
                    </p>
                  )}
                </div>
                <div>
                  <div className="font-medium text-gray-800 mb-0.5">Attachments</div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {!doc.property_id &&
                      !doc.tenant_id &&
                      !doc.lease_id &&
                      !doc.expense_id &&
                      !doc.deal_id && <li className="text-gray-500">Standalone document</li>}
                    {doc.property_id && (
                      <li>
                        Property ID:{' '}
                        <span className="font-mono text-[11px]">{doc.property_id}</span>
                      </li>
                    )}
                    {doc.tenant_id && (
                      <li>
                        Tenant ID:{' '}
                        <span className="font-mono text-[11px]">{doc.tenant_id}</span>
                      </li>
                    )}
                    {doc.lease_id && (
                      <li>
                        Lease ID:{' '}
                        <span className="font-mono text-[11px]">{doc.lease_id}</span>
                      </li>
                    )}
                    {doc.expense_id && (
                      <li>
                        Expense ID:{' '}
                        <span className="font-mono text-[11px]">{doc.expense_id}</span>
                      </li>
                    )}
                    {doc.deal_id && (
                      <li>
                        Deal ID:{' '}
                        <span className="font-mono text-[11px]">{doc.deal_id}</span>
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 bg-gray-100 flex items-center justify-center">
            {loading && <p className="text-sm text-gray-500">Loading PDF…</p>}
            {!loading && doc?.signed_url && (
              <iframe
                key={doc.signed_url}
                src={doc.signed_url}
                className="w-full h-full border-0"
                title={doc.title}
              />
            )}
            {!loading && doc && !doc.signed_url && (
              <p className="text-sm text-gray-500 px-4 text-center">
                Unable to generate a secure PDF viewer link. You can still download the file if
                a download URL is available.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

