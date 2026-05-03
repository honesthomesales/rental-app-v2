/**
 * Generate HTML versions of SC forms with exact formatting
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Printable 7-day notice from plain text (matches generated notice body). */
export function generateNoticeHTML(plainText: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>7-Day Notice</title>
  <style>
    @page { size: letter; margin: 1in; }
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 12pt;
      line-height: 1.5;
      margin: 0;
      padding: 1in;
      max-width: 8.5in;
    }
    pre.notice-body {
      white-space: pre-wrap;
      word-wrap: break-word;
      font-family: inherit;
      margin: 0;
    }
    @media print {
      .form-print-toolbar { display: none !important; }
      body { padding: 0.75in; }
    }
  </style>
</head>
<body>
<pre class="notice-body">${escapeHtml(plainText)}</pre>
</body>
</html>`
}

export type NCEjectmentGrounds = 'nonpayment' | 'endtenancy' | 'violation'

/** North Carolina statewide Complaint in Summary Ejectment draft (AOC-CVM-201 style). File the official PDF from nccourts.gov when the clerk requires it. */
export function generateNCSummaryEjectmentHTML(
  county: string,
  plaintiff: string,
  defendant: string,
  propertyAddress: string,
  grounds: NCEjectmentGrounds,
  rentOwedFormatted: string,
  violationDescription: string,
  day: number,
  month: string,
  year: number,
  plaintiffAddress: string,
  plaintiffCityStateZip: string,
  plaintiffPhone: string,
  plaintiffEmail: string,
  venueNote: string
): string {
  const g1 = grounds === 'nonpayment' ? '[X]' : '[ ]'
  const g2 = grounds === 'endtenancy' ? '[X]' : '[ ]'
  const g3 = grounds === 'violation' ? '[X]' : '[ ]'
  const violLine =
    grounds === 'violation' ? escapeHtml(violationDescription) : '______________________________'

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Complaint in Summary Ejectment</title>
  <style>
    @page { size: letter; margin: 1in; }
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 12pt;
      line-height: 1.45;
      margin: 0;
      padding: 1in;
      max-width: 8.5in;
    }
    .form-header {
      text-align: center;
      font-weight: bold;
      font-size: 13pt;
      margin-bottom: 18pt;
      text-transform: uppercase;
    }
    .form-line { margin-bottom: 8pt; }
    .caption { text-align: center; margin-bottom: 16pt; font-size: 11pt; }
    .indent { margin-left: 24pt; }
    @media print {
      .form-print-toolbar { display: none !important; }
      body { padding: 0.75in; }
    }
  </style>
</head>
<body>
  <div class="caption">NORTH CAROLINA<br/>
  In the General Court of Justice<br/>
  District Court Division<br/>
  <strong>${escapeHtml(county.toUpperCase())} County</strong><br/>
  Small Claims — Summary Ejectment</div>

  <div class="form-header">Complaint in Summary Ejectment</div>
  <div class="form-line" style="font-size:10pt;margin-bottom:14pt;">${escapeHtml(venueNote)}</div>

  <div class="form-line"><strong>Plaintiff:</strong> ${escapeHtml(plaintiff)}</div>
  <div class="form-line" style="text-align:center;margin:10pt 0;">v.</div>
  <div class="form-line"><strong>Defendant(s):</strong> ${escapeHtml(defendant)}</div>

  <div class="form-line" style="margin-top:16pt;">
    Plaintiff seeks possession of the leased premises and any rent owed under N.C. Gen. Stat. Chapter 42 (landlord and tenant).
    The premises are located at: <span style="border-bottom:1px solid #000;">${escapeHtml(propertyAddress)}</span>
  </div>

  <div class="form-line" style="margin-top:14pt;font-weight:bold;">Grounds (check one primary basis for relief):</div>
  <div class="form-line indent">${g1} Nonpayment of rent — amount claimed due and unpaid: <strong>$${escapeHtml(rentOwedFormatted)}</strong></div>
  <div class="form-line indent">${g2} Holdover after the end of the lease term or tenancy.</div>
  <div class="form-line indent">${g3} Breach of lease / other violation: ${violLine}</div>

  <div class="form-line" style="margin-top:18pt;">
    WHEREFORE, Plaintiff requests that the Court enter judgment for restitution of the premises, for unpaid rent and mesne profits as allowed by law, for court costs, and for such other relief as is just.
  </div>

  <div class="form-line" style="margin-top:22pt;">Date: ${day} day of ${escapeHtml(month)}, ${year}.</div>
  <div class="form-line" style="margin-top:20pt;border-top:1px solid #000;width:320px;padding-top:6pt;">
    ${escapeHtml(plaintiff)} / Authorized Agent</div>

  <div class="form-line" style="margin-top:12pt;">Address: ${escapeHtml(plaintiffAddress)}</div>
  <div class="form-line">City/State/ZIP: ${escapeHtml(plaintiffCityStateZip)}</div>
  <div class="form-line">Phone: ${escapeHtml(plaintiffPhone)}</div>
  <div class="form-line">Email: ${escapeHtml(plaintiffEmail)}</div>

  <div class="form-line" style="margin-top:28pt;font-size:9pt;">
    Draft aligned with statewide form <strong>AOC-CVM-201</strong> (Complaint in Summary Ejectment). Obtain the current official PDF from
    <span style="word-break:break-all;">https://www.nccourts.gov/documents/forms/complaint-in-summary-ejectment</span> if your clerk requires the court-issued form.
  </div>
</body>
</html>`
}

