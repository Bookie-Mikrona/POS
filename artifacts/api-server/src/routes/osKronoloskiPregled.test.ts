/**
 * osKronoloskiPregled.test.ts
 *
 * Scenarij 0001454 (HP 470 G10 — realni primer po popravku odpisane):
 *   nabavna = 1469.00, odpisana = 0.00 (novo sredstvo, aktivacija 31.10.2024)
 *   obračun 2024 (do 12): 61.21 €  → 2 meseca (nov + dec)
 *   obračun 2025 (do 7):  214.23 € → 7 mesecev (jan–jul)
 *
 * Pričakovana veriga:
 *   31.10.2024 Aktivacija:  NV +1469, PV 0,      ned 1469,00
 *   31.12.2024 Letni (2):   AM 61,21, PV 61,21,  ned 1407,79
 *   31.07.2025 Medletni(7): AM 214,23,PV 275,44, ned 1193,56
 */

import { describe, it, expect } from "vitest";
import { calcKronoloskiPregled, calcNMesecev, type KronoloskiDoknjizbaInput, type KronoloskiObracunInput } from "./osKronoloskiPregled";

// ─── Pomožne tovarne ─────────────────────────────────────────────────────────

function dok(
  seq: number,
  nv: number,
  ov: number,
  datumAktivacije: string | null,
  datumNabave = "2024-01-01",
  naziv: string | null = null,
): KronoloskiDoknjizbaInput {
  return {
    seq,
    nabavnaVrednost: nv.toFixed(2),
    odpisanaVrednost: ov.toFixed(2),
    datumNabave,
    datumAktivacije,
    status: "v_uporabi",
    nazivVlaganja: naziv,
  };
}

function obr(
  leto: number,
  doMeseca: number,
  obracunano: number,
  status: "odprt" | "zakljucen" = "zakljucen",
): KronoloskiObracunInput {
  return { leto, doMeseca, obracunano: obracunano.toFixed(2), status };
}

// ─── calcNMesecev ─────────────────────────────────────────────────────────────

describe("calcNMesecev", () => {
  it("aktivacija v istem letu: konec oktobra → 2 meseca v letu do dec", () => {
    expect(calcNMesecev("2024-10-31", "2024-10-01", 2024, 12)).toBe(2);
  });

  it("aktivacija v istem letu: konec jan → 11 mesecev v letu do dec", () => {
    expect(calcNMesecev("2024-01-31", "2024-01-01", 2024, 12)).toBe(11);
  });

  it("aktivacija pred letom → polno obdobje (doMeseca)", () => {
    expect(calcNMesecev("2023-12-31", "2023-12-01", 2024, 12)).toBe(12);
    expect(calcNMesecev("2023-12-31", "2023-12-01", 2025, 7)).toBe(7);
  });

  it("medletni obračun 7 mes., aktivacija pred letom → 7", () => {
    expect(calcNMesecev("2024-10-31", "2024-10-01", 2025, 7)).toBe(7);
  });

  it("aktivacija v istem letu po zadnjem mesecu → 0", () => {
    expect(calcNMesecev("2024-12-31", "2024-12-01", 2024, 12)).toBe(0);
  });

  it("aktivacija po letu → 0", () => {
    expect(calcNMesecev("2026-01-31", "2026-01-01", 2024, 12)).toBe(0);
  });

  it("null aktivacija → fallback na datumNabave (okt nabava → 2 mes. nov+dec)", () => {
    // datumNabave "2024-10-01" → mesec 10 → firstAmortMonth 11 → N = 12−11+1 = 2
    expect(calcNMesecev(null, "2024-10-01", 2024, 12)).toBe(2);
  });
});

// ─── calcKronoloskiPregled — 0001454 scenarij ─────────────────────────────────

