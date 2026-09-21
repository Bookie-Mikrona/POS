/**
 * ESC/POS bitmap (slikovni) način — račun kot rastrska 1-bitna slika.
 *
 * Namen: pravilni čšž/€ na kitajskih GBK-zaklenjenih BT tiskalnikih (npr. Q10 Back Clip),
 * kjer ESC t n in FS . nimata učinka.
 *
 * Pipeline:
 *   buildTextReceipt() → Canvas (DejaVu Sans Mono Bold, 384 px)
 *     → 1-bit raster (prag 160) → trim + bele cone skrčene → GS v 0 bloki (brez ESC J)
 *   QR (FURS): ločen GS v 0 blok na koncu
 *
 * GS v 0 format: 1D 76 30 00  xL xH  yL yH  <raster>
 *   xL/xH = širina V BAJTIH (ne pikslih): 384px → xL=0x30, xH=0x00
 *
 * Omejitev blokov (MAX_GS_ROWS_PER_BLOCK):
 *   Q10 Back Clip ima majhen GS v 0 vhodni buffer (~2-4 KB ≈ 42-83 vrstic pri 48 B/vrstico).
 *   Bloki > buffer → tiskalnik pade iz rastrskega načina → bajte tolmači kot besedilo
 *   → "scrambled" izpis (izmenično slika/smetje). Omejitev = 30 vrstic/blok (1440 B)
 *   je varna meja in ustreza izvornemu ~22-vrsticam/blok iz prejšnje implementacije.
 */

import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import QRCode from "qrcode";
import path from "path";
import { fileURLToPath } from "url";
import { buildTextReceipt } from "./pos-escpos";
import type { PrintRacunData } from "./pos-escpos";

// ── Konstante ──────────────────────────────────────────────────────────────────

const PX_WIDTH_58  = 384;
const PX_WIDTH_80  = 512;
const BYTES_ROW_58 = 48;   // 384/8
const BYTES_ROW_80 = 64;   // 512/8

/** Minimalni levi/desni rob (px) */
const MARGIN_X = 2;
/** Zgornji/spodnji rob na canvas segmentu (px) — malo dihanja za glave/repe */
const MARGIN_Y = 6;

/**
 * Največje število rastrskih vrstic na en GS v 0 blok.
 *
 * Q10 Back Clip ima majhen vhodni buffer (~2-4 KB ≈ 42-83 vrstic pri 48 B/vrstico).
 * Ko blok preseže buffer, tiskalnik pade iz rastrskega načina in bajte tolmači kot
 * besedilo → "scrambled" izpis (izmenično slika/smetje).
 *
 * 30 vrstic × 48 B = 1440 B/blok — varno pod Q10 bufferjem in blizu izvornemu
 * ~22-vrstic/blok iz ESC J implementacije.
 */
const MAX_GS_ROWS_PER_BLOCK = 30;

/**
 * Prag za pretvorbo v 1-bit.
 * 160 namesto 128: antialiased robovi postanejo črni → debelejše, ostrejše črke
 * brez mehčanja (vidnega sivila) na termičnem tisku.
 */
const THRESHOLD = 160;

const FONT_FAMILY = "ReceiptMono";

// ── Pisave ────────────────────────────────────────────────────────────────────

let fontsLoaded = false;

function loadFonts(): void {
  if (fontsLoaded) return;
  try {
    const dir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../assets/fonts",
    );
    // Primarna pisava: DejaVu Sans Mono Bold — debelejša, odlična čitljivost pri 8-dot tisku
    GlobalFonts.registerFromPath(path.join(dir, "DejaVuSansMono-Bold.ttf"),    FONT_FAMILY);
    // Rezervna: Overpass Mono (regular + bold) — za sisteme brez DejaVu
    GlobalFonts.registerFromPath(path.join(dir, "overpass-mono-bold.ttf"),     FONT_FAMILY);
    GlobalFonts.registerFromPath(path.join(dir, "overpass-mono-regular.ttf"),  FONT_FAMILY);
  } catch (e) {
    console.warn("[bitmap] Pisava ni naložena:", (e as Error).message);
  }
  fontsLoaded = true;
}

// ── Kalibracija pisave ────────────────────────────────────────────────────────

