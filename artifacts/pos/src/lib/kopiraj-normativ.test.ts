/**
 * Enota-testi za logiko kopiranja normativa med artikli.
 *
 * Pokritost:
 *  - preslikajNormativIzVira: pretvori API normative v lokalni format
 *  - jeNormativPrazen: zazna, kdaj artikel nima normativa
 *
 * Ti testi pokrivajo jedro handleCopyFromArtikel v Menu.tsx:
 *  - izbira artikla z normativom → vrstice se nadomestijo
 *  - izbira artikla brez normativa → kopiranje se zavrne (jeNormativPrazen=true)
 */

import { describe, it, expect } from "vitest";
import type { Normativ } from "@workspace/api-client-react";
import { preslikajNormativIzVira, jeNormativPrazen } from "./kopiraj-normativ";

// ─── Testni podatki ───────────────────────────────────────────────────────────

const normativSMlekom: Normativ = {
  id: 1,
  artikelId: 10,
  vhodniArtikelId: 20,
  vhodniArtikelIme: "Mleko",
  enotaMere: "LTR",
  kolicina: 0.2,
  vrstniRed: 1,
};

const normativSMoko: Normativ = {
  id: 2,
  artikelId: 10,
  vhodniArtikelId: 21,
  vhodniArtikelIme: "Moka",
  enotaMere: "KGM",
  kolicina: 0.5,
  vrstniRed: 2,
};

const normativBrezImena: Normativ = {
  id: 3,
  artikelId: 10,
  vhodniArtikelId: 22,
  vhodniArtikelIme: "",
  enotaMere: null,
  kolicina: 1,
  vrstniRed: 3,
};

// ─── preslikajNormativIzVira ──────────────────────────────────────────────────

describe("preslikajNormativIzVira", () => {
  it("pretvori en normativ v NormativItem", () => {
    const rezultat = preslikajNormativIzVira([normativSMlekom]);

    expect(rezultat).toHaveLength(1);
    expect(rezultat[0]).toEqual({
      vhodniArtikelId: 20,
      kolicina: "0.2",
      ime: "Mleko",
    });
  });

  it("pretvori več normativov in ohrani vrstni red", () => {
    const rezultat = preslikajNormativIzVira([normativSMlekom, normativSMoko]);

    expect(rezultat).toHaveLength(2);
    expect(rezultat[0].vhodniArtikelId).toBe(20);
    expect(rezultat[1].vhodniArtikelId).toBe(21);
  });

  it("kolicina je vedno niz (string), ne število", () => {
    const rezultat = preslikajNormativIzVira([normativSMlekom]);

    expect(typeof rezultat[0].kolicina).toBe("string");
    expect(rezultat[0].kolicina).toBe("0.2");
  });

  it("celoštevilska kolicina je pretvorjena v niz", () => {
    const normativKelj: Normativ = {
      ...normativSMlekom,
      kolicina: 3,
      vhodniArtikelIme: "Jajce",
    };
    const rezultat = preslikajNormativIzVira([normativKelj]);

    expect(rezultat[0].kolicina).toBe("3");
  });

  it("prazno ime (prazen string) se preslika kot undefined", () => {
    const rezultat = preslikajNormativIzVira([normativBrezImena]);

    expect(rezultat[0].ime).toBeUndefined();
  });

  it("vrne prazno polje za prazen vhod", () => {
    const rezultat = preslikajNormativIzVira([]);

    expect(rezultat).toEqual([]);
  });

  it("vsebuje samo polja NormativItem (ne API polj kot id, artikelId, vrstniRed)", () => {
    const rezultat = preslikajNormativIzVira([normativSMlekom]);
    const kljuci = Object.keys(rezultat[0]);

    expect(kljuci).toContain("vhodniArtikelId");
    expect(kljuci).toContain("kolicina");
    expect(kljuci).not.toContain("id");
    expect(kljuci).not.toContain("artikelId");
    expect(kljuci).not.toContain("vrstniRed");
    expect(kljuci).not.toContain("enotaMere");
  });
});

// ─── jeNormativPrazen ─────────────────────────────────────────────────────────

describe("jeNormativPrazen", () => {
  it("vrne true za prazen seznam — artikel nima normativa, kopiranje se zavrne", () => {
    expect(jeNormativPrazen([])).toBe(true);
  });

  it("vrne true za null — API vrnil null", () => {
    expect(jeNormativPrazen(null)).toBe(true);
  });

  it("vrne true za undefined — API ni vrnil podatkov", () => {
    expect(jeNormativPrazen(undefined)).toBe(true);
  });

  it("vrne false, ko artikel ima normative — kopiranje je dovoljeno", () => {
    expect(jeNormativPrazen([normativSMlekom])).toBe(false);
  });

  it("vrne false za več normativov", () => {
    expect(jeNormativPrazen([normativSMlekom, normativSMoko])).toBe(false);
  });
});

// ─── Skupni tok: kopiranje iz vira ───────────────────────────────────────────

describe("tok kopiranja normativa", () => {
  it("artikel z normativom: vrstice se nadomestijo z normativom vira", () => {
    const viriNormativi = [normativSMlekom, normativSMoko];

    expect(jeNormativPrazen(viriNormativi)).toBe(false);
    const novoStanje = preslikajNormativIzVira(viriNormativi);

    expect(novoStanje).toHaveLength(2);
    expect(novoStanje[0]).toMatchObject({ vhodniArtikelId: 20, kolicina: "0.2", ime: "Mleko" });
    expect(novoStanje[1]).toMatchObject({ vhodniArtikelId: 21, kolicina: "0.5", ime: "Moka" });
  });

  it("artikel brez normativa: kopiranje se zavrne, obstoječe vrstice ostanejo nespremenjene", () => {
    const obstojeceVrstice = [
      { vhodniArtikelId: 99, kolicina: "1", ime: "Stara sestavina" },
    ];
    const viriNormativi: Normativ[] = [];

    const jebrazen = jeNormativPrazen(viriNormativi);
    expect(jebrazen).toBe(true);

    const novoStanje = jebrazen ? obstojeceVrstice : preslikajNormativIzVira(viriNormativi);
    expect(novoStanje).toEqual(obstojeceVrstice);
  });
});
