/**
 * ESC/POS byte builder for thermal receipt printers.
 * Podpira štiri kodne strani:
 *   CP1250       (Windows-1250, ESC t 45 / n=0x2D) — privzeto
 *   WPC1250      (Windows-1250, ESC t 12 / n=0x0C) — nekatere HW različice tega tiskalnika
 *   CP852        (OEM Latin-2,  ESC t 18 / n=0x12) — starejši OEM tiskalniki
 *   ascii-translit — brez kodne strani; šumniki se transliterirajo (č→c, š→s, ž→z),
 *                    € se prepiše v "EUR". Primerno za tiskalnike brez Latin-2/1250 podpore.
 * iconv-lite windows1250 se uporabi za CP1250 in WPC1250 (isti znaki, različen index).
 *
 * CP852 + € (znak euro):
 *   CP852 nima € v svoji tabeli. Rešitev: kratek preklop na CP858 (= CP850 + € na 0xD5)
 *   samo za tisti znak, nato se vrnemo na CP852. Sekvenca: 1B 74 13  D5  1B 74 12.
 *   JavaScript .length === 1 za "€" → padStart/padEnd računata širino pravilno (1 znak).
 */
import iconv from "iconv-lite";
import QRCode from "qrcode";

// --- ESC/POS command constants ---
const ESC = 0x1b;
const GS  = 0x1d;
const LF  = 0x0a;

/**
 * Transliterira UTF-8 niz v čisti ASCII.
 * Pravila: šumniki → najbližji ASCII; € → "EUR"; ostali ne-ASCII → izpuščeni.
 * Izvoženo za unit-teste.
 */
export function transliterateToAscii(s: string): string {
  const MAP: Record<string, string> = {
    "č": "c", "š": "s", "ž": "z",
    "Č": "C", "Š": "S", "Ž": "Z",
    "đ": "d", "Đ": "D",
    "€": "EUR",
    // razširjeni latinski (pogosti v naslovih dobaviteljev/podjetij)
    "à": "a", "á": "a", "â": "a", "ã": "a", "ä": "a", "å": "a", "æ": "ae",
    "ç": "c", "è": "e", "é": "e", "ê": "e", "ë": "e",
    "ì": "i", "í": "i", "î": "i", "ï": "i",
    "ñ": "n",
    "ò": "o", "ó": "o", "ô": "o", "õ": "o", "ö": "o", "ø": "o", "œ": "oe",
    "ù": "u", "ú": "u", "û": "u", "ü": "u",
    "ý": "y", "ÿ": "y",
    "ß": "ss",
    "À": "A", "Á": "A", "Â": "A", "Ã": "A", "Ä": "A", "Å": "A", "Æ": "AE",
    "Ç": "C", "È": "E", "É": "E", "Ê": "E", "Ë": "E",
    "Ì": "I", "Í": "I", "Î": "I", "Ï": "I",
    "Ñ": "N",
    "Ò": "O", "Ó": "O", "Ô": "O", "Õ": "O", "Ö": "O", "Ø": "O", "Œ": "OE",
    "Ù": "U", "Ú": "U", "Û": "U", "Ü": "U",
    "Ý": "Y",
  };
  let out = "";
  for (const ch of s) {
    if (ch in MAP) {
      out += MAP[ch];
    } else if (ch.charCodeAt(0) < 128) {
      out += ch; // čisti ASCII — ohrani
    }
    // ostale ne-ASCII znake izpusti
  }
  return out;
}

/**
 * Na računu se zaradi zasebnosti in kratkega formata izpiše samo osebno ime.
 * Polni posnetek natakarja ostane nespremenjen za evidence, poročila in
 * računovodsko revizijsko sled.
 */
export function firstNameOnly(natakarIme?: string | null): string {
  return natakarIme?.trim().split(/\s+/)[0] ?? "";
}

/**
 * Enkodira niz v Windows-1250 bajte (privzeto) ali CP852 (OEM Latin-2).
 * CP1250: č=0xE8, š=0x9A, ž=0x9E  (€=0x80 deluje nativno)
 * CP852:  č=0x9F, š=0xE7, ž=0xA7  (€ ni v tabeli → ročno 0x80, ker ga večina
 *         modernih tiskalnikov z OEM 852 podpira na mestu 0x80)
 * ascii-translit: transliteriraj nato kodiraj kot ASCII.
 */
function encodeText(s: string, encoding: "cp1250" | "wpc1250" | "cp852" | "ascii-translit" = "cp1250"): Buffer {
  if (encoding === "ascii-translit") {
    // Transliteracija: šumniki → ASCII; € → "EUR". Nobena kodna stran ni potrebna.
    return Buffer.from(transliterateToAscii(s), "ascii");
  }
  if (encoding === "cp852") {
    // CP852 nima €. Kratek preklop na CP858 (CP850 + € @ 0xD5) za vsak € znak.
    // JS .length("€") === 1 → padStart/padEnd v buildEscPosReceipt računata pravilno.
    const SEQ_858 = Buffer.from([ESC, 0x74, 0x13]); // preklop na PC858
    const EURO    = Buffer.from([0xD5]);              // € v CP858
    const SEQ_852 = Buffer.from([ESC, 0x74, 0x12]); // nazaj na PC852
    const parts = s.split("€");
    if (parts.length === 1) return iconv.encode(s, "cp852"); // ni € — hitra pot
    const bufs: Buffer[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) bufs.push(iconv.encode(parts[i], "cp852"));
      if (i < parts.length - 1) bufs.push(SEQ_858, EURO, SEQ_852);
    }
    return Buffer.concat(bufs);
  }
  // CP1250 in WPC1250 sta ista znakovna tabela (razlikujeta se samo v indeksu ESC t)
  return iconv.encode(s, "windows1250");
}

const FS = 0x1c;

const CMD = {
  INIT:            [ESC, 0x40],
  DISABLE_CHINESE: [FS,  0x2E],        // FS . — izklopi GB2312 kitajski način (za kitajske tiskalnike)
  CODE_PAGE_437:      [ESC, 0x74, 0x00], // PC437   standardni ASCII (n=0)   — privzeta tabela tiskalnika
  CODE_PAGE_1250:     [ESC, 0x74, 0x2D], // CP1250  Windows-1250 (n=45=0x2D) — novejša HW
  CODE_PAGE_1250_WPC: [ESC, 0x74, 0x0C], // WPC1250 Windows-1250 (n=12=0x0C) — starejša HW
  CODE_PAGE_852:      [ESC, 0x74, 0x12], // PC852   OEM Latin-2  (n=18=0x12)
  CODE_PAGE_858:      [ESC, 0x74, 0x13], // PC858   CP850 + € @ 0xD5 (n=19) — kratek preklop za €
  ALIGN_LEFT:      [ESC, 0x61, 0x00],
  ALIGN_CENTER:   [ESC, 0x61, 0x01],
  ALIGN_RIGHT:    [ESC, 0x61, 0x02],
  BOLD_ON:        [ESC, 0x45, 0x01],
  BOLD_OFF:       [ESC, 0x45, 0x00],
  DOUBLE_HEIGHT:  [ESC, 0x21, 0x10], // double height only (not width)
  NORMAL_SIZE:    [ESC, 0x21, 0x00],
  FONT_B:         [ESC, 0x4D, 0x01], // manjša pisava (Font B) — ~30% manjše znake
  FONT_A:         [ESC, 0x4D, 0x00], // normalna pisava (Font A)
  FEED_3:         [ESC, 0x64, 0x03],
  CUT:            [GS,  0x56, 0x41, 0x03],
  UNDERLINE_ON:   [ESC, 0x2d, 0x01],
  UNDERLINE_OFF:  [ESC, 0x2d, 0x00],
};

