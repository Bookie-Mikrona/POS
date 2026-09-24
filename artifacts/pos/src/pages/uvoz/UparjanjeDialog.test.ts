import { describe, expect, it } from "vitest";
import {
  jeEnotaSkupinskegaKandidataSkladna,
  pripraviPostavkoZaNovArtikel,
  type Kandidat,
  type NeuparjenaPostavka,
} from "./UparjanjeDialog";
import { isGroupablePurchaseUnit } from "@/lib/skupinski-nabavni-artikel";

const postavka: NeuparjenaPostavka = {
  id: 10,
  zap_st: 1,
  izv_gtin: null,
  izv_sifra: "A-24",
  izv_naziv: "Nov artikel",
  izv_enota: "pak",
  izv_kolicina: "1",
  izv_cena: "12.00",
  enot_v_paketu: "1",
  uparjanje_zaupanje: null,
  uparjanje_kandidati: [],
  opozorila: [],
};

describe("ustvarjanje novega artikla iz uparjanja", () => {
  it("prenese trenutno vneseno število enot v obrazec novega artikla", () => {
    expect(pripraviPostavkoZaNovArtikel(postavka, "24")).toMatchObject({
      enot_v_paketu: "24",
      izbrano_enot_v_paketu: "24",
    });
  });

  it("pri praznem polju ohrani prvotno vrednost postavke", () => {
    expect(pripraviPostavkoZaNovArtikel(postavka, " ")).toMatchObject({
      enot_v_paketu: "1",
      izbrano_enot_v_paketu: "1",
    });
  });
});

describe("ujemanje e-SLOG enot skupinskega nabavnega artikla", () => {
  const generic: Kandidat = {
    artikelId: 20,
    sifra: null,
    naziv: "Mleko",
    osnovnaEnota: "LTR",
    zadnjaCenaEnota: null,
    enotVPaketu: null,
    ocena: 0.5,
    znanDobavitelj: false,
    jeSkupinskiNabavniArtikel: true,
  };

  it("dovoli izbiro združljivega generic targeta", () => {
    expect(jeEnotaSkupinskegaKandidataSkladna(
      { izv_enota: "LTR" },
      generic,
    )).toBe(true);
  });

  it("prepozna KOM in H87 kot isto enoto ter zavrne drugačno enoto", () => {
    expect(jeEnotaSkupinskegaKandidataSkladna(
      { izv_enota: "H87" },
      { ...generic, osnovnaEnota: "KOM" },
    )).toBe(true);
    expect(jeEnotaSkupinskegaKandidataSkladna(
      { izv_enota: "KGM" },
      generic,
    )).toBe(false);
    expect(jeEnotaSkupinskegaKandidataSkladna(
      { izv_enota: "pak" },
      generic,
    )).toBe(false);
  });

  it("dovoljuje tudi druge podprte kanonične e-SLOG enote", () => {
    expect(isGroupablePurchaseUnit("MTK")).toBe(true);
    expect(jeEnotaSkupinskegaKandidataSkladna(
      { izv_enota: "M2" },
      { ...generic, osnovnaEnota: "MTK" },
    )).toBe(true);
    expect(jeEnotaSkupinskegaKandidataSkladna(
      { izv_enota: "KG" },
      { ...generic, osnovnaEnota: "KGM" },
    )).toBe(true);
    expect(isGroupablePurchaseUnit("DLT")).toBe(false);
  });

  it("ne omeji izbire običajnega artikla po enoti", () => {
    expect(jeEnotaSkupinskegaKandidataSkladna(
      { izv_enota: "KGM" },
      { ...generic, jeSkupinskiNabavniArtikel: false },
    )).toBe(true);
  });
});