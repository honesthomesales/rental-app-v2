/**
 * Dashboard Property Tax helpers shared by the tax table and profit card.
 * property_tax is stored as a monthly figure; annual due = monthly × 12.
 */

export type DashboardTaxProperty = {
  id?: string
  property_type?: string | null
  property_tax?: number | string | null
  tax_owed?: number | string | null
  tax_paid_amount_current?: number | string | null
  tax_paid_amount_previous?: number | string | null
  trailer_property_tax?: number | string | null
  trailer_tax_owed?: number | string | null
  trailer_tax_paid_amount_current?: number | string | null
  trailer_tax_paid_amount_previous?: number | string | null
  tax_color_state?: number | null
}

/** Decimal columns written from the tax table, including the mobile-home bill. */
export const TAX_DECIMAL_FIELD_NAMES = [
  'tax_paid_amount_current',
  'tax_paid_amount_previous',
  'tax_owed',
  'property_tax',
  'trailer_property_tax',
  'trailer_tax_paid_amount_current',
  'trailer_tax_paid_amount_previous',
  'trailer_tax_owed',
] as const

export function isTaxDecimalField(key: string): boolean {
  return (TAX_DECIMAL_FIELD_NAMES as readonly string[]).includes(key)
}

/** Double wide and single wide have a separate home tax bill and tax ID. */
export function isMobileHomeType(propertyType: string | null | undefined): boolean {
  return propertyType === 'doublewide' || propertyType === 'singlewide'
}

/** DB sometimes stores -1 as a sentinel for tax paid fields; treat as $0. */
export function effectiveTaxPaid(value: unknown): number {
  const n = parseFloat(String(value ?? ''))
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

/** 0 none, 1 yellow customer, 3 lime HHS, 7 dark green bank. */
export function normalizeTaxColorState(colorState: number | null | undefined): number {
  const state = Number(colorState ?? 0)
  if (state === 0 || state === 1 || state === 7) return state
  return 3
}

/** Yellow customer and dark green bank contribute $0 monthly tax. */
export function isMonthlyTaxWaivedByColorState(
  colorState: number | null | undefined,
): boolean {
  const state = normalizeTaxColorState(colorState)
  return state === 1 || state === 7
}

export function annualTaxDue(propertyTaxMonthly: unknown): number {
  const monthly = parseFloat(String(propertyTaxMonthly ?? ''))
  if (!Number.isFinite(monthly) || monthly <= 0) return 0
  return monthly * 12
}

function manualOwed(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const manual = parseFloat(String(value))
  if (!Number.isFinite(manual)) return null
  return manual
}

function owedForStream(
  monthlyRate: unknown,
  owedOverride: unknown,
  paidCurrent: unknown,
  paidPrevious: unknown,
): number {
  const manual = manualOwed(owedOverride)
  if (manual !== null) return manual
  const totalPaid = effectiveTaxPaid(paidCurrent) + effectiveTaxPaid(paidPrevious)
  return Math.max(0, annualTaxDue(monthlyRate) - totalPaid)
}

/** Land remaining (manual tax_owed override, else annual − current paid − prior paid). */
export function taxesOwedForProperty(property: DashboardTaxProperty): number {
  return owedForStream(
    property.property_tax,
    property.tax_owed,
    property.tax_paid_amount_current,
    property.tax_paid_amount_previous,
  )
}

/** Mobile-home bill remaining. Zero unless the property is a double wide or single wide. */
export function trailerTaxesOwedForProperty(property: DashboardTaxProperty): number {
  if (!isMobileHomeType(property.property_type)) return 0
  return owedForStream(
    property.trailer_property_tax,
    property.trailer_tax_owed,
    property.trailer_tax_paid_amount_current,
    property.trailer_tax_paid_amount_previous,
  )
}

/** Land remaining plus the home bill on a mobile home. */
export function totalTaxesOwedForProperty(property: DashboardTaxProperty): number {
  return taxesOwedForProperty(property) + trailerTaxesOwedForProperty(property)
}

/** This-year payments, plus the home payment on a mobile home. */
export function currentYearPaidForProperty(property: DashboardTaxProperty): number {
  const land = effectiveTaxPaid(property.tax_paid_amount_current)
  if (!isMobileHomeType(property.property_type)) return land
  return land + effectiveTaxPaid(property.trailer_tax_paid_amount_current)
}

/**
 * Kept for older callers. Profit totals use the dashboard Monthly Taxes column.
 */
export function storedMonthlyTaxRate(property: DashboardTaxProperty): number {
  const land = Number(property.property_tax) || 0
  if (!isMobileHomeType(property.property_type)) return land
  return land + (Number(property.trailer_property_tax) || 0)
}
