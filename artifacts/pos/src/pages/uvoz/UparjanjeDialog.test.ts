import { describe, expect, it } from "vitest";
import {
  pripraviPostavkoZaNovArtikel,
  type NeuparjenaPostavka,
} from "./UparjanjeDialog";

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