import {
  homeTaxLedger,
  isTaxYearPaid,
  landTaxLedger,
  taxYearsForDate,
  withTaxYearEntry,
} from '@/lib/tax-years'

describe('tax year window', () => {
  it('stays on the prior calendar year until May', () => {
    expect(taxYearsForDate(new Date(2026, 11, 10))).toEqual([2026, 2025, 2024])
    expect(taxYearsForDate(new Date(2027, 0, 2))).toEqual([2026, 2025, 2024])
    expect(taxYearsForDate(new Date(2027, 3, 30))).toEqual([2026, 2025, 2024])
  })

  it('rolls forward on May 1', () => {
    expect(taxYearsForDate(new Date(2027, 4, 1))).toEqual([2027, 2026, 2025])
    expect(taxYearsForDate(new Date(2027, 5, 2))).toEqual([2027, 2026, 2025])
  })
})

describe('tax year paid state', () => {
  it('keeps a partial payment unpaid and marks a covered bill paid', () => {
    expect(isTaxYearPaid({ owed: 700, paid: 200 })).toBe(false)
    expect(isTaxYearPaid({ owed: 700, paid: 700 })).toBe(true)
    expect(isTaxYearPaid({ owed: null, paid: 1426 })).toBe(false)
    expect(isTaxYearPaid({ owed: null, paid: 0 })).toBe(false)
  })
})

describe('legacy tax ledger', () => {
  const asOf = new Date(2026, 10, 9)

  it('puts the current owed and paid on this tax year and prior paid on last year', () => {
    const ledger = landTaxLedger(
      {
        property_tax: 200,
        tax_owed: 1431.64,
        tax_paid_amount_current: 0,
        tax_paid_amount_previous: 1426,
      },
      asOf,
    )
    expect(ledger['2026']).toEqual({ owed: 1431.64, paid: 0 })
    expect(ledger['2025']).toEqual({ owed: null, paid: 1426 })
    expect(ledger['2024']).toBeUndefined()
  })

  it('keeps a saved year ledger instead of the old columns', () => {
    const ledger = landTaxLedger(
      {
        tax_owed: 1,
        tax_by_year: { '2026': { owed: 700, paid: 200 }, '2024': { owed: 400, paid: 400 } },
      },
      asOf,
    )
    expect(ledger['2026']).toEqual({ owed: 700, paid: 200 })
    expect(isTaxYearPaid(ledger['2024'])).toBe(true)
  })

  it('gives a mobile home its own year ledger', () => {
    const ledger = homeTaxLedger(
      {
        property_type: 'singlewide',
        trailer_tax_owed: 400,
        trailer_tax_paid_amount_current: 50,
        trailer_tax_paid_amount_previous: 25,
      },
      asOf,
    )
    expect(ledger['2026']).toEqual({ owed: 400, paid: 50 })
    expect(ledger['2025']).toEqual({ owed: null, paid: 25 })
    expect(homeTaxLedger({ property_type: 'house', trailer_tax_owed: 400 }, asOf)).toEqual({})
  })

  it('drops a year that is cleared back to blank', () => {
    const next = withTaxYearEntry(
      { '2026': { owed: 700, paid: 0 } },
      2026,
      { owed: 0, paid: 0 },
    )
    expect(next['2026']).toBeUndefined()
  })
})
