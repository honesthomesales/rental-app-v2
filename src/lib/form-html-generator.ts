/**
 * Generate HTML versions of SC forms with exact formatting
 */

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
    <div class="form-line" style="font-size: 10pt;">SCCA/732 (Amended 05/2008)</div>
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
    <div class="form-line" style="font-size: 10pt;">SCCA/716 (Amended 05/2008)</div>
  </div>
</body>
</html>`
}
