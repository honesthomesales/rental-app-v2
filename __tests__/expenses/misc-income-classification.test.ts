import {
  MISC_INCOME_RATE,
  ONE_TIME_EXPENSE_RATE,
  applyMiscIncomeDelta,
  classifyExpense,
  isMiscIncome,
  isOneTimeExpense,
  isRecurringExpense,
  sumAmountOwed,
} from "@/lib/expenses/classification";

describe("expense classification (Misc Income)", () => {
  it("classifies interest_rate 9.9999 as misc income", () => {
    expect(isMiscIncome({ interest_rate: 9.9999 })).toBe(true);
    expect(isRecurringExpense({ interest_rate: 9.9999 })).toBe(false);
    expect(classifyExpense({ interest_rate: 9.9999 })).toBe("misc_income");
  });

  it("classifies -9.9999 as one-time expense, not misc", () => {
    expect(isOneTimeExpense({ interest_rate: -9.9999 })).toBe(true);
    expect(isMiscIncome({ interest_rate: -9.9999 })).toBe(false);
  });

  it("treats ordinary rates as recurring expenses", () => {
    expect(isRecurringExpense({ interest_rate: 0 })).toBe(true);
    expect(isRecurringExpense({ interest_rate: 5.25 })).toBe(true);
  });

  it("excludes misc from recurring expense sums", () => {
    const rows = [
      { interest_rate: 0, amount_owed: 200 },
      { interest_rate: MISC_INCOME_RATE, amount_owed: 100 },
      { interest_rate: ONE_TIME_EXPENSE_RATE, amount_owed: 50 },
    ];
    const recurring = rows.filter(isRecurringExpense);
    expect(sumAmountOwed(recurring)).toBe(200);
    const misc = rows.filter(isMiscIncome);
    expect(sumAmountOwed(misc)).toBe(100);
  });

  it("adding $100 misc increases income and profit, not expenses", () => {
    const before = {
      miscIncome: 0,
      totalIncome: 1000,
      profit: 400,
      expenses: 600,
    };
    const after = applyMiscIncomeDelta({ ...before, delta: 100 });
    expect(after.miscIncome).toBe(100);
    expect(after.totalIncome).toBe(1100);
    expect(after.profit).toBe(500);
    expect(after.expenses).toBe(600);
  });

  it("editing $100 to $150 changes totals by only $50", () => {
    const afterCreate = applyMiscIncomeDelta({
      miscIncome: 0,
      totalIncome: 1000,
      profit: 400,
      expenses: 600,
      delta: 100,
    });
    const afterEdit = applyMiscIncomeDelta({
      ...afterCreate,
      delta: 50,
    });
    expect(afterEdit.miscIncome).toBe(150);
    expect(afterEdit.totalIncome).toBe(1150);
    expect(afterEdit.profit).toBe(550);
    expect(afterEdit.expenses).toBe(600);
  });

  it("exports sentinel constants for producers", () => {
    expect(MISC_INCOME_RATE).toBe(9.9999);
    expect(ONE_TIME_EXPENSE_RATE).toBe(-9.9999);
  });
});
