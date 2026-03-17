'use client'

import { useEffect, useMemo, useState } from 'react'
import { Document } from '@/types/database'
import { DocumentUploader } from '@/components/DocumentUploader'
import { DocumentPreviewModal } from '@/components/DocumentPreviewModal'
import { DocumentViewer } from '@/components/DocumentViewer'
import { MagnifyingGlassIcon, PlusIcon, DocumentTextIcon } from '@heroicons/react/24/outline'

type AttachmentFilter = 'all' | 'standalone' | 'property' | 'tenant' | 'lease' | 'expense' | 'deal'

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [attachmentFilter, setAttachmentFilter] = useState<AttachmentFilter>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const [viewerId, setViewerId] = useState<string | null>(null)

  useEffect(() => {
    fetchDocuments()
  }, [])

  const fetchDocuments = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (dateFrom) params.set('from', dateFrom)
      if (dateTo) params.set('to', dateTo)

      const res = await fetch(`/api/documents?${params.toString()}`)
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to fetch documents')
      }
      const data = (await res.json()) as Document[]
      setDocuments(data || [])
    } catch (error) {
      console.error('Error fetching documents:', error)
      setDocuments([])
    } finally {
      setLoading(false)
    }
  }

  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      if (attachmentFilter === 'standalone') {
        return (
          !doc.property_id &&
          !doc.tenant_id &&
          !doc.lease_id &&
          !doc.expense_id &&
          !doc.deal_id
        )
      }
      if (attachmentFilter === 'property') return !!doc.property_id
      if (attachmentFilter === 'tenant') return !!doc.tenant_id
      if (attachmentFilter === 'lease') return !!doc.lease_id
      if (attachmentFilter === 'expense') return !!doc.expense_id
      if (attachmentFilter === 'deal') return !!doc.deal_id
      return true
    })
  }, [documents, attachmentFilter])

  const handlePdfReady = (file: File) => {
    setPreviewFile(file)
  }

  const handleDocumentSaved = (doc: Document) => {
    setDocuments((prev) => [doc, ...prev])
    setPreviewFile(null)
  }

  const handleDeleteDocument = async (doc: Document) => {
    if (!confirm(`Delete document "${doc.title}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to delete document')
      }
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id))
      if (viewerId === doc.id) setViewerId(null)
    } catch (error) {
      console.error('Error deleting document:', error)
      alert(error instanceof Error ? error.message : 'Failed to delete document.')
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
          <p className="text-gray-600 mt-2">
            Scan, upload, and manage documents in a simple inbox.
          </p>
        </div>
      </div>

      <div className="mb-6 bg-white rounded-lg shadow p-4">
        <h2 className="text-sm font-semibold text-gray-800 mb-3 flex items-center">
          <PlusIcon className="h-4 w-4 text-blue-500 mr-1" />
          New Document
        </h2>
        <DocumentUploader onPdfReady={handlePdfReady} />
      </div>

      <div className="mb-4 bg-white rounded-lg shadow p-4">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Search
            </label>
            <div className="relative">
              <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by title or notes..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                From date
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                To date
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Attachment
              </label>
              <select
                value={attachmentFilter}
                onChange={(e) => setAttachmentFilter(e.target.value as AttachmentFilter)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="all">All</option>
                <option value="standalone">Standalone only</option>
                <option value="property">Attached to property</option>
                <option value="tenant">Attached to tenant</option>
                <option value="lease">Attached to lease</option>
                <option value="expense">Attached to expense</option>
                <option value="deal">Attached to deal</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={fetchDocuments}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <DocumentTextIcon className="h-5 w-5 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-800">
              Document Inbox
            </h2>
          </div>
          <p className="text-xs text-gray-500">
            Showing {filteredDocuments.length} of {documents.length} documents
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Title
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Notes
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Uploaded
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Attached To
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Size
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">
                    Loading documents…
                  </td>
                </tr>
              )}
              {!loading && filteredDocuments.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                    No documents found. Scan or upload a document to get started.
                  </td>
                </tr>
              )}
              {!loading &&
                filteredDocuments.map((doc) => (
                  <tr
                    key={doc.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => setViewerId(doc.id)}
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {doc.title}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">
                      {doc.notes || '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {doc.created_at
                        ? new Date(doc.created_at).toLocaleString()
                        : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500">
                      {(!doc.property_id &&
                        !doc.tenant_id &&
                        !doc.lease_id &&
                        !doc.expense_id &&
                        !doc.deal_id && (
                          <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                            Standalone
                          </span>
                        )) || (
                        <div className="space-y-0.5">
                          {doc.property_id && (
                            <div>
                              <span className="font-semibold">Property:</span>{' '}
                              <span className="font-mono text-[11px]">
                                {doc.property_id}
                              </span>
                            </div>
                          )}
                          {doc.tenant_id && (
                            <div>
                              <span className="font-semibold">Tenant:</span>{' '}
                              <span className="font-mono text-[11px]">
                                {doc.tenant_id}
                              </span>
                            </div>
                          )}
                          {doc.lease_id && (
                            <div>
                              <span className="font-semibold">Lease:</span>{' '}
                              <span className="font-mono text-[11px]">
                                {doc.lease_id}
                              </span>
                            </div>
                          )}
                          {doc.expense_id && (
                            <div>
                              <span className="font-semibold">Expense:</span>{' '}
                              <span className="font-mono text-[11px]">
                                {doc.expense_id}
                              </span>
                            </div>
                          )}
                          {doc.deal_id && (
                            <div>
                              <span className="font-semibold">Deal:</span>{' '}
                              <span className="font-mono text-[11px]">
                                {doc.deal_id}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {doc.file_size
                        ? `${(doc.file_size / 1024).toFixed(1)} KB`
                        : '—'}
                    </td>
                    <td
                      className="px-4 py-3 whitespace-nowrap text-sm text-blue-600"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="text-red-600 hover:text-red-800 text-xs"
                        onClick={() => handleDeleteDocument(doc)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <DocumentPreviewModal
        open={!!previewFile}
        pdfFile={previewFile}
        onClose={() => setPreviewFile(null)}
        onSaved={handleDocumentSaved}
      />

      <DocumentViewer
        documentId={viewerId}
        onClose={() => setViewerId(null)}
      />
    </div>
  )
}

