import { describe, expect, it } from "vitest";
import { trialBalanceNet, formatTrialBalanceNet } from "./trial-balance-net";

describe("presentation-only trial-balance net", () => {
  it.each([
    ["23948.52", "21081.77", 2866.75],
    ["0", "3000.00", -3000],
    ["192.00", "192.00", 0],
    ["0.30", "0.20", 0.10],
    ["-10.00", "-20.00", 10],
  ])("subtracts %s − %s in cents", (debit, credit, expected) => {
    expect(trialBalanceNet(debit, credit)).toBe(expected);
  });
  it("shows a settled account as a numeric zero, not a blank", () => {
    expect(formatTrialBalanceNet("192", "192")).toBe("0,00");
    expect(Object.is(trialBalanceNet("0", "0"), -0)).toBe(false);
  });
});