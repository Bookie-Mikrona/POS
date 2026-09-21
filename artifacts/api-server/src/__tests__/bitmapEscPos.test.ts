/**
 * Testi za pos-escpos-bitmap.ts — bitmap (slikovni) ESC/POS tiskanje
 *
 * Testira:
 * - calibrateFont: measureText potrdi, da 32 znakov (normal+bold) ≤ usableWidth
 * - isWhiteRow, buildCompressedBytes: ESC J za bele vrstice, trim, GS v 0 za barvne
 * - rasterToGsV0Blocks: xL/xH v BAJTIH, chunking
 * - buildEscPosReceiptBitmap: format, GS v 0 header, init, cut
 */
import { describe, it, expect } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  calibrateFont,
  isWhiteRow,
  buildCompressedBytes,
  rasterToGsV0Blocks,
  buildEscPosReceiptBitmap,
  type FontMetrics,
} from "../lib/pos-escpos-bitmap";
import { buildEscPosReceipt } from "../lib/pos-escpos";
import type { PrintRacunData } from "../lib/pos-escpos";

// ── Testni podatki ─────────────────────────────────────────────────────────────

const minimalData: PrintRacunData = {
  stevilkaRacuna: "12-0001-1",
  datum: new Date("2024-08-10T12:00:00Z"),
  mizaStevilka: null,
  skupaj: 10.00,
  ddv: 1.64,
  placilnaNacin: "gotovina",
  status: "poslan",
  zoi: null,
  eor: null,
  fursQrUrl: null,
  nazivRestvracije: "Test Restavracija",
  naslovRestvracije: "Testna 1, Ljubljana",
  enotaOpis: "POS 1",
  davcnaStevilka: "SI12345678",
  racunPozdrav1: "Hvala za obisk!",
  racunPozdrav2: "",
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
  znesekGotovina: 10.00,
  znesekKartica: null,
  znesekBon: null,
  steviloBonov: null,
  znesekBonPica: null,
  znesekNegotovinsko: null,
  jeDdvZavezanec: true,
  postavke: [
    {
      postavkaId: 1,
      ime: "Čaj mešani šumnik",
      kolicina: 2,
      cenaKos: 2.50,
      cenaKosOriginalna: null,
      skupaj: 5.00,
      davek: 9.5,
      opomba: null,
      parentPostavkaId: null,
    },
  ],
};

// ── calibrateFont ─────────────────────────────────────────────────────────────

describe("calibrateFont", () => {
  it("vrne FontMetrics z normalSize in headingSize (58mm, 32 cols)", () => {
    const m = calibrateFont(384, 32);
    expect(m.normalSize).toBeGreaterThan(0);
    expect(m.headingSize).toBeGreaterThanOrEqual(m.normalSize);
    expect(m.lineHeightNormal).toBeGreaterThan(m.normalSize);
    expect(m.lineHeightHeading).toBeGreaterThanOrEqual(m.lineHeightNormal);
    expect(m.marginX).toBe(2);
    expect(m.usableWidth).toBe(380); // 384 - 2*2
  });

  it("normalSize je v razumnem območju (8–28 px)", () => {
    const m = calibrateFont(384, 32);
    expect(m.normalSize).toBeGreaterThanOrEqual(8);
    expect(m.normalSize).toBeLessThanOrEqual(28);
  });

  it("32 znakov bold pri normalSize ≤ usableWidth", () => {
    const m = calibrateFont(384, 32);
    const cal = createCanvas(384, 50);
    const ctx = cal.getContext("2d");
    ctx.font = `bold ${m.normalSize}px "ReceiptMono"`;
    const w = ctx.measureText("M".repeat(32)).width;
    expect(Math.ceil(w)).toBeLessThanOrEqual(m.usableWidth);
  });

  it("32 znakov bold pri headingSize ≤ usableWidth", () => {
    const m = calibrateFont(384, 32);
    const cal = createCanvas(384, 50);
    const ctx = cal.getContext("2d");
    ctx.font = `bold ${m.headingSize}px "ReceiptMono"`;
    const w = ctx.measureText("M".repeat(32)).width;
    expect(Math.ceil(w)).toBeLessThanOrEqual(m.usableWidth);
  });

  it("headingSize ≥ normalSize (poudarjene vrstice so enako ali večje)", () => {
    const m = calibrateFont(384, 32);
    expect(m.headingSize).toBeGreaterThanOrEqual(m.normalSize);
  });

  it("80mm (512 px, 40 cols) — 40 znakov bold ≤ usableWidth", () => {
    const m = calibrateFont(512, 40);
    expect(m.usableWidth).toBe(508);
    const cal = createCanvas(512, 50);
    const ctx = cal.getContext("2d");
    ctx.font = `bold ${m.normalSize}px "ReceiptMono"`;
    const w = ctx.measureText("M".repeat(40)).width;
    expect(Math.ceil(w)).toBeLessThanOrEqual(m.usableWidth);
  });

  it("referenčni niz čšž€ (32 znakov) pri normalSize ≤ usableWidth", () => {
    const m = calibrateFont(384, 32);
    const ref32 = "SKUPAJ           čšž€    12,34 €"; // 32 znakov
    expect(ref32.length).toBe(32);
    const cal = createCanvas(384, 50);
    const ctx = cal.getContext("2d");
    ctx.font = `bold ${m.normalSize}px "ReceiptMono"`;
    const w = ctx.measureText(ref32).width;
    expect(Math.ceil(w)).toBeLessThanOrEqual(m.usableWidth);
  });

  it("32-znakovni bold niz ne preseže 384px skupaj z robom", () => {
    const m = calibrateFont(384, 32);
    const cal = createCanvas(384, 50);
    const ctx = cal.getContext("2d");
    ctx.font = `bold ${m.normalSize}px "ReceiptMono"`;
    const w = ctx.measureText("12345678901234567890123456789012").width;
    expect(m.marginX + Math.ceil(w)).toBeLessThanOrEqual(384 - m.marginX);
  });
});

