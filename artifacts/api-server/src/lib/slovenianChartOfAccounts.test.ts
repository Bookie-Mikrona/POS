import { describe, expect, it } from "vitest";
import {
  BUDGET_CHART_OF_ACCOUNTS,
  buildSlovenianChartOfAccounts,
} from "./slovenianChartOfAccounts";

describe("SRS 2024 kontni plan proračunskih uporabnikov", () => {
  it("pretvori celoten uradni vir po dogovorjenih pravilih", () => {
    const plan = BUDGET_CHART_OF_ACCOUNTS;
    const byCode = new Map(plan.map((account) => [account.code, account]));

    expect(plan).toHaveLength(2201);
    expect(new Set(plan.map((account) => account.code)).size).toBe(plan.length);
    expect(plan.some((account) => account.code.length === 6)).toBe(false);

    expect(byCode.get("0010")?.name).toBe(byCode.get("001")?.name);
    expect(byCode.get("0010000")?.name).toBe(byCode.get("001")?.name);
    expect(byCode.get("4000000")?.name).toBe("Osnovne plače");
    expect(byCode.get("4029000")?.name).toBe("Stroški konferenc, seminarjev in simpozijev");
  });

  it("pusti knjiženje samo na listih in ohrani celotno hierarhijo", () => {
    for (const account of BUDGET_CHART_OF_ACCOUNTS) {
      if (account.parentCode) {
        expect(BUDGET_CHART_OF_ACCOUNTS.some((candidate) => candidate.code === account.parentCode)).toBe(true);
      }

      const hasChild = BUDGET_CHART_OF_ACCOUNTS.some(
        (candidate) =>
          candidate.code.length > account.code.length &&
          candidate.code.startsWith(account.code),
      );
      expect(account.allowsPosting).toBe(!hasChild);
    }
  });

  it("zavrne podvojen uradni konto že pred generiranjem", () => {
    expect(() =>
      buildSlovenianChartOfAccounts([
        { code: "00", name: "Skupina" },
        { code: "00", name: "Podvojeno" },
      ]),
    ).toThrow("Podvojen uradni konto 00");
  });
});