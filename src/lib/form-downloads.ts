/**
 * Utilities for downloading forms as PDF or Word documents
 * 
 * NOTE: These functions are client-side only and use dynamic imports
 * to prevent server-side bundling issues with browser-only libraries.
 * This file should only be imported in client components.
 */

/**
 * Download form as PDF - uses HTML if available for better formatting, otherwise uses text
 */
export async function downloadAsPDF(content: string, filename: string, htmlContent?: string) {
  // If HTML content is provided, use it for better formatting with html2canvas
  // Only run in browser environment (client-side only)
  if (htmlContent && typeof window !== 'undefined' && typeof document !== 'undefined') {
    try {
      // Dynamically import html2canvas - client-side only
      const html2canvas = (await import('html2canvas')).default
      
      // Create a temporary element with the HTML
      const element = document.createElement('div')
      element.innerHTML = htmlContent
      element.style.position = 'absolute'
      element.style.left = '-9999px'
      element.style.width = '8.5in'
      element.style.padding = '1in'
      document.body.appendChild(element)
      
      // Wait a bit for rendering
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Convert HTML to canvas then to PDF
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        letterRendering: true,
        width: 816, // 8.5in at 96 DPI
        height: 1056 // 11in at 96 DPI
      })
      
      document.body.removeChild(element)
      
      const imgData = canvas.toDataURL('image/png')
      // Dynamically import jsPDF - client-side only
      const { default: jsPDF } = await import('jspdf')
      const pdf = new jsPDF('p', 'in', 'letter')
      const imgWidth = 8.5
      const pageHeight = 11
      const imgHeight = (canvas.height * imgWidth) / canvas.width
      let heightLeft = imgHeight
      let position = 0
      
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight
      
      while (heightLeft > 0) {
        position = heightLeft - imgHeight
        pdf.addPage()
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
        heightLeft -= pageHeight
      }
      
      pdf.save(filename)
      return
    } catch (error) {
      console.error('Error generating PDF from HTML:', error)
      // Fall through to text-based PDF
    }
  }
  
  // Generate PDF from text content (fallback)
  // Dynamic import to prevent server-side bundling
  const { default: jsPDF } = await import('jspdf')
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
      // Handle OPTIONS header with larger font (+6 points = 16pt)
      if (line.trim().startsWith('***OPTIONS***')) {
        doc.setFontSize(16)
        doc.setFont('courier', 'bold')
        doc.text('OPTIONS', margin, y, { maxWidth })
        doc.setFontSize(10)
        doc.setFont('courier', 'normal')
        y += lineHeight * 1.2
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
    }
  })
  
  doc.save(filename)
}

/**
 * Download form as Word document - uses HTML if available for better formatting
 */
export async function downloadAsWord(content: string, filename: string, htmlContent?: string) {
  // Dynamically import docx - client-side only
  const { Document, Paragraph, TextRun, Packer } = await import('docx')
  
  // If HTML content is provided, try to use it (client-side only)
  if (htmlContent && typeof window !== 'undefined' && typeof document !== 'undefined') {
    // For Word, we can create a better formatted document from HTML
    // Parse HTML and convert to Word document structure
    const parser = new DOMParser()
    const doc = parser.parseFromString(htmlContent, 'text/html')
    const paragraphs: InstanceType<typeof Paragraph>[] = []
    
    // Extract text content preserving structure
    const walkNode = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim()
        if (text) {
          paragraphs.push(new Paragraph({
            children: [new TextRun({ text, font: 'Times New Roman', size: 20 })],
            spacing: { after: 100 },
          }))
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element
        if (element.tagName === 'DIV' && element.classList.contains('form-header')) {
          paragraphs.push(new Paragraph({
            children: [new TextRun({ text: element.textContent || '', bold: true, size: 24 })],
            spacing: { after: 200 },
          }))
        } else if (element.tagName === 'STRONG') {
          paragraphs.push(new Paragraph({
            children: [new TextRun({ text: element.textContent || '', bold: true, size: 20 })],
            spacing: { after: 150 },
          }))
        } else {
          Array.from(node.childNodes).forEach(walkNode)
        }
      }
    }
    
    Array.from(doc.body.childNodes).forEach(walkNode)
    
    if (paragraphs.length > 0) {
      const wordDoc = new Document({
        sections: [{
          properties: {
            page: {
              margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
            },
          },
          children: paragraphs,
        }],
      })
      
      const blob = await Packer.toBlob(wordDoc)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      URL.revokeObjectURL(url)
      return
    }
  }
  
  // Fallback to text-based Word document
  // Split content into paragraphs, preserving exact spacing
  const paragraphs = content.split('\n').map((line) => {
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
    
    // Handle OPTIONS header with larger font (+6 points: 20pt base + 6 = 26pt, but Word uses half-points so 32 = 16pt)
    if (trimmed.startsWith('***OPTIONS***')) {
      return new Paragraph({
        children: [
          new TextRun({
            text: 'OPTIONS',
            font: 'Courier New',
            size: 32, // 16pt (base 20 = 10pt, +6pt = 16pt = 32 in Word units)
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
