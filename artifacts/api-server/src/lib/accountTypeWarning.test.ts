import { describe, expect, it } from "vitest";
import { accountTypeWarning } from "./accountTypeWarning";
import { COMPANY_CHART_OF_ACCOUNTS } from "./companyChartOfAccounts";

describe("SRS code/type warnings", () => {
  it.each([
    ["0", "asset"], ["1", "asset"], ["2", "liability"], ["3", "asset"],
    ["4", "expense"], ["5", "liability"], ["6", "expense"], ["7", "revenue"],
    ["8", "equity"], ["9", "equity"], ["9600000", "liability"],
    ["9700000", "liability"], ["9800000", "liability"],
    ["9900000", "asset"], ["9990000", "liability"],
  ])("uses the chart's rule for %s", (code, type) => {
    expect(accountTypeWarning({ code, name: "Test", type })).toBeNull();
    const wrongType = type === "asset" ? "expense" : "asset";
    expect(accountTypeWarning({ code, name: "Test", type: wrongType })?.expectedType).toBe(type);
  });
  it("does not invent an SRS class for nonnumeric codes", () => {
    expect(accountTypeWarning({ code: "CUSTOM", name: "Test", type: "asset" })).toBeNull();
  });
  it("agrees with every account in the actual standard import", () => {
    expect(COMPANY_CHART_OF_ACCOUNTS.filter(account => accountTypeWarning(account))).toEqual([]);
  });
});