export function generateEjectmentHTML(
  county: string,
  plaintiff: string,
  defendant: string,
  magistrate: string,
  address: string,
  ejectmentReason: 'nonpayment' | 'endtenancy' | 'violation',
  reasonDescription: string,
  day: number,
  month: string,
  year: number,
  plaintiffAddress: string,
  plaintiffCityStateZip: string,
  plaintiffPhone: string,
  plaintiffEmail: string
): string {
  // Use checkbox characters that match PDF forms - use [X] and [ ] format to match SC forms exactly
  const checkbox1 = ejectmentReason === 'nonpayment' ? '[X]' : '[ ]'
  const checkbox2 = ejectmentReason === 'endtenancy' ? '[X]' : '[ ]'
  const checkbox3 = ejectmentReason === 'violation' ? '[X]' : '[ ]'

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Application for Ejectment</title>
  <style>
    @page {
      size: letter;
      margin: 1in;
    }
    body {
      font-family: 'Times New Roman', serif;
      font-size: 12pt;
      line-height: 1.6;
      margin: 0;
      padding: 1in;
      max-width: 8.5in;
    }
    .form-header {
      text-align: center;
      font-weight: bold;
      font-size: 14pt;
      margin-bottom: 24pt;
      text-transform: uppercase;
    }
    .form-section {
      margin-bottom: 12pt;
    }
    .form-line {
      margin-bottom: 6pt;
    }
    .underline {
      border-bottom: 1px solid black;
      display: inline-block;
      min-width: 250px;
      height: 14pt;
      vertical-align: bottom;
    }
    .checkbox {
      font-size: 14pt;
      margin-right: 8pt;
      display: inline-block;
      width: 16pt;
    }
    .indent {
      margin-left: 24pt;
      margin-bottom: 8pt;
    }
    .spacing {
      margin-bottom: 12pt;
    }
    .signature-line {
      border-top: 1px solid black;
      width: 350px;
      margin-top: 20pt;
      margin-bottom: 8pt;
    }
    .blank-line {
      border-bottom: 1px solid black;
      display: inline-block;
      min-width: 300px;
      height: 14pt;
    }
  </style>
</head>
<body>
  <div class="form-header">APPLICATION FOR EJECTMENT (Eviction)</div>
  
  <div class="form-section">
    <div class="form-line">STATE OF SOUTH CAROLINA</div>
    <div class="form-line">COUNTY OF <span class="underline">${county.toUpperCase()}</span></div>
  </div>

  <div class="form-section">
    <div class="form-line">PLAINTIFF(S): <span class="underline">${plaintiff}</span></div>
    <div class="form-line" style="text-align: center; margin: 12pt 0;">VS.</div>
    <div class="form-line">DEFENDANT(S): <span class="underline">${defendant}</span></div>
  </div>

  <div class="form-section">
    <div class="form-line">CIVIL CASE NUMBER: <span class="underline"></span></div>
    <div class="form-line">IN THE MAGISTRATE'S COURT</div>
  </div>

  <div class="form-section spacing">
    <div class="form-line">I, ${plaintiff}, plaintiff in this action, do hereby state that I am the landlord-lessor of premises within the jurisdiction of ${magistrate}, which is described as: (address and description of premises - apartment, house, etc.) <span class="underline">${address}</span>.</div>
  </div>

  <div class="form-section spacing">
    <div class="form-line">I further state that, with regard to the above described premises, a landlord-tenant relationship exists between myself and the defendant ${defendant}, the tenant-lessee, as evidenced by the following: (Attach lease papers or other written proof.)</div>
  </div>

  <div class="form-section">
    <div class="form-line" style="font-weight: bold; margin-bottom: 12pt;">GROUNDS FOR EJECTMENT:</div>
    <div class="form-line indent" style="margin-bottom: 12pt;">
      ${checkbox1} The tenant fails or refuses to pay the rent when due or when demanded; or
      ${ejectmentReason === 'nonpayment' ? `<div style="margin-left: 24pt; margin-top: 8pt; margin-bottom: 12pt;">${reasonDescription}</div>` : ''}
    </div>
    <div class="form-line indent" style="margin-bottom: 12pt;">
      ${checkbox2} The term of tenancy or occupancy has ended; or
    </div>
    <div class="form-line indent">
      ${checkbox3} The terms or conditions of the lease have been violated as follows: ${ejectmentReason === 'violation' ? reasonDescription : '<span class="blank-line"></span>'}
    </div>
  </div>

  <div class="form-section spacing" style="margin-top: 18pt;">
    <div class="form-line">WHEREFORE, the plaintiff demands possession of the premises, damages, costs, and such other relief as the Court may deem just and proper.</div>
  </div>

  <div class="form-section spacing" style="margin-top: 24pt;">
    <div class="form-line">Sworn to before me this ${day} day of ${month}, ${year}.</div>
    <div class="signature-line"></div>
    <div class="form-line">Magistrate or Notary Public for South Carolina</div>
    <div class="form-line">My Commission expires: <span class="blank-line"></span></div>
  </div>

  <div class="form-section spacing" style="margin-top: 24pt;">
    <div class="form-line">PLAINTIFF (or his attorney): <span class="blank-line"></span></div>
    <div class="form-line">Address: ${plaintiffAddress}</div>
    <div class="form-line">City/State/Zip: ${plaintiffCityStateZip}</div>
    <div class="form-line">Phone Number: ${plaintiffPhone}</div>
    <div class="form-line">Email: ${plaintiffEmail}</div>
  </div>

  <div class="form-section" style="margin-top: 36pt;">
    <div class="form-line" style="font-size: 10pt;">SCCA/732 — Use official SC Judicial Branch form; Revised 12/2024</div>
  </div>
</body>
</html>`
}

export function generateAffidavitHTML(
  county: string,
  plaintiff: string,
  defendant: string,
  invoiceItems: Array<{ description: string; amount: string }>,
  totalAmount: string,
  day: number,
  month: string,
  year: number
): string {
  // Ensure exactly 5 lines total (form shows 5 lines)
  while (invoiceItems.length < 5) {
    invoiceItems.push({ description: '', amount: '' })
  }

  const itemsHTML = invoiceItems.map(item => {
    const description = item.description || ''
    const amount = item.amount || ''
    return `
      <tr style="height: 20pt;">
        <td style="width: 70%; padding: 4pt 0; vertical-align: bottom;">${description}</td>
        <td style="text-align: right; width: 30%; padding: 4pt 0; vertical-align: bottom; font-family: 'Courier New', monospace;">$${amount}</td>
      </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Affidavit and Itemization of Accounts</title>
  <style>
    @page {
      size: letter;
      margin: 1in;
    }
    body {
      font-family: 'Times New Roman', serif;
      font-size: 12pt;
      line-height: 1.6;
      margin: 0;
      padding: 1in;
      max-width: 8.5in;
    }
    .form-header {
      text-align: center;
      font-weight: bold;
      font-size: 14pt;
      margin-bottom: 24pt;
      text-transform: uppercase;
    }
    .form-section {
      margin-bottom: 12pt;
    }
    .form-line {
      margin-bottom: 6pt;
    }
    .underline {
      border-bottom: 1px solid black;
      display: inline-block;
      min-width: 250px;
      height: 14pt;
      vertical-align: bottom;
    }
    .blank-line {
      border-bottom: 1px solid black;
      display: inline-block;
      min-width: 300px;
      height: 14pt;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 18pt 0;
      table-layout: fixed;
    }
    table td {
      padding: 4pt 0;
      border: none;
      vertical-align: bottom;
    }
    .item-desc {
      width: 70%;
      font-family: 'Times New Roman', serif;
    }
    .item-amount {
      width: 30%;
      text-align: right;
      font-family: 'Courier New', monospace;
    }
    .total-row {
      font-weight: bold;
      margin-top: 8pt;
      padding-top: 8pt;
      border-top: 1px solid #ccc;
    }
    .signature-line {
      border-top: 1px solid black;
      width: 350px;
      margin-top: 20pt;
      margin-bottom: 8pt;
    }
  </style>
</head>
<body>
  <div class="form-header">AFFIDAVIT AND ITEMIZATION OF ACCOUNTS</div>
  
  <div class="form-section">
    <div class="form-line">STATE OF SOUTH CAROLINA</div>
    <div class="form-line">COUNTY OF <span class="underline">${county.toUpperCase()}</span></div>
  </div>

  <div class="form-section">
    <div class="form-line">CIVIL CASE NUMBER: <span class="underline"></span></div>
    <div class="form-line">IN THE MAGISTRATE'S COURT</div>
  </div>

  <div class="form-section">
    <div class="form-line">PLAINTIFF(S): <span class="underline">${plaintiff}</span></div>
    <div class="form-line" style="text-align: center; margin: 12pt 0;">VS.</div>
    <div class="form-line">DEFENDANT(S): <span class="underline">${defendant}</span></div>
  </div>

  <div class="form-section spacing">
    <div class="form-line">Plaintiff, ${plaintiff}, personally appearing before me, who, being duly sworn, states that he is the plaintiff in this action, and that the itemization of accounts which follows is true and correct.</div>
  </div>

  <div class="form-section spacing">
    <div class="form-line">He further states that no part of the sum included in the itemization below has been paid or satisfied in any fashion, and is today due and owed to him.</div>
  </div>

  <div class="form-section">
    <div class="form-line" style="font-weight: bold; margin-bottom: 12pt;">ITEMIZATION OF ACCOUNTS</div>
    <table>
      ${itemsHTML}
      <tr class="total-row">
        <td class="item-desc" style="font-weight: bold;">TOTAL</td>
        <td class="item-amount" style="font-weight: bold;">$${totalAmount}</td>
      </tr>
    </table>
  </div>

  <div class="form-section spacing">
    <div class="form-line">(Copies of bills, papers or other proof of any of the above accounts should be attached to this document.)</div>
  </div>

  <div class="form-section spacing" style="margin-top: 24pt;">
    <div class="form-line">Sworn to and Subscribed before me this ${day} day of ${month}, ${year}.</div>
    <div class="signature-line"></div>
    <div class="form-line">Magistrate or Notary Public for South Carolina</div>
    <div class="form-line">My Commission expires: <span class="blank-line"></span></div>
  </div>

  <div class="form-section spacing" style="margin-top: 24pt;">
    <div class="form-line">PLAINTIFF (or his attorney): <span class="blank-line"></span></div>
  </div>

  <div class="form-section" style="margin-top: 36pt;">
    <div class="form-line" style="font-size: 10pt;">SCCA/716 — Use official SC Judicial Branch form</div>
  </div>
</body>
</html>`
}

/** NC rent ledger / itemization (same figures as SC affidavit; caption per NC summary ejectment practice). */
export function generateNCRentLedgerHTML(
  county: string,
  plaintiff: string,
  defendant: string,
  invoiceItems: Array<{ description: string; amount: string }>,
  totalAmount: string,
  day: number,
  month: string,
  year: number
): string {
  while (invoiceItems.length < 5) {
    invoiceItems.push({ description: '', amount: '' })
  }

  const itemsHTML = invoiceItems.map(item => {
    const description = item.description || ''
    const amount = item.amount || ''
    return `
      <tr style="height: 20pt;">
        <td style="width: 70%; padding: 4pt 0; vertical-align: bottom;">${description}</td>
        <td style="text-align: right; width: 30%; padding: 4pt 0; vertical-align: bottom; font-family: 'Courier New', monospace;">$${amount}</td>
      </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Affidavit and Itemization of Accounts — Rent Ledger (NC)</title>
  <style>
    @page {
      size: letter;
      margin: 1in;
    }
    body {
      font-family: 'Times New Roman', serif;
      font-size: 12pt;
      line-height: 1.6;
      margin: 0;
      padding: 1in;
      max-width: 8.5in;
    }
    .form-header {
      text-align: center;
      font-weight: bold;
      font-size: 14pt;
      margin-bottom: 24pt;
      text-transform: uppercase;
    }
    .form-section {
      margin-bottom: 12pt;
    }
    .form-line {
      margin-bottom: 6pt;
    }
    .underline {
      border-bottom: 1px solid black;
      display: inline-block;
      min-width: 250px;
      height: 14pt;
      vertical-align: bottom;
    }
    .blank-line {
      border-bottom: 1px solid black;
      display: inline-block;
      min-width: 300px;
      height: 14pt;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 18pt 0;
      table-layout: fixed;
    }
    table td {
      padding: 4pt 0;
      border: none;
      vertical-align: bottom;
    }
    .item-desc {
      width: 70%;
      font-family: 'Times New Roman', serif;
    }
    .item-amount {
      width: 30%;
      text-align: right;
      font-family: 'Courier New', monospace;
    }
    .total-row {
      font-weight: bold;
      margin-top: 8pt;
      padding-top: 8pt;
      border-top: 1px solid #ccc;
    }
    .signature-line {
      border-top: 1px solid black;
      width: 350px;
      margin-top: 20pt;
      margin-bottom: 8pt;
    }
  </style>
</head>
<body>
  <div class="form-header">Affidavit and Itemization of Accounts (Rent Ledger)</div>

  <div class="form-section">
    <div class="form-line">STATE OF NORTH CAROLINA</div>
    <div class="form-line">COUNTY OF <span class="underline">${county.toUpperCase()}</span></div>
  </div>

  <div class="form-section">
    <div class="form-line">CIVIL CASE NUMBER: <span class="underline"></span></div>
    <div class="form-line">IN THE GENERAL COURT OF JUSTICE</div>
    <div class="form-line">DISTRICT COURT DIVISION — SMALL CLAIMS</div>
  </div>

  <div class="form-section">
    <div class="form-line">PLAINTIFF(S): <span class="underline">${plaintiff}</span></div>
    <div class="form-line" style="text-align: center; margin: 12pt 0;">VS.</div>
    <div class="form-line">DEFENDANT(S): <span class="underline">${defendant}</span></div>
  </div>

  <div class="form-section spacing">
    <div class="form-line">Plaintiff, ${plaintiff}, personally appearing before me, being duly sworn, states that he/she/it is the plaintiff in this action, and that the itemization of accounts which follows is true and correct.</div>
  </div>

  <div class="form-section spacing">
    <div class="form-line">Plaintiff further states that no part of the sum included in the itemization below has been paid or satisfied in any fashion, and is today due and owed.</div>
  </div>

  <div class="form-section">
    <div class="form-line" style="font-weight: bold; margin-bottom: 12pt;">ITEMIZATION OF ACCOUNTS</div>
    <table>
      ${itemsHTML}
      <tr class="total-row">
        <td class="item-desc" style="font-weight: bold;">TOTAL</td>
        <td class="item-amount" style="font-weight: bold;">$${totalAmount}</td>
      </tr>
    </table>
  </div>

  <div class="form-section spacing">
    <div class="form-line">(Copies of bills, invoices, ledger pages, or other proof may be attached.)</div>
  </div>

  <div class="form-section spacing" style="margin-top: 24pt;">
    <div class="form-line">Sworn to and subscribed before me this ${day} day of ${month}, ${year}.</div>
    <div class="signature-line"></div>
    <div class="form-line">Magistrate or Notary Public for North Carolina</div>
    <div class="form-line">My Commission expires: <span class="blank-line"></span></div>
  </div>

  <div class="form-section spacing" style="margin-top: 24pt;">
    <div class="form-line">PLAINTIFF (or attorney): <span class="blank-line"></span></div>
  </div>

  <div class="form-section" style="margin-top: 36pt;">
    <div class="form-line" style="font-size: 10pt;">Attach to Complaint in Summary Ejectment (AOC-CVM-201). Use current official forms from nccourts.gov when required by the clerk.</div>
  </div>
</body>
</html>`
}
