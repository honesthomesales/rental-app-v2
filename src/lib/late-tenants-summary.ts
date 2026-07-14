/**
 * Pure Late Tenants display helpers.
 * Row totals must never use a running portfolio sum.
 */

export type LateTenantRowTotals = {
  accountTotalOwed: number
  totalOwedLate: number
}

export function buildLateTenantRowTotals(accountOwed: number): LateTenantRowTotals {
  const owed = Number(accountOwed) || 0
  return {
    accountTotalOwed: owed,
    totalOwedLate: owed,
  }
}

export type LateTenantSummary = {
  lateLeases: number
  totalLateOwed: number
  totalAllOwed: number
  thirtyPlusLate: number
  avgDaysLate: number
}

export function buildLateTenantsSummary(
  rows: Array<{ accountTotalOwed?: number; totalOwedLate?: number; daysLate?: number }>,
): LateTenantSummary {
  const lateLeases = rows.length
  const portfolio = rows.reduce(
    (sum, row) => sum + Number(row.accountTotalOwed ?? row.totalOwedLate ?? 0),
    0,
  )
  const thirtyPlusLate = rows.filter((r) => (r.daysLate || 0) >= 30).length
  const avgDaysLate =
    lateLeases === 0
      ? 0
      : Math.round(
          rows.reduce((sum, r) => sum + (r.daysLate || 0), 0) / lateLeases,
        )

  // totalLateOwed === totalAllOwed: both are the sum of per-account unpaid
  // OPEN balances for late leases only (no separate "all owed" scope).
  return {
    lateLeases,
    totalLateOwed: portfolio,
    totalAllOwed: portfolio,
    thirtyPlusLate,
    avgDaysLate,
  }
}