export interface FontMetrics {
  /** Velikost pisave za normalne vrstice (px) */
  normalSize: number;
  /** Velikost pisave za poudarjene vrstice — format "B" (px); ≥ normalSize */
  headingSize: number;
  /** Višina vrstice za normalne (px) */
  lineHeightNormal: number;
  /** Višina vrstice za poudarjene (px) */
  lineHeightHeading: number;
  /** Levi/desni rob (px) */
  marginX: number;
  /** Uporabna širina = pxWidth − 2*marginX (px) */
  usableWidth: number;
}

/**
 * Izmeri dejansko širino znakov z measureText in vrne optimalne metrike.
 *
 * Strategija:
 * - VSE besedilo rišemo bold (samo weight, ne rez za normalne vs "B").
 * - normalSize: največji bold fontSize kjer 32 × "M" ≤ usableWidth.
 * - headingSize: normalSize + 3, a le če 32 × "M" bold pri headingSize ≤ usableWidth.
 *   Poudarjene vrstice so pogosto krajše (naslov, SKUPAJ) → per-line fallback v render.
 * - lineHeight: Math.ceil(fontSize * 1.45) — berljiv razmik za termični tisk.
 *
 * @param pxWidth  Širina canvasa (384 ali 512 px)
 * @param cols     Število znakov v vrstici (32 ali 40)
 */
export function calibrateFont(pxWidth: number, cols: number): FontMetrics {
  loadFonts();
  const usableWidth = pxWidth - MARGIN_X * 2;
  const testStr = "M".repeat(cols);

  const cal = createCanvas(pxWidth, 60);
  const ctx = cal.getContext("2d");

  // Iščemo največ fontSize kjer bold testStr ≤ usableWidth
  let normalSize = 8; // varnostni minimum
  for (let size = 28; size >= 8; size--) {
    ctx.font = `bold ${size}px "${FONT_FAMILY}"`;
    const w = ctx.measureText(testStr).width;
    if (Math.ceil(w) <= usableWidth) {
      normalSize = size;
      break;
    }
  }

  // headingSize: normalSize + 3 (le če 32 znakov ustrezajo), sicer normalSize
  let headingSize = normalSize;
  for (const candidate of [normalSize + 3, normalSize + 2, normalSize + 1]) {
    ctx.font = `bold ${candidate}px "${FONT_FAMILY}"`;
    const w = ctx.measureText(testStr).width;
    if (Math.ceil(w) <= usableWidth) {
      headingSize = candidate;
      break;
    }
  }

  return {
    normalSize,
    headingSize,
    lineHeightNormal:  Math.ceil(normalSize  * 1.45),
    lineHeightHeading: Math.ceil(headingSize * 1.45),
    marginX:    MARGIN_X,
    usableWidth,
  };
}

// Cache metrik: pxWidth+cols → FontMetrics
const metricsCache = new Map<string, FontMetrics>();
function getMetrics(pxWidth: number, cols: number): FontMetrics {
  const key = `${pxWidth}x${cols}`;
  if (!metricsCache.has(key)) metricsCache.set(key, calibrateFont(pxWidth, cols));
  return metricsCache.get(key)!;
}

// ── Pomožne funkcije ──────────────────────────────────────────────────────────

/**
 * Pretvori RGBA ImageData v 1-bitni raster.
 * Prag THRESHOLD (160): antialiased robovi postanejo črni → brez sivila na tisku.
 */
function imagedataToRaster(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bytesPerRow: number,
): Uint8Array {
  const raster = new Uint8Array(height * bytesPerRow);
  for (let row = 0; row < height; row++) {
    for (let byteIdx = 0; byteIdx < bytesPerRow; byteIdx++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = byteIdx * 8 + bit;
        if (x >= width) break;
        const px = (row * width + x) * 4;
        const lum = 0.299 * data[px] + 0.587 * data[px + 1] + 0.114 * data[px + 2];
        if (lum < THRESHOLD) b |= 0x80 >> bit;
      }
      raster[row * bytesPerRow + byteIdx] = b;
    }
  }
  return raster;
}

/** Vrne true če je vrstica v rastru popolnoma bela (vse 0x00). */
export function isWhiteRow(raster: Uint8Array, row: number, bytesPerRow: number): boolean {
  const base = row * bytesPerRow;
  for (let b = 0; b < bytesPerRow; b++) {
    if (raster[base + b] !== 0) return false;
  }
  return true;
}

