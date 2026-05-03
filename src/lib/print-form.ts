/**
 * Browser print preview and print for generated legal form HTML documents.
 * Client-only — import only from 'use client' components.
 */

/** Insert a toolbar hidden when printing (for preview window only). */
export function injectPrintToolbar(html: string): string {
  if (html.includes('form-print-toolbar')) return html
  const toolbar = `<div class="form-print-toolbar no-print" style="padding:12px 14px;margin-bottom:16px;border-bottom:1px solid #e2e8f0;background:#f8fafc;font-family:system-ui,-apple-system,sans-serif;font-size:13px;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;">
<button type="button" onclick="window.print()" style="padding:8px 16px;background:#2563eb;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Print</button>
<button type="button" onclick="window.close()" style="padding:8px 16px;background:#64748b;color:white;border:none;border-radius:6px;cursor:pointer;">Close</button>
<div style="color:#334155;max-width:560px;line-height:1.45;">
<strong>Clean print (like a downloaded court PDF):</strong><br/>
In <strong>Chrome / Edge</strong>, in the print dialog turn <strong>off</strong> <em>Headers and footers</em>. Otherwise the browser adds the page title, date/time, URL (often &quot;about:blank&quot;), and page numbers (e.g. 1/2) outside our layout.<br/>
Set <strong>Margins</strong> to <strong>Default</strong> (the form already uses 0.5&quot; Letter margins). This toolbar does not print.
</div>
</div><style>@media print{.no-print,.form-print-toolbar{display:none!important}}</style>`
  return html.replace(/<body([^>]*)>/i, `<body$1>${toolbar}`)
}

/** Open a preview tab using a blob URL (avoids &quot;about:blank&quot; in the footer URL line when headers are on). */
export function openPrintPreview(html: string): void {
  const withToolbar = injectPrintToolbar(html)
  const blob = new Blob([withToolbar], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const w = window.open(url, '_blank', 'width=840,height=1120')
  if (!w) {
    alert('Please allow pop-ups for print preview.')
    URL.revokeObjectURL(url)
    return
  }
  setTimeout(() => URL.revokeObjectURL(url), 600000)
}

/**
 * Open the system print dialog. Uses a hidden iframe so the printed document is not tied to an
 * empty tab (reduces &quot;about:blank&quot; in browser header/footer fields compared to a blank window).
 */
export function printFormDocument(html: string): void {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.setAttribute('title', 'Print')
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
    visibility: 'hidden',
  })
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument!
  doc.open()
  doc.write(html)
  doc.close()

  const runPrint = () => {
    try {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
      }, 800)
    }
  }

  setTimeout(runPrint, 400)
}