describe("calcKronoloskiPregled — 0001454 HP 470 G10", () => {
  const doknjizbe = [dok(0, 1469, 0, "2024-10-31", "2024-10-01")];
  const obracuni = [obr(2024, 12, 61.21), obr(2025, 7, 214.23, "odprt")];
  const dogodki = calcKronoloskiPregled(doknjizbe, obracuni);

  it("3 dogodki (aktivacija + 2 obračuna)", () => {
    expect(dogodki).toHaveLength(3);
  });

  it("1. aktivacija — datum, opis, NV, PV, neodpisana", () => {
    const ev = dogodki[0];
    expect(ev.datum).toBe("2024-10-31");
    expect(ev.opis).toBe("Aktivacija / nabava");
    expect(ev.spremembaNv).toBe("1469.00");
    expect(ev.obracunanaAm).toBe("0.00");
    expect(ev.skupniPv).toBe("0.00");
    expect(ev.neodpisana).toBe("1469.00");
  });

  it("2. letni obračun 2024 — datum, opis (2 mes.), AM, kumulativni PV, neodpisana", () => {
    const ev = dogodki[1];
    expect(ev.datum).toBe("2024-12-31");
    expect(ev.opis).toBe("Letni obračun (2 mes.)");
    expect(ev.obracunanaAm).toBe("61.21");
    expect(ev.skupniPv).toBe("61.21");
    expect(ev.neodpisana).toBe("1407.79");
    expect(ev.spremembaNv).toBe("0.00");
  });

  it("3. medletni obračun 2025 — datum, opis (7 mes.), AM, kumulativni PV, neodpisana", () => {
    const ev = dogodki[2];
    expect(ev.datum).toBe("2025-07-31");
    expect(ev.opis).toBe("Medletni obračun (7 mes.)");
    expect(ev.obracunanaAm).toBe("214.23");
    expect(ev.skupniPv).toBe("275.44");
    expect(ev.neodpisana).toBe("1193.56");
  });

  it("PV kumulativno raste: 0 → 61,21 → 275,44", () => {
    const pvji = dogodki.map((e) => parseFloat(e.skupniPv));
    expect(pvji[0]).toBe(0);
    expect(pvji[1]).toBeCloseTo(61.21, 2);
    expect(pvji[2]).toBeCloseTo(275.44, 2);
  });

  it("neodpisana pada: 1469 → 1407,79 → 1193,56", () => {
    const ned = dogodki.map((e) => parseFloat(e.neodpisana));
    expect(ned[0]).toBeCloseTo(1469, 2);
    expect(ned[1]).toBeCloseTo(1407.79, 2);
    expect(ned[2]).toBeCloseTo(1193.56, 2);
  });

  it("veriženje: neodpisana[i] = neodpisana[i-1] − AM (za obračune)", () => {
    const ned0 = parseFloat(dogodki[0].neodpisana);
    const am1 = parseFloat(dogodki[1].obracunanaAm);
    const ned1 = parseFloat(dogodki[1].neodpisana);
    expect(ned1).toBeCloseTo(ned0 - am1, 2);

    const am2 = parseFloat(dogodki[2].obracunanaAm);
    const ned2 = parseFloat(dogodki[2].neodpisana);
    expect(ned2).toBeCloseTo(ned1 - am2, 2);
  });
});

// ─── Staro sredstvo: uvožena odpisana > 0 ─────────────────────────────────────

describe("calcKronoloskiPregled — staro sredstvo z uvoženo odpisano", () => {
  // Aktivacija 2023-12-31; uvožena odpisana = 500 (akumulirana pred uvozom)
  const doknjizbe = [dok(0, 5000, 500, "2023-12-31", "2023-12-01")];
  const obracuni = [obr(2024, 12, 250)];
  const dogodki = calcKronoloskiPregled(doknjizbe, obracuni);

  it("aktivacija kaže NV 5000, PV 500 (uvožena odpisana)", () => {
    expect(dogodki[0].skupniPv).toBe("500.00");
    expect(dogodki[0].neodpisana).toBe("4500.00");
  });

  it("po obračunu: PV = 500 + 250 = 750, ned = 4250", () => {
    expect(dogodki[1].skupniPv).toBe("750.00");
    expect(dogodki[1].neodpisana).toBe("4250.00");
  });

  it("obračun 2024 (do 12, aktivacija 12/2023) → 12 mes.", () => {
    expect(dogodki[1].opis).toBe("Letni obračun (12 mes.)");
  });
});

// ─── Dograditev ───────────────────────────────────────────────────────────────

describe("calcKronoloskiPregled — dograditev", () => {
  const doknjizbe = [
    dok(0, 1000, 0, "2024-01-31", "2024-01-01"),
    dok(1, 500, 0, "2024-06-30", "2024-06-01", "Razširitev RAM"),
  ];
  const obracuni = [obr(2024, 12, 125)]; // skupaj NV = 1500, 250 na letnem
  const dogodki = calcKronoloskiPregled(doknjizbe, obracuni);

  it("3 dogodki: aktivacija + dograditev + obračun", () => {
    expect(dogodki).toHaveLength(3);
  });

  it("1. aktivacija: NV 1000, PV 0, ned 1000", () => {
    expect(dogodki[0].opis).toBe("Aktivacija / nabava");
    expect(dogodki[0].spremembaNv).toBe("1000.00");
    expect(dogodki[0].skupniPv).toBe("0.00");
    expect(dogodki[0].neodpisana).toBe("1000.00");
  });

  it("2. dograditev: NV +500, PV nespremenjen (0), ned 1500", () => {
    expect(dogodki[1].opis).toBe("Dograditev — Razširitev RAM");
    expect(dogodki[1].spremembaNv).toBe("500.00");
    expect(dogodki[1].skupniPv).toBe("0.00");
    expect(dogodki[1].neodpisana).toBe("1500.00");
  });

  it("3. obračun: AM 125, PV 125, ned 1375", () => {
    expect(dogodki[2].obracunanaAm).toBe("125.00");
    expect(dogodki[2].skupniPv).toBe("125.00");
    expect(dogodki[2].neodpisana).toBe("1375.00");
  });

  it("dograditev urejanje: dograditev (jun) pred obračunom (dec), oba 2024", () => {
    expect(dogodki[1].datum).toBe("2024-06-30");
    expect(dogodki[2].datum).toBe("2024-12-31");
    expect(dogodki[1].datum < dogodki[2].datum).toBe(true);
  });
});

