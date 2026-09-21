import { describe, expect, it } from "vitest";

import {
  dolociAktivnostNovegaArtikla,
  normalizeAddedSugarForTaxCategory,
  parseProdajnaCena,
  predlagajVrstoEmbalaze,
  zagotoviVrstoEmbalazeVNazivu,
} from "./NovArtikelDialog";
import { predlagajArtikel } from "./naziv";

describe("NovArtikelDialog — dodan sladkor", () => {
  it("ob preklopu sladkane pijače na Pijača-jed odstrani oznako sladkorja", () => {
    expect(normalizeAddedSugarForTaxCategory("hot_beverage", true)).toBe(true);
    expect(normalizeAddedSugarForTaxCategory("cold_beverage", true)).toBe(true);
    expect(normalizeAddedSugarForTaxCategory("food_drink", true)).toBe(false);
  });
});

describe("NovArtikelDialog — naziv povratne embalaže", () => {
  it("iz OCR naziva Zaboj samodejno predlaga vrsto embalaže zaboj", () => {
    expect(predlagajVrstoEmbalaze("ZABOJ UNION 0,5L 20/1")).toBe("zaboj");
    expect(predlagajVrstoEmbalaze("Steklenica Union 0,5L")).toBe("steklenica");
  });

  it("že v začetnem OCR predlogu ohrani besedo Zaboj iz skeniranega naziva", () => {
    expect(predlagajArtikel("ZABOJ UNION 0,5L 20/1", "KOM", null).naziv)
      .toBe("Zaboj union 0,5l");
  });

  it("vrne besedo Zaboj v očiščen naziv zaboja", () => {
    expect(zagotoviVrstoEmbalazeVNazivu("Union 0,5l/20", "zaboj"))
      .toBe("Zaboj Union 0,5l/20");
  });

  it("ob spremembi vrste zamenja staro predpono in je ne podvoji", () => {
    expect(zagotoviVrstoEmbalazeVNazivu("Steklenica Laško 0,5l/20", "zaboj"))
      .toBe("Zaboj Laško 0,5l/20");
    expect(zagotoviVrstoEmbalazeVNazivu("Zaboj Union 0,33l/24", "zaboj"))
      .toBe("Zaboj Union 0,33l/24");
  });
});

describe("NovArtikelDialog — aktivnost nabavnega artikla", () => {
  it("nabavni in embalažni artikel takoj omogoči za uparjanje", () => {
    expect(dolociAktivnostNovegaArtikla("NABAVNI", false)).toBe(true);
    expect(dolociAktivnostNovegaArtikla("POVRATNA_EMBALAZA", false)).toBe(true);
  });

  it("pri prodajnem artiklu ohrani uporabnikovo izbiro", () => {
    expect(dolociAktivnostNovegaArtikla("NABAVNO_PRODAJNI", false)).toBe(false);
    expect(dolociAktivnostNovegaArtikla("NABAVNO_PRODAJNI", true)).toBe(true);
  });
});

describe("NovArtikelDialog — prodajna cena", () => {
  it("slovensko decimalno vejico pretvori v številčno ceno", () => {
    expect(parseProdajnaCena("3,50")).toBe(3.5);
    expect(parseProdajnaCena(" 1 234,56 ")).toBe(1234.56);
  });

  it("neveljavne vrednosti ne spremeni tiho v nič", () => {
    expect(parseProdajnaCena("")).toBeNull();
    expect(parseProdajnaCena("3,5,0")).toBeNull();
    expect(parseProdajnaCena("-1")).toBeNull();
  });
});