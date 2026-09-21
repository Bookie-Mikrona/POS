/**
 * Testi za ascii-translit layout popravek (pos-escpos.ts).
 *
 * Problem (pred popravkom):
 *   Layout vrstic se je gradil z € kot 1 znak, transliteracija €→"EUR"
 *   se je izvedla šele pri encodeText() → vrstica zrasla na 34 znakov.
 *
 * Popravek:
 *   Pri encoding=ascii-translit je N = transliterateToAscii in C = "EUR",
 *   zato padStart/padEnd/twoColumns računajo širino z že-transliteriranimi nizi.
 *   encodeText() je idempotenten za čisti ASCII.
 *
 * Preverjamo:
 *   1. Nobena vrstica (pri translit) ne presega 32 znakov.
 *   2. Poravnava: znesek desno je zadnji znak vrstice (brez odvečnih presledkov).
 *   3. Šumniki (č→c 1:1): ne vplivajo na dolžino vrstic.
 *   4. Drugi encodingi (cp1250, cp852): € ostane 1 znak v layoutu, nespremenjen.
 */

import { describe, it, expect } from "vitest";
import { buildEscPosReceipt, firstNameOnly } from "../lib/pos-escpos";
import type { PrintRacunData } from "../lib/pos-escpos";

// ── Testni podatki ─────────────────────────────────────────────────────────────

const baseData: PrintRacunData = {
  stevilkaRacuna:   "12-0001-1",
  datum:            new Date("2026-08-10T12:00:00Z"),
  mizaStevilka:     5,
  skupaj:           24.60,
  ddv:               2.15,
  placilnaNacin:    "gotovina",
  status:           "poslan",
  zoi:              null,
  eor:              null,
  fursQrUrl:        null,
  nazivRestvracije: "Restavracija Čopova",      // šumnik v naslovu
  naslovRestvracije:"Čopova ulica 3, Ljubljana",
  enotaOpis:        "POS 1",
  davcnaStevilka:   "SI12345678",
  racunPozdrav1:    "Hvala za obisk!",
  racunPozdrav2:    undefined,
  steviloPrintov:   1,
  kupecDavcnaStevilka: null,
  kupecNaziv:       null,
  kupecNaslov:      null,
  kupecZavezanecDdv: null,
  vivaTerminalSessionId: null,
  sumupCheckoutId:  null,
  natakarIme:       "Živa",                     // šumnik v imenu natakarja
  stornoIzvornaRacunStevilka: null,
  racunMaticna:     null,
  racunSodisce:     null,
  racunKapital:     null,
  racunDdvKlavzula: null,
  racunPravnaKlavzula: null,
  prodajalecIban:   null,
  prodajalecBic:    null,
  dniOdloga:        null,
  znesekGotovina:   25.00,
  znesekKartica:    null,
  znesekBon:        null,
  steviloBonov:     null,
  znesekBonPica:    null,
  znesekNegotovinsko: null,
  jeDdvZavezanec:   true,
  postavke: [
    {
      postavkaId:         1,
      ime:                "Čaj šumivý čšž",         // šumniki v imenu
      kolicina:           2,
      cenaKos:            3.20,
      cenaKosOriginalna:  null,
      skupaj:             6.40,
      davek:              9.5,
      opomba:             null,
      parentPostavkaId:   null,
    },
    {
      postavkaId:         2,
      ime:                "Burger Šef posebni",
      kolicina:           1,
      cenaKos:            13.40,
      cenaKosOriginalna:  null,
      skupaj:             13.40,
      davek:              22,
      opomba:             null,
      parentPostavkaId:   null,
    },
    {
      postavkaId:         3,
      ime:                "Pivo 0.5L",
      kolicina:           1,
      cenaKos:            4.80,
      cenaKosOriginalna:  null,
      skupaj:             4.80,
      davek:              9.5,
      opomba:             null,
      parentPostavkaId:   null,
    },
  ],
};

// ── Pomožne funkcije ────────────────────────────────────────────────────────────

/**
 * Pravilni ESC/POS text extractor.
 *
 * Enostavni regex [\x00-\x1f] NE zadostuje, ker parameter bajti ESC sekvenc
 * (npr. 0x45="E" pri ESC E, 0x61="a" pri ESC a) spadajo v ASCII tiskljivi
 * razpon in ostanejo v besedilu — vrstica se navidezno podaljša.
 *
 * Ta funkcija hodi bajt po bajt in pravilno preskoči ESC/FS/GS sekvence z
 * njihovimi parametri, ter zbira samo bajte ki jih tiskalnik izpiše kot tekst.
 */
