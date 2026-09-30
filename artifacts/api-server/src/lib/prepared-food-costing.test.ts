import { describe, expect, it } from "vitest";
import {
  allocatePreparedFood,
  preparedMaterialQuantityForProduction,
  preparedMaterialUnitCost,
} from "./prepared-food-costing";

describe("prepared food costing", () => {
  it("keeps frozen portions from thawed stock first and values waste at today's prepared unit cost", () => {
    const result = allocatePreparedFood({
      thawedQuantity: 5, preparedQuantity: 5, correctionQuantity: 0, soldQuantity: 3, frozenAtEndQuantity: 6,
      thawedCostPerPortion: 2, preparedCostPerPortion: 4,
    });
    expect(result.frozenFromThawed).toBe(5);
    expect(result.frozenFromPrepared).toBe(1);
    expect(result.frozenCostPerPortion).toBe(14 / 6);
    expect(result.wasteQuantity).toBe(1);
    expect(result.wasteFromPrepared).toBe(1);
    expect(result.wasteValue).toBe(4);
    expect(result.preparedMaterialValue).toBe(20);
    expect(result.remainingMaterialValue).toBe(16);
  });

  it("rejects impossible closes and calculates material cost", () => {
    expect(() => allocatePreparedFood({
      thawedQuantity: 1, preparedQuantity: 0, correctionQuantity: 0, soldQuantity: 0, frozenAtEndQuantity: 2,
      thawedCostPerPortion: 1, preparedCostPerPortion: 1,
    })).toThrow(/waste negative/);
    expect(preparedMaterialUnitCost([{ quantity: 0.2, wac: 10 }, { quantity: 2, wac: 1.5 }])).toBe(5);
  });

  it("records thawed waste quantity without creating or transferring today's material cost", () => {
    const result = allocatePreparedFood({
      thawedQuantity: 3,
      preparedQuantity: 0,
      correctionQuantity: 0,
      soldQuantity: 0,
      frozenAtEndQuantity: 0,
      thawedCostPerPortion: 2.75,
      preparedCostPerPortion: 0,
    });

    expect(result.wasteQuantity).toBe(3);
    expect(result.wasteValue).toBe(0);
    expect(result.preparedMaterialValue).toBe(0);
    expect(result.remainingMaterialValue).toBe(0);
  });

  it("uses the current preparation cost for portions prepared that day", () => {
    const result = allocatePreparedFood({
      thawedQuantity: 0,
      preparedQuantity: 2,
      correctionQuantity: 0,
      soldQuantity: 0,
      frozenAtEndQuantity: 0,
      thawedCostPerPortion: 99,
      preparedCostPerPortion: 4.5,
    });

    expect(result.wasteQuantity).toBe(2);
    expect(result.wasteValue).toBe(9);
  });

  it("multiplies recipe quantities by prepared kilograms produced", () => {
    expect(preparedMaterialQuantityForProduction(3, 10)).toBe(30);
  });

  it("negativna korekcija zmanjša skupno količino in fizični kalo", () => {
    const corrected = allocatePreparedFood({
      thawedQuantity: 2,
      preparedQuantity: 8,
      correctionQuantity: -2,
      soldQuantity: 7,
      frozenAtEndQuantity: 0,
      thawedCostPerPortion: 2,
      preparedCostPerPortion: 4,
    });
    expect(corrected.wasteQuantity).toBe(1);
    expect(corrected.wasteValue).toBe(4);
    expect(corrected.remainingMaterialValue).toBe(28);
  });

  it("pozitivna korekcija poveča največjo količino za zamrzovanje in preostali kalo", () => {
    const result = allocatePreparedFood({
      thawedQuantity: 0,
      preparedQuantity: 10,
      correctionQuantity: 1,
      soldQuantity: 4,
      frozenAtEndQuantity: 5,
      thawedCostPerPortion: 0,
      preparedCostPerPortion: 0.485,
    });

    expect(result.wasteQuantity).toBe(2);
    expect(result.frozenCostPerPortion).toBe(0.485);
    expect(result.wasteValue).toBe(0.97);
  });

  it("pozitivna korekcija dovoli prodajo do popravljene skupne količine", () => {
    const result = allocatePreparedFood({
      thawedQuantity: 0,
      preparedQuantity: 20,
      correctionQuantity: 2,
      soldQuantity: 22,
      frozenAtEndQuantity: 0,
      thawedCostPerPortion: 0,
      preparedCostPerPortion: 3.5,
    });

    expect(result.wasteQuantity).toBe(0);
    expect(result.wasteValue).toBe(0);
    expect(result.preparedMaterialValue).toBe(70);
    expect(result.remainingMaterialValue).toBe(70);
    expect(result.frozenCostPerPortion).toBe(0);
  });

  it("prenese eno od desetih pripravljenih porcij iz materiala na kalo", () => {
    const result = allocatePreparedFood({
      thawedQuantity: 0,
      preparedQuantity: 10,
      correctionQuantity: 0,
      soldQuantity: 9,
      frozenAtEndQuantity: 0,
      thawedCostPerPortion: 0,
      preparedCostPerPortion: 1,
    });

    expect(result.wasteQuantity).toBe(1);
    expect(result.preparedMaterialValue).toBe(10);
    expect(result.wasteValue).toBe(1);
    expect(result.remainingMaterialValue).toBe(9);
    expect(result.remainingMaterialValue + result.wasteValue).toBe(result.preparedMaterialValue);
  });

  it("nikoli ne prenese na kalo več kot celoten strošek današnje priprave", () => {
    const result = allocatePreparedFood({
      thawedQuantity: 5,
      preparedQuantity: 2,
      correctionQuantity: 0,
      soldQuantity: 0,
      frozenAtEndQuantity: 0,
      thawedCostPerPortion: 7,
      preparedCostPerPortion: 3,
    });

    expect(result.wasteQuantity).toBe(7);
    expect(result.wasteValue).toBe(6);
    expect(result.remainingMaterialValue).toBe(0);
  });
});