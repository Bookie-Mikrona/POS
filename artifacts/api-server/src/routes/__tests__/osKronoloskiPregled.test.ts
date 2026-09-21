/**
 * osKronoloskiPregled.test.ts — Testi za calcKronoloskiPregled (čista funkcija)
 *
 * Pokriva:
 *   1. Osnovno aktivacijo (seq=0, odpisana=0) — svež začetek
 *   2. Sveža dograditev (odpisana="0.00") — ne sme vplivati na PV
 *   3. Uvožena dograditev (odpisana>0) — MORA prispevati k PV (0000402 vzorec)
 *   4. 0000402 celoten scenarij: 4 doknjižbe, 2 uvoženi → neodpisana=257,99
 *   5. Obračunska vrstica po dograditvah — PV se pravilno nadaljuje
 *   6. Izločitev — NV/PV razknjižena
 */

import { describe, it, expect } from "vitest";
import {
  calcKronoloskiPregled,
  type KronoloskiDoknjizbaInput,
  type KronoloskiObracunInput,
} from "../osKronoloskiPregled";

// ─── Pomožni gradniki ─────────────────────────────────────────────────────────

function dok(
  seq: number,
  nabavna: string,
  odpisana: string,
  datumAktivacije: string,
  nazivVlaganja: string | null = null,
): KronoloskiDoknjizbaInput {
  return {
    seq,
    nabavnaVrednost: nabavna,
    odpisanaVrednost: odpisana,
    datumNabave: datumAktivacije,
    datumAktivacije,
    status: odpisana === nabavna ? "odpisano" : "v_uporabi",
    nazivVlaganja,
  };
}

function obr(leto: number, doMeseca: number, obracunano: string): KronoloskiObracunInput {
  return { leto, doMeseca, obracunano, status: "zakljucen" };
}

// ─── 1. Osnovna aktivacija (brez dograditev, sveže sredstvo) ─────────────────

describe("calcKronoloskiPregled — osnovna aktivacija", () => {
  it("seq=0 z odpisana=0 → PV=0, neodpisana=NV", () => {
    const r = calcKronoloskiPregled(
      [dok(0, "1469.00", "0.00", "2024-10-31")],
      [],
      null, null,
    );
    expect(r).toHaveLength(1);
    expect(r[0].opis).toBe("Aktivacija / nabava");
    expect(r[0].skupniPv).toBe("0.00");
    expect(r[0].neodpisana).toBe("1469.00");
  });

  it("seq=0 z odpisana>0 (uvoženo) → PV = odpisana, neodpisana = preostalo", () => {
    // Sredstvo uvoženo z NV=133051, odpisana=133051 → polno odpisano
    const r = calcKronoloskiPregled(
      [dok(0, "133051.00", "133051.00", "2010-01-01")],
      [],
      null, null,
    );
    expect(r).toHaveLength(1);
    expect(r[0].skupniPv).toBe("133051.00");
    expect(r[0].neodpisana).toBe("0.00");
  });
});

// ─── 2. Sveža dograditev (odpisana=0) — PV se ne sme spremeniti ──────────────

describe("calcKronoloskiPregled — sveža dograditev (odpisana=0)", () => {
  it("sveža dograditev z odpisana=0 ne vpliva na PV", () => {
    const r = calcKronoloskiPregled(
      [
        dok(0, "10000.00", "0.00", "2023-01-01"),
        dok(1, "2000.00",  "0.00", "2024-06-01", "Nova oprema"),
      ],
      [],
      null, null,
    );
    // seq=0: PV=0, ned=10000
    expect(r[0].skupniPv).toBe("0.00");
    expect(r[0].neodpisana).toBe("10000.00");
    // seq=1 dograditev: PV ostane 0 (odpisana=0 → +0), ned=12000
    expect(r[1].skupniPv).toBe("0.00");
    expect(r[1].neodpisana).toBe("12000.00");
  });
});

// ─── 3. Uvožena dograditev (odpisana>0) — mora prispevati k PV ───────────────

describe("calcKronoloskiPregled — uvožena dograditev (odpisana>0)", () => {
  it("uvožena dograditev z odpisana>0 pravilno prispeva k PV", () => {
    const r = calcKronoloskiPregled(
      [
        dok(0, "100000.00", "80000.00", "2015-01-01"),   // neodp=20000
        dok(1, "5000.00",   "3000.00",  "2018-01-01"),   // uvožena: neodp=2000
      ],
      [],
      null, null,
    );
    // seq=0: PV=80000, ned=20000
    expect(r[0].skupniPv).toBe("80000.00");
    expect(r[0].neodpisana).toBe("20000.00");
    // seq=1: PV=80000+3000=83000, ned=105000-83000=22000
    expect(r[1].skupniPv).toBe("83000.00");
    expect(r[1].neodpisana).toBe("22000.00");
  });

  it("uvožena polno odpisana dograditev → neodpisana ostane enaka (ne raste)", () => {
    const r = calcKronoloskiPregled(
      [
        dok(0, "100000.00", "80000.00", "2015-01-01"),   // ned=20000
        dok(1, "17177.97",  "17177.97", "2010-12-31"),   // polno odpisana → ned ne sme rasti
      ],
      [],
      null, null,
    );
    // seq=1: PV=80000+17177.97=97177.97, NV=117177.97, ned=117177.97-97177.97=20000
    expect(r[1].skupniPv).toBe("97177.97");
    expect(r[1].neodpisana).toBe("20000.00");
  });
});