// ── isWhiteRow ────────────────────────────────────────────────────────────────

describe("isWhiteRow", () => {
  it("bela vrstica (vse 0x00) → true", () => {
    const r = new Uint8Array(3 * 4).fill(0);
    expect(isWhiteRow(r, 0, 4)).toBe(true);
    expect(isWhiteRow(r, 1, 4)).toBe(true);
  });

  it("vrstica z enim ne-ničelnim bajtom → false", () => {
    const r = new Uint8Array(3 * 4).fill(0);
    r[4 + 2] = 0xFF; // vrstica 1, bajt 2
    expect(isWhiteRow(r, 1, 4)).toBe(false);
    expect(isWhiteRow(r, 0, 4)).toBe(true);  // vrstica 0 je še bela
    expect(isWhiteRow(r, 2, 4)).toBe(true);  // vrstica 2 je bela
  });
});

// ── buildCompressedBytes ──────────────────────────────────────────────────────
// Opomba: ESC J optimizacija je ODSTRANJENA (Q10 jo ignorira → stiskanje).
// Bele vrstice ostanejo v rastru kot 0x00 bajti znotraj GS v 0 blokov.

describe("buildCompressedBytes", () => {
  const GS = 0x1D, ESC = 0x1B;
  const bpr = 4; // bytesPerRow za teste

  /** Pomožnik: preveri, ali niz vsebuje ESC J (0x1B 0x4A) */
  function hasEscJ(out: number[]): boolean {
    return out.findIndex((b, i) => b === ESC && out[i + 1] === 0x4A) >= 0;
  }

  it("prazna slika (vse bele) → prazen niz", () => {
    const r = new Uint8Array(5 * bpr).fill(0);
    expect(buildCompressedBytes(r, 5, bpr)).toEqual([]);
  });

  it("samo barvne vrstice → en GS v 0 blok, brez ESC J", () => {
    const r = new Uint8Array(3 * bpr).fill(0xFF);
    const out = buildCompressedBytes(r, 3, bpr);
    expect(out.length).toBe(8 + 3 * bpr); // GS header + 3 vrstice
    expect(out[0]).toBe(GS); expect(out[1]).toBe(0x76);
    expect(out[4]).toBe(bpr); // xL
    expect(out[6]).toBe(3);   // yL
    expect(hasEscJ(out)).toBe(false);
  });

  it("bele-barvne-bele → trim vodilnih/sledilnih, en GS v 0 za barvne, brez ESC J", () => {
    const r = new Uint8Array(5 * bpr).fill(0);
    r[1 * bpr] = 0xFF; r[1 * bpr + 1] = 0xFF; r[1 * bpr + 2] = 0xFF; r[1 * bpr + 3] = 0xFF;
    r[2 * bpr] = 0xFF; r[2 * bpr + 1] = 0xFF; r[2 * bpr + 2] = 0xFF; r[2 * bpr + 3] = 0xFF;
    // vrstice 0 in 4 so bele (trim), vrstice 1+2 barvne
    const out = buildCompressedBytes(r, 5, bpr);
    expect(out.length).toBe(8 + 2 * bpr); // samo en GS v 0 za vrstici 1+2
    expect(out[0]).toBe(GS);
    expect(out[6]).toBe(2); // 2 vrstici
    expect(hasEscJ(out)).toBe(false);
  });

  it("barvne–bele–barvne → en GS v 0 blok (bele kot 0x00), brez ESC J", () => {
    const r = new Uint8Array(5 * bpr).fill(0);
    // Vrstice 0+1 barvne, 2+3 bele (0x00), 4 barvna
    r[0 * bpr] = 0xFF; r[0 * bpr + 1] = 0xFF; r[0 * bpr + 2] = 0xFF; r[0 * bpr + 3] = 0xFF;
    r[1 * bpr] = 0xFF; r[1 * bpr + 1] = 0xFF; r[1 * bpr + 2] = 0xFF; r[1 * bpr + 3] = 0xFF;
    r[4 * bpr] = 0xFF; r[4 * bpr + 1] = 0xFF; r[4 * bpr + 2] = 0xFF; r[4 * bpr + 3] = 0xFF;
    const out = buildCompressedBytes(r, 5, bpr);
    // En GS v 0 blok z vsemi 5 vrsticami (0+1 barvni, 2+3 bele kot 0x00, 4 barvna)
    // = 8 bajtov header + 5*bpr bajtov podatkov
    expect(out.length).toBe(8 + 5 * bpr);
    expect(out[0]).toBe(GS); expect(out[6]).toBe(5); // yL=5
    expect(hasEscJ(out)).toBe(false);
    // Vrstici 2+3 (indeks v bloku: 2+3) morata biti 0x00
    const dataOffset = 8;
    expect(out[dataOffset + 2 * bpr]).toBe(0); // vrstica 2: 0x00
    expect(out[dataOffset + 3 * bpr]).toBe(0); // vrstica 3: 0x00
  });

  it("velike bele cone (> maxWhiteRows) so skrčene na maxWhiteRows", () => {
    const maxW = 4;
    const r = new Uint8Array(10 * bpr).fill(0);
    // Vrstica 0 barvna, 1–8 bele (8 vrstic), 9 barvna
    r[0] = 0xFF; r[9 * bpr] = 0xFF;
    const out = buildCompressedBytes(r, 10, bpr, maxW);
    // Pričakovano: rows = [0, 1,2,3,4, 9] = 6 vrstic (max 4 belih ohranimo)
    expect(out[0]).toBe(GS);
    expect(out[6]).toBe(6); // yL = 1 barvna + 4 bele + 1 barvna
    expect(hasEscJ(out)).toBe(false);
    // Bele vrstice (indeks 1–4 v bloku) so 0x00
    const d = 8;
    expect(out[d + 1 * bpr]).toBe(0);
    expect(out[d + 4 * bpr]).toBe(0);
  });

  it("bele cone <= maxWhiteRows so OHRANENE v celoti", () => {
    const r = new Uint8Array(5 * bpr).fill(0);
    r[0] = 0xFF; r[4 * bpr] = 0xFF;
    // 3 bele vrstice med njima, maxWhiteRows=24 (privzeto) → vse 3 ohranjene
    const out = buildCompressedBytes(r, 5, bpr, 24);
    expect(out[6]).toBe(5); // vse 5 vrstic
    expect(hasEscJ(out)).toBe(false);
  });

  it("bele cone > 255 vrstic → skrčene na maxWhiteRows=24, en blok, brez ESC J", () => {
    const bigWhite = 300;
    const r = new Uint8Array((bigWhite + 2) * bpr).fill(0);
    r[0] = 0xFF; r[(bigWhite + 1) * bpr] = 0xFF;
    // maxWhiteRows=24 → ohranimo 24 belih vrstic + 2 barvni = 26 vrstic
    // maxRowsPerBlock=30 (privzeto) → 26 < 30 → en blok
    const out = buildCompressedBytes(r, bigWhite + 2, bpr, 24);
    expect(hasEscJ(out)).toBe(false);
    expect(out[0]).toBe(GS);
    expect(out[6]).toBe(26); // 1 barvna + 24 bele + 1 barvna
  });

  it("skupno > maxRowsPerBlock vrstic → razbitje v bloke po ≤maxRowsPerBlock", () => {
    const total = 100;
    const r = new Uint8Array(total * bpr).fill(0xFF); // vse barvne
    const limit = 30;
    const out = buildCompressedBytes(r, total, bpr, 24, limit);
    expect(hasEscJ(out)).toBe(false);
    // Preverimo vse bloke: noben ne sme preseči limit vrstic
    let pos = 0;
    const blockSizes: number[] = [];
    while (pos < out.length) {
      if (out[pos] === GS && out[pos+1] === 0x76 && out[pos+2] === 0x30 && out[pos+3] === 0x00) {
        const rows = out[pos+6] + out[pos+7]*256;
        blockSizes.push(rows);
        pos += 8 + rows * bpr;
      } else pos++;
    }
    expect(blockSizes.length).toBe(Math.ceil(total / limit)); // ceil(100/30)=4
    expect(Math.max(...blockSizes)).toBeLessThanOrEqual(limit);
    expect(blockSizes.reduce((a,b)=>a+b,0)).toBe(total);
  });
});

