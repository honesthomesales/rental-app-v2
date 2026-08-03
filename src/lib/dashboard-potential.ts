import {
  isEligibleEmptyPotentialProperty,
  selectNewestLeaseByProperty,
  type LeaseRecencyFields,
} from '@/lib/lease-status'

export interface EmptyPotentialProperty {
  id: string
  name?: string | null
  address?: string | null
  property_type?: string | null
  status?: string | null
  rent_value?: number | null
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
