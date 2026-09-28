import { describe, expect, it } from "vitest";
import { mealTypeForPizzaUpdate } from "./pizza-meal-type";

describe("mealTypeForPizzaUpdate", () => {
  it("ob urejanju pice ne sprejme neželenega preklopa v à la carte", () => {
    expect(mealTypeForPizzaUpdate("ala_carte", "composite", true, true)).toBe("composite");
    expect(mealTypeForPizzaUpdate(undefined, "composite", true, true)).toBe("composite");
  });

  it("ohrani tudi obstoječe druge tipe, novo pico pa označi kot sestavljeno", () => {
    expect(mealTypeForPizzaUpdate("composite", "prepared", true, true)).toBe("prepared");
    expect(mealTypeForPizzaUpdate("ala_carte", "ala_carte", false, true)).toBe("composite");
    expect(mealTypeForPizzaUpdate("ala_carte", "composite", true, false)).toBe("ala_carte");
  });
});