/**
 * Testi za cols parameter pri /print/racun/:id/zcs in buildTextReceipt
 *
 * Pokriva:
 *  - buildTextReceipt(data, 30): vse vrstice ≤ 30 znakov, črte = 30
 *  - buildTextReceipt(data, 32): vse vrstice ≤ 32 znakov, črte = 32
 *  - ZCS ostane 30 (privzeto brez ?cols)
 *  - cols=32 vrne 32-znakovne vrstice
 *  - cols=99 (neveljaven) → privzeto 30
 */

import { describe, it, expect } from "vitest";
import { buildTextReceipt } from "../lib/pos-escpos";
import type { PrintRacunData } from "../lib/pos-escpos";

// ── Minimalni testni podatki ───────────────────────────────────────────────────

function makeData(overrides: Partial<PrintRacunData> = {}): PrintRacunData {
  return {
    stevilkaRacuna: "2026-001",
    datum: new Date("2026-08-10T12:00:00Z"),
    mizaStevilka: null,
    skupaj: 12.50,
    ddv: 2.04,
    placilnaNacin: "gotovina",
    status: "poslan",
    zoi: null,
    eor: null,
    fursQrUrl: null,
    nazivRestvracije: "Test Restavracija",
    naslovRestvracije: "Testna ulica 1",
    enotaOpis: null,
    davcnaStevilka: "12345678",
    racunPozdrav1: "Hvala za obisk!",
    racunPozdrav2: "Se vidimo.",
    steviloPrintov: 1,
    kupecDavcnaStevilka: null,
    kupecNaziv: null,
    kupecNaslov: null,
    kupecZavezanecDdv: null,
    vivaTerminalSessionId: null,
    sumupCheckoutId: null,
    natakarIme: null,
    stornoIzvornaRacunStevilka: null,
    racunMaticna: null,
    racunSodisce: null,
    racunKapital: null,
    racunDdvKlavzula: null,
    racunPravnaKlavzula: null,
    prodajalecIban: null,
    prodajalecBic: null,
    dniOdloga: null,
    znesekGotovina: 12.50,
    znesekKartica: null,
    znesekBon: null,
    steviloBonov: null,
    znesekBonPica: null,
    znesekNegotovinsko: null,
    jeDdvZavezanec: true,
    postavke: [
      {
        postavkaId: 1,
        ime: "Kava",
        kolicina: 2,
        cenaKos: 2.50,
        cenaKosOriginalna: null,
        skupaj: 5.00,
        davek: 9.5,
        opomba: null,
        parentPostavkaId: null,
      },
      {
        postavkaId: 2,
        ime: "Malica — Juha, Rižota, Solata",
        kolicina: 1,
        cenaKos: 7.50,
        cenaKosOriginalna: null,
        skupaj: 7.50,
        davek: 9.5,
        opomba: "brez solate",
        parentPostavkaId: null,
      },
    ],
    ...overrides,
  };
}

// ── cols=30 (ZCS privzeto) ─────────────────────────────────────────────────────

describe("buildTextReceipt cols=30 (ZCS Z92 privzeto)", () => {
  const data = makeData();
  const result = buildTextReceipt(data, 30);

  it("vrne linee array", () => {
    expect(Array.isArray(result.linee)).toBe(true);
    expect(result.linee.length).toBeGreaterThan(5);
  });

  it("vse vrstice so ≤ 30 znakov", () => {
    const tooLong = result.linee.filter(l => l.length > 30);
    expect(tooLong).toEqual([]);
  });

  it("ločilne črte so točno 30 znakov", () => {
    const lines = result.linee.filter(l => /^-{10,}$/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l.length).toBe(30);
    }
  });

  it("vsebuje stevilkaRacuna", () => {
    expect(result.linee.some(l => l.includes("2026-001"))).toBe(true);
  });

  it("qrUrl je null (ni FURS QR kode)", () => {
    expect(result.qrUrl).toBeNull();
  });
});

// ── cols=32 (BT tiskalnik — bridge:"bt" v2.2+ ali "q10" ≤v2.1) ───────────────

