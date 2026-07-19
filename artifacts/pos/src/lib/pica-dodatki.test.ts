/**
 * Enota-testi za filtrirajPrivzeteDodatke.
 *
 * Pokritost:
 *  - izbrisan (ni v mapi) dodatek ne sme biti vključen v preAddSelectedDodatki
 *  - neaktiven (aktiven=false) dodatek ne sme biti vključen
 *  - artikel, ki ni jeDodatekZaPico, ne sme biti vključen
 *  - samo veljavni (obstoječi, aktivni, jeDodatekZaPico) dodatki se obdržijo
 *  - mešani seznam: veljavni in neveljavni ID-ji → vrne samo veljavne
 *  - prazen seznam ID-jev → vrne prazen seznam
 *  - prazen artikliMap → vrne prazen seznam
 */

import { describe, it, expect } from "vitest";
import { filtrirajPrivzeteDodatke, type DodatekMeta } from "./pica-dodatki";

function mapaIz(vnosi: [number, DodatekMeta][]): Map<number, DodatekMeta> {
  return new Map(vnosi);
}

describe("filtrirajPrivzeteDodatke", () => {
  describe("izbrisan dodatek", () => {
    it("ID, ki ne obstaja v mapi (izbrisan artikel), se ne vključi", () => {
      const artikliMap = mapaIz([]);
      const rezultat = filtrirajPrivzeteDodatke([101], artikliMap);
      expect(rezultat).toEqual([]);
    });

    it("mešan seznam: izbrisan ID se izpusti, obstoječ aktivni se ohrani", () => {
      const artikliMap = mapaIz([
        [200, { aktiven: true, jeDodatekZaPico: true }],
      ]);
      const rezultat = filtrirajPrivzeteDodatke([999, 200], artikliMap);
      expect(rezultat).toEqual([200]);
    });
  });

  describe("neaktiven dodatek", () => {
    it("aktiven=false → se izpusti", () => {
      const artikliMap = mapaIz([
        [10, { aktiven: false, jeDodatekZaPico: true }],
      ]);
      const rezultat = filtrirajPrivzeteDodatke([10], artikliMap);
      expect(rezultat).toEqual([]);
    });

    it("aktiven=undefined → se izpusti (ne velja kot aktiven)", () => {
      const artikliMap = mapaIz([
        [11, { jeDodatekZaPico: true }],
      ]);
      const rezultat = filtrirajPrivzeteDodatke([11], artikliMap);
      expect(rezultat).toEqual([]);
    });
  });

  describe("ni jeDodatekZaPico", () => {
    it("jeDodatekZaPico=false → se izpusti", () => {
      const artikliMap = mapaIz([
        [20, { aktiven: true, jeDodatekZaPico: false }],
      ]);
      const rezultat = filtrirajPrivzeteDodatke([20], artikliMap);
      expect(rezultat).toEqual([]);
    });

    it("jeDodatekZaPico=undefined → se izpusti", () => {
      const artikliMap = mapaIz([
        [21, { aktiven: true }],
      ]);
      const rezultat = filtrirajPrivzeteDodatke([21], artikliMap);
      expect(rezultat).toEqual([]);
    });
  });

  describe("veljavni dodatki", () => {
    it("aktiven=true in jeDodatekZaPico=true → se ohrani", () => {
      const artikliMap = mapaIz([
        [30, { aktiven: true, jeDodatekZaPico: true }],
      ]);
      const rezultat = filtrirajPrivzeteDodatke([30], artikliMap);
      expect(rezultat).toEqual([30]);
    });

    it("več veljavnih ID-jev → vsi se ohranijo", () => {
      const artikliMap = mapaIz([
        [31, { aktiven: true, jeDodatekZaPico: true }],
        [32, { aktiven: true, jeDodatekZaPico: true }],
        [33, { aktiven: true, jeDodatekZaPico: true }],
      ]);
      const rezultat = filtrirajPrivzeteDodatke([31, 32, 33], artikliMap);
      expect(rezultat).toEqual([31, 32, 33]);
    });
  });

  describe("mešani scenariji", () => {
    it("seznam z izbranim, neaktivnim in veljavnim → vrne samo veljavnega", () => {
      const artikliMap = mapaIz([
        [40, { aktiven: false, jeDodatekZaPico: true }],
        [41, { aktiven: true, jeDodatekZaPico: false }],
        [42, { aktiven: true, jeDodatekZaPico: true }],
      ]);
      const rezultat = filtrirajPrivzeteDodatke([999, 40, 41, 42], artikliMap);
      expect(rezultat).toEqual([42]);
    });

    it("ohranja vrstni red veljavnih ID-jev iz vhodnega seznama", () => {
      const artikliMap = mapaIz([
        [50, { aktiven: true, jeDodatekZaPico: true }],
        [51, { aktiven: true, jeDodatekZaPico: true }],
      ]);
      const rezultat = filtrirajPrivzeteDodatke([51, 50], artikliMap);
      expect(rezultat).toEqual([51, 50]);
    });
  });

  describe("robni primeri", () => {
    it("prazen seznam ID-jev → vrne prazen seznam", () => {
      const artikliMap = mapaIz([
        [60, { aktiven: true, jeDodatekZaPico: true }],
      ]);
      const rezultat = filtrirajPrivzeteDodatke([], artikliMap);
      expect(rezultat).toEqual([]);
    });

    it("prazen artikliMap → vsi ID-ji se izpustijo", () => {
      const artikliMap = mapaIz([]);
      const rezultat = filtrirajPrivzeteDodatke([70, 71, 72], artikliMap);
      expect(rezultat).toEqual([]);
    });
  });
});
