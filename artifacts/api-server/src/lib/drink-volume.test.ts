import { describe, expect, it } from "vitest";
import { automaticDrinkVolume, drinkNameKey, drinkNormativeQuantity, parseDrinkVolumeName } from "./drink-volume";

describe("drink volume names", () => {
  it.each([
    ["Dingač 0,1 litra", 0.1], ["Dingač 0.1L", 0.1], ["Dingač 1 dl", 0.1],
    ["Dingač en deciliter", 0.1], ["Dingač 10 cl", 0.1], ["Dingač 100 ml", 0.1],
    ["Dingač 3 cl", 0.03], ["Dingač 5 cl", 0.05],
    ["Dingač tri centilitre", 0.03], ["Dingač pet centilitrov", 0.05],
    ["Dingač 0,03 litra", 0.03], ["Dingač 0,05 l", 0.05],
    ["Dingač 7,5 decilitrov", 0.75], ["Dingač sedem decilitrov", 0.7],
    ["Dingač en liter", 1], ["Dingač pol litra", 0.5], ["Dingač četrt litra", 0.25],
    ["Dingač sedem in pol decilitrov", 0.75], ["Dingač 0,001 hl", 0.1],
    ["Dingač 0,0001 kl", 0.1],
  ])("reads %s", (name, liters) => {
    expect(parseDrinkVolumeName(name)).toEqual({ baseName: "Dingač", liters });
  });

  it("keeps vintages and full product names, ignoring case and diacritics for matching", () => {
    expect(parseDrinkVolumeName("Dingač premium 2024 0,1 l").baseName).toBe("Dingač premium 2024");
    expect(drinkNameKey("DINGAČ")).toBe(drinkNameKey("dingac"));
    expect(drinkNameKey("Dingač premium")).not.toBe(drinkNameKey("Dingač"));
    expect(parseDrinkVolumeName("Bela frankinja (Kerin, Krško) 0,1 l")).toEqual({
      baseName: "Bela frankinja (Kerin, Krško)", liters: 0.1,
    });
    expect(parseDrinkVolumeName("Dingač (0,1 l)")).toEqual({ baseName: "Dingač", liters: 0.1 });
  });

  it.each(["Dingač", "Dingač 0 l", "Dingač 0,7 l / 0,75 l", "Dingač 6 × 0,75 l"])(
    "does not invent a sale volume for %s", name => {
      expect(parseDrinkVolumeName(name).liters).toBeNull();
    },
  );
});

describe("automatic drink normative eligibility", () => {
  const sale = { ime: "Dingač 0,1 l", taxCategory: "alcoholic", nabavniArtikel: false, prodajniArtikel: true };
  it("applies to alcohol and cold beverages, but not other categories or roles", () => {
    expect(automaticDrinkVolume(sale)).toEqual({ baseName: "Dingač", liters: 0.1 });
    expect(automaticDrinkVolume({ ...sale, taxCategory: "cold_beverage" })).not.toBeNull();
    for (const taxCategory of ["food", "hot_beverage", "food_drink", "other"]) {
      expect(automaticDrinkVolume({ ...sale, taxCategory })).toBeNull();
    }
    expect(automaticDrinkVolume({ ...sale, nabavniArtikel: true })).toBeNull();
    expect(automaticDrinkVolume({ ...sale, prodajniArtikel: false })).toBeNull();
    expect(automaticDrinkVolume({ ...sale, povratnaEmbalaza: true })).toBeNull();
    expect(automaticDrinkVolume({ ...sale, ime: "Dingač" })).toBeNull();
  });
});

describe("purchase inventory units and one-liter fallback", () => {
  it.each([0.03, 0.05])("uses the spirit serving size %s instead of assuming one deciliter", liters => {
    expect(drinkNormativeQuantity(liters, { ime: "Žganje 1 liter", enotaMere: "LTR" })).toBe(liters);
    expect(drinkNormativeQuantity(liters, { ime: "Žganje", enotaMere: "kos" })).toBe(liters);
  });

  it.each([
    ["Dingač 0,75 l", "LTR", 0.1], ["Dingač", "liter", 0.1],
    ["Dingač 0,75 l", "kos", 0.1333], ["Dingač sedem decilitrov", "H87", 0.1429],
    ["Dingač", "kos", 0.1], ["Dingač", null, 0.1],
    ["Dingač 0,7 l / 0,75 l", "kos", 0.1],
    ["Dingač", "dl", 1], ["Dingač", "cl", 10], ["Dingač", "ml", 100],
  ])("consumes the correct stock quantity from %s (%s)", (ime, enotaMere, expected) => {
    expect(drinkNormativeQuantity(0.1, { ime, enotaMere })).toBe(expected);
  });

  it("does not reinterpret mass inventory as liters or round tiny quantities to zero", () => {
    expect(drinkNormativeQuantity(0.1, { ime: "Dingač", enotaMere: "kg" })).toBeNull();
    expect(drinkNormativeQuantity(0.000001, { ime: "Dingač", enotaMere: "l" })).toBeNull();
  });
});