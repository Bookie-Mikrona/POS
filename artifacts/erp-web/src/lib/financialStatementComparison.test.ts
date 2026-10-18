import { describe, expect, it } from "vitest";
import type { ReportSection } from "@workspace/api-client-react";
import { mergeFinancialStatementSections } from "./financialStatementComparison";

const current: ReportSection[] = [{
  class: "0", label: "Tekoči naziv", subtotal: "0", items: [
    { accountId: "a", accountCode: "001", accountName: "Tekoče ime", balance: "0" },
    { accountId: "b", accountCode: "002", accountName: "Samo tekoči", balance: "0" },
  ],
}];
const compare: ReportSection[] = [{
  class: "0", label: "Prejšnji naziv", subtotal: "40", items: [
    { accountId: "a", accountCode: "001", accountName: "Prejšnje ime", balance: "15" },
    { accountId: "c", accountCode: "003", accountName: "Samo primerjalni", balance: "25" },
  ],
}, {
  class: "1", label: "Primerjalni razdelek", subtotal: "-10", items: [
    { accountId: "d", accountCode: "110", accountName: "Primerjalni", balance: "-10" },
  ],
}];

describe("Združevanje obdobij finančnih izkazov", () => {
  it("združi razdelke in konte po identiteti ter ohrani ničlo, manjkajočo vrednost in tekoče nazive", () => {
    const merged = mergeFinancialStatementSections(current, compare);
    expect(merged.map((s) => s.entry.class)).toEqual(["0", "1"]);
    expect(merged[0].entry.label).toBe("Tekoči naziv");
    expect(merged[0].items.map((i) => i.entry.accountId)).toEqual(["a", "b", "c"]);
    expect(merged[0].items[0].entry.accountName).toBe("Tekoče ime");
    expect(merged[0].items[0].current?.balance).toBe("0");
    expect(merged[0].items[0].compare?.balance).toBe("15");
    expect(merged[0].items[1].compare).toBeUndefined();
    expect(merged[0].items[2].current).toBeUndefined();
    expect(merged[1].current).toBeUndefined();
    expect(merged[1].items[0].compare?.balance).toBe("-10");
    expect(current[0].items).toHaveLength(2);
    expect(compare[0].items).toHaveLength(2);
  });

  it("brez primerjave ohrani samo tekoče vrstice, brez obeh obdobij pa ostane prazen", () => {
    const merged = mergeFinancialStatementSections(current);
    expect(merged).toHaveLength(1);
    expect(merged[0].items).toHaveLength(2);
    expect(merged[0].compare).toBeUndefined();
    expect(mergeFinancialStatementSections([])).toEqual([]);
    expect(mergeFinancialStatementSections([], compare)).toHaveLength(2);
  });
});
