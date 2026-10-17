import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  convertPurchasedQuantity,
  convertSignedPurchasedQuantity,
  DrainedYieldError,
  normalizeDrainedYield,
  resolveDrainedYield,
} from "./drained-yield";

describe("drained-yield conversion", () => {
  it("reverses credit-note quantities and value without changing the positive unit cost", () => {
    const yieldData = normalizeDrainedYield({ brutoTezaG: 680, netoTezaG: 480 });
    const result = convertSignedPurchasedQuantity(
      new Decimal(-5), new Decimal(-10), "H87", "KGM", yieldData,
    );
    expect(result.quantity.toString()).toBe("-2.4");
    expect(result.unitCost.mul(result.quantity).toString()).toBe("-10");
    expect(result.unitCost.gt(0)).toBe(true);
    expect(() => convertPurchasedQuantity(
      new Decimal(-5), new Decimal(-10), "H87", "KGM", yieldData,
    )).toThrow("ni negativno");
  });
  it("transfers the full purchase cost to drained stock", () => {
    const yieldData = normalizeDrainedYield({ brutoTezaG: 680, netoTezaG: 480 });
    const result = convertPurchasedQuantity(
      new Decimal(10),
      new Decimal(50),
      "KOM",
      "KGM",
      yieldData,
    );

    expect(result.quantity.toString()).toBe("4.8");
    expect(result.unitCost.toDecimalPlaces(4).toString()).toBe("10.4167");
  });

  it("infers net grams from gross mass and an explicitly supplied yield percentage", () => {
    const yieldData = normalizeDrainedYield({ brutoTezaG: 680, netoDelezOdst: 70.5882 });
    expect(yieldData.netoTezaG).toBe("480");
    const result = convertPurchasedQuantity(
      new Decimal(10),
      new Decimal(50),
      "KOM",
      "KGM",
      yieldData,
    );
    expect(result.quantity.toDecimalPlaces(4).toString()).toBe("4.8");
    expect(result.unitCost.mul(result.quantity).toDecimalPlaces(2).toString()).toBe("50");
  });

  it("applies the declared percentage to mass purchases", () => {
    const yieldData = normalizeDrainedYield({ brutoTezaG: 680, netoTezaG: 480 });
    const result = convertPurchasedQuantity(
      new Decimal(10),
      new Decimal(50),
      "KG",
      "KGM",
      yieldData,
    );

    expect(result.quantity.toDecimalPlaces(4).toString()).toBe("7.0588");
    expect(result.unitCost.mul(result.quantity).toString()).toBe("50");
  });

  it("rejects unsupported units instead of guessing", () => {
    const yieldData = normalizeDrainedYield({ netoDelezOdst: 70 });
    expect(() => convertPurchasedQuantity(
      new Decimal(10),
      new Decimal(50),
      "L",
      "KGM",
      yieldData,
    )).toThrow(DrainedYieldError);
  });

  it("rejects inconsistent mass and percentage data", () => {
    expect(() => normalizeDrainedYield({
      brutoTezaG: 680,
      netoTezaG: 480,
      netoDelezOdst: 60,
    })).toThrow(DrainedYieldError);
  });

  it("derives net mass when an explicit percentage overrides a stale snapshot", () => {
    expect(resolveDrainedYield(
      { netoDelezOdst: 70 },
      normalizeDrainedYield({ brutoTezaG: 500, netoTezaG: 480, netoDelezOdst: 96 }),
      null,
    )).toEqual({
      brutoTezaG: "500",
      netoTezaG: "350",
      netoDelezOdst: "70",
    });
  });

  it("derives the percentage when explicit net mass overrides a stale snapshot", () => {
    expect(resolveDrainedYield(
      { netoTezaG: 350 },
      normalizeDrainedYield({ brutoTezaG: 500, netoTezaG: 480, netoDelezOdst: 96 }),
      null,
    )).toEqual({
      brutoTezaG: "500",
      netoTezaG: "350",
      netoDelezOdst: "70",
    });
  });

  it("retains all original values for a no-op null-field edit", () => {
    expect(resolveDrainedYield(
      { brutoTezaG: null, netoTezaG: null, netoDelezOdst: null },
      normalizeDrainedYield({}),
      normalizeDrainedYield({ brutoTezaG: 500, netoTezaG: 350, netoDelezOdst: 70 }),
    )).toEqual({
      brutoTezaG: "500",
      netoTezaG: "350",
      netoDelezOdst: "70",
    });
  });
});