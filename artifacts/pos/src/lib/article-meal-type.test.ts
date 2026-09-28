import { describe, expect, it } from "vitest";
import { mealTypeForArticleSave } from "./article-meal-type";

describe("mealTypeForArticleSave", () => {
  it("ohrani sestavljeno pico tudi ob urejanju možnosti To Go", () => {
    expect(mealTypeForArticleSave("composite", false, "pica", true)).toBe("composite");
  });

  it("ohrani način priprave hrane in polizdelka, pijači pa ne pripiše sestavljenosti", () => {
    expect(mealTypeForArticleSave("prepared", false, "hrana", false)).toBe("prepared");
    expect(mealTypeForArticleSave("composite", true, null, false)).toBe("composite");
    expect(mealTypeForArticleSave("composite", false, "pijaca", false)).toBe("ala_carte");
  });
});