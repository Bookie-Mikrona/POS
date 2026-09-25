import { describe, expect, it } from "vitest";
import { articleMatchesListFilter, isPolizdelek, type FilterableArticle } from "./article-list-filter";

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
const polizdelek: FilterableArticle = {
  prodajniArtikel: false,
  nabavniArtikel: false,
  povratnaEmbalaza: false,
  hasNormativ: true,
  slikaUrl: null,
};

describe("filtri seznama artiklov", () => {
  it("polizdelek določi iz treh vlog in ga pokaže v lastnem filtru", () => {
    expect(isPolizdelek(polizdelek)).toBe(true);
    expect(isPolizdelek(ordinary)).toBe(false);
    expect(isPolizdelek(packaging)).toBe(false);
    expect(articleMatchesListFilter(polizdelek, "polizdelek")).toBe(true);
    expect(articleMatchesListFilter(polizdelek, "vsi")).toBe(true);
    expect(articleMatchesListFilter(polizdelek, "zNormativom")).toBe(true);
    expect(articleMatchesListFilter(ordinary, "polizdelek")).toBe(false);
    expect(articleMatchesListFilter(packaging, "polizdelek")).toBe(false);
  });
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
      "polizdelek",
      "zNormativom",
      "brezNormativa",
      "brezSlike",
    ] as const;

    for (const filter of drugiFiltri) {
      expect(articleMatchesListFilter(packaging, filter), filter).toBe(false);
    }
  });
});