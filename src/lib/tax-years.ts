/**
 * Property tax bills stored by calendar year.
 * The visible window is the current tax year plus the two years before it.
 * The current tax year rolls forward on May 1, not on January 1.
 */

import {
  effectiveTaxPaid,
  isMonthlyTaxWaivedByColorState,
  isMobileHomeType,
  normalizeTaxColorState,
  taxesOwedForProperty,
  trailerTaxesOwedForProperty,
  type DashboardTaxProperty,
} from '@/lib/dashboard-tax'

export type TaxYearEntry = {
  /** Bill for that year. Null means it has not been entered. */
  owed: number | null
  paid: number
}

export type TaxYearLedger = Record<string, TaxYearEntry>

export type TaxYearProperty = DashboardTaxProperty & {
  tax_by_year?: unknown
  trailer_tax_by_year?: unknown
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

/** Current tax year, last year, and two years ago. May 1 starts the new year. */
export function taxYearsForDate(date: Date): [number, number, number] {
  const current = date.getMonth() >= 4 ? date.getFullYear() : date.getFullYear() - 1
  return [current, current - 1, current - 2]
}

export function parseTaxYearLedger(raw: unknown): TaxYearLedger | null {
  if (raw == null || raw === '') return null
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return null

  const ledger: TaxYearLedger = {}
  for (const [key, row] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{4}$/.test(key) || row == null || typeof row !== 'object') continue
    const record = row as { owed?: unknown; paid?: unknown }
    let owed: number | null = null
    if (record.owed !== null && record.owed !== undefined && record.owed !== '') {
      const parsed = Number(record.owed)
      if (Number.isFinite(parsed)) owed = roundMoney(parsed)
    }
    const paidRaw = Number(record.paid ?? 0)
    const paid = Number.isFinite(paidRaw) && paidRaw > 0 ? roundMoney(paidRaw) : 0
    if (owed == null && paid <= 0) continue
    ledger[key] = { owed, paid }
  }
  return ledger
}

/** Persist a cleaned ledger. Null clears the column. */
export function sanitizeTaxYearLedger(raw: unknown): TaxYearLedger | null {
  return parseTaxYearLedger(raw)
}

export function isTaxYearBlank(entry: TaxYearEntry | undefined): boolean {
  if (!entry) return true
  return (entry.owed == null || entry.owed === 0) && entry.paid <= 0
}

/** Fully paid when a bill greater than zero is covered by the amount paid. */
export function isTaxYearPaid(entry: TaxYearEntry | undefined): boolean {
  if (!entry || entry.owed == null || entry.owed <= 0) return false
  return entry.paid + 0.001 >= entry.owed
}

function legacyLedger(
  asOf: Date,
  displayedOwed: number,
  paidCurrent: number,
  paidPrevious: number,
): TaxYearLedger {
  const [current, prior] = taxYearsForDate(asOf)
  const ledger: TaxYearLedger = {}
  if (displayedOwed > 0 || paidCurrent > 0) {
    ledger[String(current)] = {
      owed: displayedOwed > 0 ? roundMoney(displayedOwed) : null,
      paid: roundMoney(paidCurrent),
    }
  }
  if (paidPrevious > 0) {
    ledger[String(prior)] = { owed: null, paid: roundMoney(paidPrevious) }
  }
  return ledger
}

export function landTaxLedger(property: TaxYearProperty, asOf: Date): TaxYearLedger {
  const stored = parseTaxYearLedger(property.tax_by_year)
  if (stored) return stored
  return legacyLedger(
    asOf,
    taxesOwedForProperty(property),
    effectiveTaxPaid(property.tax_paid_amount_current),
    effectiveTaxPaid(property.tax_paid_amount_previous),
  )
}

export function homeTaxLedger(property: TaxYearProperty, asOf: Date): TaxYearLedger {
  if (!isMobileHomeType(property.property_type)) return {}
  const stored = parseTaxYearLedger(property.trailer_tax_by_year)
  if (stored) return stored
  return legacyLedger(
    asOf,
    trailerTaxesOwedForProperty(property),
    effectiveTaxPaid(property.trailer_tax_paid_amount_current),
    effectiveTaxPaid(property.trailer_tax_paid_amount_previous),
  )
}

function yearOwedAmount(entry: TaxYearEntry | undefined): number {
  if (!entry || entry.owed == null || !Number.isFinite(entry.owed) || entry.owed <= 0) return 0
  return entry.owed
}

/** Current tax year land bill plus home bill, divided by 12. Blank years count as 0. */
export function currentYearMonthlyTax(
  property: TaxYearProperty,
  asOf: Date,
  colorState?: number | null,
): number {
  const state = normalizeTaxColorState(
    colorState !== undefined && colorState !== null ? colorState : property.tax_color_state,
  )
  if (isMonthlyTaxWaivedByColorState(state)) return 0
  const [current] = taxYearsForDate(asOf)
  const key = String(current)
  const land = yearOwedAmount(landTaxLedger(property, asOf)[key])
  const home = yearOwedAmount(homeTaxLedger(property, asOf)[key])
  return (land + home) / 12
}

/** Same figure as the dashboard Monthly Taxes column. */
export function monthlyTaxPaymentForProperty(
  property: TaxYearProperty,
  colorState?: number | null,
  asOf: Date = new Date(),
): number {
  return currentYearMonthlyTax(property, asOf, colorState)
}

export function sumMonthlyTaxPayments(
  properties: readonly TaxYearProperty[],
  asOf: Date = new Date(),
): number {
  return properties.reduce(
    (sum, property) => sum + monthlyTaxPaymentForProperty(property, undefined, asOf),
    0,
  )
}

export function withTaxYearEntry(
  ledger: TaxYearLedger,
  year: number,
  entry: TaxYearEntry,
): TaxYearLedger {
  const next: TaxYearLedger = { ...ledger }
  const key = String(year)
  const owed = entry.owed != null && Number.isFinite(entry.owed) ? roundMoney(entry.owed) : null
  const paid = Number.isFinite(entry.paid) && entry.paid > 0 ? roundMoney(entry.paid) : 0
  if ((owed == null || owed === 0) && paid <= 0) {
    delete next[key]
    return next
  }
  next[key] = { owed: owed === 0 ? null : owed, paid }
  return next
}
