import {
  buildEmptyPotentialSummary,
  buildNeitherOccupiedNorQualifyingSummary,
  explainEmptyPotentialIneligibility,
  sumEmptyPotentialRows,
  sumPotentialIncomeRows,
  type EmptyPotentialLease,
  type EmptyPotentialProperty,
} from '@/lib/dashboard-potential'
import { selectNewestLeaseByProperty } from '@/lib/lease-status'

describe('Dashboard empty potential income', () => {
  const properties: EmptyPotentialProperty[] = [
    { id: 'no-lease', name: 'No Lease', property_type: 'house', status: 'active', rent_value: 1000 },
    { id: 'newest-empty', name: 'Newest Empty', property_type: 'doublewide', status: 'active', rent_value: 1200 },
    { id: 'newest-occupied', property_type: 'singlewide', status: 'active', rent_value: 1300 },
    { id: 'newest-eviction', property_type: 'house', status: 'active', rent_value: 1400 },
    { id: 'retired', property_type: 'house', status: 'retired', rent_value: 1500 },
    { id: 'sold-property', property_type: 'house', status: 'sold', rent_value: 1600 },
    { id: 'nonresidential', property_type: 'other', status: 'active', rent_value: 1700 },
    { id: 'newest-sold', property_type: 'house', status: 'active', rent_value: 1800 },
    { id: 'rent-one', property_type: 'house', status: 'active', rent_value: 1 },
    { id: 'missing-lease-status', property_type: 'house', status: 'active', rent_value: 1900 },
  ]

  const leases: EmptyPotentialLease[] = [
    { id: 'old-occupied', property_id: 'newest-empty', status: 'occupied', created_at: '2026-01-01', lease_start_date: '2026-01-01' },
    { id: 'new-empty', property_id: 'newest-empty', status: 'empty', created_at: '2026-02-01', lease_start_date: '2026-02-01' },
    { id: 'old-empty', property_id: 'newest-occupied', status: 'empty', created_at: '2026-01-01', lease_start_date: '2026-01-01' },
    { id: 'new-occupied', property_id: 'newest-occupied', status: 'occupied', created_at: '2026-02-01', lease_start_date: '2026-02-01' },
    { id: 'new-eviction', property_id: 'newest-eviction', status: 'eviction', created_at: '2026-02-01', lease_start_date: '2026-02-01' },
    { id: 'new-sold', property_id: 'newest-sold', status: 'sold', created_at: '2026-02-01', lease_start_date: '2026-02-01' },
    { id: 'missing-status', property_id: 'missing-lease-status', status: null, created_at: '2026-02-01', lease_start_date: '2026-02-01' },
  ]

  it('includes no-lease and newest-empty properties, including older occupied history', () => {
    const summary = buildEmptyPotentialSummary(properties, leases)

    expect(summary.rows.map((row) => row.propertyId)).toEqual([
      'newest-empty',
      'no-lease',
    ])
    expect(summary.count).toBe(2)
    expect(summary.total).toBe(2200)
  })

  it('excludes newest occupied/eviction/sold, retired/sold properties, nonresidential, and rent_value <= 1', () => {
    const summary = buildEmptyPotentialSummary(properties, leases)
    const ids = new Set(summary.rows.map((row) => row.propertyId))

    for (const id of [
      'newest-occupied',
      'newest-eviction',
      'retired',
      'sold-property',
      'nonresidential',
      'newest-sold',
      'rent-one',
      'missing-lease-status',
    ]) {
      expect(ids.has(id)).toBe(false)
    }
  })

  it('derives the API total and count from the exact displayed rows', () => {
    const summary = buildEmptyPotentialSummary(properties, leases)

    expect(summary.total).toBe(sumEmptyPotentialRows(summary.rows))
    expect(summary.count).toBe(summary.rows.length)
  })

  it('derives combined empty and eviction potential from the exact displayed rows', () => {
    const empty = buildEmptyPotentialSummary(properties, leases)
    const displayedRows = [
      ...empty.rows,
      { monthlyPotential: 900 },
      { monthlyPotential: 1200 },
    ]

    expect(sumPotentialIncomeRows(displayedRows)).toBe(4300)
  })

  it('breaks newest-lease ties by lease_start_date and then id', () => {
    const newest = selectNewestLeaseByProperty<EmptyPotentialLease>([
      { id: 'start-old', property_id: 'start-tie', status: 'occupied', created_at: '2026-03-01', lease_start_date: '2026-03-01' },
      { id: 'start-new', property_id: 'start-tie', status: 'empty', created_at: '2026-03-01', lease_start_date: '2026-04-01' },
      { id: 'lease-a', property_id: 'id-tie', status: 'occupied', created_at: '2026-05-01', lease_start_date: '2026-05-01' },
      { id: 'lease-z', property_id: 'id-tie', status: 'empty', created_at: '2026-05-01', lease_start_date: '2026-05-01' },
    ])

    expect(newest.get('start-tie')?.id).toBe('start-new')
    expect(newest.get('id-tie')?.id).toBe('lease-z')
  })
})

