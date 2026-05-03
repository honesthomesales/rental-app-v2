/**
 * Shared print CSS for court forms (US Letter).
 *
 * Official SCCA / NC Judicial PDFs typically use ~0.5" margins on Letter paper.
 * Do not stack @page margins with body padding — that doubled whitespace (~2" inset).
 */

/** Minimal document title for print preview tabs (reduces browser header noise when headers are on). */
export const COURT_FORM_DOC_TITLE = '\u200B'

export const COURT_FORM_PRINT_BASE = `
  @page {
    size: letter portrait;
    margin: 0.5in;
  }
  html {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body.court-form-root {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    max-width: none;
    width: 100%;
  }
  /* Keep sworn / notary commission / plaintiff signature block on one printed page */
  .signature-block-keep-together {
    page-break-inside: avoid;
    break-inside: avoid;
  }
`