function padEnd(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function padStart(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : " ".repeat(len - s.length) + s;
}

function twoColumns(left: string, right: string, total = 32): string {
  const rightLen = right.length;
  const leftMax = total - rightLen - 1;
  const leftTrunc = left.length > leftMax ? left.slice(0, leftMax) : left;
  return padEnd(leftTrunc, leftMax) + " " + right;
}

function dashedLine(total = 32): string {
  return "-".repeat(total);
}

function centerText(s: string, total = 32): string {
  const pad = Math.max(0, Math.floor((total - s.length) / 2));
  return " ".repeat(pad) + s;
}

/**
 * Zlomi besedilo na besedne meje pri `cols` znakov.
 * Vrne seznam vrstic brez centriranja.
 */
function wrapText(s: string, cols: number): string[] {
  if (s.length <= cols) return [s];
  const words = s.split(" ");
  const result: string[] = [];
  let current = "";
  for (const word of words) {
    const w = word.slice(0, cols);
    if (current === "") {
      current = w;
    } else if ((current + " " + w).length <= cols) {
      current += " " + w;
    } else {
      result.push(current);
      current = w;
    }
  }
  if (current) result.push(current);
  return result;
}

/**
 * Zlomi besedilo in vsako vrstico centrira.
 * Uporablja se v besedilnem (ZCS) načinu, kjer ni strojne centricnosti.
 */
function centerTextLines(s: string, cols: number): string[] {
  return wrapText(s, cols).map((l) => centerText(l, cols));
}

/**
 * Zgradi strnjen vpis registrskih podatkov v eno vrstico (ZGD-1).
 * Primer: "Okr. sod. v CE, vl. 1000/2222. Mat.st.: 8511349000. Osn. kapital: 7.500,00 EUR."
 */
function buildRegistrskiVpis(
  maticna: string | null | undefined,
  sodisce: string | null | undefined,
  kapital: string | null | undefined,
): string {
  const parts: string[] = [];
  if (sodisce) parts.push(sodisce);
  if (maticna) parts.push(`Mat.st.: ${maticna}`);
  if (kapital) parts.push(kapital);
  return parts.join(". ");
}

/**
 * QR koda kot rasterski bitmap (GS v 0) — podprto na vseh ESC/POS tiskalnikih.
 * Prednost pred GS ( k: ne zahteva "QR code mode 2" ukaza.
 *
 * Centriranje: GS v 0 vedno tiska od levega roba, zato vsako vrstico ručno
 * obložimo z ničlami na levi strani (leftPadBytes).
 * printableBytes = tiskovni rob papirja v bajtih (58mm≈48, 80mm≈64).
 */
function qrRasterBytes(url: string, scale = 6, printableBytes = 48): number[] {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const size  = qr.modules.size;
  const mdata = qr.modules.data as Uint8Array;

  const dotWidth    = size * scale;
  const contentBytes = Math.ceil(dotWidth / 8);
  const dotHeight   = size * scale;

  // Leva ničelna obroba za centriranje (zaokrožimo navzdol na sod, da QR ostane
  // poravnan na bajt in ne nastane zamik desne meje)
  const leftPadBytes = Math.max(0, Math.floor((printableBytes - contentBytes) / 2));
  const totalRowBytes = leftPadBytes + contentBytes;

  const raster: number[] = [];
  for (let row = 0; row < size; row++) {
    for (let sr = 0; sr < scale; sr++) {
      // Levi pad
      for (let p = 0; p < leftPadBytes; p++) raster.push(0x00);
      // Vsebina
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

  const xL = totalRowBytes & 0xFF;
  const xH = (totalRowBytes >> 8) & 0xFF;
  const yL = dotHeight & 0xFF;
  const yH = (dotHeight >> 8) & 0xFF;

  // GS v 0: mode=0 (normal/single density)
  return [GS, 0x76, 0x30, 0x00, xL, xH, yL, yH, ...raster];
}

export interface PrintPostavka {
  ime: string;
  kolicina: number;
  cenaKos: number;
  cenaKosOriginalna?: number | null;
  skupaj: number;
  davek: number;
  opomba?: string | null;
  parentPostavkaId?: number | null;
  postavkaId?: number | null;
  jeEmbalaza?: boolean;
  toGo?: boolean;
}

/** Pure display projection; never use this for fiscal or accounting values. */
export function projectPackagingDisplayPrices(postavke: PrintPostavka[]): PrintPostavka[] {
  const postavkeById = new Map(
    postavke.filter(line => line.postavkaId != null).map(line => [line.postavkaId!, line]),
  );
  const foldablePackaging = new Set<PrintPostavka>();
  const packagingByParent = new Map<number, number>();
  for (const line of postavke) {
    const parent = line.parentPostavkaId == null ? undefined : postavkeById.get(line.parentPostavkaId);
    if (
      line.jeEmbalaza
      && parent
      && Number(line.davek) === Number(parent.davek)
      && line.parentPostavkaId != null
    ) {
      foldablePackaging.add(line);
      packagingByParent.set(line.parentPostavkaId, (packagingByParent.get(line.parentPostavkaId) ?? 0) + line.skupaj);
    }
  }
  return postavke.map((line) => {
    const displayLine = line.toGo && line.parentPostavkaId == null && !/\sTo-Go$/i.test(line.ime)
      ? { ...line, ime: `${line.ime} To-Go` }
      : line;
    if (line.jeEmbalaza && !foldablePackaging.has(line)) return { ...displayLine, jeEmbalaza: false };
    if (foldablePackaging.has(line)) return { ...displayLine, cenaKos: 0, cenaKosOriginalna: null, skupaj: 0 };
    const packagingTotal = line.postavkaId == null ? 0 : packagingByParent.get(line.postavkaId) ?? 0;
    if (packagingTotal === 0) return displayLine;
    const together = Math.round((line.skupaj + packagingTotal + Number.EPSILON) * 100) / 100;
    const cenaKos = line.kolicina
      ? Math.round((together / line.kolicina + Number.EPSILON) * 100) / 100
      : line.cenaKos;
    const isFullyBonCovered = line.cenaKos === 0 && line.skupaj === 0 && (line.cenaKosOriginalna ?? 0) > 0;
    const originalPrice = isFullyBonCovered || line.cenaKosOriginalna == null
      ? null
      : line.kolicina
        ? Math.round((line.cenaKosOriginalna + packagingTotal / line.kolicina + Number.EPSILON) * 100) / 100
        : line.cenaKosOriginalna;
    return {
      ...displayLine,
      cenaKosOriginalna: originalPrice,
      skupaj: together,
      cenaKos,
    };
  });
}

/** Prevent e-SLOG from folding differently taxed packaging into a parent's VAT line. */
export function assertPackagingVatMatchesParent(postavke: PrintPostavka[]): void {
  const byId = new Map(postavke.filter(line => line.postavkaId != null).map(line => [line.postavkaId!, line]));
  for (const packaging of postavke) {
    if (!packaging.jeEmbalaza || packaging.parentPostavkaId == null) continue;
    const parent = byId.get(packaging.parentPostavkaId);
    if (parent && Number(packaging.davek) !== Number(parent.davek)) {
      throw new Error(
        `e-SLOG display consolidation blocked: packaging "${packaging.ime}" has VAT ${packaging.davek}% ` +
        `but parent "${parent.ime}" has VAT ${parent.davek}%.`,
      );
    }
  }
}

export interface PrintRacunData {
  stevilkaRacuna: string;
  datum: Date;
  mizaStevilka?: number | null;
  natakarIme?: string | null;
  postavke: PrintPostavka[];
  skupaj: number;
  ddv: number;
  placilnaNacin: "gotovina" | "kartica" | "bon" | "bon_pica" | "negotovinsko" | "reprezentanca" | "lastna_poraba";
  zoi?: string | null;
  eor?: string | null;
  fursQrUrl?: string | null;
  status: "poslan" | "napaka" | "testni";
  nazivRestvracije?: string;
  naslovRestvracije?: string;
  enotaOpis?: string | null;
  davcnaStevilka?: string;
  jeDdvZavezanec?: boolean;
  racunPozdrav1?: string;
  racunPozdrav2?: string;
  steviloPrintov?: number;
  kupecDavcnaStevilka?: string | null;
  kupecNaziv?: string | null;
  kupecNaslov?: string | null;
  kupecZavezanecDdv?: boolean | null;
  vivaTerminalSessionId?: string | null;
  /** ID Viva transakcije (Android Terminal / Tap to Pay / Smart); izpiše se na računu pri kartičnem plačilu. */
  vivaTransactionId?: string | null;
  sumupCheckoutId?: string | null;
  stornoIzvornaRacunStevilka?: string | null;
  racunMaticna?: string | null;
  racunSodisce?: string | null;
  racunKapital?: string | null;
  racunDdvKlavzula?: string | null;
  racunPravnaKlavzula?: string | null;
  prodajalecIban?: string | null;
  prodajalecBic?: string | null;
  dniOdloga?: number | null;
  znesekGotovina?: number | null;
  znesekKartica?: number | null;
  /** Napitnina, vodena ločeno od prodajnih postavk; kartični znesek jo že vključuje. */
  znesekNapitnina?: number | null;
  znesekBon?: number | null;
  steviloBonov?: number | null;
  znesekBonPica?: number | null;
  znesekNegotovinsko?: number | null;
}

/**
 * Build an ESC/POS receipt as a Uint8Array ready to send to a thermal printer.
 * @param cols  32 for 58 mm printers, 40 for 80 mm printers (default 32)
 */
export interface ZcsRacunJson {
  linee: string[];
  formati: string[];   // 'B' = bold, 'N' = normal (ena vrednost na vrstico)
  qrUrl: string | null;
  qrBase64: string | null;
  /** ZOI (zaščitna oznaka izdajatelja) za kasnejši prikaz na potrdilu */
  zoi?: string | null;
}

/**
 * Zgradi seznam besedilnih vrstic za ZCS Android tiskalnik (UTF-8 JSON, brez bajt kodiranja).
 * Enaka vsebina kot buildEscPosReceipt, a brez ESC/POS ukazov.
 */
export function buildTextReceipt(data: PrintRacunData, cols = 32, supportsDoubleHeight = false): ZcsRacunJson {
  data = { ...data, postavke: projectPackagingDisplayPrices(data.postavke) };
  const linee: string[] = [];
  const formati: string[] = [];
  // fmt: false/"N" = navadno, true/"B" = krepko, "H" = dvojna višina+krepko (BT most v2.5+, NB80 APK v1.2+).
  // supportsDoubleHeight=false (privzeto, ZCS terminal): "H" → "B" (krepko brez dvojne višine).
  // supportsDoubleHeight=true (BT most, NB80): "H" ostane "H".
  // Ne-slikovne poti (ESC/POS, bitmap) ne berejo formati[] — "H" jih ne prizadene.
  function line(s = "", fmt: boolean | "H" = false) {
    linee.push(s);
    const resolvedFmt = fmt === "H" ? (supportsDoubleHeight ? "H" : "B") : fmt ? "B" : "N";
    formati.push(resolvedFmt);
  }

  // "H" format = dvojna višina (NB80 APK v1.2+: scaleY=2, scaleX=1 — enojna širina znaka).
  // BT slikovni most: "H" = dvojna višina v generirani sliki, prav tako enojna x-os.
  // Obe poti: "H" vrstice gradimo na polnih cols — ni več HALF delitve.

  const placilniNacinLabels: Record<string, string> = {
    gotovina: "Gotovina", kartica: "Kartica", bon: "Bon", bon_pica: "Bon za pico", negotovinsko: "Negotovinsko (TRR)",
  };

  const datum = data.datum.toLocaleString("sl-SI", {
    timeZone: "Europe/Ljubljana", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  const datumSamo = data.datum.toLocaleDateString("sl-SI", {
    timeZone: "Europe/Ljubljana", day: "2-digit", month: "2-digit", year: "numeric",
  });

  const dniOdloga = data.dniOdloga ?? 8;
  const datumValuteStr = (() => {
    const d = new Date(data.datum);
    d.setDate(d.getDate() + dniOdloga);
    return d.toLocaleDateString("sl-SI", { timeZone: "Europe/Ljubljana", day: "2-digit", month: "2-digit", year: "numeric" });
  })();

  const jeDdv = data.jeDdvZavezanec !== false;

  // HEADER
  for (const l of centerTextLines(data.nazivRestvracije ?? "RESTAVRACIJA", cols)) line(l, true);
  if (data.naslovRestvracije) for (const l of centerTextLines(data.naslovRestvracije, cols)) line(l, true);
  if (data.davcnaStevilka) for (const l of centerTextLines(jeDdv ? `ID za DDV: SI${data.davcnaStevilka}` : `Davčna št.: ${data.davcnaStevilka}`, cols)) line(l, true);
  if (data.enotaOpis) for (const l of centerTextLines(data.enotaOpis, cols)) line(l, true);
  if (data.placilnaNacin === "negotovinsko" && data.prodajalecIban) for (const l of centerTextLines(`TRR: ${data.prodajalecIban}`, cols)) line(l, true);
  if (data.placilnaNacin === "negotovinsko" && data.prodajalecBic) line(centerText(`BIC: ${data.prodajalecBic}`, cols), true);
  line(dashedLine(cols));

  if (data.steviloPrintov && data.steviloPrintov > 1) {
    line(centerText(`*** KOPIJA ${data.steviloPrintov - 1} ***`, cols));
  }

  // RECEIPT INFO — glava: samo identifikacijski podatki
  // "H" = dvojna višina (scaleY=2, scaleX=1) — polnih cols znakov na vseh poteh (NB80 58mm + BT most)
  line(twoColumns("Račun:", data.stevilkaRacuna, cols), "H");
  line(twoColumns("Datum:", datum, cols));
  line(twoColumns("Datum opr. storitve:", datumSamo, cols));
  if (data.placilnaNacin === "negotovinsko") line(twoColumns("Datum valute:", datumValuteStr, cols));
  if (data.status === "testni") line(centerText("*** TESTNI RAČUN ***", cols));

  if (data.stornoIzvornaRacunStevilka) {
    line(dashedLine(cols));
    line("STORNO RACUNA:");
    line(data.stornoIzvornaRacunStevilka);
  }

  if (data.kupecNaziv || data.kupecDavcnaStevilka) {
    line(dashedLine(cols));
    line("KUPEC:");
    if (data.kupecNaziv) line(data.kupecNaziv.slice(0, cols));
    if (data.kupecDavcnaStevilka) line(data.kupecZavezanecDdv ? `ID za DDV: SI${data.kupecDavcnaStevilka}` : `Davčna st.: ${data.kupecDavcnaStevilka}`);
    if (data.kupecNaslov) line(data.kupecNaslov.slice(0, cols));
  }

  if (data.vivaTerminalSessionId) {
    line(dashedLine(cols));
    line("VIVA TERMINAL:", true);
    const sid = data.vivaTerminalSessionId;
    for (let i = 0; i < sid.length; i += cols) line(sid.slice(i, i + cols));
  }

  if (data.sumupCheckoutId) {
    line(dashedLine(cols));
    line("SUMUP CHECKOUT:", true);
    const cid = data.sumupCheckoutId;
    for (let i = 0; i < cid.length; i += cols) line(cid.slice(i, i + cols));
  }

  if (data.vivaTransactionId && !data.vivaTerminalSessionId) {
    line(dashedLine(cols));
    line("VIVA TRANSAKCIJA:", true);
    const tid = data.vivaTransactionId;
    for (let i = 0; i < tid.length; i += cols) line(tid.slice(i, i + cols));
  }

  line(dashedLine(cols));

  const uniqueRates = [...new Set(data.postavke.map((p) => p.davek))].sort((a, b) => b - a);
  const davekOkrajsava = new Map<number, string>(uniqueRates.map((r, i) => [r, jeDdv ? `T${i + 1}` : ""]));

  // ITEMS tabela — ENAK format kot USB 58mm (buildEscPosReceipt):
  //   glava:    Art. Kol. Cena Skupaj (4 kolone, desno poravnane, ločene z 1 presledkom)
  //   postavka: 1. vrstica = naziv artikla
  //             2. vrstica = DDV oznaka (T1..) + količina + cena + skupaj
  // Širine: kol(4), cena(10), skupaj(10); artW = cols-27 (cols=32→5, cols=30→3, cols=40→13)
  const kolW = 4, cenaW = 10, skupajW = 10;
  const artW = cols - 3 - kolW - cenaW - skupajW;
  // Formatarji za seštevke (SKUPAJ/Osnova/DDV) — nespremenjen format s presledkom pred €
  const fa   = (v: number) => padStart(v.toFixed(2) + " €", 10);
  const fan  = (v: number) => padStart("-" + Math.abs(v).toFixed(2) + " €", 10);
  const faL  = (v: number) => padStart(v.toFixed(2) + " €", 11);
  // Vrstica tabele — identična itemVrstica iz buildEscPosReceipt
  function itemVrstica(art: string, kol: string, cena: string, skupaj: string): string {
    return padStart(art.slice(0, artW), artW) + " " + padStart(kol, kolW) + " " + padStart(cena, cenaW) + " " + padStart(skupaj, skupajW);
  }
  line(itemVrstica("Art.", "Kol.", "Cena", "Skupaj"));
  line(dashedLine(cols));

  // Grupiranje: dodatki pod pico
  const dodatekMap = new Map<number, PrintPostavka[]>();
  for (const p of data.postavke) {
    if (p.parentPostavkaId != null) {
      const arr = dodatekMap.get(p.parentPostavkaId) ?? [];
      arr.push(p);
      dodatekMap.set(p.parentPostavkaId, arr);
    }
  }
  const topPostavkeIds = new Set(data.postavke.filter(p => p.parentPostavkaId == null && p.postavkaId != null).map(p => p.postavkaId as number));
  const topPostavke = data.postavke.filter(p => p.parentPostavkaId == null);
  // Osirotele podredne postavke (parent ni v tiskanem naboru)
  const printedIds = new Set(topPostavkeIds);

  const printPostavkaRow = (p: PrintPostavka) => {
    // imaPopust: prikaži "Redna cena / Popust X%" samo pri delnem popustu (cenaKos > 0).
    // Ko cenaKos=0 (100% popust z bon za pico), vrstice preskočimo — "Bon za pico" spodaj že pojasni.
    const imaPopust = p.cenaKosOriginalna != null && p.cenaKosOriginalna > p.cenaKos + 0.001 && p.cenaKos > 0.001;

    const okr = davekOkrajsava.get(p.davek) ?? "";

    // 1. vrstica: naziv artikla (prelom pri cols, da se nič ne izgubi)
    for (const l of wrapText(p.ime, cols)) line(l);

    // Opomba: ena vrstica (brez lomljenja), polnih cols, zamik 2 presledka
    if (p.opomba) line("  " + p.opomba.slice(0, cols - 2));
    if (p.jeEmbalaza) return;

    if (imaPopust && p.cenaKosOriginalna != null) {
      const popustPct = Math.round((1 - p.cenaKos / p.cenaKosOriginalna) * 100);
      const popustZnesek = p.cenaKosOriginalna - p.cenaKos;
      line(twoColumns("  Redna cena:", `${p.cenaKosOriginalna.toFixed(2)} €/kos`, cols));
      line(twoColumns(`  Popust ${popustPct}%:`, `-${popustZnesek.toFixed(2)} €/kos`, cols));
    }

    // 2. vrstica: DDV oznaka (T1..) + količina + cena + skupaj — enako kot USB
    line(padEnd(okr, artW) + " " + padStart(String(p.kolicina), kolW) + " " + padStart(p.cenaKos.toFixed(2) + " €", cenaW) + " " + padStart(p.skupaj.toFixed(2) + " €", skupajW));
  };

  const printNested = (parent: PrintPostavka) => {
    for (const child of parent.postavkaId != null ? dodatekMap.get(parent.postavkaId) ?? [] : []) {
      if (child.postavkaId != null) printedIds.add(child.postavkaId);
      for (const text of wrapText(child.ime, cols - 6)) line("    * " + text);
      if (child.skupaj !== 0 || child.cenaKos !== 0) {
        line(twoColumns("      Dodatek:", faL(child.skupaj), cols));
      }
      if (child.opomba) line("      " + child.opomba.slice(0, cols - 6));
    }
  };

  for (const p of topPostavke) {
    printPostavkaRow(p);
    // Dodatki
    const pId = p.postavkaId ?? null;
    const dodatki = pId != null ? (dodatekMap.get(pId) ?? []) : [];
    const embalaze = dodatki.filter(d => d.jeEmbalaza);
    const placljeniDodatki = dodatki.filter(d => !d.jeEmbalaza && (d.skupaj !== 0 || d.cenaKos !== 0));
    const brezplacniDodatki = dodatki.filter(d => !d.jeEmbalaza && d.skupaj === 0 && d.cenaKos === 0);
    for (const d of embalaze) {
      if (d.postavkaId != null) printedIds.add(d.postavkaId);
      for (const l of wrapText(d.ime, cols - 2)) line("  " + l);
      printNested(d);
    }
    for (const d of placljeniDodatki) {
      if (d.postavkaId != null) printedIds.add(d.postavkaId);
      // "+ " + naziv v 1. vrstici, DDV+zneski v 2. vrstici — enako kot USB
      const dOkr = davekOkrajsava.get(d.davek) ?? "";
      const dLines = wrapText(d.ime, cols - 2);
      for (let i = 0; i < dLines.length; i++) line((i === 0 ? "+ " : "  ") + dLines[i]);
      if (d.opomba) line("    " + d.opomba.slice(0, cols - 4));
      line(padEnd(dOkr, artW) + " " + padStart(String(d.kolicina), kolW) + " " + padStart(d.cenaKos.toFixed(2) + " €", cenaW) + " " + padStart(d.skupaj.toFixed(2) + " €", skupajW));
      printNested(d);
    }
    for (const d of brezplacniDodatki) {
      if (d.postavkaId != null) printedIds.add(d.postavkaId);
      // Brezplačni dodatek: "  * " + naziv
      const dBrezVrstice = wrapText(d.ime, cols - 4).slice(0, 3);
      for (let i = 0; i < dBrezVrstice.length; i++) line((i === 0 ? "  * " : "    ") + dBrezVrstice[i]);
      if (d.opomba) line("    " + d.opomba.slice(0, cols - 4));
      printNested(d);
    }
    if (placljeniDodatki.length > 0) {
      const skupajPica = p.skupaj + placljeniDodatki.reduce((s, d) => s + d.skupaj, 0);
      line(twoColumns("  Skupaj artikel:", faL(skupajPica), cols));
    }
  }
  // Osirotele dodatke tiskamo kot samostojne postavke
  for (const d of data.postavke.filter(d => d.parentPostavkaId != null && (d.postavkaId == null || !printedIds.has(d.postavkaId)))) {
    printPostavkaRow(d);
  }

  line(dashedLine(cols));

  // TOTALS
  const jeBrezplacno = data.placilnaNacin === "reprezentanca" || data.placilnaNacin === "lastna_poraba";
  const skupajIzPostavk = data.postavke.reduce((s, p) => s + p.skupaj, 0);
  const brezDDV = jeBrezplacno ? skupajIzPostavk - data.ddv : data.skupaj - data.ddv;

  // Popust — prikazan PRED osnovo; preskočimo 100% bon za pico (cenaKos=0),
  // ker je ta popust že prikazan v "Bon za pico" vrstici spodaj.
  const skupniPrihranek = data.postavke.reduce((acc, p) => {
    const ori = p.cenaKosOriginalna;
    if (ori != null && ori > p.cenaKos + 0.001 && p.cenaKos > 0.001) acc += (ori - p.cenaKos) * p.kolicina;
    return acc;
  }, 0);
  if (skupniPrihranek > 0.001) {
    line(twoColumns("Popust:", fan(skupniPrihranek), cols));
  }
  if (jeBrezplacno) {
    line(twoColumns(data.placilnaNacin === "reprezentanca" ? "Reprezentanca:" : "Lastna poraba:", "", cols));
    line(twoColumns("100% popust:", fan(skupajIzPostavk), cols));
  }
  if (jeDdv) {
    line(twoColumns("Osnova (brez DDV):", faL(brezDDV), cols));
    line(twoColumns("DDV skupaj:", fa(data.ddv), cols));
  }
  line("");
  // "H" = dvojna višina; polnih cols znakov na vseh poteh (NB80 58mm in BT most)
  line(twoColumns("SKUPAJ:", faL(data.skupaj), cols), "H");

  // DDV razrez po stopnjah — samo za zavezance
  if (jeDdv) {
    const ddvPoStopnji = new Map<number, { skupajPostavke: number; ddvZnesek: number }>();
    for (const p of data.postavke) {
      const ddvZnesek = Math.round(p.skupaj * p.davek / (100 + p.davek) * 100) / 100;
      const ex = ddvPoStopnji.get(p.davek) ?? { skupajPostavke: 0, ddvZnesek: 0 };
      ddvPoStopnji.set(p.davek, { skupajPostavke: ex.skupajPostavke + p.skupaj, ddvZnesek: ex.ddvZnesek + ddvZnesek });
    }
    const ddvVrstice = Array.from(ddvPoStopnji.entries()).sort(([a], [b]) => a - b)
      .map(([s, v]) => ({ stopnja: s, osnova: v.skupajPostavke - v.ddvZnesek, ddvZnesek: v.ddvZnesek }))
      .filter(v => v.osnova > 0.001 || v.ddvZnesek > 0.001); // preskoči ničelne vrstice (bon za pico → 0 € pice)
    if (ddvVrstice.length > 0) {
      line(dashedLine(cols));
      const dC3 = 10, dC2 = 11, dC1 = cols - dC2 - dC3;
      line(padEnd("Stopnja", dC1) + padStart("Osnova", dC2) + padStart("DDV", dC3));
      for (const { stopnja, osnova, ddvZnesek } of ddvVrstice) {
        const okr = davekOkrajsava.get(stopnja) ?? "";
        line(padEnd(`${okr} DDV ${stopnja}%:`, dC1) + faL(osnova) + fa(ddvZnesek));
      }
    }
  }

  // Miza in natakar — prestavljeno iz glave
  if (data.mizaStevilka) line(twoColumns("Miza:", String(data.mizaStevilka), cols));
  if (data.natakarIme) line(twoColumns("Natakar:", firstNameOnly(data.natakarIme).slice(0, 20), cols));

  // Boni — bon za pico je informativna vrstica (skupaj je že zmanjšan za bon za pico)
  const bonPicaZn = data.znesekBonPica ?? 0;
  const bonZn = data.znesekBon ?? 0;
  const imaBone = Math.abs(bonPicaZn) > 0.005 || Math.abs(bonZn) > 0.005;
  if (imaBone) {
    line("");
    if (Math.abs(bonPicaZn) > 0.005) line(twoColumns(`Bon za pico${data.steviloBonov ? ` (${data.steviloBonov}×)` : ""}:`, fan(bonPicaZn), cols));
    if (Math.abs(bonZn) > 0.005) line(twoColumns("Darilni bon:", fan(bonZn), cols));

    // Ostane za plačilo — samo kadar je darilni bon (skupaj je že neto, bon za pico je samo info)
    if (bonZn > 0) {
      line("");
      const ostaneZaPlacilo = Math.max(0, data.skupaj - bonZn);
      line(twoColumns("Ostane za plačilo:", faL(ostaneZaPlacilo), cols), true);
    }
  }

  // Vrsta plačila
  if (imaBone) line("");
  const gotZn = data.znesekGotovina ?? 0;
  const kartZn = data.znesekKartica ?? 0;
  const napitnina = data.znesekNapitnina ?? 0;
  const negotZn = data.znesekNegotovinsko ?? 0;
  if (Math.abs(gotZn) > 0.005) line(twoColumns("Gotovina:", fa(gotZn), cols));
  if (Math.abs(napitnina) > 0.005) line(twoColumns("Napitnina:", fa(napitnina), cols));
  if (Math.abs(kartZn) > 0.005) line(twoColumns("Kartica skupaj:", fa(kartZn), cols));
  if (Math.abs(negotZn) > 0.005) line(twoColumns("Negotovinsko:", fa(negotZn), cols));
  if (![gotZn, kartZn, napitnina, negotZn, bonPicaZn, bonZn].some((znesek) => Math.abs(znesek) > 0.005)) {
    line(twoColumns((placilniNacinLabels[data.placilnaNacin] ?? data.placilnaNacin) + ":", faL(data.skupaj), cols));
  }

  line(dashedLine(cols));

  // FURS
  if (data.zoi) {
    line(centerText("DAVČNA POTRDITEV (FURS)", cols));
    // Brez presledka za dvopičjem: "ZOI:<koda>", "EOR:<koda>"
    // cols=40: ZOI(4+32=36≤40)→1 vrstica; EOR(4+36=40)→točno 1 vrstica
    // cols=32: oba se prelomita (pričakovano)
    const zoiStr = "ZOI:" + data.zoi;
    for (let i = 0; i < zoiStr.length; i += cols) line(zoiStr.slice(i, i + cols));
    if (data.eor) {
      const eorStr = "EOR:" + data.eor;
      for (let i = 0; i < eorStr.length; i += cols) line(eorStr.slice(i, i + cols));
    }
    line(dashedLine(cols));
  }

  // REGISTRSKI PODATKI — samo za negotovinsko (TRR), strnjeno v eno vrstico
  if (data.placilnaNacin === "negotovinsko") {
    const vpis = buildRegistrskiVpis(data.racunMaticna, data.racunSodisce, data.racunKapital);
    if (vpis) {
      line(dashedLine(cols));
      for (const l of wrapText(vpis, cols)) line(l);
    }
    if (data.racunPravnaKlavzula) {
      line(dashedLine(cols));
      for (const l of wrapText(data.racunPravnaKlavzula, cols)) line(l);
    }
  }
  // DDV klavzula — za nezavezance vedno, za zavezance samo pri negotovinskem
  if (data.racunDdvKlavzula && (!jeDdv || data.placilnaNacin === "negotovinsko")) {
    line(dashedLine(cols));
    for (const l of wrapText(data.racunDdvKlavzula, cols)) line(l);
  }

  // FOOTER
  if (data.racunPozdrav1) line(centerText(data.racunPozdrav1, cols));
  if (data.racunPozdrav2) line(centerText(data.racunPozdrav2, cols));
  line("");

  // Krajši izpis brez posega v vsebinske/FURS vrstice:
  // - ena prazna vrstica je uporabna samo pred SKUPAJ za ločitev povzetka;
  // - prazna vrstica na koncu ni del vsebine računa (most/APK poskrbi za odmik);
  // - podvojene ločilne črte ne nosijo dodatne informacije.
  // Oba seznama obdelujemo skupaj, da formati[i] vedno ostane usklajen z linee[i].
  const compactLinee: string[] = [];
  const compactFormati: string[] = [];
  for (let i = 0; i < linee.length; i++) {
    const current = linee[i];

    if (current.trim() === "") {
      const nextContent = linee.slice(i + 1).find((candidate) => candidate.trim() !== "");
      if (nextContent?.startsWith("SKUPAJ:") && compactLinee[compactLinee.length - 1]?.trim() !== "") {
        compactLinee.push("");
        compactFormati.push(formati[i]);
      }
      continue;
    }

    const previous = compactLinee[compactLinee.length - 1];
    if (/^-+$/.test(current) && previous === current) continue;

    compactLinee.push(current);
    compactFormati.push(formati[i]);
  }

  return {
    linee: compactLinee,
    formati: compactFormati,
    qrUrl: data.fursQrUrl ?? null,
    qrBase64: null,
    zoi: data.zoi ?? null,
  };
}

// ── 40-kolončni format za NYX/NB80 80mm tiskalnik ─────────────────────────────
// Artikel: naziv (prelom pri 20 znakih, 1–3 vrstice) nato takoj
//   DDV-kategorija (T1, T2...) + količina + cena€ + skupaj€ na isti vrstici.
// ZOI:/EOR: brez presledka za dvopičjem — ZOI (32 z.) in EOR (36 z.) se izpišeta
//   brez dodatnih vrstic vmesnega prostora.
export function buildNb80TextReceipt(data: PrintRacunData): ZcsRacunJson {
  data = { ...data, postavke: projectPackagingDisplayPrices(data.postavke) };
  const COLS    = 40;
  const NAZIV_W = 14;   // širina naziva (zlom tu) — skrajšano za širše stolpce zneskov
  const DDV_W   = 2;    // T1, T2 …
  const KOL_W   = 4;    // količina (npr. "   1", " 1.5", "1.25")
  const CENA_W  = 10;   // cena/kos: "  12.50 EUR" (10 znakov)
  const SUM_W   = 10;   // skupaj:   "  12.50 EUR" (10 znakov) — 14+2+4+10+10 = 40
  // Fiksirani zneskovni stolpci: cene/DDV = 10 znakov, skupaj/osnova = 11 znakov
  const fa   = (v: number) => padStart(v.toFixed(2) + " €", 10);
  const fan  = (v: number) => padStart("-" + Math.abs(v).toFixed(2) + " €", 10);
  const faL  = (v: number) => padStart(v.toFixed(2) + " €", 11);

  const linee: string[] = [];
  const formati: string[] = [];
  function line(s = "", fmt: boolean | "H" = false) { linee.push(s); formati.push(fmt === "H" ? "H" : fmt ? "B" : "N"); }

  const placilniNacinLabels: Record<string, string> = {
    gotovina: "Gotovina", kartica: "Kartica", bon: "Bon",
    bon_pica: "Bon za pico", negotovinsko: "Negotovinsko (TRR)",
  };

  const datum = data.datum.toLocaleString("sl-SI", {
    timeZone: "Europe/Ljubljana", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  const datumSamo = data.datum.toLocaleDateString("sl-SI", {
    timeZone: "Europe/Ljubljana", day: "2-digit", month: "2-digit", year: "numeric",
  });
  const dniOdloga = data.dniOdloga ?? 8;
  const datumValuteStr = (() => {
    const d = new Date(data.datum);
    d.setDate(d.getDate() + dniOdloga);
    return d.toLocaleDateString("sl-SI", { timeZone: "Europe/Ljubljana", day: "2-digit", month: "2-digit", year: "numeric" });
  })();

  const jeDdv = data.jeDdvZavezanec !== false;

  // ── GLAVA — "N" (ne "B") da 1× velikost; "B" bi pomenilo 2× in odrez pri 40 znakih ──────────
  for (const l of centerTextLines(data.nazivRestvracije ?? "RESTAVRACIJA", COLS)) line(l);
  if (data.naslovRestvracije) for (const l of centerTextLines(data.naslovRestvracije, COLS)) line(l);
  if (data.davcnaStevilka) for (const l of centerTextLines(
    jeDdv ? `ID za DDV: SI${data.davcnaStevilka}` : `Davčna št.: ${data.davcnaStevilka}`, COLS
  )) line(l);
  if (data.enotaOpis) for (const l of centerTextLines(data.enotaOpis, COLS)) line(l);
  if (data.placilnaNacin === "negotovinsko" && data.prodajalecIban)
    for (const l of centerTextLines(`TRR: ${data.prodajalecIban}`, COLS)) line(l);
  if (data.placilnaNacin === "negotovinsko" && data.prodajalecBic)
    line(centerText(`BIC: ${data.prodajalecBic}`, COLS));
  line(dashedLine(COLS));

  if (data.steviloPrintov && data.steviloPrintov > 1)
    line(centerText(`*** KOPIJA ${data.steviloPrintov - 1} ***`, COLS));

  // "H" = dvojna višina (scaleY=2, scaleX=1 — enojna širina); polnih COLS=40 znakov
  line(twoColumns("Račun:", data.stevilkaRacuna, COLS), "H");
  line(twoColumns("Datum:", datum, COLS));
  line(twoColumns("Datum opr. storitve:", datumSamo, COLS));
  if (data.placilnaNacin === "negotovinsko") line(twoColumns("Datum valute:", datumValuteStr, COLS));
  if (data.status === "testni") line(centerText("*** TESTNI RAČUN ***", COLS));

  if (data.stornoIzvornaRacunStevilka) {
    line(dashedLine(COLS));
    line("STORNO RACUNA:");
    line(data.stornoIzvornaRacunStevilka);
  }

  if (data.kupecNaziv || data.kupecDavcnaStevilka) {
    line(dashedLine(COLS));
    line("KUPEC:");
    if (data.kupecNaziv) line(data.kupecNaziv.slice(0, COLS));
    if (data.kupecDavcnaStevilka)
      line(data.kupecZavezanecDdv
        ? `ID za DDV: SI${data.kupecDavcnaStevilka}`
        : `Davčna st.: ${data.kupecDavcnaStevilka}`);
    if (data.kupecNaslov) line(data.kupecNaslov.slice(0, COLS));
  }

  if (data.vivaTerminalSessionId) {
    line(dashedLine(COLS)); line("VIVA TERMINAL:"); // "N" — 40 zn. pri 1×
    const sid = data.vivaTerminalSessionId;
    for (let i = 0; i < sid.length; i += COLS) line(sid.slice(i, i + COLS));
  }
  if (data.sumupCheckoutId) {
    line(dashedLine(COLS)); line("SUMUP CHECKOUT:"); // "N" — 40 zn. pri 1×
    const cid = data.sumupCheckoutId;
    for (let i = 0; i < cid.length; i += COLS) line(cid.slice(i, i + COLS));
  }
  if (data.vivaTransactionId && !data.vivaTerminalSessionId) {
    line(dashedLine(COLS)); line("VIVA TRANSAKCIJA:");
    const tid = data.vivaTransactionId;
    for (let i = 0; i < tid.length; i += COLS) line(tid.slice(i, i + COLS));
  }

  line(dashedLine(COLS));

  // DDV kategorije: razvrsti padajoče → T1=največ, T2=…
  const uniqueRates = [...new Set(data.postavke.map(p => p.davek))].sort((a, b) => b - a);
  const davekOkrajsava = new Map<number, string>(
    uniqueRates.map((r, i) => [r, jeDdv ? `T${i + 1}` : ""])
  );

  // ── ARTIKLI — novi 40-kolončni format ─────────────────────────────────────
  // Glava stolpcev
  line(
    padEnd("Naziv", NAZIV_W) +
    padStart("D.", DDV_W) +
    padStart("Kol.", KOL_W) +
    padStart("Cena", CENA_W) +
    padStart("Skupaj", SUM_W)
  );
  line(dashedLine(COLS));

  function fmtKol(v: number): string {
    const s = Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, "");
    return padStart(s.slice(0, KOL_W), KOL_W);
  }
  function fmtEur(v: number, w: number): string {
    return padStart(v.toFixed(2) + " €", w);
  }

  // Grupiraj dodatke pod pice
  const dodatekMap = new Map<number, PrintPostavka[]>();
  for (const p of data.postavke) {
    if (p.parentPostavkaId != null) {
      const arr = dodatekMap.get(p.parentPostavkaId) ?? [];
      arr.push(p);
      dodatekMap.set(p.parentPostavkaId, arr);
    }
  }
  const topIds = new Set(
    data.postavke.filter(p => p.parentPostavkaId == null && p.postavkaId != null)
      .map(p => p.postavkaId as number)
  );
  const topPostavke = data.postavke.filter(p => p.parentPostavkaId == null);
  const printedIds = new Set(topIds);

  const printRow = (p: PrintPostavka) => {
    const imaPopust = p.cenaKosOriginalna != null && p.cenaKosOriginalna > p.cenaKos + 0.001 && p.cenaKos > 0.001;
    const okr = jeDdv ? (davekOkrajsava.get(p.davek) ?? "").slice(0, DDV_W) : "";
    const nums = padEnd(okr, DDV_W) + fmtKol(p.kolicina) + fmtEur(p.cenaKos, CENA_W) + fmtEur(p.skupaj, SUM_W);

    // Prelom naziva pri NAZIV_W znakih, največ 3 vrstice
    const nazVrstice = wrapText(p.ime, NAZIV_W).slice(0, 3);
    if (p.jeEmbalaza) {
      for (const nameLine of nazVrstice) line(padEnd(nameLine, COLS));
      if (p.opomba) line("  " + p.opomba.slice(0, COLS - 2));
      return;
    }
    for (let i = 0; i < nazVrstice.length - 1; i++)
      line(padEnd(nazVrstice[i], COLS));                       // vmesne: samo naziv
    line(padEnd(nazVrstice[nazVrstice.length - 1], NAZIV_W) + nums); // zadnja: naziv + numerika

    if (p.opomba) line("  " + p.opomba.slice(0, COLS - 2));

    if (imaPopust && p.cenaKosOriginalna != null) {
      const popustPct = Math.round((1 - p.cenaKos / p.cenaKosOriginalna) * 100);
      const popustZn  = (p.cenaKosOriginalna - p.cenaKos) * p.kolicina;
      line(twoColumns(`  Popust ${popustPct}%:`, fan(popustZn), COLS));
    }
  };

  const printNested = (parent: PrintPostavka) => {
    for (const child of parent.postavkaId != null ? dodatekMap.get(parent.postavkaId) ?? [] : []) {
      if (child.postavkaId != null) printedIds.add(child.postavkaId);
      line("    * " + child.ime.slice(0, COLS - 6));
      if (child.skupaj !== 0 || child.cenaKos !== 0) line(twoColumns("      Dodatek:", faL(child.skupaj), COLS));
      if (child.opomba) line("      " + child.opomba.slice(0, COLS - 6));
    }
  };

  for (const p of topPostavke) {
    printRow(p);
    const pId = p.postavkaId ?? null;
    const dodatki = pId != null ? (dodatekMap.get(pId) ?? []) : [];
    const embalaze = dodatki.filter(d => d.jeEmbalaza);
    const placljeni   = dodatki.filter(d => !d.jeEmbalaza && (d.skupaj !== 0 || d.cenaKos !== 0));
    const brezplacni  = dodatki.filter(d => !d.jeEmbalaza && d.skupaj === 0 && d.cenaKos === 0);
    for (const d of embalaze) {
      if (d.postavkaId != null) printedIds.add(d.postavkaId);
      line("  " + d.ime.slice(0, COLS - 2));
      printNested(d);
    }
    for (const d of placljeni) {
      if (d.postavkaId != null) printedIds.add(d.postavkaId);
      line("+ " + d.ime.slice(0, COLS - 2));
      if (d.opomba) line("    " + d.opomba.slice(0, COLS - 4));
      line(padEnd("", NAZIV_W) + padEnd("", DDV_W) + fmtKol(d.kolicina) + fmtEur(d.cenaKos, CENA_W) + fmtEur(d.skupaj, SUM_W));
      printNested(d);
    }
    for (const d of brezplacni) {
      if (d.postavkaId != null) printedIds.add(d.postavkaId);
      line("  * " + d.ime.slice(0, COLS - 4));
      if (d.opomba) line("    " + d.opomba.slice(0, COLS - 4));
      printNested(d);
    }
    if (placljeni.length > 0) {
      const skupajPica = p.skupaj + placljeni.reduce((s, d) => s + d.skupaj, 0);
      line(twoColumns("  Skupaj artikel:", faL(skupajPica), COLS));
    }
  }
  for (const d of data.postavke.filter(d => d.parentPostavkaId != null && (d.postavkaId == null || !printedIds.has(d.postavkaId)))) printRow(d);

  line(dashedLine(COLS));

  // ── SEŠTEVKI ───────────────────────────────────────────────────────────────
  const jeBrezplacno = data.placilnaNacin === "reprezentanca" || data.placilnaNacin === "lastna_poraba";
  const skupajIzPostavk = data.postavke.reduce((s, p) => s + p.skupaj, 0);
  const brezDDV = jeBrezplacno ? skupajIzPostavk - data.ddv : data.skupaj - data.ddv;

  const skupniPrihranek = data.postavke.reduce((acc, p) => {
    const ori = p.cenaKosOriginalna;
    if (ori != null && ori > p.cenaKos + 0.001 && p.cenaKos > 0.001) acc += (ori - p.cenaKos) * p.kolicina;
    return acc;
  }, 0);
  if (skupniPrihranek > 0.001) line(twoColumns("Popust:", fan(skupniPrihranek), COLS));
  if (jeBrezplacno) {
    line(twoColumns(data.placilnaNacin === "reprezentanca" ? "Reprezentanca:" : "Lastna poraba:", "", COLS));
    line(twoColumns("100% popust:", fan(skupajIzPostavk), COLS));
  }
  if (jeDdv) {
    line(twoColumns("Osnova (brez DDV):", faL(brezDDV), COLS));
    line(twoColumns("DDV skupaj:", fa(data.ddv), COLS));
  }
  line("");
  // "H" = dvojna višina; polnih COLS=40 znakov; vejica format (dogovorjeni za 80mm)
  const fmt2H = (v: number) => v.toFixed(2).replace(".", ",") + "€";
  line(twoColumns("SKUPAJ:", fmt2H(data.skupaj), COLS), "H");

  // DDV razrez po stopnjah
  if (jeDdv) {
    const ddvPoStopnji = new Map<number, { skupajPostavke: number; ddvZnesek: number }>();
    for (const p of data.postavke) {
      const ddvZnesek = Math.round(p.skupaj * p.davek / (100 + p.davek) * 100) / 100;
      const ex = ddvPoStopnji.get(p.davek) ?? { skupajPostavke: 0, ddvZnesek: 0 };
      ddvPoStopnji.set(p.davek, { skupajPostavke: ex.skupajPostavke + p.skupaj, ddvZnesek: ex.ddvZnesek + ddvZnesek });
    }
    const ddvVrstice = Array.from(ddvPoStopnji.entries()).sort(([a], [b]) => a - b)
      .map(([s, v]) => ({ stopnja: s, osnova: v.skupajPostavke - v.ddvZnesek, ddvZnesek: v.ddvZnesek }))
      .filter(v => v.osnova > 0.001 || v.ddvZnesek > 0.001);
    if (ddvVrstice.length > 0) {
      line(dashedLine(COLS));
      const dC3 = 10, dC2 = 11, dC1 = COLS - dC2 - dC3;
      line(padEnd("Stopnja", dC1) + padStart("Osnova", dC2) + padStart("DDV", dC3));
      for (const { stopnja, osnova, ddvZnesek } of ddvVrstice) {
        const okr = davekOkrajsava.get(stopnja) ?? "";
        line(padEnd(`${okr} DDV ${stopnja}%:`, dC1) + faL(osnova) + fa(ddvZnesek));
      }
    }
  }

  if (data.mizaStevilka) line(twoColumns("Miza:", String(data.mizaStevilka), COLS));
  if (data.natakarIme)   line(twoColumns("Natakar:", firstNameOnly(data.natakarIme).slice(0, 20), COLS));

  // Boni
  const bonPicaZn = data.znesekBonPica ?? 0;
  const bonZn     = data.znesekBon ?? 0;
  const imaBone   = Math.abs(bonPicaZn) > 0.005 || Math.abs(bonZn) > 0.005;
  if (imaBone) {
    line("");
    if (Math.abs(bonPicaZn) > 0.005)
      line(twoColumns(`Bon za pico${data.steviloBonov ? ` (${data.steviloBonov}×)` : ""}:`, fan(bonPicaZn), COLS));
    if (Math.abs(bonZn) > 0.005) line(twoColumns("Darilni bon:", fan(bonZn), COLS));
    if (bonZn > 0) {
      line("");
      line(twoColumns("Ostane za plačilo:", faL(Math.max(0, data.skupaj - bonZn)), COLS)); // "N" — 1×
    }
  }

  if (imaBone) line("");
  const gotZn   = data.znesekGotovina ?? 0;
  const kartZn  = data.znesekKartica ?? 0;
  const napitnina = data.znesekNapitnina ?? 0;
  const negotZn = data.znesekNegotovinsko ?? 0;
  if (Math.abs(gotZn) > 0.005) line(twoColumns("Gotovina:", fa(gotZn), COLS));
  if (Math.abs(napitnina) > 0.005) line(twoColumns("Napitnina:", fa(napitnina), COLS));
  if (Math.abs(kartZn) > 0.005) line(twoColumns("Kartica skupaj:", fa(kartZn), COLS));
  if (Math.abs(negotZn) > 0.005) line(twoColumns("Negotovinsko:", fa(negotZn), COLS));
  if (![gotZn, kartZn, napitnina, negotZn, bonPicaZn, bonZn].some((znesek) => Math.abs(znesek) > 0.005))
    line(twoColumns((placilniNacinLabels[data.placilnaNacin] ?? data.placilnaNacin) + ":", faL(data.skupaj), COLS));

  line(dashedLine(COLS));

  // ── FURS — ZOI:/EOR: brez presledka za dvopičjem ─────────────────────────
  // ZOI je 32 hex znakov → "ZOI:" + 32 = 36 znakov (krajše od 40) → ena vrstica
  // EOR je 36 znakov (UUID) → "EOR:" + 36 = 40 znakov → točno ena vrstica
  if (data.zoi) {
    line(centerText("DAVČNA POTRDITEV (FURS)", COLS));
    const zoiStr = "ZOI:" + data.zoi;
    for (let i = 0; i < zoiStr.length; i += COLS) line(zoiStr.slice(i, i + COLS));
    if (data.eor) {
      const eorStr = "EOR:" + data.eor;
      for (let i = 0; i < eorStr.length; i += COLS) line(eorStr.slice(i, i + COLS));
    }
    line(dashedLine(COLS));
  }

  // Registrski podatki (samo negotovinsko)
  if (data.placilnaNacin === "negotovinsko") {
    const vpis = buildRegistrskiVpis(data.racunMaticna, data.racunSodisce, data.racunKapital);
    if (vpis) { line(dashedLine(COLS)); for (const l of wrapText(vpis, COLS)) line(l); }
    if (data.racunPravnaKlavzula) {
      line(dashedLine(COLS));
      for (const l of wrapText(data.racunPravnaKlavzula, COLS)) line(l);
    }
  }
  if (data.racunDdvKlavzula && (!jeDdv || data.placilnaNacin === "negotovinsko")) {
    line(dashedLine(COLS));
    for (const l of wrapText(data.racunDdvKlavzula, COLS)) line(l);
  }

  if (data.racunPozdrav1) line(centerText(data.racunPozdrav1, COLS));
  if (data.racunPozdrav2) line(centerText(data.racunPozdrav2, COLS));
  line("");

  return { linee, formati, qrUrl: data.fursQrUrl ?? null, qrBase64: null, zoi: data.zoi ?? null };
}

export function buildEscPosReceipt(
  data: PrintRacunData,
  cols = 32,
  opts?: { encoding?: "cp1250" | "wpc1250" | "cp852" | "ascii-translit" },
): Uint8Array {
  data = { ...data, postavke: projectPackagingDisplayPrices(data.postavke) };
  const enc        = opts?.encoding ?? "cp1250";
  const codepageCmd = enc === "ascii-translit"
    ? CMD.CODE_PAGE_437     // PC437 (n=0) — standardna ASCII privzeta tabela
    : enc === "cp852"
      ? CMD.CODE_PAGE_852
      : enc === "wpc1250"
        ? CMD.CODE_PAGE_1250_WPC
        : CMD.CODE_PAGE_1250;
  const chunks: Buffer[] = [];

  function bytes(...cmds: number[][]): void {
    chunks.push(Buffer.from(cmds.flat()));
  }

  function text(s: string): void {
    chunks.push(encodeText(s, enc));
  }

  function line(s = ""): void {
    text(s);
    bytes([LF]);
  }

  function empty(n = 1): void {
    for (let i = 0; i < n; i++) bytes([LF]);
  }

  // N() normalizira nize za layout izračun PRED gradnjo vrstic.
  //
  // ascii-translit: N = transliterateToAscii — šumniki → ASCII PRED
  //   padStart/padEnd/twoColumns; encodeText() je potem idempotenten za ASCII.
  //
  // CP852/CP1250/WPC1250: N = identiteta — € ostane 1 znak v JS stringu,
  //   padStart/padEnd računata pravilno; encodeText() vstavi pravilne bajte.
  const N: (s: string) => string =
    enc === "ascii-translit" ? transliterateToAscii : (s) => s;

  // Valutni simbol za ne-translit tisk (CP1250/WPC1250/CP852):
  // – CP852:          "€" — encodeText() vstavi inline CP858 sekvenco
  // – CP1250/WPC1250: "€" — windows-1250 ima € = 0x80 nativno
  const C = "€";

  // ascii-translit: valuta je označena prek GLAVE tabele (EUR v stolpcu) in POVZETKOV.
  // Posamezni zneski so GOLA ŠTEVILA brez valutne pripone — ne "12.50 EUR" temveč "    12.50".
  // Ne-translit: pripona je " €" (prostor + simbol).
  const amtSuffix = enc === "ascii-translit" ? "" : " " + C;

  // Lokalne verzije layout funkcij, ki senčijo module-level in vključijo N().
  // Kličejo se na vsakem klicu znotraj buildEscPosReceipt samodejno.
  /* eslint-disable no-inner-declarations */
  function padEnd(s: string, len: number): string {
    const ns = N(s);
    return ns.length >= len ? ns.slice(0, len) : ns + " ".repeat(len - ns.length);
  }
  function padStart(s: string, len: number): string {
    const ns = N(s);
    return ns.length >= len ? ns.slice(0, len) : " ".repeat(len - ns.length) + ns;
  }
  function twoColumns(left: string, right: string, total = 32): string {
    const nr = N(right);
    const nl = N(left);
    const rLen   = nr.length;
    const lMax   = total - rLen - 1;
    const lTrunc = nl.length > lMax ? nl.slice(0, lMax) : nl;
    return (lTrunc.length < lMax ? lTrunc + " ".repeat(lMax - lTrunc.length) : lTrunc) + " " + nr;
  }
  /* eslint-enable no-inner-declarations */

  // Fiksirani zneskovni stolpci: cene/DDV = 10 znakov, skupaj/osnova = 11 znakov
  // ascii-translit: amtSuffix="" → gola števila brez valutnega simbola.
  // CP852/CP1250/WPC1250: amtSuffix=" €" → encodeText() prevede v pravilne bajte.
  const fa   = (v: number) => padStart(v.toFixed(2) + amtSuffix, 10);
  const fan  = (v: number) => padStart("-" + Math.abs(v).toFixed(2) + amtSuffix, 10);
  const faL  = (v: number) => padStart(v.toFixed(2) + amtSuffix, 11);

  // Oznaka z "(EUR)" za ascii-translit povzetke: vstavi "(EUR)" pred zaključni ":".
  // Vzdrži ≤ lMax znakov — twoColumns() samodejno skrajša, ampak konkretne pretvorbe
  // zagotovijo smiselno branje brez rezanja na sredini besede.
  function lbl(label: string): string {
    if (enc !== "ascii-translit") return label;
    const MAP: Record<string, string> = {
      "SKUPAJ:":             "SKUPAJ (EUR):",
      "Osnova (brez DDV):":  "Osn. brez DDV (EUR):",  // 20 znakov = lMax faL
      "DDV skupaj:":         "DDV skupaj (EUR):",
      "Popust:":             "Popust (EUR):",
      "100% popust:":        "100% popust (EUR):",
      "Gotovina:":           "Gotovina (EUR):",
      "Kartica:":            "Kartica (EUR):",
      "Negotovinsko:":       "Negotovinsko (EUR):",
      "Reprezentanca:":      "Reprezentanca (EUR):",  // 20 znakov = lMax faL
      "Lastna poraba:":      "Lastna poraba (EUR):",
      "Ostane za plačilo:":  "Ostane pl. (EUR):",
      "  Skupaj artikel:":   "  Skupaj art. (EUR):",  // 20 znakov = lMax faL
    };
    if (label in MAP) return MAP[label];
    // Generičen fallback: vstavi "(EUR)" pred ":" → twoColumns() skrajša po potrebi
    return label.endsWith(":") ? label.slice(0, -1) + " (EUR):" : label + " (EUR)";
  }

  const placilniNacinLabels: Record<string, string> = {
    gotovina:      "Gotovina",
    kartica:       "Kartica",
    bon:           "Bon",
    bon_pica:      "Bon za pico",
    negotovinsko:  "Negotovinsko (TRR)",
    reprezentanca: "Reprezentanca",
    lastna_poraba: "Lastna poraba",
  };

  const datum = data.datum.toLocaleString("sl-SI", {
    timeZone: "Europe/Ljubljana",
    day:    "2-digit",
    month:  "2-digit",
    year:   "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  });
  const datumSamo = data.datum.toLocaleDateString("sl-SI", {
    timeZone: "Europe/Ljubljana",
    day:   "2-digit",
    month: "2-digit",
    year:  "numeric",
  });

  const dniOdloga = data.dniOdloga ?? 8;
  const datumValuteStr = (() => {
    const d = new Date(data.datum);
    d.setDate(d.getDate() + dniOdloga);
    return d.toLocaleDateString("sl-SI", { timeZone: "Europe/Ljubljana", day: "2-digit", month: "2-digit", year: "numeric" });
  })();

  const jeDdv = data.jeDdvZavezanec !== false;

  // --- HEADER ---
  bytes(CMD.INIT);
  bytes(CMD.DISABLE_CHINESE); // izklopi GB2312 kitajski način (Xprinter, POS-58 ipd.)
  bytes(codepageCmd);  // nastavi kodna stran (cp1250 ali cp852)
  bytes(CMD.ALIGN_CENTER);
  bytes(CMD.BOLD_ON);
  for (const l of wrapText(data.nazivRestvracije ?? "RESTAVRACIJA", cols)) line(l);
  if (data.naslovRestvracije) for (const l of wrapText(data.naslovRestvracije, cols)) line(l);
  if (data.davcnaStevilka) for (const l of wrapText(jeDdv ? `ID za DDV: SI${data.davcnaStevilka}` : `Davčna št.: ${data.davcnaStevilka}`, cols)) line(l);
  if (data.enotaOpis) for (const l of wrapText(data.enotaOpis, cols)) line(l);
  if (data.placilnaNacin === "negotovinsko" && data.prodajalecIban) for (const l of wrapText(`TRR: ${data.prodajalecIban}`, cols)) line(l);
  if (data.placilnaNacin === "negotovinsko" && data.prodajalecBic) line(`BIC: ${data.prodajalecBic}`);
  bytes(CMD.BOLD_OFF);
  bytes(CMD.ALIGN_LEFT);
  line(dashedLine(cols));

  // --- KOPIJA HEADER ---
  if (data.steviloPrintov && data.steviloPrintov > 1) {
    bytes(CMD.ALIGN_CENTER);
    bytes(CMD.BOLD_ON);
    line(`*** KOPIJA ${data.steviloPrintov - 1} ***`);
    bytes(CMD.BOLD_OFF);
    bytes(CMD.ALIGN_LEFT);
  }

  // --- RECEIPT INFO — glava: samo identifikacijski podatki ---
  bytes(CMD.BOLD_ON);
  line(twoColumns("Račun:", data.stevilkaRacuna, cols));
  bytes(CMD.BOLD_OFF);
  line(twoColumns("Datum:", datum, cols));
  line(twoColumns("Datum opr. storitve:", datumSamo, cols));
  if (data.placilnaNacin === "negotovinsko") line(twoColumns("Datum valute:", datumValuteStr, cols));
  if (data.status === "testni") {
    bytes(CMD.ALIGN_CENTER);
    line("*** TESTNI RAČUN ***");
    bytes(CMD.ALIGN_LEFT);
  }

  // --- STORNO REFERENCA ---
  if (data.stornoIzvornaRacunStevilka) {
    line(dashedLine(cols));
    bytes(CMD.BOLD_ON);
    line("STORNO RACUNA:");
    bytes(CMD.BOLD_OFF);
    line(data.stornoIzvornaRacunStevilka);
  }

  // --- KUPEC ---
  if (data.kupecNaziv || data.kupecDavcnaStevilka) {
    line(dashedLine(cols));
    bytes(CMD.BOLD_ON);
    line("KUPEC:"); // brez šumevcev — kratka oznaka
    bytes(CMD.BOLD_OFF);
    if (data.kupecNaziv) line(data.kupecNaziv.slice(0, cols));
    if (data.kupecDavcnaStevilka) line(data.kupecZavezanecDdv ? `ID za DDV: SI${data.kupecDavcnaStevilka}` : `Davčna št.: ${data.kupecDavcnaStevilka}`);
    if (data.kupecNaslov) line(data.kupecNaslov.slice(0, cols));
  }

  // --- VIVA TERMINAL ---
  if (data.vivaTerminalSessionId) {
    line(dashedLine(cols));
    bytes(CMD.BOLD_ON);
    line("VIVA TERMINAL:");
    bytes(CMD.BOLD_OFF);
    const sid = data.vivaTerminalSessionId;
    for (let i = 0; i < sid.length; i += cols) {
      line(sid.slice(i, i + cols));
    }
  }

  // --- SUMUP CHECKOUT ---
  if (data.sumupCheckoutId) {
    line(dashedLine(cols));
    bytes(CMD.BOLD_ON);
    line("SUMUP CHECKOUT:");
    bytes(CMD.BOLD_OFF);
    const cid = data.sumupCheckoutId;
    for (let i = 0; i < cid.length; i += cols) {
      line(cid.slice(i, i + cols));
    }
  }

  // --- VIVA TRANSAKCIJA ---
  if (data.vivaTransactionId && !data.vivaTerminalSessionId) {
    line(dashedLine(cols));
    bytes(CMD.BOLD_ON);
    line("VIVA TRANSAKCIJA:");
    bytes(CMD.BOLD_OFF);
    const tid = data.vivaTransactionId;
    for (let i = 0; i < tid.length; i += cols) {
      line(tid.slice(i, i + cols));
    }
  }

  line(dashedLine(cols));

  // Okrajšave DDV stopenj: T1 = najvišja stopnja, T2 = naslednja (samo za zavezance)
  const uniqueRates = [...new Set(data.postavke.map((p) => p.davek))].sort((a, b) => b - a);
  const davekOkrajsava = new Map<number, string>(uniqueRates.map((r, i) => [r, jeDdv ? `T${i + 1}` : ""]));

  // --- ITEMS — 4 kolone, desno poravnane, ločene z enim presledkom ---
  const kolW = 4, cenaW = 10, skupajW = 10;
  const artW = cols - 3 - kolW - cenaW - skupajW;
  function itemVrstica(art: string, kol: string, cena: string, skupaj: string): string {
    return padStart(art.slice(0, artW), artW) + " " + padStart(kol, kolW) + " " + padStart(cena, cenaW) + " " + padStart(skupaj, skupajW);
  }
  line(itemVrstica("Art.", "Kol.", "Cena", "Skupaj"));
  // ascii-translit: valuta je označena v glavi tabele — (EUR) pod stolpcema Cena in Skupaj
  if (enc === "ascii-translit") {
    line(
      " ".repeat(artW) + " " + " ".repeat(kolW) + " " +
      padStart("(EUR)", cenaW) + " " + padStart("(EUR)", skupajW)
    );
  }
  line(dashedLine(cols));

  // Grupiranje: dodatki pod pico
  const dodatekMapEsc = new Map<number, PrintPostavka[]>();
  for (const p of data.postavke) {
    if (p.parentPostavkaId != null) {
      const arr = dodatekMapEsc.get(p.parentPostavkaId) ?? [];
      arr.push(p);
      dodatekMapEsc.set(p.parentPostavkaId, arr);
    }
  }
  const topPostavkeEscIds = new Set(data.postavke.filter(p => p.parentPostavkaId == null && p.postavkaId != null).map(p => p.postavkaId as number));
  const topPostavkeEsc = data.postavke.filter(p => p.parentPostavkaId == null);
  const printedIdsEsc = new Set(topPostavkeEscIds);

  const printPostavkaRowEsc = (p: PrintPostavka) => {
    const cenaKosOriginalna = p.cenaKosOriginalna;
    // imaPopust: samo pri delnem popustu (cenaKos > 0); 100% bon za pico preskočimo
    const imaPopust = cenaKosOriginalna != null && cenaKosOriginalna > p.cenaKos + 0.001 && p.cenaKos > 0.001;
    const okr = davekOkrajsava.get(p.davek) ?? "";
    line(p.ime.slice(0, cols));
    if (p.opomba) line("  " + p.opomba.slice(0, cols - 2));
    if (p.jeEmbalaza) return;
    if (imaPopust && cenaKosOriginalna != null) {
      const popustPct = Math.round((1 - p.cenaKos / cenaKosOriginalna) * 100);
      const popustZnesek = cenaKosOriginalna - p.cenaKos;
      // ascii-translit: gola vrednost + "/kos" (brez €); ostalo: "n.nn €/kos"
      const kosUnit = enc === "ascii-translit" ? "/kos" : " €/kos";
      line(twoColumns("  Redna cena:", `${cenaKosOriginalna.toFixed(2)}${kosUnit}`, cols));
      line(twoColumns(`  Popust ${popustPct}%:`, `-${popustZnesek.toFixed(2)}${kosUnit}`, cols));
    }
    line(padEnd(okr, artW) + " " + padStart(String(p.kolicina), kolW) + " " + padStart(p.cenaKos.toFixed(2) + amtSuffix, cenaW) + " " + padStart(p.skupaj.toFixed(2) + amtSuffix, skupajW));
  };

  const printNestedEsc = (parent: PrintPostavka) => {
    for (const child of parent.postavkaId != null ? dodatekMapEsc.get(parent.postavkaId) ?? [] : []) {
      if (child.postavkaId != null) printedIdsEsc.add(child.postavkaId);
      line("    * " + child.ime.slice(0, cols - 6));
      if (child.skupaj !== 0 || child.cenaKos !== 0) line(twoColumns(lbl("      Dodatek:"), faL(child.skupaj), cols));
      if (child.opomba) line("      " + child.opomba.slice(0, cols - 6));
    }
  };

  for (const p of topPostavkeEsc) {
    printPostavkaRowEsc(p);
    // Dodatki
    const pIdEsc = p.postavkaId ?? null;
    const dodatki = pIdEsc != null ? (dodatekMapEsc.get(pIdEsc) ?? []) : [];
    const embalazeEsc = dodatki.filter(d => d.jeEmbalaza);
    const placljeniDodatkiEsc = dodatki.filter(d => !d.jeEmbalaza && (d.skupaj !== 0 || d.cenaKos !== 0));
    const brezplacniDodatkiEsc = dodatki.filter(d => !d.jeEmbalaza && d.skupaj === 0 && d.cenaKos === 0);
    for (const d of embalazeEsc) {
      if (d.postavkaId != null) printedIdsEsc.add(d.postavkaId);
      line("  " + d.ime.slice(0, cols - 2));
      printNestedEsc(d);
    }
    for (const d of placljeniDodatkiEsc) {
      if (d.postavkaId != null) printedIdsEsc.add(d.postavkaId);
      line("+ " + d.ime.slice(0, cols - 2));
      if (d.opomba) line("    " + d.opomba.slice(0, cols - 4));
      line(padEnd("", artW) + " " + padStart(String(d.kolicina), kolW) + " " + padStart(d.cenaKos.toFixed(2) + amtSuffix, cenaW) + " " + padStart(d.skupaj.toFixed(2) + amtSuffix, skupajW));
      printNestedEsc(d);
    }
    for (const d of brezplacniDodatkiEsc) {
      if (d.postavkaId != null) printedIdsEsc.add(d.postavkaId);
      line("  * " + d.ime.slice(0, cols - 4));
      if (d.opomba) line("    " + d.opomba.slice(0, cols - 4));
      printNestedEsc(d);
    }
    if (placljeniDodatkiEsc.length > 0) {
      const skupajPica = p.skupaj + placljeniDodatkiEsc.reduce((s, d) => s + d.skupaj, 0);
      line(twoColumns(lbl("  Skupaj artikel:"), faL(skupajPica), cols));
    }
  }
  // Osirotele dodatke tiskamo kot samostojne postavke
  for (const d of data.postavke.filter(d => d.parentPostavkaId != null && (d.postavkaId == null || !printedIdsEsc.has(d.postavkaId)))) {
    printPostavkaRowEsc(d);
  }

  line(dashedLine(cols));

  // --- TOTALS ---
  const jeBrezplacnoEsc = data.placilnaNacin === "reprezentanca" || data.placilnaNacin === "lastna_poraba";
  const skupajIzPostavkEsc = data.postavke.reduce((s, p) => s + p.skupaj, 0);
  const brezDDV = jeBrezplacnoEsc ? skupajIzPostavkEsc - data.ddv : data.skupaj - data.ddv;

  // Popust — prikazan PRED osnovo; preskočimo 100% bon za pico (cenaKos=0)
  const skupniPrihranekEsc = data.postavke.reduce((acc, p) => {
    const ori = p.cenaKosOriginalna;
    if (ori != null && ori > p.cenaKos + 0.001 && p.cenaKos > 0.001) acc += (ori - p.cenaKos) * p.kolicina;
    return acc;
  }, 0);
  if (skupniPrihranekEsc > 0.001) {
    line(twoColumns(lbl("Popust:"), fan(skupniPrihranekEsc), cols));
  }
  if (jeBrezplacnoEsc) {
    line(twoColumns(lbl(data.placilnaNacin === "reprezentanca" ? "Reprezentanca:" : "Lastna poraba:"), "", cols));
    line(twoColumns(lbl("100% popust:"), fan(skupajIzPostavkEsc), cols));
  }
  if (jeDdv) {
    line(twoColumns(lbl("Osnova (brez DDV):"), faL(brezDDV), cols));
    line(twoColumns(lbl("DDV skupaj:"), fa(data.ddv), cols));
  }
  empty();
  bytes(CMD.BOLD_ON);
  line(twoColumns(lbl("SKUPAJ:"), faL(data.skupaj), cols));
  bytes(CMD.BOLD_OFF);

  // DDV razrez po stopnjah — samo za zavezance
  if (jeDdv) {
    const ddvPoStopnji = new Map<number, { skupajPostavke: number; ddvZnesek: number }>();
    for (const p of data.postavke) {
      const ddvZnesek = Math.round(p.skupaj * p.davek / (100 + p.davek) * 100) / 100;
      const ex = ddvPoStopnji.get(p.davek) ?? { skupajPostavke: 0, ddvZnesek: 0 };
      ddvPoStopnji.set(p.davek, { skupajPostavke: ex.skupajPostavke + p.skupaj, ddvZnesek: ex.ddvZnesek + ddvZnesek });
    }
    const ddvVrstice = Array.from(ddvPoStopnji.entries())
      .sort(([a], [b]) => a - b)
      .map(([s, v]) => ({ stopnja: s, osnova: v.skupajPostavke - v.ddvZnesek, ddvZnesek: v.ddvZnesek }))
      .filter(v => v.osnova > 0.001 || v.ddvZnesek > 0.001); // preskoči ničelne vrstice (bon za pico → 0 € pice)
    if (ddvVrstice.length > 0) {
      line(dashedLine(cols));
      const dC3 = 10, dC2 = 11, dC1 = cols - dC2 - dC3;
      // ascii-translit: dodaj "(EUR)" v naslova numeričnih stolpcev (enkrat za celotno tabelo)
      if (enc === "ascii-translit") {
        line(padEnd("Stopnja", dC1) + padStart("Osn.(EUR)", dC2) + padStart("DDV(EUR)", dC3));
      } else {
        line(padEnd("Stopnja", dC1) + padStart("Osnova", dC2) + padStart("DDV", dC3));
      }
      for (const { stopnja, osnova, ddvZnesek } of ddvVrstice) {
        const okr = davekOkrajsava.get(stopnja) ?? "";
        line(padEnd(`${okr} DDV ${stopnja}%:`, dC1) + faL(osnova) + fa(ddvZnesek));
      }
    }
  }

  // Miza in natakar — prestavljeno iz glave
  if (data.mizaStevilka) line(twoColumns("Miza:", String(data.mizaStevilka), cols));
  if (data.natakarIme) line(twoColumns("Natakar:", firstNameOnly(data.natakarIme).slice(0, 20), cols));

  // Boni — bon za pico je informativna vrstica (skupaj je že zmanjšan za bon za pico)
  const bonPicaZnEsc = data.znesekBonPica ?? 0;
  const bonZnEsc = data.znesekBon ?? 0;
  const imaBoneEsc = Math.abs(bonPicaZnEsc) > 0.005 || Math.abs(bonZnEsc) > 0.005;
  if (imaBoneEsc) {
    empty();
    if (Math.abs(bonPicaZnEsc) > 0.005) line(twoColumns(`Bon za pico${data.steviloBonov ? ` (${data.steviloBonov}×)` : ""}:`, fan(bonPicaZnEsc), cols));
    if (Math.abs(bonZnEsc) > 0.005) line(twoColumns("Darilni bon:", fan(bonZnEsc), cols));

    // Ostane za plačilo — samo kadar je darilni bon (skupaj je že neto, bon za pico je samo info)
    if (bonZnEsc > 0) {
      empty();
      const ostaneZaPlacilo = Math.max(0, data.skupaj - bonZnEsc);
      bytes(CMD.BOLD_ON);
      line(twoColumns(lbl("Ostane za plačilo:"), faL(ostaneZaPlacilo), cols));
      bytes(CMD.BOLD_OFF);
    }
  }

  // Vrsta plačila
  if (imaBoneEsc) empty();
  const gotZnEsc = data.znesekGotovina ?? 0;
  const kartZnEsc = data.znesekKartica ?? 0;
  const napitninaEsc = data.znesekNapitnina ?? 0;
  const negotZnEsc = data.znesekNegotovinsko ?? 0;
  if (Math.abs(gotZnEsc) > 0.005) line(twoColumns(lbl("Gotovina:"), fa(gotZnEsc), cols));
  if (Math.abs(napitninaEsc) > 0.005) line(twoColumns(lbl("Napitnina:"), fa(napitninaEsc), cols));
  if (Math.abs(kartZnEsc) > 0.005) line(twoColumns(lbl("Kartica skupaj:"), fa(kartZnEsc), cols));
  if (Math.abs(negotZnEsc) > 0.005) line(twoColumns(lbl("Negotovinsko:"), fa(negotZnEsc), cols));
  if (![gotZnEsc, kartZnEsc, napitninaEsc, negotZnEsc, bonPicaZnEsc, bonZnEsc].some((znesek) => Math.abs(znesek) > 0.005)) {
    line(twoColumns(lbl((placilniNacinLabels[data.placilnaNacin] ?? data.placilnaNacin) + ":"), faL(data.skupaj), cols));
  }

  line(dashedLine(cols));

  // --- FURS SECTION ---
  if (data.zoi) {
    bytes(CMD.ALIGN_CENTER);
    bytes(CMD.BOLD_ON);
    line("DAVČNA POTRDITEV (FURS)");
    bytes(CMD.BOLD_OFF);
    bytes(CMD.ALIGN_LEFT);
    const zoiLabel = "ZOI: ";
    const zoiValue = data.zoi;
    line(zoiLabel + zoiValue.slice(0, cols - zoiLabel.length));
    if (zoiValue.length > cols - zoiLabel.length) {
      line("     " + zoiValue.slice(cols - zoiLabel.length));
    }
    if (data.eor) {
      const eorLabel = "EOR: ";
      line(eorLabel + data.eor.slice(0, cols - eorLabel.length));
      if (data.eor.length > cols - eorLabel.length) {
        line("     " + data.eor.slice(cols - eorLabel.length));
      }
    }
    // QR koda — GS v 0 rasterski bitmap (podprto na vseh ESC/POS tiskalnikih)
    // GS v 0 ignorira ALIGN ukaze → centriramo z levo ničelno obrobo v qrRasterBytes.
    // 58mm (cols=32) → 48 tiskovalnih bajtov/vrstico; 80mm (cols=40) → 64 bajtov/vrstico.
    if (data.fursQrUrl) {
      empty();
      const printableBytes = cols >= 40 ? 64 : 48;
      bytes(qrRasterBytes(data.fursQrUrl, 6, printableBytes));
      empty();
    }
    line(dashedLine(cols));
  }

  // --- REGISTRSKI PODATKI — samo za negotovinsko (TRR), strnjeno + manjša pisava ---
  if (data.placilnaNacin === "negotovinsko") {
    const vpis = buildRegistrskiVpis(data.racunMaticna, data.racunSodisce, data.racunKapital);
    if (vpis) {
      line(dashedLine(cols));
      bytes(CMD.FONT_B);
      for (const l of wrapText(vpis, cols)) line(l);
      bytes(CMD.FONT_A);
    }
    if (data.racunPravnaKlavzula) {
      line(dashedLine(cols));
      bytes(CMD.FONT_B);
      for (const l of wrapText(data.racunPravnaKlavzula, cols)) line(l);
      bytes(CMD.FONT_A);
    }
  }
  // DDV klavzula — za nezavezance vedno, za zavezance samo pri negotovinskem
  if (data.racunDdvKlavzula && (!jeDdv || data.placilnaNacin === "negotovinsko")) {
    line(dashedLine(cols));
    bytes(CMD.FONT_B);
    for (const l of wrapText(data.racunDdvKlavzula, cols)) line(l);
    bytes(CMD.FONT_A);
  }

  // --- FOOTER ---
  bytes(CMD.ALIGN_CENTER);
  if (data.racunPozdrav1) line(data.racunPozdrav1);
  if (data.racunPozdrav2) line(data.racunPozdrav2);
  empty();

  // --- CUT ---
  bytes(CMD.FEED_3);
  bytes(CMD.CUT);

  return Buffer.concat(chunks);
}
