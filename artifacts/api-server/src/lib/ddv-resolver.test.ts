import { describe, expect, it } from "vitest";

import { normalizeAddedSugarForTaxCategory, resolveRate } from "./ddv-resolver";

describe("izrecna 5-% DDV kategorija", () => {
  it("uporabi samo svoje 5-% pravilo in ne spremeni obstoječe kategorije hrane", () => {
    const rules: Parameters<typeof resolveRate>[1] = [
      {
        id: 501,
        priority: 10,
        supplyKind: null,
        taxCategory: "vat_super_reduced_5",
        addedSugar: null,
        rate: "5.00",
        configurable: false,
        label: "Znižana stopnja DDV 5 %",
      },
      {
        id: 950,
        priority: 10,
        supplyKind: null,
        taxCategory: "food",
        addedSugar: null,
        rate: "9.50",
        configurable: false,
        label: "Hrana",
      },
    ];

    expect(resolveRate({
      supplyKind: "eat_in",
      taxCategory: "vat_super_reduced_5",
      addedSugar: false,
      nastavitve: {},
      fallbackRate: 22,
      jeDdvZavezanec: true,
    }, rules)).toMatchObject({ rate: 5, ruleId: 501 });

    expect(resolveRate({
      supplyKind: "eat_in",
      taxCategory: "food",
      addedSugar: false,
      nastavitve: {},
      fallbackRate: 22,
      jeDdvZavezanec: true,
    }, rules)).toMatchObject({ rate: 9.5, ruleId: 950 });
  });
});

describe("pijača-jed z dodanim sladkorjem", () => {
  const foodDrinkRule: Parameters<typeof resolveRate>[1] = [{
    id: 951,
    priority: 10,
    supplyKind: null,
    taxCategory: "food_drink",
    addedSugar: null,
    rate: "9.50",
    configurable: false,
    label: "Pijača-jed",
  }];

  it.each(["eat_in", "to_go"] as const)(
    "ohrani 9,5 %% v toku %s in normalizira addedSugar",
    (supplyKind) => {
      expect(normalizeAddedSugarForTaxCategory("food_drink", true)).toBe(false);
      expect(resolveRate({
        supplyKind,
        taxCategory: "food_drink",
        addedSugar: true,
        nastavitve: {},
        fallbackRate: 22,
        jeDdvZavezanec: true,
      }, foodDrinkRule)).toMatchObject({ rate: 9.5, ruleId: 951 });
    },
  );
});

describe("pijača kot del menija", () => {
  const rules: Parameters<typeof resolveRate>[1] = [
    {
      id: 95,
      priority: 1,
      supplyKind: null,
      taxCategory: "menu_item",
      addedSugar: null,
      rate: "5.00",
      configurable: false,
      label: "Pijača kot del menija",
    },
    {
      id: 220,
      priority: 10,
      supplyKind: null,
      taxCategory: "alcoholic",
      addedSugar: null,
      rate: "9.50",
      configurable: false,
      label: "Alkoholna pijača",
    },
  ];

  it.each(["eat_in", "to_go"] as const)("uporabi 9,5 %% v toku %s", (supplyKind) => {
    expect(resolveRate({
      supplyKind,
      taxCategory: "cold_beverage",
      addedSugar: false,
      jeDelMenija: true,
      nastavitve: {},
      fallbackRate: 22,
      jeDdvZavezanec: true,
    }, rules)).toMatchObject({ rate: 9.5, ruleId: 95 });
  });

  it("samostojne pijače ne spremeni v menijsko", () => {
    expect(resolveRate({
      supplyKind: "eat_in",
      taxCategory: "cold_beverage",
      addedSugar: false,
      jeDelMenija: false,
      nastavitve: {},
      fallbackRate: 22,
      jeDdvZavezanec: true,
    }, rules)).toMatchObject({ rate: 22, ruleId: null });
  });

  it.each([
    ["vat_super_reduced_5", 5],
    ["other", 22],
  ] as const)("ne dovoli menijske stopnje za kategorijo %s", (taxCategory, fallbackRate) => {
    expect(resolveRate({
      supplyKind: "to_go",
      taxCategory,
      addedSugar: false,
      jeDelMenija: true,
      nastavitve: {},
      fallbackRate,
      jeDdvZavezanec: true,
    }, rules)).toMatchObject({ rate: fallbackRate, ruleId: null });
  });

  it("alkohol ohrani pri 22 %, tudi če je označen kot del menija", () => {
    expect(resolveRate({
      supplyKind: "eat_in",
      taxCategory: "alcoholic",
      addedSugar: false,
      jeDelMenija: true,
      nastavitve: {},
      fallbackRate: 9.5,
      jeDdvZavezanec: true,
    }, rules)).toMatchObject({ rate: 22, ruleId: 220 });
  });
});