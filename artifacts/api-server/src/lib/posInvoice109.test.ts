import { describe, expect, it } from "vitest";
import { allocatePos109, pos109PostingReasons } from "./posInvoice109";

describe("allocatePos109", () => {
  it("prenese povezane prejemnice na 109, preostanek pa obdrži na stroškovnih kontih", () => {
    const result = allocatePos109("125.00", [
      { id: "a", accountId: "strosek-a", amount: "100.00" },
      { id: "b", accountId: "strosek-b", amount: "80.00" },
    ]);

    expect(result.unallocated.toFixed(2)).toBe("0.00");
    expect(result.allocations.map((row) => ({
      to109: row.transferredTo109.toFixed(2),
      expense: row.remainingExpense.toFixed(2),
    }))).toEqual([
      { to109: "100.00", expense: "0.00" },
      { to109: "25.00", expense: "55.00" },
    ]);
  });

  it("ne more zapreti več 109, kot ga vsebujejo vrstice računa", () => {
    const result = allocatePos109("220.00", [
      { id: "a", accountId: "strosek-a", amount: "100.00" },
    ]);

    expect(result.unallocated.toFixed(2)).toBe("120.00");
    expect(result.allocations[0].transferredTo109.toFixed(2)).toBe("100.00");
  });
});

describe("pos109PostingReasons", () => {
  it("dovoli knjiženje, kadar so vse povezane prejemnice že knjižene in ne presegajo računa", () => {
    expect(pos109PostingReasons({
      hasLinks: true,
      linkedReceiptNet: "100.00",
      invoiceNet: "150.00",
      allReceiptsBooked: true,
    })).toEqual([]);
  });

  it("obdrži račun kot osnutek pri nepotrjeni prejemnici ali presežku 109", () => {
    const reasons = pos109PostingReasons({
      hasLinks: true,
      linkedReceiptNet: "160.00",
      invoiceNet: "150.00",
      allReceiptsBooked: false,
    });

    expect(reasons).toHaveLength(2);
    expect(reasons.join(" ")).toContain("še nima potrjene POS temeljnice");
    expect(reasons.join(" ")).toContain("presega neto vrednost računa");
  });
});