describe('Properties neither occupied nor qualifying', () => {
  const totalProperties: EmptyPotentialProperty[] = [
    {
      id: 'occ-a',
      name: 'Occupied A',
      address: '100 Occupied St',
      property_type: 'house',
      status: 'active',
      rent_value: 900,
    },
    {
      id: 'empty-ok',
      name: 'Empty OK',
      address: '200 Empty Ave',
      property_type: 'house',
      status: 'active',
      rent_value: 1100,
    },
    {
      id: 'evict-b',
      name: 'Eviction B',
      address: '300 Evict Rd',
      property_type: 'doublewide',
      status: 'active',
      rent_value: 800,
    },
    {
      id: 'no-rent',
      name: 'No Rent Name',
      address: '',
      property_type: 'singlewide',
      status: 'active',
      rent_value: null,
    },
    {
      id: 'rent-one',
      name: 'Dollar One',
      address: '50 Low Rent Ln',
      property_type: 'house',
      status: 'active',
      rent_value: 1,
    },
    {
      id: 'empty-zero',
      name: 'Zero Rent',
      address: '10 Zero Ct',
      property_type: 'house',
      status: 'active',
      rent_value: 0,
    },
  ]

  const leases: EmptyPotentialLease[] = [
    {
      id: 'l-occ',
      property_id: 'occ-a',
      status: 'occupied',
      created_at: '2026-02-01',
      lease_start_date: '2026-02-01',
    },
    {
      id: 'l-empty',
      property_id: 'empty-ok',
      status: 'empty',
      created_at: '2026-02-01',
      lease_start_date: '2026-02-01',
    },
    {
      id: 'l-evict',
      property_id: 'evict-b',
      status: 'eviction',
      created_at: '2026-02-01',
      lease_start_date: '2026-02-01',
    },
    {
      id: 'l-zero',
      property_id: 'empty-zero',
      status: 'empty',
      created_at: '2026-02-01',
      lease_start_date: '2026-02-01',
    },
  ]

  it('lists only Total Properties that are neither occupied nor in Potential Income', () => {
    const empty = buildEmptyPotentialSummary(totalProperties, leases)
    const potentialPropertyIds = [
      ...empty.rows.map((r) => r.propertyId),
      'evict-b',
    ]

    const summary = buildNeitherOccupiedNorQualifyingSummary(
      totalProperties,
      leases,
      potentialPropertyIds,
    )

    expect(summary.rows.map((r) => r.propertyId)).toEqual([
      'empty-zero',
      'rent-one',
      'no-rent',
    ])
    expect(summary.count).toBe(3)

    for (const row of summary.rows) {
      expect(totalProperties.some((p) => p.id === row.propertyId)).toBe(true)
      expect(potentialPropertyIds).not.toContain(row.propertyId)
    }
  })

  it('uses property name when address is missing and explains failed conditions', () => {
    const empty = buildEmptyPotentialSummary(totalProperties, leases)
    const summary = buildNeitherOccupiedNorQualifyingSummary(
      totalProperties,
      leases,
      [...empty.rows.map((r) => r.propertyId), 'evict-b'],
    )

    const noRent = summary.rows.find((r) => r.propertyId === 'no-rent')
    expect(noRent?.address).toBe('No Rent Name')
    expect(noRent?.currentLeaseStatus).toBe('No lease')
    expect(noRent?.reasonNotQualifying).toBe('Missing Rent Value')

    const rentOne = summary.rows.find((r) => r.propertyId === 'rent-one')
    expect(rentOne?.reasonNotQualifying).toBe('Rent Value of $1 or less')
    expect(rentOne?.savedRentValue).toBe(1)

    const zero = summary.rows.find((r) => r.propertyId === 'empty-zero')
    expect(zero?.currentLeaseStatus).toBe('Empty')
    expect(zero?.reasonNotQualifying).toBe('Missing Rent Value')
  })

  it('explainEmptyPotentialIneligibility reports the first failing rule', () => {
    expect(
      explainEmptyPotentialIneligibility({
        propertyType: 'house',
        propertyStatus: 'active',
        rentValue: null,
        hasCurrentLease: false,
      }),
    ).toBe('Missing Rent Value')

    expect(
      explainEmptyPotentialIneligibility({
        propertyType: 'house',
        propertyStatus: 'active',
        rentValue: 1,
        hasCurrentLease: true,
        currentLeaseStatus: 'empty',
      }),
    ).toBe('Rent Value of $1 or less')
  })
})
