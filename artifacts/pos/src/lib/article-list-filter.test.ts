import { describe, expect, it } from "vitest";
import { articleMatchesListFilter, type FilterableArticle } from "./article-list-filter";

const ordinary: FilterableArticle = {
  prodajniArtikel: true,
  nabavniArtikel: true,
  povratnaEmbalaza: false,
  hasNormativ: true,
  slikaUrl: null,
};

const packaging: FilterableArticle = {
  prodajniArtikel: false,
  nabavniArtikel: true,
  povratnaEmbalaza: true,
  hasNormativ: false,
  slikaUrl: null,
};

describe("filtri seznama artiklov", () => {
  it("v filtru Vsi skrije embalažo", () => {
    expect(articleMatchesListFilter(ordinary, "vsi")).toBe(true);
    expect(articleMatchesListFilter(packaging, "vsi")).toBe(false);
  });

  it("v filtru Embalaža prikaže samo embalažne artikle", () => {
    expect(articleMatchesListFilter(ordinary, "embalaza")).toBe(false);
    expect(articleMatchesListFilter(packaging, "embalaza")).toBe(true);
  });

  it("embalaže ne prikaže v nobenem drugem filtru", () => {
    const drugiFiltri = [
      "vsi",
      "prodajni",
      "nabavni",
      "zNormativom",
      "brezNormativa",
      "brezSlike",
    ] as const;

    for (const filter of drugiFiltri) {
      expect(articleMatchesListFilter(packaging, filter), filter).toBe(false);
    }
  });
});