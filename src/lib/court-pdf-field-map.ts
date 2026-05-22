/**
 * Official court PDF AcroForm field names (not x/y coordinates).
 * Templates: public/forms/SCCA732.pdf (SC), public/forms/NC_eviction.pdf (NC AOC-CVM-201).
 *
 * Adjust mapping logic in fill-court-pdf-template.ts if the court renames fields in a revision.
 */

/** South Carolina SCCA/732 — Application for Ejectment */
export const SC_EJECTMENT_FIELDS = {
  civilCaseNumber: 'Civil Case Number',
  countyDropdown: 'Select the County',
  plaintiff: 'Plaintiff(s)',
  plaintiffName: 'Name of Plaintiff',
  defendant: 'Defendant(s)',
  defendantName: 'Name of the Defendant (Tenant / Lessee)',
  propertyAddress: 'Property Address',
  plaintiffAddress: "Plaintiff's Address",
  plaintiffCityStateZip: 'City / State / Zip Code',
  phone: 'Telephone Number',
  email: 'Email Address',
  amountOwed: 'Amount of Failed Payment',
  violationDescription: 'Description of the Terms or Conditions Violated',
  daySworn: 'Day Sworn',
  monthSworn: 'Month Sworn',
  yearSworn: 'Year Sworn',
  plaintiffSignature: 'Signature of Plaintiff or Person filing on behalf of Plaintiff',
  checkLeaseProof: 'lease',
  checkNonpayment:
    'Tenant has failed or refuses to pay rent when due or upon demand in the amount of',
  checkEndTenancy: 'The term of tenancy or occupancy has expired',
  checkViolation: 'The terms or conditions of the lease have been violated as follows',
} as const

/** North Carolina AOC-CVM-201 — Complaint in Summary Ejectment */
export const NC_EJECTMENT_FIELDS = {
  fileNo: 'FileNo',
  countyName: 'CountyName',
  plaintiffName: 'PltfName',
  plaintiffStreet: 'PltfStreetAddr',
  plaintiffMail: 'PltfMailAddr',
  plaintiffCity: 'PltfCity',
  plaintiffState: 'PltfState',
  plaintiffZip: 'PltfZip',
  plaintiffPhone: 'PltfTelephone',
  defendantIndividual: 'Def1Indv',
  defendantName: 'Def1Name',
  defendantStreet: 'Def1StreetAddr',
  defendantCity: 'Def1City',
  defendantState: 'Def1State',
  defendantZip: 'Def1Zip',
  premises: 'PremisesDesc',
  rentRate: 'RentRate',
  rentDueDate: 'RentDueDate',
  leaseEndDate: 'LeaseEndDate',
  rentPastDue: 'RentPastDueAmount',
  amountDue: 'AmountDue',
  breachDescription: 'BreachedDesc',
  signDate: 'Sign1Date',
  plaintiffSignName: 'PltfSignName',
  agentName: 'AgentName',
  checkWritten: 'Written',
  checkOral: 'Oral',
  checkFailedPayRent: 'FailedPayRent',
  checkLeaseEnded: 'LeaseEnded',
  checkBreached: 'BreachedCondition',
  checkRentMonth: 'Month',
  checkRentWeek: 'Week',
  checkConventional: 'Conventional',
  checkNoInterpreter: 'NoInterpreterNotNeededCkBox',
} as const

export const COURT_PDF_TEMPLATES = {
  SC_EJECTMENT: '/forms/SCCA732.pdf',
  NC_EJECTMENT: '/forms/NC_eviction.pdf',
} as const
