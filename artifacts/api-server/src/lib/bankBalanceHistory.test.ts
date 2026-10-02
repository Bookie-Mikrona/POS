import { describe, expect, it } from "vitest";
import { buildBankBalanceHistory } from "./bankBalanceHistory";

describe("buildBankBalanceHistory", () => {
  it("carries earlier evidence forward and sums only complete 110x account sets", () => {
    const result = buildBankBalanceHistory(["a", "b"], [
      { bankAccountId: "a", evidenceDate: "2026-08-31", balance: "100.00" },
      { bankAccountId: "a", evidenceDate: "2026-09-01", balance: "120.00" },
      { bankAccountId: "b", evidenceDate: "2026-09-02", balance: "30.00" },
      { bankAccountId: "a", evidenceDate: "2026-09-04", balance: "125.25" },
      { bankAccountId: "a", evidenceDate: "2026-09-04", balance: "126.25" },
    ], "2026-09-01", "2026-09-05");

    expect(result).toEqual([
      { date: "2026-09-02", balance: "150.00" },
      { date: "2026-09-03", balance: "150.00" },
      { date: "2026-09-04", balance: "156.25" },
    ]);
  });

  it("returns no points without evidence in the selected period or without accounts", () => {
    const evidence = [{ bankAccountId: "a", evidenceDate: "2026-08-31", balance: "1.00" }];
    expect(buildBankBalanceHistory(["a"], evidence, "2026-09-01", "2026-09-30")).toEqual([]);
    expect(buildBankBalanceHistory([], evidence, "2026-08-31", "2026-09-01")).toEqual([]);
  });

  it("returns one point for a single evidenced day", () => {
    expect(buildBankBalanceHistory(["a"], [
      { bankAccountId: "a", evidenceDate: "2026-09-01", balance: "0.00" },
    ], "2026-09-01", "2026-09-30")).toEqual([{ date: "2026-09-01", balance: "0.00" }]);
  });
});