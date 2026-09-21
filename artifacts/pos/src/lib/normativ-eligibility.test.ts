import { describe, expect, it } from "vitest";
import {
  canEditNormativ,
  canUseAsNormativInput,
  normativSectionTitle,
} from "./normativ-eligibility";

describe("upravičenost za urejanje normativa", () => {
  it("omogoči normativ neprodajnemu pripravljenemu in sestavljenemu artiklu", () => {
    expect(canEditNormativ({ id: 1, prodajniArtikel: false, mealType: "prepared" })).toBe(true);
    expect(canEditNormativ({ id: 2, prodajniArtikel: false, mealType: "composite" })).toBe(true);
    expect(canEditNormativ({ id: 3, prodajniArtikel: false, mealType: "ala_carte" })).toBe(false);
  });

  it("pripravljeni artikel sprejme nabavne in druge pripravljene vhode, ne pa samega sebe", () => {
    expect(canUseAsNormativInput(10, "prepared", { id: 1, nabavniArtikel: true, mealType: "ala_carte" })).toBe(true);
    expect(canUseAsNormativInput(10, "prepared", { id: 2, nabavniArtikel: false, mealType: "prepared" })).toBe(true);
    expect(canUseAsNormativInput(10, "prepared", { id: 10, nabavniArtikel: true, mealType: "prepared" })).toBe(false);
  });

  it("sestavljeni artikel sprejme a la carte in pripravljene vhode tudi, če niso prodajni", () => {
    expect(canUseAsNormativInput(20, "composite", { id: 1, prodajniArtikel: false, mealType: "ala_carte" })).toBe(true);
    expect(canUseAsNormativInput(20, "composite", { id: 2, prodajniArtikel: false, mealType: "prepared" })).toBe(true);
    expect(canUseAsNormativInput(20, "composite", { id: 3, prodajniArtikel: true, mealType: "composite" })).toBe(false);
  });

  it("uporabi jasen naslov glede na operativni tip", () => {
    expect(normativSectionTitle("prepared")).toBe("Normativ priprave");
    expect(normativSectionTitle("composite")).toBe("Sestavljeni normativ");
    expect(normativSectionTitle("ala_carte")).toBe("Normativ za prodajo");
  });
});