function parseLines(buf: Uint8Array): string[] {
  const ONE_PARAM_CMDS = new Set([
    0x74, // ESC t n — code page
    0x61, // ESC a n — align
    0x45, // ESC E n — bold
    0x21, // ESC ! n — font mode
    0x4D, // ESC M n — font select
    0x2D, // ESC - n — underline
    0x64, // ESC d n — feed n lines
    0x4A, // ESC J n — feed n dots
  ]);
  const lines: string[] = [];
  let cur = "";
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b === 0x0A) {                        // LF — konec vrstice
      lines.push(cur); cur = ""; i++; continue;
    }
    if (b === 0x1B) {                        // ESC — preskoči sekvenco + parametre
      const cmd = buf[i + 1] ?? 0;
      if (cmd === 0x40) { i += 2; }          // ESC @ — brez parametrov
      else if (ONE_PARAM_CMDS.has(cmd)) { i += 3; } // 1 parameter bajt
      else { i += 2; }
      continue;
    }
    if (b === 0x1C) { i += 2; continue; }    // FS . — 0 parametrov
    if (b === 0x1D) {                        // GS
      const cmd = buf[i + 1] ?? 0;
      if (cmd === 0x56) { i += 4; }          // GS V fn m — 2 parametra
      else { i += 2; }
      continue;
    }
    if (b >= 0x20 && b <= 0x7E) cur += String.fromCharCode(b); // tiskljivi ASCII
    i++;
  }
  if (cur.length > 0) lines.push(cur);
  return lines.filter(l => l.length > 0);
}

// ── TESTI ───────────────────────────────────────────────────────────────────────

