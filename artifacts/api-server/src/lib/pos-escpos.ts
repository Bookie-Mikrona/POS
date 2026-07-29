/**
 * ESC/POS byte builder for thermal receipt printers.
 * Uses Windows-1250 (CP1250, ESC t 45=0x2D) — robustno za č, š, ž na vseh tiskalnikih.
 * iconv-lite windows1250 in Android charset("windows-1250") sta identični tablici.
 */
import iconv from "iconv-lite";

// --- ESC/POS command constants ---
const ESC = 0x1b;
const GS  = 0x1d;
const LF  = 0x0a;

/**
 * Enkodira niz v Windows-1250 bajte.
 * č=0xE8, š=0x9A, ž=0x9E — standardne vrednosti, enake na strežniku in Android SDK.
 */
function encodeText(s: string): Buffer {
  return iconv.encode(s, "windows1250");
}

const FS = 0x1c;

const CMD = {
  INIT:            [ESC, 0x40],
  DISABLE_CHINESE: [FS,  0x2E],        // FS . — izklopi GB2312 kitajski način (za kitajske tiskalnike)
  CODE_PAGE_1250:  [ESC, 0x74, 0x2D], // CP1250 Windows-1250 (n=45=0x2D)
  CODE_PAGE_852:   [ESC, 0x74, 0x12], // PC852 Latin-2 (alternativa, n=18)
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

/** ESC/POS QR code — GS ( k sequence (model 2, module size 5, error correction M) */
function qrCodeBytes(url: string): number[] {
  const data = Array.from(Buffer.from(url, "ascii"));
  const payloadLen = data.length + 3; // cn + fn + m + data
  const pL = payloadLen & 0xff;
  const pH = (payloadLen >> 8) & 0xff;
  return [
    // Set model 2
    GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00,
    // Module size 5
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x05,
    // Error correction level M
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31,
    // Store data
    GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30, ...data,
    // Print
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30,
  ];
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
}

/**
 * Zgradi seznam besedilnih vrstic za ZCS Android tiskalnik (UTF-8 JSON, brez bajt kodiranja).
 * Enaka vsebina kot buildEscPosReceipt, a brez ESC/POS ukazov.
 */
export function buildTextReceipt(data: PrintRacunData, cols = 32): ZcsRacunJson {
  const linee: string[] = [];
  const formati: string[] = [];
  function line(s = "", bold = false) { linee.push(s); formati.push(bold ? "B" : "N"); }

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
  line(twoColumns("Račun:", data.stevilkaRacuna, cols), true);
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

  line(dashedLine(cols));

  const uniqueRates = [...new Set(data.postavke.map((p) => p.davek))].sort((a, b) => b - a);
  const davekOkrajsava = new Map<number, string>(uniqueRates.map((r, i) => [r, jeDdv ? `T${i + 1}` : ""]));

  // ITEMS — 4 kolone, desno poravnane, ločene z enim presledkom
  const kolW = 4, cenaW = 9, skupajW = 9;
  const artW = cols - 3 - kolW - cenaW - skupajW; // 3 presledki med kolonami
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
  const orphanDodatki = data.postavke.filter(p => p.parentPostavkaId != null && !topPostavkeIds.has(p.parentPostavkaId));

  const printPostavkaRow = (p: PrintPostavka) => {
    // imaPopust: prikaži "Redna cena / Popust X%" samo pri delnem popustu (cenaKos > 0).
    // Ko cenaKos=0 (100% popust z bon za pico), vrstice preskočimo — "Bon za pico" spodaj že pojasni.
    const imaPopust = p.cenaKosOriginalna != null && p.cenaKosOriginalna > p.cenaKos + 0.001 && p.cenaKos > 0.001;
    const okr = davekOkrajsava.get(p.davek) ?? "";
    line(p.ime.slice(0, cols));
    if (p.opomba) line("  " + p.opomba.slice(0, cols - 2));
    if (imaPopust && p.cenaKosOriginalna != null) {
      const popustPct = Math.round((1 - p.cenaKos / p.cenaKosOriginalna) * 100);
      const popustZnesek = p.cenaKosOriginalna - p.cenaKos;
      line(twoColumns("  Redna cena:", `${p.cenaKosOriginalna.toFixed(2)} €/kos`, cols));
      line(twoColumns(`  Popust ${popustPct}%:`, `-${popustZnesek.toFixed(2)} €/kos`, cols));
    }
    line(padEnd(okr, artW) + " " + padStart(String(p.kolicina), kolW) + " " + padStart(p.cenaKos.toFixed(2) + " €", cenaW) + " " + padStart(p.skupaj.toFixed(2) + " €", skupajW));
  };

  for (const p of topPostavke) {
    printPostavkaRow(p);
    // Dodatki
    const pId = p.postavkaId ?? null;
    const dodatki = pId != null ? (dodatekMap.get(pId) ?? []) : [];
    const placljeniDodatki = dodatki.filter(d => d.skupaj !== 0 || d.cenaKos !== 0);
    const brezplacniDodatki = dodatki.filter(d => d.skupaj === 0 && d.cenaKos === 0);
    for (const d of placljeniDodatki) {
      line("+ " + d.ime.slice(0, cols - 2));
      if (d.opomba) line("    " + d.opomba.slice(0, cols - 4));
      line(padEnd("", artW) + " " + padStart(String(d.kolicina), kolW) + " " + padStart(d.cenaKos.toFixed(2) + " €", cenaW) + " " + padStart(d.skupaj.toFixed(2) + " €", skupajW));
    }
    for (const d of brezplacniDodatki) {
      line("  * " + d.ime.slice(0, cols - 4));
      if (d.opomba) line("    " + d.opomba.slice(0, cols - 4));
    }
    if (placljeniDodatki.length > 0) {
      const skupajPica = p.skupaj + placljeniDodatki.reduce((s, d) => s + d.skupaj, 0);
      line(twoColumns("  Skupaj artikel:", skupajPica.toFixed(2) + " €", cols));
    }
  }
  // Osirotele dodatke tiskamo kot samostojne postavke
  for (const d of orphanDodatki) {
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
    line(twoColumns("Popust:", `-${skupniPrihranek.toFixed(2)} €`, cols));
  }
  if (jeBrezplacno) {
    line(twoColumns(data.placilnaNacin === "reprezentanca" ? "Reprezentanca:" : "Lastna poraba:", "", cols));
    line(twoColumns("100% popust:", `-${skupajIzPostavk.toFixed(2)} €`, cols));
  }
  if (jeDdv) {
    line(twoColumns("Osnova (brez DDV):", `${brezDDV.toFixed(2)} €`, cols));
    line(twoColumns("DDV skupaj:", `${data.ddv.toFixed(2)} €`, cols));
  }
  line("");
  line(twoColumns("SKUPAJ:", `${data.skupaj.toFixed(2)} €`, cols), true);

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
      const dC3 = 10, dC2 = Math.floor((cols - dC3) / 2), dC1 = cols - dC2 - dC3;
      line(padEnd("Stopnja", dC1) + padStart("Osnova", dC2) + padStart("DDV", dC3));
      for (const { stopnja, osnova, ddvZnesek } of ddvVrstice) {
        const okr = davekOkrajsava.get(stopnja) ?? "";
        line(padEnd(`${okr} DDV ${stopnja}%:`, dC1) + padStart(`${osnova.toFixed(2)} €`, dC2) + padStart(`${ddvZnesek.toFixed(2)} €`, dC3));
      }
    }
  }

  // Miza in natakar — prestavljeno iz glave
  if (data.mizaStevilka) line(twoColumns("Miza:", String(data.mizaStevilka), cols));
  if (data.natakarIme) line(twoColumns("Natakar:", data.natakarIme.slice(0, 20), cols));

  // Boni — bon za pico je informativna vrstica (skupaj je že zmanjšan za bon za pico)
  const bonPicaZn = data.znesekBonPica ?? 0;
  const bonZn = data.znesekBon ?? 0;
  const imaBone = bonPicaZn > 0 || bonZn > 0;
  if (imaBone) {
    line("");
    if (bonPicaZn > 0) line(twoColumns(`Bon za pico${data.steviloBonov ? ` (${data.steviloBonov}×)` : ""}:`, `-${bonPicaZn.toFixed(2)} €`, cols));
    if (bonZn > 0) line(twoColumns("Darilni bon:", `-${bonZn.toFixed(2)} €`, cols));

    // Ostane za plačilo — samo kadar je darilni bon (skupaj je že neto, bon za pico je samo info)
    if (bonZn > 0) {
      line("");
      const ostaneZaPlacilo = Math.max(0, data.skupaj - bonZn);
      line(twoColumns("Ostane za plačilo:", `${ostaneZaPlacilo.toFixed(2)} €`, cols), true);
    }
  }

  // Vrsta plačila
  if (imaBone) line("");
  const gotZn = data.znesekGotovina ?? 0;
  const kartZn = data.znesekKartica ?? 0;
  const negotZn = data.znesekNegotovinsko ?? 0;
  if (gotZn > 0) line(twoColumns("Gotovina:", `${gotZn.toFixed(2)} €`, cols));
  if (kartZn > 0) line(twoColumns("Kartica:", `${kartZn.toFixed(2)} €`, cols));
  if (negotZn > 0) line(twoColumns("Negotovinsko:", `${negotZn.toFixed(2)} €`, cols));
  if (gotZn === 0 && kartZn === 0 && negotZn === 0 && !imaBone) {
    line(twoColumns((placilniNacinLabels[data.placilnaNacin] ?? data.placilnaNacin) + ":", `${data.skupaj.toFixed(2)} €`, cols));
  }

  line(dashedLine(cols));

  // FURS
  if (data.zoi) {
    line(centerText("DAVČNA POTRDITEV (FURS)", cols));
    const zoiLabel = "ZOI: ";
    line(zoiLabel + data.zoi.slice(0, cols - zoiLabel.length));
    if (data.zoi.length > cols - zoiLabel.length) line("     " + data.zoi.slice(cols - zoiLabel.length));
    if (data.eor) {
      const eorLabel = "EOR: ";
      line(eorLabel + data.eor.slice(0, cols - eorLabel.length));
      if (data.eor.length > cols - eorLabel.length) line("     " + data.eor.slice(cols - eorLabel.length));
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

  return { linee, formati, qrUrl: data.fursQrUrl ?? null, qrBase64: null, zoi: data.zoi ?? null };
}

export function buildEscPosReceipt(data: PrintRacunData, cols = 32): Uint8Array {
  const chunks: Buffer[] = [];

  function bytes(...cmds: number[][]): void {
    chunks.push(Buffer.from(cmds.flat()));
  }

  function text(s: string): void {
    chunks.push(encodeText(s));
  }

  function line(s = ""): void {
    text(s);
    bytes([LF]);
  }

  function empty(n = 1): void {
    for (let i = 0; i < n; i++) bytes([LF]);
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
  bytes(CMD.CODE_PAGE_1250);  // nastavi Windows-1250 za č, š, ž
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

  line(dashedLine(cols));

  // Okrajšave DDV stopenj: T1 = najvišja stopnja, T2 = naslednja (samo za zavezance)
  const uniqueRates = [...new Set(data.postavke.map((p) => p.davek))].sort((a, b) => b - a);
  const davekOkrajsava = new Map<number, string>(uniqueRates.map((r, i) => [r, jeDdv ? `T${i + 1}` : ""]));

  // --- ITEMS — 4 kolone, desno poravnane, ločene z enim presledkom ---
  const kolW = 4, cenaW = 9, skupajW = 9;
  const artW = cols - 3 - kolW - cenaW - skupajW;
  function itemVrstica(art: string, kol: string, cena: string, skupaj: string): string {
    return padStart(art.slice(0, artW), artW) + " " + padStart(kol, kolW) + " " + padStart(cena, cenaW) + " " + padStart(skupaj, skupajW);
  }
  line(itemVrstica("Art.", "Kol.", "Cena", "Skupaj"));
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
  const orphanDodatkiEsc = data.postavke.filter(p => p.parentPostavkaId != null && !topPostavkeEscIds.has(p.parentPostavkaId));

  const printPostavkaRowEsc = (p: PrintPostavka) => {
    const cenaKosOriginalna = p.cenaKosOriginalna;
    // imaPopust: samo pri delnem popustu (cenaKos > 0); 100% bon za pico preskočimo
    const imaPopust = cenaKosOriginalna != null && cenaKosOriginalna > p.cenaKos + 0.001 && p.cenaKos > 0.001;
    const okr = davekOkrajsava.get(p.davek) ?? "";
    line(p.ime.slice(0, cols));
    if (p.opomba) line("  " + p.opomba.slice(0, cols - 2));
    if (imaPopust && cenaKosOriginalna != null) {
      const popustPct = Math.round((1 - p.cenaKos / cenaKosOriginalna) * 100);
      const popustZnesek = cenaKosOriginalna - p.cenaKos;
      line(twoColumns("  Redna cena:", `${cenaKosOriginalna.toFixed(2)} €/kos`, cols));
      line(twoColumns(`  Popust ${popustPct}%:`, `-${popustZnesek.toFixed(2)} €/kos`, cols));
    }
    line(padEnd(okr, artW) + " " + padStart(String(p.kolicina), kolW) + " " + padStart(p.cenaKos.toFixed(2) + " €", cenaW) + " " + padStart(p.skupaj.toFixed(2) + " €", skupajW));
  };

  for (const p of topPostavkeEsc) {
    printPostavkaRowEsc(p);
    // Dodatki
    const pIdEsc = p.postavkaId ?? null;
    const dodatki = pIdEsc != null ? (dodatekMapEsc.get(pIdEsc) ?? []) : [];
    const placljeniDodatkiEsc = dodatki.filter(d => d.skupaj !== 0 || d.cenaKos !== 0);
    const brezplacniDodatkiEsc = dodatki.filter(d => d.skupaj === 0 && d.cenaKos === 0);
    for (const d of placljeniDodatkiEsc) {
      line("+ " + d.ime.slice(0, cols - 2));
      if (d.opomba) line("    " + d.opomba.slice(0, cols - 4));
      line(padEnd("", artW) + " " + padStart(String(d.kolicina), kolW) + " " + padStart(d.cenaKos.toFixed(2) + " €", cenaW) + " " + padStart(d.skupaj.toFixed(2) + " €", skupajW));
    }
    for (const d of brezplacniDodatkiEsc) {
      line("  * " + d.ime.slice(0, cols - 4));
      if (d.opomba) line("    " + d.opomba.slice(0, cols - 4));
    }
    if (placljeniDodatkiEsc.length > 0) {
      const skupajPica = p.skupaj + placljeniDodatkiEsc.reduce((s, d) => s + d.skupaj, 0);
      line(twoColumns("  Skupaj artikel:", skupajPica.toFixed(2) + " €", cols));
    }
  }
  // Osirotele dodatke tiskamo kot samostojne postavke
  for (const d of orphanDodatkiEsc) {
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
    line(twoColumns("Popust:", `-${skupniPrihranekEsc.toFixed(2)} €`, cols));
  }
  if (jeBrezplacnoEsc) {
    line(twoColumns(data.placilnaNacin === "reprezentanca" ? "Reprezentanca:" : "Lastna poraba:", "", cols));
    line(twoColumns("100% popust:", `-${skupajIzPostavkEsc.toFixed(2)} €`, cols));
  }
  if (jeDdv) {
    line(twoColumns("Osnova (brez DDV):", `${brezDDV.toFixed(2)} €`, cols));
    line(twoColumns("DDV skupaj:", `${data.ddv.toFixed(2)} €`, cols));
  }
  empty();
  bytes(CMD.BOLD_ON);
  line(twoColumns("SKUPAJ:", `${data.skupaj.toFixed(2)} €`, cols));
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
      const dC3 = 10, dC2 = Math.floor((cols - dC3) / 2), dC1 = cols - dC2 - dC3;
      line(padEnd("Stopnja", dC1) + padStart("Osnova", dC2) + padStart("DDV", dC3));
      for (const { stopnja, osnova, ddvZnesek } of ddvVrstice) {
        const okr = davekOkrajsava.get(stopnja) ?? "";
        line(padEnd(`${okr} DDV ${stopnja}%:`, dC1) + padStart(`${osnova.toFixed(2)} €`, dC2) + padStart(`${ddvZnesek.toFixed(2)} €`, dC3));
      }
    }
  }

  // Miza in natakar — prestavljeno iz glave
  if (data.mizaStevilka) line(twoColumns("Miza:", String(data.mizaStevilka), cols));
  if (data.natakarIme) line(twoColumns("Natakar:", data.natakarIme.slice(0, 20), cols));

  // Boni — bon za pico je informativna vrstica (skupaj je že zmanjšan za bon za pico)
  const bonPicaZnEsc = data.znesekBonPica ?? 0;
  const bonZnEsc = data.znesekBon ?? 0;
  const imaBoneEsc = bonPicaZnEsc > 0 || bonZnEsc > 0;
  if (imaBoneEsc) {
    empty();
    if (bonPicaZnEsc > 0) line(twoColumns(`Bon za pico${data.steviloBonov ? ` (${data.steviloBonov}×)` : ""}:`, `-${bonPicaZnEsc.toFixed(2)} €`, cols));
    if (bonZnEsc > 0) line(twoColumns("Darilni bon:", `-${bonZnEsc.toFixed(2)} €`, cols));

    // Ostane za plačilo — samo kadar je darilni bon (skupaj je že neto, bon za pico je samo info)
    if (bonZnEsc > 0) {
      empty();
      const ostaneZaPlacilo = Math.max(0, data.skupaj - bonZnEsc);
      bytes(CMD.BOLD_ON);
      line(twoColumns("Ostane za plačilo:", `${ostaneZaPlacilo.toFixed(2)} €`, cols));
      bytes(CMD.BOLD_OFF);
    }
  }

  // Vrsta plačila
  if (imaBoneEsc) empty();
  const gotZnEsc = data.znesekGotovina ?? 0;
  const kartZnEsc = data.znesekKartica ?? 0;
  const negotZnEsc = data.znesekNegotovinsko ?? 0;
  if (gotZnEsc > 0) line(twoColumns("Gotovina:", `${gotZnEsc.toFixed(2)} €`, cols));
  if (kartZnEsc > 0) line(twoColumns("Kartica:", `${kartZnEsc.toFixed(2)} €`, cols));
  if (negotZnEsc > 0) line(twoColumns("Negotovinsko:", `${negotZnEsc.toFixed(2)} €`, cols));
  if (gotZnEsc === 0 && kartZnEsc === 0 && negotZnEsc === 0 && bonPicaZnEsc === 0 && bonZnEsc === 0) {
    line(twoColumns((placilniNacinLabels[data.placilnaNacin] ?? data.placilnaNacin) + ":", `${data.skupaj.toFixed(2)} €`, cols));
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
    // QR koda (ESC/POS native GS ( k)
    if (data.fursQrUrl) {
      empty();
      bytes(CMD.ALIGN_CENTER);
      bytes(qrCodeBytes(data.fursQrUrl));
      empty();
      bytes(CMD.ALIGN_LEFT);
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
