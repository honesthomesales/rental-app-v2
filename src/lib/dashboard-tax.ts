/**
 * Dashboard Property Tax helpers shared by the tax table and profit card.
 * property_tax is stored as a monthly figure; annual due = monthly × 12.
 */

export type DashboardTaxProperty = {
  id?: string
  property_tax?: number | string | null
  tax_owed?: number | string | null
  tax_paid_amount_current?: number | string | null
  tax_paid_amount_previous?: number | string | null
  tax_color_state?: number | null
}

/** DB sometimes stores -1 as a sentinel for tax paid fields; treat as $0. */
export function effectiveTaxPaid(value: unknown): number {
  const n = parseFloat(String(value ?? ''))
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

/**
 * Color states that zero the displayed Monthly Tax (Owed/12) column:
 * 1 yellow, 2 light green, 6 light red.
 */
export function isMonthlyTaxWaivedByColorState(
  colorState: number | null | undefined,
): boolean {
  return colorState === 1 || colorState === 2 || colorState === 6
}

export function annualTaxDue(propertyTaxMonthly: unknown): number {
  const monthly = parseFloat(String(propertyTaxMonthly ?? ''))
  if (!Number.isFinite(monthly) || monthly <= 0) return 0
  return monthly * 12
}

/** Remaining tax owed (manual tax_owed override, else annual − paid). */
export function taxesOwedForProperty(property: DashboardTaxProperty): number {
  if (property.tax_owed !== null && property.tax_owed !== undefined) {
    const manual = parseFloat(String(property.tax_owed))
    if (Number.isFinite(manual)) return manual
  }
  const totalPaid =
    effectiveTaxPaid(property.tax_paid_amount_current) +
    effectiveTaxPaid(property.tax_paid_amount_previous)
  return Math.max(0, annualTaxDue(property.property_tax) - totalPaid)
}

/**
 * Same value shown in the dashboard tax section "Monthly Tax (Owed/12)" column.
 */
export function monthlyTaxPaymentForProperty(
  property: DashboardTaxProperty,
  colorState?: number | null,
): number {
  const state =
    colorState !== undefined && colorState !== null
      ? colorState
      : property.tax_color_state ?? 0
  if (isMonthlyTaxWaivedByColorState(state)) return 0
  return taxesOwedForProperty(property) / 12
}

export function sumMonthlyTaxPayments(
  properties: readonly DashboardTaxProperty[],
): number {
  return properties.reduce(
    (sum, property) => sum + monthlyTaxPaymentForProperty(property),
    0,
  )
}
