import {
  buildEmptyPotentialSummary,
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
