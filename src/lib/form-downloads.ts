/**
 * Utilities for downloading forms as PDF or Word documents
 */

import jsPDF from 'jspdf'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, SectionType } from 'docx'

/**
 * Download form as PDF
 */
export function downloadAsPDF(content: string, filename: string) {
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 20
  const maxWidth = pageWidth - margin * 2
  
  // Split content into lines and add to PDF
  const lines = content.split('\n')
  let y = margin
  const lineHeight = 7
  
  lines.forEach((line) => {
    // Check if we need a new page
    if (y + lineHeight > pageHeight - margin) {
      doc.addPage()
      y = margin
    }
    
    // Handle special formatting
    if (line.trim() === '') {
      y += lineHeight / 2
    } else {
      // Split long lines to fit page width
      const wrappedLines = doc.splitTextToSize(line, maxWidth)
      doc.text(wrappedLines, margin, y, { maxWidth })
      y += wrappedLines.length * lineHeight
    }
  })
  
  doc.save(filename)
}

/**
 * Download form as Word document
 */
export async function downloadAsWord(content: string, filename: string) {
  // Split content into paragraphs
  const paragraphs = content.split('\n').map((line) => {
    const trimmed = line.trim()
    
    if (trimmed === '') {
      return new Paragraph({
        text: '',
        spacing: { after: 100 },
      })
    }
    
    // Detect headings (all caps or bold markers)
    if (trimmed.toUpperCase() === trimmed && trimmed.length < 100) {
      return new Paragraph({
        text: trimmed,
        heading: HeadingLevel.HEADING_2,
        spacing: { after: 200 },
      })
    }
    
    // Detect bold markers
    if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      return new Paragraph({
        text: trimmed.replace(/\*\*/g, ''),
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: trimmed.replace(/\*\*/g, ''),
            bold: true,
          }),
        ],
      })
    }
    
    return new Paragraph({
      text: trimmed,
      spacing: { after: 100 },
    })
  })
  
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs,
      },
    ],
  })
  
  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