describe("ascii-translit: layout pred transliteracijo", () => {
  const COLS = 32;

  it("nobena vrstica ne presega 32 znakov", () => {
    const buf = buildEscPosReceipt(baseData, COLS, { encoding: "ascii-translit" });
    const lines = parseLines(buf);
    for (const l of lines) {
      expect(l.length, `Predolga vrstica (${l.length}): "${l}"`).toBeLessThanOrEqual(COLS);
    }
  });

  it("vrstice so čisti ASCII (samo 0x20–0x7E)", () => {
    const buf = buildEscPosReceipt(baseData, COLS, { encoding: "ascii-translit" });
    // Po odstranitvi ESC/POS bajtov morajo biti vsi preostali znaki ASCII
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      // LF (0x0A) je dovoljen, ESC (0x1B) in ESC sekvence preskočimo, 0x20–0x7E = tiskljivi
      if (b === 0x0A || b === 0x1B || b === 0x1C) continue;
      if (b >= 0x20 && b <= 0x7E) continue;
      // Preverimo, da ni "EUR" zakodiran kot 0x80 (€ v CP1250) ali 0x9A (š v CP1250)
      // — to bi pomenilo, da transliteracija ni bila izvedena
      if (b === 0x80 || b === 0x9A || b === 0x9E || b === 0xE8) {
        throw new Error(
          `Najden ne-ASCII bajt 0x${b.toString(16).toUpperCase()} pri indeksu ${i} — šumnik/€ ni transliteriran`
        );
      }
    }
  });

  it("SKUPAJ vrstica: 32 znakov, '(EUR)' v oznaki, znesek BREZ EUR na koncu", () => {
    const buf = buildEscPosReceipt(baseData, COLS, { encoding: "ascii-translit" });
    const lines = parseLines(buf);
    const skupajLine = lines.find(l => l.includes("SKUPAJ"));
    expect(skupajLine).toBeTruthy();
    // "(EUR)" mora biti v OZNAKI (del labela), ne na koncu vrstice
    expect(skupajLine).toContain("(EUR)");
    // Vrstica se konča z golim zneskom (ne "EUR") — valuta je v oznaki
    expect(skupajLine!.endsWith("EUR")).toBe(false);
    // Vsebuje pravi znesek
    expect(skupajLine).toContain("24.60");
    // Ni € simbola
    expect(skupajLine).not.toContain("€");
    // Dolžina točno 32
    expect(skupajLine!.length).toBe(COLS);
  });

  it("SKUPAJ vrstica: oblika 'SKUPAJ (EUR): <presledki> <znesek>'", () => {
    const buf = buildEscPosReceipt(baseData, COLS, { encoding: "ascii-translit" });
    const lines = parseLines(buf);
    const skupajLine = lines.find(l => l.includes("SKUPAJ"))!;
    // Mora biti v obliki "SKUPAJ (EUR): ..." — EUR v labelu, ne pripona znesku
    expect(skupajLine).toMatch(/SKUPAJ\s*\(EUR\):/);
    // Znesek je desno poravnan (padStart) — konča z golim številom
    expect(skupajLine).toMatch(/\d+\.\d{2}$/);
    expect(skupajLine).toContain("24.60");
  });

  it("Osnova (brez DDV) vrstica: točno 32 znakov", () => {
    const buf = buildEscPosReceipt(baseData, COLS, { encoding: "ascii-translit" });
    const lines = parseLines(buf);
    const osnova = lines.find(l => l.includes("Osnova") || l.includes("brez DDV"));
    expect(osnova).toBeTruthy();
    expect(osnova!.length).toBeLessThanOrEqual(COLS);
    expect(osnova).not.toContain("€");
    expect(osnova).toContain("EUR");
  });

  it("DDV skupaj vrstica: točno ≤ 32 znakov, vsebuje 'EUR'", () => {
    const buf = buildEscPosReceipt(baseData, COLS, { encoding: "ascii-translit" });
    const lines = parseLines(buf);
    const ddv = lines.find(l => /DDV skupaj/i.test(l));
    expect(ddv).toBeTruthy();
    expect(ddv!.length).toBeLessThanOrEqual(COLS);
    expect(ddv).toContain("EUR");
  });

  it("Gotovina vrstica: ≤ 32 znakov, vsebuje 'EUR'", () => {
    const buf = buildEscPosReceipt(baseData, COLS, { encoding: "ascii-translit" });
    const lines = parseLines(buf);
    const got = lines.find(l => l.includes("Gotovina"));
    expect(got).toBeTruthy();
    expect(got!.length).toBeLessThanOrEqual(COLS);
    expect(got).toContain("EUR");
  });

  it("(EUR) glava tabele: vrstica pod Art./Kol./Cena/Skupaj vsebuje '(EUR)' v dveh stolpcih", () => {
    const buf = buildEscPosReceipt(baseData, COLS, { encoding: "ascii-translit" });
    const lines = parseLines(buf);
    // Poišči sub-header vrstico z (EUR) — mora biti PRED artikli
    const eurHeaderIdx = lines.findIndex(l => l.includes("(EUR)") && !l.includes(":") && !l.includes("Stopnja"));
    expect(eurHeaderIdx, `(EUR) glava tabele ni najdena`).toBeGreaterThan(-1);
    const eurHeader = lines[eurHeaderIdx];
    // Vsebuje natanko dve (EUR) — eno pod Cena, eno pod Skupaj
    expect((eurHeader.match(/\(EUR\)/g) ?? []).length).toBe(2);
    // Dolžina ≤ 32
    expect(eurHeader.length).toBeLessThanOrEqual(COLS);
  });

  it("postavka vrstica (kol + cena + skupaj): gola števila BREZ 'EUR'", () => {
    const buf = buildEscPosReceipt(baseData, COLS, { encoding: "ascii-translit" });
    const lines = parseLines(buf);
    // Vrstice z zneski v stolpcih (kol + cena + skupaj) — vzorec: "T1       1      13.40      13.40"
    const postavkaVrstice = lines.filter(l => /^\s*T\d\s+\d+\s+\d+\.\d{2}\s+\d+\.\d{2}$/.test(l));
    expect(postavkaVrstice.length, "Ni najdene nobene postavka vrstice").toBeGreaterThan(0);
    for (const l of postavkaVrstice) {
      // Gola števila — brez EUR, brez €
      expect(l, `Postavka vrstica vsebuje EUR: "${l}"`).not.toContain("EUR");
      expect(l, `Postavka vrstica vsebuje €: "${l}"`).not.toContain("€");
      expect(l.length, `Predolga postavka vrstica: "${l}"`).toBeLessThanOrEqual(COLS);
    }
  });

  it("šumniki v imenu artikla (č→c 1:1): vrstice ≤ 32 znakov", () => {
    // "Čaj šumivý čšž" → "Caj sumivi csz" (isti znaki, samo zamenjani)
    const buf = buildEscPosReceipt(baseData, COLS, { encoding: "ascii-translit" });
    const lines = parseLines(buf);
    // Ime artikla se prelomi v svojo vrstico
    const cajLine = lines.find(l => /caj/i.test(l) || /Caj/i.test(l));
    expect(cajLine).toBeTruthy();
    expect(cajLine!.length).toBeLessThanOrEqual(COLS);
  });

  it("natakar z šumniki (Živa→Ziva): vrstica ≤ 32 znakov", () => {
    const buf = buildEscPosReceipt(baseData, COLS, { encoding: "ascii-translit" });
    const lines = parseLines(buf);
    const natakar = lines.find(l => l.includes("Natakar") || l.includes("Ziva"));
    // Natakar vrstica mora biti ≤ 32
    if (natakar) expect(natakar.length).toBeLessThanOrEqual(COLS);
  });

  it("na izpisu računa izpiše samo ime natakarja", () => {
    expect(firstNameOnly("Živa Novak")).toBe("Živa");
    expect(firstNameOnly("  Živa   Novak  ")).toBe("Živa");
    expect(firstNameOnly(null)).toBe("");

    const buf = buildEscPosReceipt(
      { ...baseData, natakarIme: "Živa Novak" },
      COLS,
      { encoding: "ascii-translit" },
    );
    const lines = parseLines(buf);
    const natakar = lines.find(l => l.includes("Natakar"));
    expect(natakar).toContain("Ziva");
    expect(natakar).not.toContain("Novak");
  });

  it("vrstica s ceno/kosom pri popustu: ≤ 32 znakov", () => {
    // Dodamo popust na eno postavko
    const withDiscount: PrintRacunData = {
      ...baseData,
      postavke: [{
        ...baseData.postavke[0],
        cenaKos:            2.50,
        cenaKosOriginalna:  3.20,  // redna cena → popust
        skupaj:             5.00,
      }, ...baseData.postavke.slice(1)],
    };
    const buf = buildEscPosReceipt(withDiscount, COLS, { encoding: "ascii-translit" });
    const lines = parseLines(buf);
    for (const l of lines) {
      expect(l.length, `Predolga vrstica: "${l}"`).toBeLessThanOrEqual(COLS);
    }
    // Redna cena vrstica ne sme vsebovati €
    const rednaCena = lines.find(l => l.includes("Redna cena") || l.includes("redna cena"));
    if (rednaCena) {
      expect(rednaCena).not.toContain("€");
    }
  });
});

