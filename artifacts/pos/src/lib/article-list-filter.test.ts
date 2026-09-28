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
const smallEquipment: FilterableArticle = {
  prodajniArtikel: false,
  nabavniArtikel: true,
  drobniInventar: true,
  povratnaEmbalaza: false,
};
const polizdelek: FilterableArticle = {
  prodajniArtikel: false,
  nabavniArtikel: false,
  povratnaEmbalaza: false,
  hasNormativ: true,
  slikaUrl: null,
};

describe("filtri seznama artiklov", () => {
  it("drobni inventar prikaže samo v Vsi in Drobni inventar, ne glede na druge oznake", () => {
    expect(articleMatchesListFilter(smallEquipment, "drobni")).toBe(true);
    expect(articleMatchesListFilter(smallEquipment, "vsi")).toBe(true);
    const overlapping: FilterableArticle = {
      ...smallEquipment,
      prodajniArtikel: true,
      povratnaEmbalaza: true,
      hasNormativ: true,
      slikaUrl: null,
    };
    const otherFilters = [
      "prodajni", "nabavni", "polizdelek", "embalaza",
      "zNormativom", "brezNormativa", "brezSlike",
    ] as const;
    for (const filter of otherFilters) {
      expect(articleMatchesListFilter(smallEquipment, filter), filter).toBe(false);
      expect(articleMatchesListFilter(overlapping, filter), filter).toBe(false);
    }
    expect(articleMatchesListFilter(overlapping, "vsi")).toBe(true);
    expect(articleMatchesListFilter(overlapping, "drobni")).toBe(true);
    expect(articleMatchesListFilter(ordinary, "drobni")).toBe(false);
    expect(articleMatchesListFilter(packaging, "drobni")).toBe(false);
  });
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