import { describe, expect, it } from "vitest";
import { buildBalanceSheet, buildIncomeStatement } from "./reports";

function account(code: string, type: string, debit: number, credit: number) {
  return {
    accountId: code, code, name: code, type, debit, credit,
    balance: type === "asset" || type === "expense" ? debit - credit : credit - debit,
  };
}

describe("Bookie Old historical 2025 statement classification", () => {
  const accounts = [
    account("0400001", "asset", 11171.16, 0),
    account("1200000", "asset", 21012.90, 0),
    account("2200000", "liability", 0, 22483.96),
    account("7546000", "expense", 55, 0),
    account("4100000", "expense", 14841.10, 0),
    account("7600000", "revenue", 0, 17703.75),
    account("8150000", "equity", 2807.65, 0),
    account("9300000", "equity", 0, 9700.10),
  ];

  it("uses the posted historical account types, not the first digit of a mapped code", () => {
    const income = buildIncomeStatement(accounts, true);
    expect(income.revenue.total).toBe("17703.75");
    expect(income.expenses.total).toBe("14896.10");
    expect(income.netResult).toBe("2807.65");
    expect(income.expenses.sections.flatMap((s) => s.items).map((a) => a.accountCode))
      .toContain("7546000");

    const statement = buildBalanceSheet(accounts, true, Number(income.netResult));
    expect(statement.aktiva.total).toBe("32184.06");
    expect(statement.pasiva.total).toBe("32184.06");
    expect(statement.pasiva.sections.flatMap((s) => s.items).map((a) => a.accountCode))
      .toContain("2200000");
    expect(statement.aktiva.sections.flatMap((s) => s.items).map((a) => a.accountCode))
      .not.toContain("2200000");
  });

  it("never hides an unbalanced historical year as an invented profit", () => {
    expect(() => buildBalanceSheet(accounts, true, 2807.63)).toThrow(
      "Zgodovinska bilanca se ne ujema",
    );
  });
});