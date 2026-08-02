/**
 * Single source of truth for RENT_expenses row classification.
 *
 * Production stores Misc Income and one-time expenses in RENT_expenses using
 * interest_rate sentinels (DECIMAL(5,4) limits). Do not invent a second rule.
 */

export const ONE_TIME_EXPENSE_RATE = -9.9999;
export const MISC_INCOME_RATE = 9.9999;

/** Tolerance for DECIMAL(5,4) / float comparisons. */
const RATE_EPS = 0.00005;

export type ExpenseClassification = "misc_income" | "one_time_expense" | "recurring_expense";

export type ExpenseLike = {
  interest_rate?: number | string | null;
  category?: string | null;
};

function rateOf(row: ExpenseLike): number | null {
  if (row.interest_rate == null || row.interest_rate === "") return null;
  const n = Number(row.interest_rate);
  return Number.isFinite(n) ? n : null;
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < RATE_EPS;
}

/**
 * Misc Income: interest_rate sentinel 9.9999.
 * Category string alone is not authoritative (legacy edits may drift),
 * but is accepted as a fallback when rate is missing and category matches.
 */
export function isMiscIncome(row: ExpenseLike): boolean {
  const rate = rateOf(row);
  if (rate != null && near(rate, MISC_INCOME_RATE)) return true;
  if (rate == null) {
    const cat = String(row.category || "")
      .trim()
      .toLowerCase();
    return cat === "misc income";
  }
  return false;
}

export function isOneTimeExpense(row: ExpenseLike): boolean {
  if (isMiscIncome(row)) return false;
  const rate = rateOf(row);
  if (rate != null && near(rate, ONE_TIME_EXPENSE_RATE)) return true;
  if (rate == null) {
    const cat = String(row.category || "")
      .trim()
      .toLowerCase();
    return cat === "one-time expense" || cat === "one time expense";
  }
  return false;
}

/** Recurring / fixed expense rows that affect debt totals. */
export function isRecurringExpense(row: ExpenseLike): boolean {
  return !isMiscIncome(row) && !isOneTimeExpense(row);
}

export function classifyExpense(row: ExpenseLike): ExpenseClassification {
  if (isMiscIncome(row)) return "misc_income";
  if (isOneTimeExpense(row)) return "one_time_expense";
  return "recurring_expense";
}

export function sumAmountOwed(
  rows: Array<ExpenseLike & { amount_owed?: number | string | null; amount?: number | string | null }>,
  preferOwed = true,
): number {
  return rows.reduce((sum, row) => {
    const owed = Number(row.amount_owed);
    const amt = Number(row.amount);
    const value = preferOwed
      ? Number.isFinite(owed)
        ? owed
        : Number.isFinite(amt)
          ? amt
          : 0
      : Number.isFinite(amt)
        ? amt
        : Number.isFinite(owed)
          ? owed
          : 0;
    return sum + value;
  }, 0);
}

/** Pure helper for tests: apply $delta Misc Income to income/profit/expense totals. */
export function applyMiscIncomeDelta(args: {
  miscIncome: number;
  totalIncome: number;
  profit: number;
  expenses: number;
  delta: number;
}) {
  return {
    miscIncome: Math.round((args.miscIncome + args.delta) * 100) / 100,
    totalIncome: Math.round((args.totalIncome + args.delta) * 100) / 100,
    profit: Math.round((args.profit + args.delta) * 100) / 100,
    expenses: Math.round(args.expenses * 100) / 100,
  };
}
