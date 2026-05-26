export type CourtPdfTextCoord = {
  page: number
  x: number
  y: number
  size: number
  maxWidth?: number
  lineHeight?: number
}

export type CourtPdfCheckboxCoord = CourtPdfTextCoord

/**
 * Coordinates are in PDF points from the bottom-left corner.
 * They were seeded from the official template AcroForm widget rectangles,
 * then nudged for direct page.drawText() overlays.
 */
export const SCCA732_COORDS = {
  county: { page: 0, x: 136, y: 636, size: 10 },
  plaintiff: { page: 0, x: 140, y: 565, size: 10 },
  defendant: { page: 0, x: 156, y: 484, size: 10 },
  plaintiffAddress: { page: 0, x: 145, y: 366, size: 9 },
  cityStateZip: { page: 0, x: 145, y: 319, size: 9 },
  phone: { page: 0, x: 145, y: 278, size: 9 },
  email: { page: 0, x: 145, y: 235, size: 9 },
  plaintiffName: { page: 0, x: 181, y: 171, size: 9 },
  propertyAddress: { page: 0, x: 113, y: 131, size: 9, maxWidth: 205 },
  tenantNames: { page: 1, x: 272, y: 687, size: 9, maxWidth: 145 },
  leaseCheckbox: { page: 1, x: 110, y: 650, size: 12 },
  nonpaymentCheckbox: { page: 1, x: 110, y: 588, size: 12 },
  amountOwed: { page: 1, x: 276, y: 567, size: 9 },
  expiredTenancyCheckbox: { page: 1, x: 110, y: 542, size: 12 },
  violationCheckbox: { page: 1, x: 110, y: 520, size: 12 },
  violationDescription: {
    page: 1,
    x: 110,
    y: 487,
    size: 9,
    maxWidth: 420,
    lineHeight: 11,
  },
  swornDay: { page: 1, x: 345, y: 273, size: 9 },
  swornMonth: { page: 1, x: 103, y: 253, size: 9 },
  swornYear: { page: 1, x: 252, y: 253, size: 9 },
  plaintiffSignatureName: { page: 1, x: 80, y: 326, size: 9, maxWidth: 270 },
} as const satisfies Record<string, CourtPdfTextCoord>

export const NC_EVICTION_COORDS = {
  county: { page: 0, x: 280, y: 544, size: 10 },
  plaintiffName: { page: 0, x: 40, y: 376, size: 8 },
  plaintiffStreet: { page: 0, x: 40, y: 363, size: 8 },
  plaintiffMail: { page: 0, x: 40, y: 350, size: 8 },
  plaintiffCity: { page: 0, x: 40, y: 337, size: 8 },
  plaintiffState: { page: 0, x: 171, y: 337, size: 8 },
  plaintiffZip: { page: 0, x: 199, y: 337, size: 8 },
  plaintiffPhone: { page: 0, x: 160, y: 314, size: 8 },
  defendantIndividual: { page: 0, x: 168, y: 283, size: 12 },
  defendantName: { page: 0, x: 40, y: 278, size: 8 },
  defendantStreet: { page: 0, x: 40, y: 265, size: 8 },
  defendantMail: { page: 0, x: 40, y: 252, size: 8 },
  defendantCity: { page: 0, x: 40, y: 240, size: 8 },
  defendantState: { page: 0, x: 171, y: 240, size: 8 },
  defendantZip: { page: 0, x: 199, y: 240, size: 8 },
  premisesAddress: { page: 0, x: 274, y: 460, size: 8, maxWidth: 425, lineHeight: 10 },
  conventionalCheckbox: { page: 0, x: 711, y: 462, size: 12 },
  rentRate: { page: 0, x: 280, y: 404, size: 8 },
  rentMonthCheckbox: { page: 0, x: 380, y: 412, size: 12 },
  rentWeekCheckbox: { page: 0, x: 380, y: 401, size: 12 },
  rentDueDate: { page: 0, x: 419, y: 404, size: 8 },
  leaseEndDate: { page: 0, x: 565, y: 404, size: 8 },
  oralLeaseCheckbox: { page: 0, x: 711, y: 401, size: 12 },
  writtenLeaseCheckbox: { page: 0, x: 742, y: 401, size: 12 },
  failedPayRentCheckbox: { page: 0, x: 287, y: 385, size: 12 },
  leaseEndedCheckbox: { page: 0, x: 287, y: 357, size: 12 },
  breachedCheckbox: { page: 0, x: 287, y: 340, size: 12 },
  breachDescription: { page: 0, x: 274, y: 298, size: 8, maxWidth: 495, lineHeight: 10 },
  rentPastDue: { page: 0, x: 450, y: 153, size: 8 },
  totalAmountDue: { page: 0, x: 629, y: 153, size: 8 },
  signDate: { page: 0, x: 274, y: 101, size: 8 },
  plaintiffSignatureName: { page: 0, x: 369, y: 101, size: 8, maxWidth: 195 },
  agentName: { page: 0, x: 369, y: 48, size: 8, maxWidth: 195 },
  noInterpreterCheckbox: { page: 0, x: 357, y: 514, size: 12 },
} as const satisfies Record<string, CourtPdfTextCoord>
