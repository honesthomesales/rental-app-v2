'use client'

import { useState } from 'react'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

interface DocumentUploaderProps {
  onPdfReady: (file: File) => void
}

export function DocumentUploader({ onPdfReady }: DocumentUploaderProps) {
  const [isProcessing, setIsProcessing] = useState(false)

  const handlePdfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf') {
      alert('Please upload a PDF file.')
      return
    }
    onPdfReady(file)
    event.target.value = ''
  }

  const handleScanImages = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return

    setIsProcessing(true)
    try {
      const images = Array.from(files)
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a4',
      })

      for (let index = 0; index < images.length; index++) {
        const imageFile = images[index]
        const imageUrl = URL.createObjectURL(imageFile)

        // Create an offscreen image element
        const img = document.createElement('img')
        img.src = imageUrl
        img.style.maxWidth = '100%'
        img.style.filter = 'contrast(1.1) brightness(1.05)'

        // Wrap image in container for html2canvas
        const container = document.createElement('div')
        container.style.padding = '16px'
        container.style.backgroundColor = '#ffffff'
        container.appendChild(img)
        document.body.appendChild(container)

        // Wait for image to load
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('Failed to load image'))
        })

        const canvas = await html2canvas(container, {
          backgroundColor: '#ffffff',
          scale: 2,
        })

        const imgData = canvas.toDataURL('image/jpeg', 0.9)
        const pageWidth = pdf.internal.pageSize.getWidth()
        const pageHeight = pdf.internal.pageSize.getHeight()

        const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height)
        const imgWidth = canvas.width * ratio
        const imgHeight = canvas.height * ratio
        const x = (pageWidth - imgWidth) / 2
        const y = (pageHeight - imgHeight) / 2

        if (index > 0) {
          pdf.addPage()
        }
        pdf.addImage(imgData, 'JPEG', x, y, imgWidth, imgHeight)

        document.body.removeChild(container)
        URL.revokeObjectURL(imageUrl)
      }

      const blob = pdf.output('blob')
      const pdfFile = new File([blob], `scan-${Date.now()}.pdf`, {
        type: 'application/pdf',
      })
      onPdfReady(pdfFile)
    } catch (error) {
      console.error('Error generating PDF from scans:', error)
      alert('Failed to process scanned images into a PDF.')
    } finally {
      setIsProcessing(false)
      event.target.value = ''
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Upload PDF
        </label>
        <input
          type="file"
          accept="application/pdf"
          onChange={handlePdfUpload}
          className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Scan with Camera (multi-page)
        </label>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={handleScanImages}
          className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
        />
        <p className="mt-1 text-xs text-gray-500">
          Capture one or more pages. Images are enhanced and combined into a single PDF on your device.
        </p>
      </div>
      {isProcessing && (
        <p className="text-xs text-gray-500">
          Processing scans into a PDF. This may take a few seconds for multiple pages…
        </p>
      )}
    </div>
  )
}

