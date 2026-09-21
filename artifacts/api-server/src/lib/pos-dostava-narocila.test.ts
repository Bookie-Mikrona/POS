import { describe, expect, it } from "vitest";
import {
  izracunajCenoDostave,
  izracunajPredvidenoDostavo,
  ustvariDostavniSnapshot,
  ustvariDostavnoPostavko,
} from "./pos-dostava-narocila";

describe("dostava telefonskega naročila", () => {
  const artikel = { id: 41, ime: "Dostava", davek: 22, vrstaArtikla: "storitev" };

  it("ustvari nespremenljiv snapshot naslova, cene in časa naselja", () => {
    expect(ustvariDostavniSnapshot({
      ulica: "Glavna ulica",
      hisnaStevilka: "12A",
      vhod: "B",
      nadstropje: "2",
      navodilo: "Pokliči ob prihodu",
      naseljeId: 7,
      naseljeNaziv: "Center",
      cenaDostave: 3.5,
      casDostaveMin: 14,
    })).toMatchObject({
      dostavaUlica: "Glavna ulica",
      dostavaHisnaStevilka: "12A",
      dostavaNaseljeId: 7,
      dostavaNaseljeNaziv: "Center",
      dostavaCena: 3.5,
      dostavaCasMin: 14,
    });
  });

  it("ustvari postavko dostave z DDV iz dostavnega artikla", () => {
    expect(ustvariDostavnoPostavko(artikel, 3.5, true)).toMatchObject({
      artikelId: 41,
      ime: "Dostava",
      cenaKos: 3.5,
      skupaj: 3.5,
      davek: 22,
      vrstaArtikla: "storitev",
    });
  });

  it("za dostavo doda čas naselja na pripravo, prevzem pa dodatnega časa nima", () => {
    const pripravljenost = new Date("2026-08-24T10:15:00.000Z");
    expect(izracunajPredvidenoDostavo(pripravljenost, 14)?.toISOString())
      .toBe("2026-08-24T10:29:00.000Z");
    expect(izracunajPredvidenoDostavo(pripravljenost, null)).toBeNull();
  });

  it("ob menjavi naselja izdela novo ceno za obstoječi dostavni artikel", () => {
    const prej = ustvariDostavnoPostavko(artikel, 3.5, true);
    const potem = ustvariDostavnoPostavko(artikel, 5, true);
    expect(prej.cenaKos).toBe(3.5);
    expect(potem.cenaKos).toBe(5);
    expect(potem.davek).toBe(22);
  });

  it("ceno storitve na kilometer pomnoži z oddaljenostjo samo pri ničelni ceni naselja", () => {
    expect(izracunajCenoDostave(0.7, 5)).toBe(3.5);
    expect(izracunajCenoDostave(0.79, 3.333)).toBe(2.63);
    expect(izracunajCenoDostave(0.7, 5, 4)).toBe(4);
  });
});