import { describe, expect, it } from "vitest";
import {
  expectedPurchaseVatRateForArticle,
  resolveInputVatCode,
} from "./vat-code-resolver";

describe("expectedPurchaseVatRateForArticle", () => {
  it("uses the explicit purchase rate before the category", () => {
    expect(expectedPurchaseVatRateForArticle("5", "cold_beverage", true)).toBe("5.00");
  });

  it("uses 22 percent for a sweetened cold beverage", () => {
    expect(expectedPurchaseVatRateForArticle(null, "cold_beverage", true)).toBe("22.00");
  });

  it("uses 9.5 percent for an unsweetened cold beverage", () => {
    expect(expectedPurchaseVatRateForArticle(null, "cold_beverage", false)).toBe("9.50");
  });
});

// Reprezentativni izsek dejansko seedanega FURS vhodnega šifranta: za isto
// stopnjo so redna, neodbitna, EU, uvozna in samoobdavčitvena obravnava.
const candidates = [
  { id: "p22", code: "P22", rate: "22.00" },
  { id: "pn22", code: "PN22", rate: "22.00" },
  { id: "eub22", code: "EUB22", rate: "22.00" },
  { id: "rc22", code: "RC76A-22", rate: "22.00" },
  { id: "uv22", code: "UV22", rate: "22.00" },
  { id: "p95", code: "P95", rate: "9.50" },
  { id: "pn95", code: "PN95", rate: "9.50" },
  { id: "p5", code: "P5", rate: "5.00" },
  { id: "pop", code: "POP", rate: "0.00" },
];

describe("resolveInputVatCode", () => {
  it("preslika običajno e-SLOG kategorijo S na redno domačo P22 kodo", () => {
    expect(resolveInputVatCode(candidates, "S", "22")).toEqual({
      kind: "matched", vatCodeId: "p22",
    });
  });

  it("CSV brez DDV kategorije preslika na redno P95 kodo", () => {
    expect(resolveInputVatCode(candidates, null, "9.5")).toEqual({
      kind: "matched", vatCodeId: "p95",
    });
  });

  it("ohrani polno FURS kodo ne glede na zapis s presledki oziroma vezaji", () => {
    expect(resolveInputVatCode(candidates, "p-95", "9.5")).toEqual({
      kind: "matched", vatCodeId: "p95",
    });
  });

  it("ne ugiba pri posebni kategoriji brez polne FURS kode", () => {
    expect(resolveInputVatCode(candidates, "AE", "22"))
      .toEqual({ kind: "ambiguous", candidateCount: 5 });
  });

  it("pusti kodo prazno, če standardna stopnja nima FURS ustreznika", () => {
    expect(resolveInputVatCode(candidates, "S", "8")).toEqual({ kind: "missing" });
  });

  it("ne zamenja oproščene kategorije E z redno 0 % FURS obravnavo", () => {
    expect(resolveInputVatCode(candidates, "E", "0")).toEqual({ kind: "missing" });
  });

  it("pusti zunajobsegno kategorijo O brez DDV kode", () => {
    expect(resolveInputVatCode(candidates, "O", "0")).toEqual({ kind: "missing" });
  });
});