/**
 * Zgradi GS v 0 bloke iz 1-bitnega rastra.
 *
 * Q10 SDK podpira en blok do 65535 vrstic.
 * maxRowsPerBlock = 65535 privzeto → en blok za tipičen račun.
 *
 * Format: 1D 76 30 00  xL xH  yL yH  <raster bajti>
 *   xL/xH = širina V BAJTIH: 384px → 48B → xL=0x30 xH=0x00
 */
export function rasterToGsV0Blocks(
  raster: Uint8Array,
  totalRows: number,
  bytesPerRow: number,
  maxRowsPerBlock = 65535,
): number[] {
  const GS = 0x1D;
  const out: number[] = [];
  let rowOffset = 0;
  while (rowOffset < totalRows) {
    const chunkRows = Math.min(maxRowsPerBlock, totalRows - rowOffset);
    out.push(
      GS, 0x76, 0x30, 0x00,
      bytesPerRow & 0xFF, (bytesPerRow >> 8) & 0xFF,
      chunkRows & 0xFF,   (chunkRows >> 8) & 0xFF,
    );
    const start = rowOffset * bytesPerRow;
    for (let i = start; i < start + chunkRows * bytesPerRow; i++) out.push(raster[i]);
    rowOffset += chunkRows;
  }
  return out;
}

/**
 * Zgradi rasterski ESC/POS tok BREZ ESC J optimizacije.
 *
 * Ozadje: Q10 Back Clip (GBK firmware) ignorira ESC J n med GS v 0 bloki →
 * medvrstični razmiki, pretvorjeni v ESC J, se izgubijo → stisnjeno besedilo.
 * Rešitev: bele vrstice ostanejo V RASTRU kot 0x00 bajti; tiskalnik jih mora
 * upoštevati kot prazne rasterske vrstice.
 *
 * Strategija:
 *   - Trim: obreže le vodilne/sledilne bele vrstice (robni MARGIN_Y)
 *   - Bele vrstice znotraj first..last: V RASTRU kot 0x00 (ne ESC J)
 *   - Bele cone > maxWhiteRows: skrčene na maxWhiteRows (nadzor velikosti)
 *   - Razbitje: samo po ≤255 vrsticah na GS v 0 blok (hardwarova meja)
 *
 * @param raster          1-bitni raster (Uint8Array)
 * @param totalRows       Skupno število vrstic rastra
 * @param bytesPerRow     Bajtov na vrstico (48 za 58mm, 64 za 80mm)
 * @param maxWhiteRows    Največja bela cona med vrsticami (privzeto 24 px)
 * @param maxRowsPerBlock Največje število vrstic na en GS v 0 blok (privzeto MAX_GS_ROWS_PER_BLOCK)
 * @returns               Niz ESC/POS bajtov (samo GS v 0 bloki, brez ESC J)
 */
