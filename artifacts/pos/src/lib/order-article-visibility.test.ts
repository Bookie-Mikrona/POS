import { describe, expect, it } from "vitest";
import { isOrderArticleVisible } from "./order-article-visibility";

describe("isOrderArticleVisible", () => {
  it("prikaže sestavljeni artikel, ko ima shranjen normativ in razpoložljive pripravljene sestavine", () => {
    expect(isOrderArticleVisible({
      prodajniArtikel: true,
      kategorijaId: 18,
      mealType: "composite",
      availableQuantity: 1,
    })).toBe(true);
  });

  it("skrije sestavljeni artikel brez razpoložljivosti", () => {
    expect(isOrderArticleVisible({
      prodajniArtikel: true,
      kategorijaId: 18,
      mealType: "composite",
      availableQuantity: 0,
    })).toBe(false);
  });

  it("prikaže aktivni večhodni paket tudi, ko ovojni artikel ni navaden prodajni artikel", () => {
    expect(isOrderArticleVisible({
      prodajniArtikel: false,
      kategorijaId: null,
      mealType: "ala_carte",
      availableQuantity: null,
    }, true)).toBe(true);
  });
});