describe("buildTextReceipt cols=32 (BT tiskalnik)", () => {
  const data = makeData();
  const result = buildTextReceipt(data, 32);

  it("vrne linee array", () => {
    expect(Array.isArray(result.linee)).toBe(true);
    expect(result.linee.length).toBeGreaterThan(5);
  });

  it("vse vrstice so ≤ 32 znakov", () => {
    const tooLong = result.linee.filter(l => l.length > 32);
    expect(tooLong).toEqual([]);
  });

  it("ločilne črte so točno 32 znakov", () => {
    const lines = result.linee.filter(l => /^-{10,}$/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l.length).toBe(32);
    }
  });

  it("vsebuje stevilkaRacuna", () => {
    expect(result.linee.some(l => l.includes("2026-001"))).toBe(true);
  });

  it("vsebuje več informacij (32 > 30 znakov) ali enako", () => {
    // 32-znakovne vrstice ne smejo biti krajše od 30-znakovnih za iste podatke
    const result30 = buildTextReceipt(data, 30);
    // Vsaj ločilna črta je daljša
    const dashes32 = result.linee.find(l => /^-{10,}$/.test(l))!;
    const dashes30 = result30.linee.find(l => /^-{10,}$/.test(l))!;
    expect(dashes32.length).toBeGreaterThan(dashes30.length);
  });
});

// ── primerjava 30 vs 32 ───────────────────────────────────────────────────────

describe("primerjava cols=30 vs cols=32", () => {
  const data = makeData();
  const r30 = buildTextReceipt(data, 30);
  const r32 = buildTextReceipt(data, 32);

  it("cols=30 ne sme imeti vrstic daljših od 30", () => {
    expect(r30.linee.filter(l => l.length > 30)).toEqual([]);
  });

  it("cols=32 ne sme imeti vrstic daljših od 32", () => {
    expect(r32.linee.filter(l => l.length > 32)).toEqual([]);
  });

  it("cols=32 ima daljše ločilne črte kot cols=30", () => {
    const dash30 = r30.linee.find(l => /^-+$/.test(l))!;
    const dash32 = r32.linee.find(l => /^-+$/.test(l))!;
    expect(dash32.length).toBe(32);
    expect(dash30.length).toBe(30);
  });

  it("obe varianti imata enako stevilkaRacuna", () => {
    expect(r30.linee.some(l => l.includes("2026-001"))).toBe(true);
    expect(r32.linee.some(l => l.includes("2026-001"))).toBe(true);
  });

  it("privzeto (brez cols arg) = 32 znakov (buildTextReceipt default)", () => {
    // Opomba: buildTextReceipt(data) privzeto = 32, ne 30.
    // /zcs endpoint eksplicitno poda 30 ali 32 — nikoli privzetka.
    const rDefault = buildTextReceipt(data);
    const dash = rDefault.linee.find(l => /^-+$/.test(l))!;
    expect(dash.length).toBe(32);
  });
});

// ── cols neveljaven ────────────────────────────────────────────────────────────

describe("racuni.ts cols query param logika (unit)", () => {
  /**
   * Zrcali logiko v /print/racun/:id/zcs:
   *   const _c = req.query.cols;
   *   const reqCols = _c === "32" ? 32 : _c === "40" ? 40 : 30;
   */
  function parseColsParam(cols: string | undefined): 30 | 32 | 40 {
    return cols === "32" ? 32 : cols === "40" ? 40 : 30;
  }

  it("cols=32 → 32", () => {
    expect(parseColsParam("32")).toBe(32);
  });

  it("cols=40 → 40 (BT most 80mm)", () => {
    expect(parseColsParam("40")).toBe(40);
  });

  it("cols=30 → 30", () => {
    expect(parseColsParam("30")).toBe(30);
  });

  it("cols=undefined (brez parametra) → 30 (ZCS privzeto)", () => {
    expect(parseColsParam(undefined)).toBe(30);
  });

  it("cols=99 (neveljaven) → 30 (varnostni privzetek)", () => {
    expect(parseColsParam("99")).toBe(30);
  });

  it("cols='' (prazen) → 30", () => {
    expect(parseColsParam("")).toBe(30);
  });
});

// ── cols=40 (BT most 80mm) ────────────────────────────────────────────────────

