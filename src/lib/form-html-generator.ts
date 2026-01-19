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
  const checkbox1 = ejectmentReason === 'nonpayment' ? 'checked' : ''
  const checkbox2 = ejectmentReason === 'endtenancy' ? 'checked' : ''
  const checkbox3 = ejectmentReason === 'violation' ? 'checked' : ''

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
      line-height: 1.5;
      margin: 0;
      padding: 0;
    }
    .form-header {
      text-align: center;
      font-weight: bold;
      margin-bottom: 20px;
    }
    .form-section {
      margin-bottom: 15px;
    }
    .form-line {
      margin-bottom: 8px;
    }
    .underline {
      border-bottom: 1px solid black;
      display: inline-block;
      min-width: 200px;
    }
    .checkbox {
      font-size: 14pt;
      margin-right: 5px;
    }
    .indent {
      margin-left: 20px;
    }
    .spacing {
      margin-bottom: 10px;
    }
    .signature-line {
      border-top: 1px solid black;
      width: 300px;
      margin-top: 30px;
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
    <div class="form-line">VS.</div>
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
    <div class="form-line"><strong>GROUNDS FOR EJECTMENT:</strong></div>
    <div class="form-line indent">
      <input type="checkbox" ${checkbox1} disabled class="checkbox"> The tenant fails or refuses to pay the rent when due or when demanded; or
      ${ejectmentReason === 'nonpayment' ? `<div class="indent spacing">${reasonDescription}</div>` : ''}
    </div>
    <div class="form-line indent">
      <input type="checkbox" ${checkbox2} disabled class="checkbox"> The term of tenancy or occupancy has ended; or
    </div>
    <div class="form-line indent">
      <input type="checkbox" ${checkbox3} disabled class="checkbox"> The terms or conditions of the lease have been violated as follows: <span class="underline">${ejectmentReason === 'violation' ? reasonDescription : ''}</span>
    </div>
  </div>

  <div class="form-section spacing">
    <div class="form-line">WHEREFORE, the plaintiff demands possession of the premises, damages, costs, and such other relief as the Court may deem just and proper.</div>
  </div>

  <div class="form-section spacing">
    <div class="form-line">Sworn to before me this ${day} day of ${month}, ${year}.</div>
    <div class="signature-line"></div>
    <div class="form-line">Magistrate or Notary Public for South Carolina</div>
    <div class="form-line">My Commission expires: <span class="underline"></span></div>
  </div>

  <div class="form-section spacing">
    <div class="form-line">PLAINTIFF (or his attorney): <span class="underline"></span></div>
    <div class="form-line">Address: ${plaintiffAddress}</div>
    <div class="form-line">City/State/Zip: ${plaintiffCityStateZip}</div>
    <div class="form-line">Phone Number: ${plaintiffPhone}</div>
    <div class="form-line">Email: ${plaintiffEmail}</div>
  </div>

  <div class="form-section" style="margin-top: 30px;">
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
  // Ensure 5 lines total
  while (invoiceItems.length < 5) {
    invoiceItems.push({ description: '', amount: '' })
  }

  const itemsHTML = invoiceItems.map(item => {
    const description = item.description || ''
    const amount = item.amount || ''
    return `
      <tr>
        <td style="width: 70%;">${description}</td>
        <td style="text-align: right; width: 30%;">$${amount}</td>
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
      line-height: 1.5;
      margin: 0;
      padding: 0;
    }
    .form-header {
      text-align: center;
      font-weight: bold;
      margin-bottom: 20px;
    }
    .form-section {
      margin-bottom: 15px;
    }
    .form-line {
      margin-bottom: 8px;
    }
    .underline {
      border-bottom: 1px solid black;
      display: inline-block;
      min-width: 200px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
    }
    table td {
      padding: 5px;
      border: none;
    }
    .signature-line {
      border-top: 1px solid black;
      width: 300px;
      margin-top: 30px;
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
    <div class="form-line">VS.</div>
    <div class="form-line">DEFENDANT(S): <span class="underline">${defendant}</span></div>
  </div>

  <div class="form-section spacing">
    <div class="form-line">Plaintiff, ${plaintiff}, personally appearing before me, who, being duly sworn, states that he is the plaintiff in this action, and that the itemization of accounts which follows is true and correct.</div>
  </div>

  <div class="form-section spacing">
    <div class="form-line">He further states that no part of the sum included in the itemization below has been paid or satisfied in any fashion, and is today due and owed to him.</div>
  </div>

  <div class="form-section">
    <div class="form-line"><strong>ITEMIZATION OF ACCOUNTS</strong></div>
    <table>
      ${itemsHTML}
      <tr>
        <td style="font-weight: bold;">TOTAL</td>
        <td style="text-align: right; font-weight: bold;">$${totalAmount}</td>
      </tr>
    </table>
  </div>

  <div class="form-section spacing">
    <div class="form-line">(Copies of bills, papers or other proof of any of the above accounts should be attached to this document.)</div>
  </div>

  <div class="form-section spacing">
    <div class="form-line">Sworn to and Subscribed before me this ${day} day of ${month}, ${year}.</div>
    <div class="signature-line"></div>
    <div class="form-line">Magistrate or Notary Public for South Carolina</div>
    <div class="form-line">My Commission expires: <span class="underline"></span></div>
  </div>

  <div class="form-section spacing">
    <div class="form-line">PLAINTIFF (or his attorney): <span class="underline"></span></div>
  </div>

  <div class="form-section" style="margin-top: 30px;">
    <div class="form-line" style="font-size: 10pt;">SCCA/716 (Amended 05/2008)</div>
  </div>
</body>
</html>`
}