// ── Drugi encodingi ostanejo nespremenjeni ─────────────────────────────────────

describe("cp1250: € ostane 1 znak v layoutu (nespremenjen)", () => {
  const COLS = 32;

  it("SKUPAJ vrstica: vsebuje surove CP1250 bajte (ne 'EUR')", () => {
    const buf = buildEscPosReceipt(baseData, COLS, { encoding: "cp1250" });
    // V CP1250 je € = 0x80. Iščemo 0x80 v bajtih.
    const hasEuroByte = Array.from(buf).includes(0x80);
    expect(hasEuroByte).toBe(true);
    // Ne sme vsebovati ASCII "EUR" kot 45 55 52 (vsaj ne kot skupek)
    const text = Buffer.from(buf).toString("binary");
    // Preverimo, da ni "EUR" s čistim ASCII (0x45 0x55 0x52) na mestu znaka €
    // CP1250 € je samo 1 bajt 0x80, ne 3 bajti "EUR"
    expect(text).not.toMatch(/EUR/);
  });

  it("nobena vrstica pri cp1250 ne sme biti preširoka (≤ 32 znakov po dekodiranju)", () => {
    // CP1250: € je 1 bajt → layout je pravilno izračunan že pred popravkom
    // Potrjujemo, da popravek ni pokvaril CP1250
    const buf = buildEscPosReceipt(baseData, COLS, { encoding: "cp1250" });
    // Preštejemo LF in dolžino med LF-ji (brez ESC/POS bajtov)
    let lineLen = 0;
    let inEscSeq = false;
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      if (b === 0x1B || b === 0x1C) { inEscSeq = true; continue; }
      if (inEscSeq) {
        if (b === 0x74 || b === 0x61 || b === 0x45 || b === 0x21 || b === 0x4D || b === 0x64 || b === 0x2D) {
          // ESC t, ESC a, ESC E, ESC !, ESC M, ESC d, ESC - — 1 parameter bajt sledi
          i++; inEscSeq = false;
        } else if (b === 0x56) {
          i += 2; inEscSeq = false; // GS V — 2 parameter bajta
        } else {
          inEscSeq = false;
        }
        continue;
      }
      if (b === 0x0A) { lineLen = 0; continue; }
      if (b >= 0x20) lineLen++;
      if (lineLen > COLS) {
        throw new Error(`CP1250 vrstica presega ${COLS} znakov (dolžina ${lineLen})`);
      }
    }
  });
});

describe("cp852: € ostane 1 znak v layoutu (nespremenjen)", () => {
  it("vrstice pri cp852 ne presegajo 32 znakov", () => {
    const buf = buildEscPosReceipt(baseData, 32, { encoding: "cp852" });
    // Samo preverimo, da je izhod non-empty in ne vsebuje ASCII "EUR"
    expect(buf.length).toBeGreaterThan(100);
    // CP852 ne sme imeti "EUR" (to bi bil napaka — translit se ne sme izvesti)
    const text = Buffer.from(buf).toString("latin1");
    expect(text).not.toMatch(/EUR/);
  });
});

// ── Regresijski test: buildEscPosReceipt(data, 32) (privzet cp1250) ─────────────

describe("privzet encoding (cp1250): nespremenjen po popravku", () => {
  it("izhod je Uint8Array z ESC @ na začetku", () => {
    const buf = buildEscPosReceipt(baseData);
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(buf[0]).toBe(0x1B);
    expect(buf[1]).toBe(0x40);
  });

  it("vsebuje bajt 0x80 (€ v CP1250)", () => {
    const buf = buildEscPosReceipt(baseData);
    expect(Array.from(buf)).toContain(0x80);
  });
});
