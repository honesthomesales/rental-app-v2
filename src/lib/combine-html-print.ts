/**
 * Merge two full HTML documents into one printable file (e.g. ejectment + rent ledger).
 * No browser APIs — safe for API routes and client.
 */

import { COURT_FORM_DOC_TITLE, COURT_FORM_PRINT_BASE } from '@/lib/court-form-print-styles'

/** Avoid stacked @page rules when merging two form stylesheets. */
function stripPageRules(css: string): string {
  return css.replace(/@page\s*\{[^}]*\}/gi, '').trim()
}

export function combineHtmlDocumentsForPrint(firstFullHtml: string, secondFullHtml: string): string {
  function extractBody(html: string): string {
    const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
    return m ? m[1].trim() : html
  }

  function extractStyles(html: string): string {
    const parts: string[] = []
    const re = /<style[^>]*>([\s\S]*?)<\/style>/gi
    let m
    while ((m = re.exec(html))) {
      parts.push(m[1])
    }
    return parts.join('\n')
  }

  const styles = `${stripPageRules(extractStyles(firstFullHtml))}\n${stripPageRules(extractStyles(secondFullHtml))}`

  const body1 = extractBody(firstFullHtml)
  const body2 = extractBody(secondFullHtml)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${COURT_FORM_DOC_TITLE}</title>
  <style>
${COURT_FORM_PRINT_BASE}
${styles}
.combined-page-break {
  page-break-before: always;
  break-before: page;
}
@media print {
  .combined-page-break {
    page-break-before: always;
    break-before: page;
  }
}
  </style>
</head>
<body class="court-form-root">
${body1}
<div class="combined-page-break"></div>
${body2}
</body>
</html>`
}

/** Prefer server-built packet; else merge ejectment + affidavit client-side. */
export function getEjectmentPacketPrintHtml(forms: {
  ejectmentAndLedgerPrintHTML?: string
  ejectmentHTML?: string
  affidavitHTML?: string
}): string | undefined {
  if (forms.ejectmentAndLedgerPrintHTML) return forms.ejectmentAndLedgerPrintHTML
  if (forms.ejectmentHTML && forms.affidavitHTML) {
    return combineHtmlDocumentsForPrint(forms.ejectmentHTML, forms.affidavitHTML)
  }
  return forms.ejectmentHTML
}