// ── rasterToGsV0Blocks ─────────────────────────────────────────────────────────

describe("rasterToGsV0Blocks", () => {
  const GS = 0x1D;

  it("header: GS v 0 m, xL/xH v BAJTIH (58mm = 48 bajtov = 0x30)", () => {
    const bpr = 48;
    const raster = new Uint8Array(5 * bpr).fill(0xAA);
    const out = rasterToGsV0Blocks(raster, 5, bpr);
    expect(out[0]).toBe(GS); expect(out[1]).toBe(0x76);
    expect(out[2]).toBe(0x30); expect(out[3]).toBe(0x00);
    expect(out[4]).toBe(0x30); // xL = 48 = 0x30
    expect(out[5]).toBe(0x00); // xH
    expect(out[6]).toBe(5);    // yL
    expect(out[7]).toBe(0);    // yH
  });

  it("80mm: xL=0x40 (64 bajtov)", () => {
    const raster = new Uint8Array(3 * 64).fill(0);
    const out = rasterToGsV0Blocks(raster, 3, 64);
    expect(out[4]).toBe(0x40); expect(out[5]).toBe(0x00);
  });

  it("chunking: 250 vrstic → 2 bloka (max 200)", () => {
    const bpr = 48;
    const raster = new Uint8Array(250 * bpr).fill(0);
    const out = rasterToGsV0Blocks(raster, 250, bpr, 200);
    expect(out[6]).toBe(200 & 0xFF);
    const b2 = 8 + 200 * bpr;
    expect(out[b2 + 6]).toBe(50);
    expect(out.length).toBe(2 * 8 + 250 * bpr);
  });

  it("privzetek 65535 → en blok za 800 vrstic", () => {
    const bpr = 48;
    const raster = new Uint8Array(800 * bpr).fill(0);
    const out = rasterToGsV0Blocks(raster, 800, bpr);
    let blocks = 0;
    for (let i = 0; i < out.length - 3; i++) {
      if (out[i] === GS && out[i+1] === 0x76 && out[i+2] === 0x30 && out[i+3] === 0x00) blocks++;
    }
    expect(blocks).toBe(1);
  });
});

