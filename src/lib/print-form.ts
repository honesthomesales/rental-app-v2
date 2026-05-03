/**
 * Browser print preview and print for generated legal form HTML documents.
 * Client-only — import only from 'use client' components.
 */

/** Insert a toolbar hidden when printing (for preview window only). */
export function injectPrintToolbar(html: string): string {
  if (html.includes('form-print-toolbar')) return html
  const toolbar = `<div class="form-print-toolbar no-print" style="padding:12px 14px;margin-bottom:16px;border-bottom:1px solid #e2e8f0;background:#f8fafc;font-family:system-ui,-apple-system,sans-serif;font-size:14px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
<button type="button" onclick="window.print()" style="padding:8px 16px;background:#2563eb;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Print</button>
<button type="button" onclick="window.close()" style="padding:8px 16px;background:#64748b;color:white;border:none;border-radius:6px;cursor:pointer;">Close</button>
<span style="color:#64748b;font-size:13px;max-width:460px;">Use Print to open your browser&apos;s print dialog (preview on most browsers). This bar is not printed.</span>
</div><style>@media print{.no-print,.form-print-toolbar{display:none!important}}</style>`
  return html.replace(/<body([^>]*)>/i, `<body$1>${toolbar}`)
}

/** Open a new tab with toolbar — preview before printing. */
export function openPrintPreview(html: string): void {
  const w = window.open('', '_blank', 'width=840,height=1120')
  if (!w) {
    alert('Please allow pop-ups for print preview.')
    return
  }
  w.document.open()
  w.document.write(injectPrintToolbar(html))
  w.document.close()
}

/** Open print dialog for a full HTML document (no toolbar). */
export function printFormDocument(html: string): void {
  const w = window.open('', '_blank', 'width=840,height=1120')
  if (!w) {
    alert('Please allow pop-ups to print.')
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
  setTimeout(() => {
    w.focus()
    w.print()
  }, 350)
}
