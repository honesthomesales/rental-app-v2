'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

function PrintNoticeContent() {
  const searchParams = useSearchParams()
  const [noticeHtml, setNoticeHtml] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const invoiceId = searchParams.get('invoiceId')
    const leaseId = searchParams.get('leaseId')

    if (invoiceId && leaseId) {
      fetchNotice(invoiceId, leaseId)
    }
  }, [searchParams])

  const fetchNotice = async (invoiceId: string, leaseId: string) => {
    try {
      const response = await fetch('/api/generate-notice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId, leaseId })
      })

      const data = await response.json()
      setNoticeHtml(data.noticeContent || '')
      setLoading(false)

      // Auto-print after content loads
      setTimeout(() => {
        window.print()
      }, 500)
    } catch (error) {
      console.error('Error fetching notice:', error)
      setLoading(false)
    }
  }

  const formatNoticeContent = (content: string) => {
    return content.split('\n').map((line, index) => {
      if (line.startsWith('**NOTICE TO PAY RENT OR QUIT')) {
        return <div key={index} className="text-2xl font-bold text-center mb-6">{line.replace(/\*\*/g, '')}</div>
      } else if (line.startsWith('7-DAY NOTICE PURSUANT TO')) {
        return <div key={index} className="text-xs text-center mb-4 text-gray-700">{line}</div>
      } else if (line.startsWith('**BREAKDOWN OF AMOUNTS DUE:**')) {
        return <div key={index} className="font-bold text-base mt-6 mb-3">{line.replace(/\*\*/g, '')}</div>
      } else if (line.startsWith('**TOTAL DUE:')) {
        return <div key={index} className="font-bold text-lg bg-yellow-100 p-3 border-l-4 border-yellow-500 my-4">{line.replace(/\*\*/g, '')}</div>
      } else if (line.startsWith('Rent:') || line.startsWith('Late Fee:') || line.startsWith('Other Charges:')) {
        return <div key={index} className="ml-5 mb-1">{line}</div>
      } else if (line.startsWith('**IMPORTANT:')) {
        return <div key={index} className="font-bold text-red-600 bg-red-50 p-3 rounded my-4">{line.replace(/\*\*/g, '')}</div>
      } else if (line.startsWith('**LANDLORD:**')) {
        return <div key={index} className="font-bold text-base mt-6 mb-3">{line.replace(/\*\*/g, '')}</div>
      } else if (line.startsWith('**NOTICE DELIVERY:**')) {
        return <div key={index} className="font-bold text-base mt-4 mb-3">{line.replace(/\*\*/g, '')}</div>
      } else if (line.includes('Honest Home Sales, LLC') || line.includes('PO Box 705') || line.includes('Text:') || line.includes('Email:')) {
        return <div key={index} className="bg-gray-50 p-3 border-l-4 border-blue-500 mb-1">{line}</div>
      } else if (line.includes('Date Notice Delivered:') || line.includes('Method of Delivery:')) {
        return <div key={index} className="bg-green-50 p-3 border-l-4 border-green-500 mb-1">{line}</div>
      } else if (line.trim() === '---') {
        return <div key={index} className="border-t border-gray-300 my-5"></div>
      } else if (line.trim() === '') {
        return <br key={index} />
      } else if (line.startsWith('Date:') || line.startsWith('To:') || line.startsWith('Property:')) {
        const parts = line.split(':')
        return <div key={index} className="mb-3"><strong>{parts[0]}:</strong> {parts.slice(1).join(':')}</div>
      } else {
        return <div key={index} className="mb-3">{line}</div>
      }
    })
  }

  if (loading) {
    return <div className="p-8 text-center">Loading notice...</div>
  }

  return (
    <div className="max-w-4xl mx-auto p-8 bg-white print:p-0 print:max-w-full">
      <style jsx global>{`
        @media print {
          @page {
            size: letter portrait;
            margin: 0.5in;
          }
          
          body {
            background: white !important;
            margin: 0;
            padding: 0;
          }
          
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
      
      <div className="text-sm leading-relaxed">
        {formatNoticeContent(noticeHtml)}
      </div>
    </div>
  )
}

export default function PrintNoticePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">Loading notice...</div>}>
      <PrintNoticeContent />
    </Suspense>
  )
}