// ── buildEscPosReceiptBitmap (integracija) ────────────────────────────────────

describe("buildEscPosReceiptBitmap", () => {
  const GS = 0x1D, ESC = 0x1B;

  it("vrne Uint8Array", () => {
    const r = buildEscPosReceiptBitmap(minimalData, 32);
    expect(r).toBeInstanceOf(Uint8Array);
    expect(r.length).toBeGreaterThan(100);
  });

  it("prični z ESC @ (reset)", () => {
    const r = buildEscPosReceiptBitmap(minimalData, 32);
    expect(r[0]).toBe(ESC); expect(r[1]).toBe(0x40);
  });

  it("vsebuje GS v 0 z xL=0x30 (58mm, 48 bajtov)", () => {
    const r = buildEscPosReceiptBitmap(minimalData, 32);
    const a = Array.from(r);
    const i = a.findIndex((b, j) =>
      b === GS && a[j+1] === 0x76 && a[j+2] === 0x30 && a[j+3] === 0x00);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(a[i + 4]).toBe(0x30);
    expect(a[i + 5]).toBe(0x00);
  });

  it("vsebuje GS v 0 z xL=0x40 (80mm, 64 bajtov)", () => {
    const r = buildEscPosReceiptBitmap(minimalData, 40);
    const a = Array.from(r);
    const i = a.findIndex((b, j) =>
      b === GS && a[j+1] === 0x76 && a[j+2] === 0x30 && a[j+3] === 0x00);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(a[i + 4]).toBe(0x40);
  });

  it("vsebuje ESC d (paper feed) in GS V (cut) pri koncu", () => {
    const r = buildEscPosReceiptBitmap(minimalData, 32);
    const a = Array.from(r);
    const feedIdx = a.lastIndexOf(0x64);
    expect(a[feedIdx - 1]).toBe(ESC);
    expect(a[feedIdx + 1]).toBe(0x03);
    const cutIdx = a.lastIndexOf(0x56);
    expect(a[cutIdx - 1]).toBe(GS);
  });

  it("32-znakovni bold niz pri normalSize ostane znotraj 384px", () => {
    const m = calibrateFont(384, 32);
    const cal = createCanvas(384, 50);
    const ctx = cal.getContext("2d");
    ctx.font = `bold ${m.normalSize}px "ReceiptMono"`;
    const w = ctx.measureText("12345678901234567890123456789012").width;
    expect(m.marginX + Math.ceil(w)).toBeLessThanOrEqual(384 - m.marginX);
  });

  it("izhod NE vsebuje ESC J (0x1B 0x4A) — bele vrstice so v rastru", () => {
    const r = buildEscPosReceiptBitmap(minimalData, 32);
    const a = Array.from(r);
    const escJIdx = a.findIndex((b, i) => b === 0x1B && a[i + 1] === 0x4A);
    expect(escJIdx).toBe(-1); // nobenega ESC J
  });

  it("skupna velikost tipičnega računa je ~30–60 KB (bele vrstice v rastru)", () => {
    const r = buildEscPosReceiptBitmap(minimalData, 32);
    expect(r.length).toBeGreaterThan(20_000);  // vsaj 20 KB (z belimi vrsticami)
    expect(r.length).toBeLessThan(80_000);     // ne preveč (maxWhiteRows=24 skrči)
  });

  it("vsi GS v 0 bloki imajo ≤ MAX_GS_ROWS_PER_BLOCK (30) vrstic — Q10 buffer varen", () => {
    const r = buildEscPosReceiptBitmap(minimalData, 32);
    const a = Array.from(r);
    const GS = 0x1D;
    const MAX = 30;
    const sizes: number[] = [];
    for (let i = 0; i < a.length - 7; i++) {
      if (a[i] === GS && a[i+1] === 0x76 && a[i+2] === 0x30 && a[i+3] === 0x00) {
        const yL = a[i + 6], yH = a[i + 7];
        sizes.push(yL + yH * 256);
        i += 7;
      }
    }
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(MAX);
  });
});