export function buildCompressedBytes(
  raster: Uint8Array,
  totalRows: number,
  bytesPerRow: number,
  maxWhiteRows = 24,
  maxRowsPerBlock = MAX_GS_ROWS_PER_BLOCK,
): number[] {
  const GS = 0x1D;

  // ── Trim: poišči obseg ne-belih vrstic ──────────────────────────────────
  let first = 0;
  while (first < totalRows && isWhiteRow(raster, first, bytesPerRow)) first++;
  let last = totalRows - 1;
  while (last >= 0 && isWhiteRow(raster, last, bytesPerRow)) last--;

  if (first > last) return []; // popolnoma bela slika

  // ── Zgradi seznam vrstic z omejenimi belimi conami ───────────────────────
  // Bele cone > maxWhiteRows so skrčene na maxWhiteRows vrstic.
  // Preostale vrstice (bele in barvne) gredo v raster kot 0x00 oz. originalni bajti.
  const rows: number[] = []; // indeksi vrstic v originalnem rastru
  let i = first;
  while (i <= last) {
    if (isWhiteRow(raster, i, bytesPerRow)) {
      const whiteStart = i;
      let whiteCount = 0;
      while (i <= last && isWhiteRow(raster, i, bytesPerRow)) { whiteCount++; i++; }
      // Ohrani le prvih maxWhiteRows belih vrstic, ostale zavrzi
      const keep = Math.min(whiteCount, maxWhiteRows);
      for (let w = 0; w < keep; w++) rows.push(whiteStart + w);
    } else {
      rows.push(i);
      i++;
    }
  }

  // ── Emitira GS v 0 bloke po ≤maxRowsPerBlock vrstic ─────────────────────
  // KRITIČNO: vsak blok mora biti dovolj majhen da se ujame v Q10-jev vhodni
  // buffer. Privzeto MAX_GS_ROWS_PER_BLOCK = 30 vrstic × 48 B = 1440 B/blok.
  const out: number[] = [];
  let pos = 0;
  while (pos < rows.length) {
    const chunkRows = Math.min(rows.length - pos, maxRowsPerBlock);
    out.push(
      GS, 0x76, 0x30, 0x00,
      bytesPerRow & 0xFF, (bytesPerRow >> 8) & 0xFF,
      chunkRows & 0xFF,   (chunkRows >> 8) & 0xFF,
    );
    for (let r = 0; r < chunkRows; r++) {
      const rasterRow = rows[pos + r];
      const base = rasterRow * bytesPerRow;
      for (let b = 0; b < bytesPerRow; b++) out.push(raster[base + b]);
    }
    pos += chunkRows;
  }

  // ── Samopreverjanje (dev): glava ↔ podatki morajo biti konsistentni ───────
  if (process.env.NODE_ENV !== "production") {
    let j = 0, verifiedRows = 0;
    while (j < out.length) {
      if (out[j] === GS && out[j+1] === 0x76 && out[j+2] === 0x30 && out[j+3] === 0x00) {
        const declaredBpr  = out[j+4] + out[j+5] * 256;
        const declaredRows = out[j+6] + out[j+7] * 256;
        const dataStart = j + 8;
        const dataEnd   = dataStart + declaredRows * declaredBpr;
        if (declaredBpr !== bytesPerRow) {
          throw new Error(
            `GS v 0 assert: blok @${j}: xL/xH=${declaredBpr} ≠ bytesPerRow=${bytesPerRow}`,
          );
        }
        if (dataEnd > out.length) {
          throw new Error(
            `GS v 0 assert: blok @${j}: napovedan obseg ${declaredRows}×${declaredBpr}=${declaredRows*declaredBpr} B` +
            ` presega konec izhoda (${out.length - dataStart} B na voljo)`,
          );
        }
        verifiedRows += declaredRows;
        j = dataEnd;
      } else {
        j++;
      }
    }
    if (verifiedRows !== rows.length) {
      throw new Error(
        `GS v 0 assert: skupaj vrstic v blokih=${verifiedRows} ≠ pričakovano=${rows.length}`,
      );
    }
  }

  return out;
}

/**
 * QR koda za FURS — GS v 0 rasterski blok.
 */
function qrGsV0(url: string, scale = 5, printableBytes = BYTES_ROW_58): number[] {
  const qr    = QRCode.create(url, { errorCorrectionLevel: "M" });
  const size  = qr.modules.size;
  const mdata = qr.modules.data as Uint8Array;
  const dotW  = size * scale;
  const contentBytes  = Math.ceil(dotW / 8);
  const leftPadBytes  = Math.max(0, Math.floor((printableBytes - contentBytes) / 2));
  const totalRowBytes = leftPadBytes + contentBytes;
  const raster: number[] = [];
  for (let row = 0; row < size; row++) {
    for (let sr = 0; sr < scale; sr++) {
      for (let p = 0; p < leftPadBytes; p++) raster.push(0x00);
      const rowBytes = new Array<number>(contentBytes).fill(0);
      for (let col = 0; col < size; col++) {
        if (mdata[row * size + col]) {
          for (let sc = 0; sc < scale; sc++) {
            const bit = col * scale + sc;
            rowBytes[Math.floor(bit / 8)] |= 0x80 >> (bit % 8);
          }
        }
      }
      raster.push(...rowBytes);
    }
  }
  const GS   = 0x1D;
  const dotH = size * scale;
  const xL = totalRowBytes & 0xFF; const xH = (totalRowBytes >> 8) & 0xFF;
  const yL = dotH & 0xFF;          const yH = (dotH >> 8) & 0xFF;
  return [GS, 0x76, 0x30, 0x00, xL, xH, yL, yH, ...raster];
}

