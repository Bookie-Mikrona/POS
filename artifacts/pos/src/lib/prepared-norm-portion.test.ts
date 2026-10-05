import { describe, expect, it } from "vitest";
import { baseNormQuantity, portionNormQuantity, preparedNormPortionFactor } from "./prepared-norm-portion";

describe("Normativ na normalno porcijo kg/l polizdelka", () => {
  it("400 g porcija s 120 g mesa pomeni 0,3 kg mesa na kg in 3 kg mesa za pripravo 10 kg", () => {
    const factor = preparedNormPortionFactor(true, "400");
    expect(factor).toBe(0.4);
    const base = baseNormQuantity(0.12, factor);
    expect(base).toBe(0.3);
    expect(base * 10).toBe(3);
    expect(portionNormQuantity(base, factor)).toBe("0.12");
  });
  it("400 ml porcija juhe uporablja isto pretvorbo v osnovni liter", () => {
    expect(baseNormQuantity(0.04, preparedNormPortionFactor(true, "400"))).toBe(0.1);
  });
  it("sprememba normalne porcije ohrani recept na osnovno enoto", () => {
    const base = baseNormQuantity(0.12, 0.4);
    expect(portionNormQuantity(base, 0.5)).toBe("0.15");
    expect(baseNormQuantity(0.15, 0.5)).toBe(base);
  });
  it("obstoječim receptom brez reference in porcijskim jedem ne spremeni osnove", () => {
    expect(preparedNormPortionFactor(true, "")).toBe(1);
    expect(preparedNormPortionFactor(false, "400")).toBe(1);
    expect(portionNormQuantity(0.3, 1)).toBe("0.3");
    expect(preparedNormPortionFactor(true, "400,5")).toBe(0.4005);
  });
});
