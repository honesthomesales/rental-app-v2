/**
 * Pure Late Tenants display helpers.
 * Row totals must never use a running portfolio sum.
 */

export type LateTenantRowTotals = {
  /** Full current unpaid balance (includes within-grace invoices). */
  accountTotalOwed: number;
  /** Past-due balance only (due_date + 6 or later). */
  totalOwedLate: number;
};

export function buildLateTenantRowTotals(
  accountOwed: number,
  pastDueOwed: number = accountOwed,
): LateTenantRowTotals {
  return {
    accountTotalOwed: Number(accountOwed) || 0,
    totalOwedLate: Number(pastDueOwed) || 0,
  };
}

export type LateTenantSummary = {
  lateLeases: number;
  totalLateOwed: number;
  totalAllOwed: number;
  thirtyPlusLate: number;
  avgDaysLate: number;
};

export function buildLateTenantsSummary(
  rows: Array<{
    accountTotalOwed?: number;
    totalOwedLate?: number;
    daysLate?: number;
  }>,
): LateTenantSummary {
  const lateLeases = rows.length;
  const totalLateOwed = rows.reduce(
    (sum, row) => sum + Number(row.totalOwedLate ?? 0),
    0,
  );
  const totalAllOwed = rows.reduce(
    (sum, row) =>
      sum + Number(row.accountTotalOwed ?? row.totalOwedLate ?? 0),
    0,
  );
  const thirtyPlusLate = rows.filter((r) => (r.daysLate || 0) >= 30).length;
  const avgDaysLate =
    lateLeases === 0
      ? 0
      : Math.round(
          rows.reduce((sum, r) => sum + (r.daysLate || 0), 0) / lateLeases,
        );

  return {
    lateLeases,
    totalLateOwed,
    totalAllOwed,
    thirtyPlusLate,
    avgDaysLate,
  };
}
