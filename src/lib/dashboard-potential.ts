import {
  isEligibleEmptyPotentialProperty,
  countsTowardCurrentIncome,
  leaseStatusLabel,
  normalizeLeaseStatus,
  selectNewestLeaseByProperty,
  type LeaseRecencyFields,
} from '@/lib/lease-status'

export interface EmptyPotentialProperty {
  id: string
  name?: string | null
  address?: string | null
  property_type?: string | null
  status?: string | null
  rent_value?: number | string | null
}

export interface EmptyPotentialLease extends LeaseRecencyFields {
  status?: string | null
}

export interface EmptyPotentialRow {
  propertyId: string
  propertyName: string
  address: string
  tenantName: ''
  status: 'empty'
  cadence: 'monthly'
  rent: number
  monthlyPotential: number
}

export interface NeitherOccupiedNorQualifyingRow {
  propertyId: string
  address: string
  currentLeaseStatus: string
  savedRentValue: number | null
  reasonNotQualifying: string
}

export function sumEmptyPotentialRows(rows: readonly EmptyPotentialRow[]): number {
  return rows.reduce((sum, row) => sum + row.monthlyPotential, 0)
}

export function sumPotentialIncomeRows(
  rows: readonly { monthlyPotential: number }[],
): number {
  return rows.reduce((sum, row) => sum + row.monthlyPotential, 0)
}

export function buildEmptyPotentialSummary(
  properties: readonly EmptyPotentialProperty[],
  leases: readonly EmptyPotentialLease[],
): {
  rows: EmptyPotentialRow[]
  count: number
  total: number
} {
  const newestLeaseByProperty = selectNewestLeaseByProperty(leases)
  const rows = properties
    .filter((property) => {
      const currentLease = newestLeaseByProperty.get(property.id)
      return isEligibleEmptyPotentialProperty({
        propertyType: property.property_type,
        propertyStatus: property.status,
        rentValue: property.rent_value,
        hasCurrentLease: currentLease != null,
        currentLeaseStatus: currentLease?.status,
      })
    })
    .map((property): EmptyPotentialRow => {
      const rent = Number(property.rent_value || 0)
      return {
        propertyId: property.id,
        propertyName: property.name || '',
        address: property.address || '',
        tenantName: '',
        status: 'empty',
        cadence: 'monthly',
        rent,
        monthlyPotential: rent,
      }
    })
    .sort(
      (a, b) =>
        b.monthlyPotential - a.monthlyPotential ||
        a.propertyName.localeCompare(b.propertyName) ||
        a.propertyId.localeCompare(b.propertyId),
    )

  return {
    rows,
    count: rows.length,
    total: sumEmptyPotentialRows(rows),
  }
}

/** Explain why an empty/no-lease property fails Potential Income eligibility. */
export function explainEmptyPotentialIneligibility(args: {
  propertyType: string | null | undefined
  propertyStatus: string | null | undefined
  rentValue: number | string | null | undefined
  hasCurrentLease: boolean
  currentLeaseStatus?: string | null
}): string {
  const type = String(args.propertyType || '').toLowerCase()
  if (!['house', 'doublewide', 'singlewide'].includes(type)) {
    return 'Property type is not house, doublewide, or singlewide'
  }

  const propertyStatus = String(args.propertyStatus || '').toLowerCase()
  if (propertyStatus === 'retired') return 'Property status is retired'
  if (propertyStatus === 'sold') return 'Property status is sold'

  if (
    args.hasCurrentLease &&
    normalizeLeaseStatus(args.currentLeaseStatus) !== 'empty'
  ) {
    const label = leaseStatusLabel(args.currentLeaseStatus)
    return `Newest lease status is ${label}, not Empty`
  }

  if (args.rentValue == null || String(args.rentValue).trim() === '') {
    return 'Missing Rent Value'
  }

  const rent = Number(args.rentValue)
  if (!Number.isFinite(rent) || rent <= 0) return 'Missing Rent Value'
  if (rent <= 1) return 'Rent Value of $1 or less'

  return 'Does not meet Potential Income eligibility rules'
}

/**
 * Total Properties minus occupied (newest-lease rules) minus Potential Income
 * property IDs (empty qualifying + eviction). Built from actual records.
 */
export function buildNeitherOccupiedNorQualifyingSummary(
  properties: readonly EmptyPotentialProperty[],
  leases: readonly EmptyPotentialLease[],
  potentialIncomePropertyIds: readonly string[],
): {
  rows: NeitherOccupiedNorQualifyingRow[]
  count: number
} {
  const newestLeaseByProperty = selectNewestLeaseByProperty(leases)
  const qualifyingIds = new Set(
    potentialIncomePropertyIds.filter((id) => Boolean(id)),
  )

  const rows = properties
    .filter((property) => {
      const currentLease = newestLeaseByProperty.get(property.id)
      // Match Has Tenants card: newest lease exactly occupied (not eviction).
      if (currentLease && countsTowardCurrentIncome(currentLease.status)) {
        return false
      }
      if (qualifyingIds.has(property.id)) return false
      return true
    })
    .map((property): NeitherOccupiedNorQualifyingRow => {
      const currentLease = newestLeaseByProperty.get(property.id)
      const hasCurrentLease = currentLease != null
      const rentNum =
        property.rent_value == null || String(property.rent_value).trim() === ''
          ? null
          : Number(property.rent_value)
      const savedRentValue =
        rentNum != null && Number.isFinite(rentNum) ? rentNum : null

      return {
        propertyId: property.id,
        address:
          (property.address || '').trim() ||
          property.name ||
          'Unnamed Property',
        currentLeaseStatus: hasCurrentLease
          ? leaseStatusLabel(currentLease!.status)
          : 'No lease',
        savedRentValue,
        reasonNotQualifying: explainEmptyPotentialIneligibility({
          propertyType: property.property_type,
          propertyStatus: property.status,
          rentValue: property.rent_value,
          hasCurrentLease,
          currentLeaseStatus: currentLease?.status,
        }),
      }
    })
    .sort(
      (a, b) =>
        a.address.localeCompare(b.address, undefined, { sensitivity: 'base' }) ||
        a.propertyId.localeCompare(b.propertyId),
    )

  return {
    rows,
    count: rows.length,
  }
}
