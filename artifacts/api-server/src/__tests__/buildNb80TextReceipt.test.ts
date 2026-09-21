/**
 * Preverja buildNb80TextReceipt (80mm/40-kolončni NB80 format) in
 * buildTextReceipt z doubleWidthHalf (NB80 58mm pot).
 *
 * NB80 APK v1.2+: "H" = setTextScaleY(2) + scaleX(1) → dvojna VIŠINA, enojna širina.
 * Vrstici RAČUN in SKUPAJ sta zato "H" na polnih cols/COLS znakov (ni več HALF delitve).
 * BT slikovni most: "H" = prav tako dvojna višina v sliki, enojna širina — identična logika.
 */

import { describe, it, expect } from "vitest";
import { buildNb80TextReceipt } from "../lib/pos-escpos.js";
import type { PrintRacunData } from "../lib/pos-escpos.js";

const BASE: PrintRacunData = {
  stevilkaRacuna: "2026-R-0001",
  datum: new Date("2026-08-12T10:00:00Z"),
  mizaStevilka: null,
  skupaj: 49.80,
  ddv: 4.35,
  placilnaNacin: "gotovina",
  status: "poslan",
  zoi: null,
  eor: null,
  fursQrUrl: null,
  nazivRestvracije: "Test Restavracija",
  naslovRestvracije: "Testna ul. 1",
  enotaOpis: null,
  davcnaStevilka: "12345678",
  racunPozdrav1: "Hvala!",
  racunPozdrav2: "",
  steviloPrintov: 1,
  kupecNaziv: null,
  kupecDavcnaStevilka: null,
  kupecNaslov: null,
  kupecZavezanecDdv: false,
  stornoIzvornaRacunStevilka: null,
  prodajalecIban: null,
  prodajalecBic: null,
  vivaTerminalSessionId: null,
  steviloBonov: null,
  postavke: [
    {
      ime: "Pivo",
      opomba: null,
      kolicina: 2,
      cenaKos: 3.50,
      cenaKosOriginalna: null,
      skupaj: 7.00,
      davek: 9.5,
      parentPostavkaId: null,
      postavkaId: 1,
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Vrstici "H" — polnih COLS=40 znakov (enojna širina, dvojna višina)
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildNb80TextReceipt — 'H' vrstici na polnih COLS=40 znakov", () => {

  it("vrstica ŠT. RAČUNA je 'H' in točno 40 znakov", () => {
    const { linee, formati } = buildNb80TextReceipt(BASE);
    const idx = linee.findIndex((l) => l.includes(BASE.stevilkaRacuna));
    expect(idx).toBeGreaterThan(-1);
    expect(formati[idx]).toBe("H");
    expect(linee[idx].length).toBe(40);
  });

  it("vrstica ŠT. RAČUNA vsebuje stevilkaRacuna in oznako 'Račun:'", () => {
    const { linee } = buildNb80TextReceipt(BASE);
    const l = linee.find((l) => l.includes(BASE.stevilkaRacuna))!;
    expect(l).toContain("Račun:");
    expect(l).toContain(BASE.stevilkaRacuna);
  });

  it("vrstica SKUPAJ je 'H' in točno 40 znakov", () => {
    const { linee, formati } = buildNb80TextReceipt(BASE);
    const idx = linee.findIndex((l) => l.includes("SKUPAJ:"));
    expect(idx).toBeGreaterThan(-1);
    expect(formati[idx]).toBe("H");
    expect(linee[idx].length).toBe(40);
  });

  it("vrstica SKUPAJ vsebuje znesek z vejico in brez presledka pred €", () => {
    const { linee } = buildNb80TextReceipt(BASE);
    const l = linee.find((l) => l.includes("SKUPAJ:"))!;
    // vejica kot decimalni ločnik, brez presledka pred € (fmt2H format)
    expect(l).toContain(",");
    expect(l).toContain("€");
    expect(l).not.toContain(" €");
    expect(l).toContain("49,80€");
  });

  it("RAČUN in SKUPAJ sta 'H' in polnih 40 znakov (enojna širina, brez odreza)", () => {
    const { linee, formati } = buildNb80TextReceipt(BASE);
    const racunIdx  = linee.findIndex((l) => l.includes(BASE.stevilkaRacuna));
    const skupajIdx = linee.findIndex((l) => l.includes("SKUPAJ:"));
    expect(formati[racunIdx]).toBe("H");
    expect(formati[skupajIdx]).toBe("H");
    expect(linee[racunIdx].length).toBe(40);
    expect(linee[skupajIdx].length).toBe(40);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Samo dve "H" vrstici — glava in ostale so "N"
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildNb80TextReceipt — samo ŠT. RAČUNA in SKUPAJ sta 'H'", () => {

  it("glava (naziv, naslov, davčna) so 'N' — ne 'H'", () => {
    const { linee, formati } = buildNb80TextReceipt(BASE);
    const nazivIdx = linee.findIndex((l) => l.includes("Test Restavracija"));
    expect(nazivIdx).toBeGreaterThan(-1);
    expect(formati[nazivIdx]).toBe("N");

    const naslovIdx = linee.findIndex((l) => l.includes("Testna ul."));
    if (naslovIdx > -1) expect(formati[naslovIdx]).toBe("N");
  });

  it("datumski vrstici sta 'N'", () => {
    const { linee, formati } = buildNb80TextReceipt(BASE);
    const datumIdx = linee.findIndex((l) => l.includes("Datum:") && !l.includes("opr."));
    expect(datumIdx).toBeGreaterThan(-1);
    expect(formati[datumIdx]).toBe("N");
  });

  it("skupno število 'H' vrstic = 2 (samo ŠT. RAČUNA + SKUPAJ)", () => {
    const { formati } = buildNb80TextReceipt(BASE);
    const hVrstice = formati.filter((f) => f === "H");
    expect(hVrstice.length).toBe(2);
  });

  it("ni nobene 'B' vrstice (krepko 1× ni več v 80mm izhodu)", () => {
    const { formati } = buildNb80TextReceipt(BASE);
    expect(formati.filter((f) => f === "B").length).toBe(0);
  });

  it("artikelska vrstica je 'N'", () => {
    const { linee, formati } = buildNb80TextReceipt(BASE);
    const pivIdx = linee.findIndex((l) => l.includes("Pivo"));
    expect(pivIdx).toBeGreaterThan(-1);
    expect(formati[pivIdx]).toBe("N");
  });

  it("ZOI/EOR vrstice so 'N' (ne 'H')", () => {
    const zoi = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
    const { linee, formati } = buildNb80TextReceipt({ ...BASE, zoi });
    const zoiIdx = linee.findIndex((l) => l.startsWith("ZOI:"));
    expect(zoiIdx).toBeGreaterThan(-1);
    expect(formati[zoiIdx]).toBe("N");
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Ostale vrstice ostanejo na 40 znakov (1× širina)
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildNb80TextReceipt — 'N' vrstice ostanejo na 40 znakov", () => {

  it("ločilna črta (---) je točno 40 znakov", () => {
    const { linee } = buildNb80TextReceipt(BASE);
    const dash = linee.find((l) => l.startsWith("---"))!;
    expect(dash.length).toBe(40);
  });

  it("glava tabele artiklov je točno 40 znakov", () => {
    const { linee } = buildNb80TextReceipt(BASE);
    const glava = linee.find((l) => l.includes("Naziv") && l.includes("Skupaj"))!;
    expect(glava).toBeDefined();
    expect(glava.length).toBe(40);
  });

  it("artikelska vrstica z zneski je točno 40 znakov", () => {
    const { linee } = buildNb80TextReceipt(BASE);
    const pivot = linee.find((l) => l.includes("Pivo") && l.includes("€"))!;
    expect(pivot).toBeDefined();
    expect(pivot.length).toBe(40);
  });

  it("vrstica Osnova (brez DDV) je točno 40 znakov", () => {
    const { linee } = buildNb80TextReceipt({ ...BASE, jeDdvZavezanec: true } as any);
    const osnova = linee.find((l) => l.includes("Osnova"));
    if (osnova) expect(osnova.length).toBe(40);
  });

  it("formati[] in linee[] sta enako dolgi", () => {
    const { linee, formati } = buildNb80TextReceipt(BASE);
    expect(formati.length).toBe(linee.length);
  });

  it("formati[] vsebuje samo 'H', 'N' (brez 'B')", () => {
    const { formati } = buildNb80TextReceipt(BASE);
    for (const f of formati) expect(["H", "N"]).toContain(f);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. NB80 58mm pot — buildTextReceipt(30, doubleWidthHalf=true)
//    "H" vrstici na polnih cols=30 znakov (enojna širina, dvojna višina)
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildTextReceipt(30, true) — NB80 58mm: Račun H(dvoj.višina)/30 zn., SKUPAJ H/30 zn.", () => {
  // ── Račun: "H" (dvojna višina, enojna širina), polnih 30 znakov ──

  it("Račun: format='H' (dvojna višina — NB80 APK scaleY=2, scaleX=1)", async () => {
    const { buildTextReceipt } = await import("../lib/pos-escpos.js");
    const { linee, formati } = buildTextReceipt(BASE, 30, true);
    const idx = linee.findIndex((l) => l.includes(BASE.stevilkaRacuna));
    expect(idx).toBeGreaterThan(-1);
    expect(formati[idx]).toBe("H");
  });

  it("Račun: dolžina = točno cols=30 (polna širina, enojna x-os)", async () => {
    const { buildTextReceipt } = await import("../lib/pos-escpos.js");
    const { linee } = buildTextReceipt(BASE, 30, true);
    const l = linee.find((l) => l.includes(BASE.stevilkaRacuna))!;
    expect(l.length).toBe(30);
  });

  it("Račun: vsebuje 'Račun:' in celotno stevilkaRacuna (brez odreza)", async () => {
    const { buildTextReceipt } = await import("../lib/pos-escpos.js");
    const { linee } = buildTextReceipt(BASE, 30, true);
    const l = linee.find((l) => l.includes(BASE.stevilkaRacuna))!;
    expect(l).toContain("Račun:");
    expect(l).toContain(BASE.stevilkaRacuna);
  });

  it("Račun: številka ob desnem robu (desno poravnana)", async () => {
    const { buildTextReceipt } = await import("../lib/pos-escpos.js");
    const { linee } = buildTextReceipt(BASE, 30, true);
    const l = linee.find((l) => l.includes(BASE.stevilkaRacuna))!;
    expect(l.endsWith(BASE.stevilkaRacuna)).toBe(true);
  });

  it("Račun: dolga stevilkaRacuna → cela brez odreza (brez paddinga)", async () => {
    const { buildTextReceipt } = await import("../lib/pos-escpos.js");
    const dolgaStevilka = "PP001-B001-123456789012"; // > cols-"Račun:".length
    const { linee } = buildTextReceipt({ ...BASE, stevilkaRacuna: dolgaStevilka }, 30, true);
    const l = linee.find((l) => l.includes(dolgaStevilka))!;
    expect(l).toBeDefined();
    expect(l).toContain(dolgaStevilka);
  });

  // ── SKUPAJ: "H" (dvojna višina), polnih cols=30 znakov ──

  it("SKUPAJ: format='H' (dvojna višina — enojna širina, polnih 30)", async () => {
    const { buildTextReceipt } = await import("../lib/pos-escpos.js");
    const { linee, formati } = buildTextReceipt(BASE, 30, true);
    const idx = linee.findIndex((l) => l.includes("SKUPAJ:"));
    expect(idx).toBeGreaterThan(-1);
    expect(formati[idx]).toBe("H");
  });

  it("SKUPAJ: točno cols=30 znakov (polna širina, ni več HALF=15)", async () => {
    const { buildTextReceipt } = await import("../lib/pos-escpos.js");
    const { linee } = buildTextReceipt(BASE, 30, true);
    const l = linee.find((l) => l.includes("SKUPAJ:"))!;
    expect(l.length).toBe(30);
  });

  it("SKUPAJ: vsebuje znesek (faL format: pika, presledek pred €)", async () => {
    const { buildTextReceipt } = await import("../lib/pos-escpos.js");
    const { linee } = buildTextReceipt(BASE, 30, true);
    const l = linee.find((l) => l.includes("SKUPAJ:"))!;
    expect(l).toContain("49.80 €");
  });

  // ── Ostale vrstice nespremenjena ──

  it("artikelska vrstica: 30 znakov, 'N' (1×, nespremenjena)", async () => {
    const { buildTextReceipt } = await import("../lib/pos-escpos.js");
    const { linee, formati } = buildTextReceipt(BASE, 30, true);
    const idx = linee.findIndex((l) => l.includes("Pivo") && l.includes("€"));
    if (idx > -1) {
      expect(linee[idx].length).toBe(30);
      expect(formati[idx]).toBe("N");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. BT most poti — buildTextReceipt(32/40, supportsDoubleHeight=true)
//    "H" vrstice na polnih cols (BT most slika 2× iz polne vrstice)
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildTextReceipt supportsDoubleHeight=true — BT most poti", () => {
  it("cols=32, supportsDoubleHeight=true: Račun je 'H' in točno 32 znakov", async () => {
    const { buildTextReceipt } = await import("../lib/pos-escpos.js");
    const { linee, formati } = buildTextReceipt(BASE, 32, true);
    const idx = linee.findIndex((l) => l.includes(BASE.stevilkaRacuna));
    expect(idx).toBeGreaterThan(-1);
    expect(formati[idx]).toBe("H");
    expect(linee[idx].length).toBe(32);
  });

  it("cols=32, supportsDoubleHeight=true: SKUPAJ je 'H' in točno 32 znakov", async () => {
    const { buildTextReceipt } = await import("../lib/pos-escpos.js");
    const { linee, formati } = buildTextReceipt(BASE, 32, true);
    const idx = linee.findIndex((l) => l.includes("SKUPAJ:"));
    expect(idx).toBeGreaterThan(-1);
    expect(formati[idx]).toBe("H");
    expect(linee[idx].length).toBe(32);
  });

  it("cols=40, supportsDoubleHeight=true: Račun je 'H' in točno 40 znakov", async () => {
    const { buildTextReceipt } = await import("../lib/pos-escpos.js");
    const { linee, formati } = buildTextReceipt(BASE, 40, true);
    const idx = linee.findIndex((l) => l.includes(BASE.stevilkaRacuna));
    expect(idx).toBeGreaterThan(-1);
    expect(formati[idx]).toBe("H");
    expect(linee[idx].length).toBe(40);
  });

  it("cols=40, supportsDoubleHeight=true: SKUPAJ je 'H' in točno 40 znakov", async () => {
    const { buildTextReceipt } = await import("../lib/pos-escpos.js");
    const { linee, formati } = buildTextReceipt(BASE, 40, true);
    const idx = linee.findIndex((l) => l.includes("SKUPAJ:"));
    expect(idx).toBeGreaterThan(-1);
    expect(formati[idx]).toBe("H");
    expect(linee[idx].length).toBe(40);
  });

  // ZCS terminal (cols=30, supportsDoubleHeight=false): brez "H"
  it("cols=30, supportsDoubleHeight=false (ZCS): Račun je 'B' (ne 'H'), točno 30 znakov", async () => {
    const { buildTextReceipt } = await import("../lib/pos-escpos.js");
    const { linee, formati } = buildTextReceipt(BASE, 30, false);
    const idx = linee.findIndex((l) => l.includes(BASE.stevilkaRacuna));
    expect(idx).toBeGreaterThan(-1);
    expect(formati[idx]).toBe("B");
    expect(formati[idx]).not.toBe("H");
    expect(linee[idx].length).toBe(30);
  });

  it("cols=30, supportsDoubleHeight=false (ZCS): nobena vrstica ni 'H'", async () => {
    const { buildTextReceipt } = await import("../lib/pos-escpos.js");
    const { formati } = buildTextReceipt(BASE, 30, false);
    for (const f of formati) expect(f).not.toBe("H");
  });
});