// ─── 4. Celoten scenarij 0000402 ─────────────────────────────────────────────

describe("calcKronoloskiPregled — 0000402 realni scenarij (4 doknjižbe)", () => {
  // seq0: NV=133051, odpisana=133051 (polno)
  // seq1: NV=17177.97, odpisana=17177.97 (polno)
  // seq2: NV=1036.82, odpisana=959.06 (delno)
  // seq3: NV=1441.82, odpisana=1261.59 (delno)
  const doknjizbe: KronoloskiDoknjizbaInput[] = [
    dok(0, "133051.00", "133051.00", "2010-01-01"),
    dok(1, "17177.97",  "17177.97",  "2010-12-31"),
    dok(2, "1036.82",   "959.06",    "2011-12-31"),
    dok(3, "1441.82",   "1261.59",   "2012-06-30"),
  ];

  it("vsaka dograditev prispeva odpisano k PV (ne le seq=0)", () => {
    const r = calcKronoloskiPregled(doknjizbe, [], null, null);
    expect(r).toHaveLength(4);

    // seq=0: aktivacija — NV=133051, PV=133051, ned=0
    expect(r[0].skupniPv).toBe("133051.00");
    expect(r[0].neodpisana).toBe("0.00");

    // seq=1: PV += 17177.97 → 150228.97, NV=150228.97, ned=0
    expect(r[1].skupniPv).toBe("150228.97");
    expect(r[1].neodpisana).toBe("0.00");

    // seq=2: PV += 959.06 → 151188.03, NV=151265.79, ned=77.76
    expect(r[2].skupniPv).toBe("151188.03");
    expect(r[2].neodpisana).toBe("77.76");

    // seq=3: PV += 1261.59 → 152449.62, NV=152707.61, ned=257.99
    expect(r[3].skupniPv).toBe("152449.62");
    expect(r[3].neodpisana).toBe("257.99");  // NE 19656.61
  });

  it("sedanja vrednost po vseh dograditvah = 257,99 (ne 19.656,61)", () => {
    const r = calcKronoloskiPregled(doknjizbe, [], null, null);
    const zadnja = r[r.length - 1];
    expect(zadnja.neodpisana).toBe("257.99");
  });

  it("spreadNo NV na koncu = 152707.61", () => {
    const r = calcKronoloskiPregled(doknjizbe, [], null, null);
    // Preverimo skupno NV (zadnja vrstica ne kaže spremembo NV, preverimo s seštevanjem)
    const skupnaNv = doknjizbe
      .reduce((s, d) => s + parseFloat(d.nabavnaVrednost), 0);
    expect(skupnaNv.toFixed(2)).toBe("152707.61");
    expect(r[r.length - 1].skupniPv).toBe("152449.62");
  });
});

// ─── 5. Obračunska vrstica po uvoženih dograditvah ────────────────────────────

describe("calcKronoloskiPregled — obračun po uvoženih dograditvah", () => {
  it("obračun se prišteje k PV pravilno po uvoženem začetnem stanju", () => {
    // 2 uvoženi doknjizbi + 1 obračun 2025
    const r = calcKronoloskiPregled(
      [
        dok(0, "10000.00", "8000.00", "2020-01-01"),  // ned=2000
        dok(1, "2000.00",  "1500.00", "2021-06-01"),  // uvož: ned=500
      ],
      [obr(2025, 12, "500.00")],
      null, null,
    );
    // Vrstice: seq=0, seq=1, obračun 2025
    expect(r).toHaveLength(3);

    // seq=0: PV=8000, ned=2000
    expect(r[0].skupniPv).toBe("8000.00");
    expect(r[0].neodpisana).toBe("2000.00");

    // seq=1: PV=9500, NV=12000, ned=2500
    expect(r[1].skupniPv).toBe("9500.00");
    expect(r[1].neodpisana).toBe("2500.00");

    // Obračun 2025 AM=500: PV=10000, ned=2000
    expect(r[2].obracunanaAm).toBe("500.00");
    expect(r[2].skupniPv).toBe("10000.00");
    expect(r[2].neodpisana).toBe("2000.00");
  });
});

// ─── 6. Izločitev ─────────────────────────────────────────────────────────────

describe("calcKronoloskiPregled — izločitev", () => {
  it("izločitev na koncu → ned=0, skupniPv=0", () => {
    const r = calcKronoloskiPregled(
      [dok(0, "5000.00", "3000.00", "2020-01-01")],
      [],
      "2024-12-31",
      "Prodaja",
    );
    expect(r).toHaveLength(2);
    expect(r[1].opis).toContain("Izločitev");
    expect(r[1].neodpisana).toBe("0.00");
    expect(r[1].skupniPv).toBe("0.00");
  });
});