// ─── Prazna vhoda ────────────────────────────────────────────────────────────

describe("calcKronoloskiPregled — robni primeri", () => {
  it("prazne doknjizbe → prazen seznam", () => {
    expect(calcKronoloskiPregled([], [])).toHaveLength(0);
  });

  it("doknjizbe brez obračunov → samo aktivacija", () => {
    const r = calcKronoloskiPregled(
      [dok(0, 1000, 0, "2024-05-31")],
      [],
    );
    expect(r).toHaveLength(1);
    expect(r[0].opis).toBe("Aktivacija / nabava");
  });

  it("neodpisana nikoli < 0 (prekomerna amortizacija)", () => {
    const r = calcKronoloskiPregled(
      [dok(0, 100, 0, "2024-01-31")],
      [obr(2024, 12, 150)], // več kot nabavna
    );
    expect(parseFloat(r[1].neodpisana)).toBeGreaterThanOrEqual(0);
    expect(r[1].neodpisana).toBe("0.00");
  });

  it("doslednost z calcKarticaVrednosti: zadnja neodpisana = sedanjaVrednostPoObracunu", () => {
    // 0001454 po popravku: zadnja neodpisana = 1193.56 (= sedanjaVrednostPoObracunu)
    const r = calcKronoloskiPregled(
      [dok(0, 1469, 0, "2024-10-31", "2024-10-01")],
      [obr(2024, 12, 61.21), obr(2025, 7, 214.23, "odprt")],
    );
    const zadnji = r[r.length - 1];
    expect(parseFloat(zadnji.neodpisana)).toBeCloseTo(1193.56, 2);
  });
});

// ─── Izločitev / odtujitev ─────────────────────────────────────────────────────

describe("calcKronoloskiPregled — izločitev (datumOdtujitve)", () => {
  it("doda zaključno vrstico Izločitev z negativno spremembo NV in ničelno neodpisano", () => {
    const r = calcKronoloskiPregled(
      [dok(0, 1469, 0, "2024-10-31", "2024-10-01")],
      [obr(2024, 12, 61.21)],
      "2025-04-15",
      "prodaja",
    );
    const zadnji = r[r.length - 1];
    expect(zadnji.opis).toContain("Izločitev");
    expect(zadnji.opis).toContain("prodaja");
    expect(zadnji.datum).toBe("2025-04-15");
    expect(zadnji.skupniPv).toBe("0.00");
    expect(zadnji.neodpisana).toBe("0.00");
    expect(parseFloat(zadnji.spremembaNv)).toBeLessThan(0); // negativna NV
  });

  it("negativna sprememba NV = − skupna tekoca NV (pred izlocitvijo)", () => {
    const r = calcKronoloskiPregled(
      [dok(0, 1469, 0, "2024-10-31", "2024-10-01")],
      [obr(2024, 12, 61.21)],
      "2025-04-15",
      "prodaja",
    );
    const zadnji = r[r.length - 1];
    // skupna NV = 1469.00 (ni novih dograditev), sprememba = -1469.00
    expect(parseFloat(zadnji.spremembaNv)).toBeCloseTo(-1469, 2);
  });

  it("brez razloga → opis vsebuje 'Izločitev'", () => {
    const r = calcKronoloskiPregled(
      [dok(0, 500, 0, "2024-01-31")],
      [],
      "2025-06-01",
      null,
    );
    const zadnji = r[r.length - 1];
    expect(zadnji.opis).toContain("Izločitev");
  });

  it("brez datumOdtujitve → seznam brez izločitvenega dogodka", () => {
    const r = calcKronoloskiPregled(
      [dok(0, 1469, 0, "2024-10-31", "2024-10-01")],
      [obr(2024, 12, 61.21)],
    );
    const zadnji = r[r.length - 1];
    expect(zadnji.opis).not.toContain("Izločitev");
  });
});