// ── Glavna funkcija ───────────────────────────────────────────────────────────

/**
 * Zgradi ESC/POS bajte za račun kot rastrsko sliko (bitmap način).
 *
 * @param data  Podatki računa
 * @param cols  32 = 58mm (384 px, 48 B/row); 40 = 80mm (512 px, 64 B/row)
 *
 * Pravi čšž/€ ne glede na GBK/kitajski mod tiskalnika.
 * Besedilna pot (buildEscPosReceipt) ostane nedotaknjena.
 */
export function buildEscPosReceiptBitmap(
  data: PrintRacunData,
  cols = 32,
): Uint8Array {
  loadFonts();

  const is80mm      = cols >= 40;
  const pxWidth     = is80mm ? PX_WIDTH_80 : PX_WIDTH_58;
  const bytesPerRow = is80mm ? BYTES_ROW_80 : BYTES_ROW_58;
  const metrics     = getMetrics(pxWidth, cols);

  const { linee, formati, qrUrl } = buildTextReceipt(data, cols);

  // ── Canvas: zmogljivo risanje z DejaVu Sans Mono Bold ──────────────────────
  // Vse vrstice rišemo bold (debelejše → boljša čitljivost na termičnem tisku).
  // "B" vrstice pri headingSize če vsebina ustreza usableWidth, sicer normalSize.
  //
  // Per-line višina: "B" vrstice so višje (lineHeightHeading).
  // Skupna višina canvasa: seštevek per-line višin + zgornji/spodnji MARGIN_Y.

  // Izračunaj skupno višino canvasa (per-line)
  const cal = createCanvas(pxWidth, 60);
  const calCtx = cal.getContext("2d");
  const effectiveSizes = linee.map((line, i) => {
    if (formati[i] !== "B") return metrics.normalSize;
    // Preveri ali headingSize ustreza tej vrstici
    calCtx.font = `bold ${metrics.headingSize}px "${FONT_FAMILY}"`;
    const w = calCtx.measureText(line).width;
    return Math.ceil(w) <= metrics.usableWidth ? metrics.headingSize : metrics.normalSize;
  });

  let canvasHeight = MARGIN_Y;
  const lineY: number[] = [];
  for (let i = 0; i < linee.length; i++) {
    lineY.push(canvasHeight);
    const lh = effectiveSizes[i] === metrics.headingSize
      ? metrics.lineHeightHeading
      : metrics.lineHeightNormal;
    canvasHeight += lh;
  }
  canvasHeight += MARGIN_Y;

  const canvas = createCanvas(pxWidth, canvasHeight);
  const ctx    = canvas.getContext("2d");

  // Belo ozadje
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pxWidth, canvasHeight);
  ctx.fillStyle    = "#000000";
  ctx.textBaseline = "top";

  for (let i = 0; i < linee.length; i++) {
    ctx.font = `bold ${effectiveSizes[i]}px "${FONT_FAMILY}"`;
    ctx.fillText(linee[i], metrics.marginX, lineY[i]);
  }

  // ── Canvas → 1-bit raster (prag 160 → ostri robovi, brez sivila) ──────────
  const imageData = ctx.getImageData(0, 0, pxWidth, canvasHeight);
  const raster    = imagedataToRaster(imageData.data, pxWidth, canvasHeight, bytesPerRow);

  // ── Sestavi ESC/POS bajte ─────────────────────────────────────────────────
  const ESC = 0x1B;
  const FS  = 0x1C;
  const GS  = 0x1D;

  const out: number[] = [
    ESC, 0x40,  // ESC @ — reset
    FS,  0x2E,  // FS . — disable Chinese
  ];

  // Rasterski tok: bele vrstice v GS v 0 blokih (brez ESC J — Q10 ga ignorira)
  out.push(...buildCompressedBytes(raster, canvasHeight, bytesPerRow));

  // QR koda FURS — ločen GS v 0 blok
  if (qrUrl) {
    out.push(...qrGsV0(qrUrl, 5, bytesPerRow));
  }

  // Zaključek: feed + rez
  out.push(
    ESC, 0x64, 0x03,        // ESC d 3
    GS,  0x56, 0x41, 0x03,  // GS V A 3 — partial cut
  );

  return new Uint8Array(out);
}