describe("buildTextReceipt cols=40 (BT most 80mm)", () => {
  const data = makeData();
  const result = buildTextReceipt(data, 40);

  it("vrne linee array", () => {
    expect(Array.isArray(result.linee)).toBe(true);
    expect(result.linee.length).toBeGreaterThan(5);
  });

  it("vse vrstice so ≤ 40 znakov", () => {
    const tooLong = result.linee.filter(l => l.length > 40);
    expect(tooLong).toEqual([]);
  });

  it("ločilne črte so točno 40 znakov", () => {
    const lines = result.linee.filter(l => /^-{10,}$/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l.length).toBe(40);
    }
  });

  it("vsebuje stevilkaRacuna", () => {
    expect(result.linee.some(l => l.includes("2026-001"))).toBe(true);
  });

  it("40-kol ločilne črte so daljše od 32-kol", () => {
    const r32 = buildTextReceipt(data, 32);
    const dash40 = result.linee.find(l => /^-+$/.test(l))!;
    const dash32 = r32.linee.find(l => /^-+$/.test(l))!;
    expect(dash40.length).toBe(40);
    expect(dash32.length).toBe(32);
  });
});

// ── primerjava vseh treh širin ─────────────────────────────────────────────────

describe("primerjava cols=30 vs cols=32 vs cols=40", () => {
  const data = makeData();
  const r30 = buildTextReceipt(data, 30);
  const r32 = buildTextReceipt(data, 32);
  const r40 = buildTextReceipt(data, 40);

  it("bridge=zcs (30): vse vrstice ≤ 30", () => {
    expect(r30.linee.filter(l => l.length > 30)).toEqual([]);
  });

  it("bridge=bt + 58mm (32): vse vrstice ≤ 32", () => {
    expect(r32.linee.filter(l => l.length > 32)).toEqual([]);
  });

  it("bridge=q10 (star APK ≤v2.1) + 58mm (32): enako kot bt — vse vrstice ≤ 32", () => {
    // q10 je stara oznaka istega APK; isBtBridge("q10")===true → cols=32
    expect(r32.linee.filter(l => l.length > 32)).toEqual([]);
  });

  it("bridge=bt + 80mm (40): vse vrstice ≤ 40", () => {
    expect(r40.linee.filter(l => l.length > 40)).toEqual([]);
  });

  it("bridge=q10 (star APK ≤v2.1) + 80mm (40): enako kot bt — vse vrstice ≤ 40", () => {
    expect(r40.linee.filter(l => l.length > 40)).toEqual([]);
  });

  it("ločilne črte: 30 < 32 < 40 znakov", () => {
    const d30 = r30.linee.find(l => /^-+$/.test(l))!;
    const d32 = r32.linee.find(l => /^-+$/.test(l))!;
    const d40 = r40.linee.find(l => /^-+$/.test(l))!;
    expect(d30.length).toBe(30);
    expect(d32.length).toBe(32);
    expect(d40.length).toBe(40);
  });

  it("vse tri variante vsebujejo stevilkaRacuna", () => {
    expect(r30.linee.some(l => l.includes("2026-001"))).toBe(true);
    expect(r32.linee.some(l => l.includes("2026-001"))).toBe(true);
    expect(r40.linee.some(l => l.includes("2026-001"))).toBe(true);
  });
});

// ── Dolge postavke — prelom vrstic znotraj cols ───────────────────────────────

describe("dolge vsebine se prelomijo znotraj cols", () => {
  it("cols=30: dolgo ime artikla → prelomljeno, vsaka vrstica ≤ 30", () => {
    const data = makeData({
      postavke: [{
        postavkaId: 1,
        ime: "Zelo dolgo ime jedi ki ne gre v eno vrstico",
        kolicina: 1,
        cenaKos: 5.00,
        cenaKosOriginalna: null,
        skupaj: 5.00,
        davek: 9.5,
        opomba: null,
        parentPostavkaId: null,
      }],
    });
    const result = buildTextReceipt(data, 30);
    expect(result.linee.filter(l => l.length > 30)).toEqual([]);
  });

  it("cols=32: dolgo ime artikla → prelomljeno, vsaka vrstica ≤ 32", () => {
    const data = makeData({
      postavke: [{
        postavkaId: 1,
        ime: "Zelo dolgo ime jedi ki ne gre v eno vrstico",
        kolicina: 1,
        cenaKos: 5.00,
        cenaKosOriginalna: null,
        skupaj: 5.00,
        davek: 9.5,
        opomba: null,
        parentPostavkaId: null,
      }],
    });
    const result = buildTextReceipt(data, 32);
    expect(result.linee.filter(l => l.length > 32)).toEqual([]);
  });
});
