import { describe, expect, it } from "vitest";
import {
  canEditNormativ,
  canOfferSmartNormativ,
  canUseAsModifierNormativInput,
  canUseAsNormativInput,
  compositeInputGroup,
  normativSectionTitle,
} from "./normativ-eligibility";

describe("upravičenost za urejanje normativa", () => {
  it("omogoči normativ neprodajnemu pripravljenemu in sestavljenemu artiklu", () => {
    expect(canEditNormativ({ id: 1, prodajniArtikel: false, mealType: "prepared" })).toBe(true);
    expect(canEditNormativ({ id: 2, prodajniArtikel: false, mealType: "composite" })).toBe(true);
    expect(canEditNormativ({ id: 3, prodajniArtikel: false, mealType: "ala_carte" })).toBe(false);
  });

  it("omogoči normativ živilskemu à la carte polizdelku, ne pa samo nabavnemu artiklu", () => {
    const polizdelek = { id: 4, mealType: "ala_carte", taxCategory: "food", prodajniArtikel: false, nabavniArtikel: false };
    expect(canEditNormativ(polizdelek)).toBe(true);
    expect(canEditNormativ({ ...polizdelek, nabavniArtikel: true })).toBe(false);
    expect(canEditNormativ({ ...polizdelek, taxCategory: "other" })).toBe(false);
    expect(canUseAsNormativInput(10, "composite", polizdelek)).toBe(true);
  });

  it("pametni predlog omogoči živilskemu polizdelku, ne pa nabavnemu ali sestavljenemu artiklu", () => {
    const intermediate = { mealType: "ala_carte", taxCategory: "food", prodajniArtikel: false, nabavniArtikel: false };
    expect(canOfferSmartNormativ(intermediate)).toBe(true);
    expect(canOfferSmartNormativ({ ...intermediate, mealType: "prepared" })).toBe(true);
    expect(canOfferSmartNormativ({ ...intermediate, nabavniArtikel: true })).toBe(false);
    expect(canOfferSmartNormativ({ ...intermediate, taxCategory: "other" })).toBe(false);
    expect(canOfferSmartNormativ({ ...intermediate, mealType: "composite" })).toBe(false);
    expect(canOfferSmartNormativ({ ...intermediate, prodajniArtikel: true })).toBe(true);
  });

  it("modifikatorju dovoli nabavne artikle in oba tipa živilskih polizdelkov", () => {
    const intermediate = { mealType: "ala_carte", taxCategory: "food", prodajniArtikel: false, nabavniArtikel: false };
    expect(canUseAsModifierNormativInput({ nabavniArtikel: true })).toBe(true);
    expect(canUseAsModifierNormativInput(intermediate)).toBe(true);
    expect(canUseAsModifierNormativInput({ ...intermediate, mealType: "prepared" })).toBe(true);
    expect(canUseAsModifierNormativInput({ ...intermediate, prodajniArtikel: true })).toBe(false);
    expect(canUseAsModifierNormativInput({ ...intermediate, taxCategory: "other" })).toBe(false);
    expect(canUseAsModifierNormativInput({ ...intermediate, mealType: "composite" })).toBe(false);
  });

  it("pripravljeni artikel sprejme nabavne in druge pripravljene vhode, ne pa samega sebe", () => {
    expect(canUseAsNormativInput(10, "prepared", { id: 1, nabavniArtikel: true, mealType: "ala_carte" })).toBe(true);
    expect(canUseAsNormativInput(10, "prepared", { id: 2, nabavniArtikel: false, mealType: "prepared" })).toBe(true);
    expect(canUseAsNormativInput(10, "prepared", { id: 10, nabavniArtikel: true, mealType: "prepared" })).toBe(false);
  });

  it("sestavljeni artikel sprejme a la carte in pripravljene vhode tudi, če niso prodajni", () => {
    expect(canUseAsNormativInput(20, "composite", { id: 1, prodajniArtikel: false, mealType: "ala_carte" })).toBe(true);
    expect(canUseAsNormativInput(20, "composite", { id: 2, prodajniArtikel: false, mealType: "prepared" })).toBe(true);
    expect(canUseAsNormativInput(20, "composite", { id: 4, prodajniArtikel: true, mealType: "ala_carte" })).toBe(true);
    expect(canUseAsNormativInput(20, "composite", { id: 3, prodajniArtikel: true, mealType: "composite" })).toBe(false);
    expect(compositeInputGroup({ prodajniArtikel: false, nabavniArtikel: false, mealType: "prepared" })).toBe("intermediate");
    expect(compositeInputGroup({ prodajniArtikel: false, nabavniArtikel: false, mealType: "ala_carte" })).toBe("intermediate");
    expect(compositeInputGroup({ prodajniArtikel: true, mealType: "ala_carte" })).toBe("sale_ala_carte");
  });

  it("uporabi jasen naslov glede na operativni tip", () => {
    expect(normativSectionTitle("prepared")).toBe("Normativ priprave");
    expect(normativSectionTitle("composite")).toBe("Sestavljeni normativ");
    expect(normativSectionTitle("ala_carte")).toBe("Normativ za prodajo");
    expect(normativSectionTitle("ala_carte", false)).toBe("Normativ polizdelka");
  });
});