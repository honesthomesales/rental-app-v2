/**
 * Utilities for downloading forms as PDF or Word documents
 */

import jsPDF from 'jspdf'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, SectionType } from 'docx'

/**
 * Download form as PDF - uses HTML if available for better formatting, otherwise uses text
 */
export function downloadAsPDF(content: string, filename: string, htmlContent?: string) {
  // If HTML content is provided, use it for better formatting
  if (htmlContent) {
    // Create a temporary element with the HTML
    const element = document.createElement('div')
    element.innerHTML = htmlContent
    element.style.position = 'absolute'
    element.style.left = '-9999px'
    document.body.appendChild(element)
    
    // Use browser's print to PDF functionality via html2canvas approach
    // For now, fall back to text-based PDF
    document.body.removeChild(element)
  }
  
  // Generate PDF from text content
  const doc = new jsPDF({
    unit: 'in',
    format: 'letter',
    compress: true
  })
  
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 1 // 1 inch margins
  const maxWidth = pageWidth - (margin * 2)
  
  // Use monospace font for exact character alignment
  doc.setFont('courier', 'normal')
  doc.setFontSize(10)
  
  // Split content into lines and add to PDF
  const lines = content.split('\n')
  let y = margin
  const lineHeight = 0.2 // inches
  
  lines.forEach((line) => {
    // Check if we need a new page
    if (y + lineHeight > pageHeight - margin) {
      doc.addPage()
      y = margin
    }
    
    // Handle empty lines
    if (line.trim() === '') {
      y += lineHeight * 0.5
    } else {
      // For lines with special formatting (underscores, aligned text), preserve spacing
      // Split long lines only if necessary
      if (line.length > 80) {
        const wrappedLines = doc.splitTextToSize(line, maxWidth)
        wrappedLines.forEach((wrappedLine: string) => {
          doc.text(wrappedLine, margin, y, { maxWidth })
          y += lineHeight
        })
      } else {
        doc.text(line, margin, y, { maxWidth })
        y += lineHeight
      }
    }
  })
  
  doc.save(filename)
}

/**
 * Download form as Word document with monospace font for exact formatting
 */
export async function downloadAsWord(content: string, filename: string) {
  // Split content into paragraphs, preserving exact spacing
  const paragraphs = content.split('\n').map((line, index, array) => {
    const trimmed = line.trim()
    
    // Preserve empty lines for spacing
    if (trimmed === '') {
      return new Paragraph({
        text: '',
        spacing: { after: 120, before: 0 },
      })
    }
    
    // Use monospace font for exact character alignment (Courier New)
    const isHeading = trimmed.toUpperCase() === trimmed && 
                     (trimmed.includes('STATE OF') || 
                      trimmed.includes('APPLICATION') || 
                      trimmed.includes('AFFIDAVIT') ||
                      trimmed.includes('PLAINTIFF') ||
                      trimmed.includes('DEFENDANT') ||
                      trimmed.includes('IN THE MAGISTRATE') ||
                      trimmed.includes('GROUNDS FOR') ||
                      trimmed.includes('ITEMIZATION'))
    
    if (isHeading) {
      return new Paragraph({
        children: [
          new TextRun({
            text: line,
            font: 'Courier New',
            size: 22,
            bold: true,
          }),
        ],
        spacing: { after: 120, before: 0 },
      })
    }
    
    // Detect bold markers
    if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      return new Paragraph({
        children: [
          new TextRun({
            text: trimmed.replace(/\*\*/g, ''),
            font: 'Courier New',
            size: 20,
            bold: true,
          }),
        ],
        spacing: { after: 120, before: 0 },
      })
    }
    
    // Regular text with monospace font to preserve spacing
    return new Paragraph({
      children: [
        new TextRun({
          text: line,
          font: 'Courier New',
          size: 20,
        }),
      ],
      spacing: { after: 100, before: 0 },
    })
  })
  
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch (1440 twips = 1 inch)
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
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