// ── Bajtno-natančen strukturni test ──────────────────────────────────────────
// Preveri: za vsako GS v 0 glavo sledi TOČNO napovedano število bajtov,
// bele vrstice so 0x00 v bloku, rekonstrukcija vrne vhodne podatke (barvne vrstice).

describe("buildCompressedBytes — bajtna natančnost", () => {
  const GS = 0x1D, ESC = 0x1B;
  const bpr = 48; // 58mm

  /** Razčleni GS v 0 tok — vrne bloke z dejanskimi podatki */
  function parseGsV0Stream(out: number[]): Array<{
    offset: number; rowsDeclared: number; bprDeclared: number;
    rowData: number[][]; // rowData[r] = bpr bajtov za vrstico r
  }> {
    const blocks = [];
    let i = 0;
    while (i < out.length) {
      if (out[i] === GS && out[i+1] === 0x76 && out[i+2] === 0x30 && out[i+3] === 0x00) {
        const bprD = out[i+4] + out[i+5] * 256;
        const rows = out[i+6] + out[i+7] * 256;
        const offset = i;
        i += 8;
        const rowData: number[][] = [];
        for (let r = 0; r < rows; r++) {
          rowData.push(out.slice(i, i + bprD));
          i += bprD;
        }
        blocks.push({ offset, rowsDeclared: rows, bprDeclared: bprD, rowData });
      } else {
        i++;
      }
    }
    return blocks;
  }

  it("(a) po vsaki GS v 0 glavi sledi TOČNO napovedano število bajtov", () => {
    // Sintetičen raster: 5 belih, 22 barvnih (0xAA), 12 belih, 18 barvnih (0xBB), 5 belih
    const spec = [
      {rows: 5, fill: 0x00}, {rows: 22, fill: 0xAA},
      {rows: 12, fill: 0x00}, {rows: 18, fill: 0xBB},
      {rows: 5, fill: 0x00},
    ];
    const totalRows = spec.reduce((s,x)=>s+x.rows,0);
    const r = new Uint8Array(totalRows * bpr);
    let pos = 0;
    for (const {rows, fill} of spec) {
      for (let i = 0; i < rows; i++)
        for (let b = 0; b < bpr; b++) r[(pos+i)*bpr+b] = fill;
      pos += rows;
    }

    const out = buildCompressedBytes(r, totalRows, bpr);

    // Razčleni tok — preverimo, da je vsak blok konzistenten
    const blocks = parseGsV0Stream(out);
    expect(blocks.length).toBeGreaterThan(0);
    for (const blk of blocks) {
      expect(blk.bprDeclared).toBe(bpr);
      expect(blk.rowData.length).toBe(blk.rowsDeclared);
      expect(blk.rowData.every(row => row.length === bpr)).toBe(true);
    }

    // Brez ESC J
    expect(out.findIndex((b,i) => b === ESC && out[i+1] === 0x4A)).toBe(-1);
  });

  it("(b) po zadnjem bloku ni odvečnih rastrskih bajtov (le feed/rez)", () => {
    const r = new Uint8Array(60 * bpr).fill(0xFF); // 60 barvnih
    const out = buildCompressedBytes(r, 60, bpr);
    const blocks = parseGsV0Stream(out);
    // Zadnji blok konča pri:
    const lastBlk = blocks[blocks.length - 1];
    const expectedEnd = lastBlk.offset + 8 + lastBlk.rowsDeclared * bpr;
    expect(expectedEnd).toBe(out.length); // nič za zadnjim blokom
  });

  it("(c) rekonstruirane barvne vrstice == vhodne; bele vrstice so 0x00 v bloku", () => {
    // 3 barvne (0xCD), 6 belih, 3 barvne (0xEF)
    const r = new Uint8Array(12 * bpr).fill(0);
    for (let i = 0; i < 3; i++)
      for (let b = 0; b < bpr; b++) r[i*bpr+b] = 0xCD;
    for (let i = 9; i < 12; i++)
      for (let b = 0; b < bpr; b++) r[i*bpr+b] = 0xEF;

    const out = buildCompressedBytes(r, 12, bpr);
    const blocks = parseGsV0Stream(out);

    // Rekonstruiraj vse vrstice v vrstnem redu
    const reconstructed = blocks.flatMap(b => b.rowData);
    // Pričakovano: 3×0xCD, 6×0x00, 3×0xEF (trim: first=0, last=11, maxWhiteRows=24≥6)
    expect(reconstructed.length).toBe(12);
    // Vrstice 0-2: 0xCD
    for (let i = 0; i < 3; i++) expect(reconstructed[i][0]).toBe(0xCD);
    // Vrstice 3-8: 0x00 (bele)
    for (let i = 3; i < 9; i++) expect(reconstructed[i][0]).toBe(0x00);
    // Vrstice 9-11: 0xEF
    for (let i = 9; i < 12; i++) expect(reconstructed[i][0]).toBe(0xEF);
  });

  it("bloki ≤ MAX_GS_ROWS_PER_BLOCK (30) — Q10 buffer varen", () => {
    // 100 barvnih vrstic → mora biti razbit v bloke ≤30 vrstic
    const r = new Uint8Array(100 * bpr).fill(0xFF);
    const out = buildCompressedBytes(r, 100, bpr);
    const blocks = parseGsV0Stream(out);
    expect(blocks.length).toBe(4); // ceil(100/30) = 4: 30+30+30+10
    for (const blk of blocks) {
      expect(blk.rowsDeclared).toBeLessThanOrEqual(30);
    }
    // Skupaj vrstic = 100
    expect(blocks.reduce((s,b)=>s+b.rowsDeclared, 0)).toBe(100);
  });
});

// ── Besedilna pot (sanity check, ne bitmap) ────────────────────────────────────

describe("buildEscPosReceipt (besedilna pot)", () => {
  it("vrne Uint8Array z ESC @ in LF — nedotaknjena", () => {
    const r = buildEscPosReceipt(minimalData, 32, { encoding: "ascii-translit" });
    expect(r).toBeInstanceOf(Uint8Array);
    expect(r[0]).toBe(0x1B); expect(r[1]).toBe(0x40);
    expect(Array.from(r)).toContain(0x0A);
  });
});
