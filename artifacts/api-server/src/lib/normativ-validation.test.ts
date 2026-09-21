import { describe, expect, it } from "vitest";
import { isAllowedOneToOneSelfNorm, requiresClassicNormativ } from "./normativ-validation";

describe("requiresClassicNormativ", () => {
  it("izjemo dovoli samo konfigurirani večhodni sestavljeni ovojnici", () => {
    expect(requiresClassicNormativ("composite", true)).toBe(false);
    expect(requiresClassicNormativ("composite", false)).toBe(true);
    expect(requiresClassicNormativ("prepared", false)).toBe(false);
  });
});

describe("isAllowedOneToOneSelfNorm", () => {
  const simpleGoods = {
    mealType: "ala_carte" as const,
    nabavniArtikel: true,
    prodajniArtikel: true,
  };

  it("dovoli prvi 1 : 1 lastni normativ preprostega nabavnega in prodajnega artikla", () => {
    expect(isAllowedOneToOneSelfNorm(simpleGoods, 99, [
      { vhodniArtikelId: 99, kolicina: 1 },
    ])).toBe(true);
  });

  it("ne dovoli lastnega normativa receptu ali pripravljeni hrani", () => {
    expect(isAllowedOneToOneSelfNorm(simpleGoods, 99, [
      { vhodniArtikelId: 99, kolicina: 1 },
      { vhodniArtikelId: 12, kolicina: 0.2 },
    ])).toBe(false);
    expect(isAllowedOneToOneSelfNorm(
      { ...simpleGoods, mealType: "prepared" },
      99,
      [{ vhodniArtikelId: 99, kolicina: 1 }],
    )).toBe(false);
  });
});