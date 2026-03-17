'use client'

import { useState } from 'react'
import { Document } from '@/types/database'

interface DocumentPreviewModalProps {
  open: boolean
  pdfFile: File | null
  initialTitle?: string
  onClose: () => void
  onSaved: (doc: Document) => void
}

export function DocumentPreviewModal({
  open,
  pdfFile,
  initialTitle,
  onClose,
  onSaved,
}: DocumentPreviewModalProps) {
  const [title, setTitle] = useState(initialTitle || pdfFile?.name || '')
  const [notes, setNotes] = useState('')
  const [attachmentType, setAttachmentType] = useState<
    'none' | 'property' | 'tenant' | 'lease' | 'expense' | 'deal'
  >('none')
  const [attachmentId, setAttachmentId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  if (!open || !pdfFile) return null

  const handleSave = async () => {
    if (!title.trim()) {
      alert('Please enter a title for this document.')
      return
    }

    setIsSaving(true)
    try {
      // 1. Upload file to storage
      const formData = new FormData()
      formData.append('file', pdfFile)
      formData.append('filename', pdfFile.name)

      const uploadRes = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      })

      if (!uploadRes.ok) {
        const errorData = await uploadRes.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to upload file')
      }

      const { file_url, file_size } = await uploadRes.json()

      // 2. Create document record
      const payload: any = {
        title: title.trim(),
        notes: notes.trim() || null,
        file_url,
        file_size,
      }

      if (attachmentType !== 'none' && attachmentId) {
        if (attachmentType === 'property') payload.property_id = attachmentId
        if (attachmentType === 'tenant') payload.tenant_id = attachmentId
        if (attachmentType === 'lease') payload.lease_id = attachmentId
        if (attachmentType === 'expense') payload.expense_id = attachmentId
        if (attachmentType === 'deal') payload.deal_id = attachmentId
      }

      const createRes = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!createRes.ok) {
        const errorData = await createRes.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to create document record')
      }

      const doc = (await createRes.json()) as Document
      onSaved(doc)
      onClose()
    } catch (error) {
      console.error('Error saving document:', error)
      alert(error instanceof Error ? error.message : 'Failed to save document.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Document Preview</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="Optional notes about this document"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Attach To (optional)
            </label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <select
                value={attachmentType}
                onChange={(e) => {
                  setAttachmentType(e.target.value as any)
                  setAttachmentId(null)
                }}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="none">Standalone</option>
                <option value="property">Property</option>
                <option value="tenant">Tenant</option>
                <option value="lease">Lease</option>
                <option value="expense">Expense</option>
                <option value="deal">Deal</option>
              </select>
              <input
                type="text"
                placeholder="Enter ID from context (V1)"
                value={attachmentId || ''}
                onChange={(e) => setAttachmentId(e.target.value || null)}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
                disabled={attachmentType === 'none'}
              />
            </div>
            <p className="text-xs text-gray-500">
              For V1, paste the relevant ID from a property, tenant, lease, expense, or deal. 
              Documents can also remain standalone.
            </p>
          </div>
          <div className="text-xs text-gray-500">
            <p>
              File: <span className="font-mono">{pdfFile.name}</span> ({(pdfFile.size / 1024).toFixed(1)} KB)
            </p>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : 'Save to Inbox'}
          </button>
        </div>
      </div>
    </div>
  )
}

