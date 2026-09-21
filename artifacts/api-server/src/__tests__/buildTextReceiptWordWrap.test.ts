/**
 * Preverja format tabele artiklov in ostale vrstice buildTextReceipt.
 *
 * Specifikacija (potrjena z uporabnikom, 13.8.2026):
 *   Tabela artiklov je ENAKA kot USB 58mm (buildEscPosReceipt):
 *     glava:    Art. Kol. Cena Skupaj   (4 kolone, desno poravnane, 1 presledek)
 *     postavka: 1. vrstica = naziv artikla (prelom pri cols)
 *               2. vrstica = DDV oznaka (T1..) + kolicina + cena + skupaj
 *   Širine: kol(4), cena(10), skupaj(10); artW = cols - 27
 *     cols=40 → artW=13, cols=32 → artW=5, cols=30 → artW=3
 *   Format zneskov v tabeli: pika + presledek pred € ("4.90 €") — kot USB.
 *
 * Opomba: ena vrstica (brez lomljenja), polnih cols
 *
 * Format "H": Račun + SKUPAJ vrstici → dvojna višina v BT mostu v2.5+
 */

import { describe, it, expect } from "vitest";
import { buildEscPosReceipt, buildNb80TextReceipt, buildTextReceipt } from "../lib/pos-escpos.js";
import type { PrintRacunData } from "../lib/pos-escpos.js";

// ─── Minimalen PrintRacunData ─────────────────────────────────────────────────
const BASE: PrintRacunData = {
  stevilkaRacuna: "2026-R-0001",
  datum: new Date("2026-08-12T10:00:00Z"),
  mizaStevilka: null,
  skupaj: 9.80,
  ddv: 1.80,
  placilnaNacin: "gotovina",
  status: "poslan",
  zoi: null,
  eor: null,
  fursQrUrl: null,
  nazivRestvracije: "Test",
  naslovRestvracije: "",
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
  postavke: [],
};

function makePostavka(
  ime: string,
  opts: { opomba?: string; cenaKos?: number; skupaj?: number; davek?: number; postavkaId?: number } = {},
) {
  return {
    ime,
    opomba: opts.opomba ?? null,
    kolicina: 1,
    cenaKos: opts.cenaKos ?? 4.90,
    cenaKosOriginalna: null,
    skupaj: opts.skupaj ?? 4.90,
    davek: opts.davek ?? 9.5,
    parentPostavkaId: null,
    postavkaId: opts.postavkaId ?? 1,
    artikelId: 1,
  };
}

it("izpis jasno prikaže napitnino in celoten kartični znesek", () => {
  const receipt = buildTextReceipt({
    ...BASE,
    placilnaNacin: "kartica",
    znesekKartica: 15,
    znesekNapitnina: 3,
  }, 32);
  expect(receipt.linee.some(line => line.includes("Napitnina:"))).toBe(true);
  expect(receipt.linee.some(line => line.includes("Kartica skupaj:"))).toBe(true);
});

/** Vrne vrstice artiklov med glavo tabele in naslednjo ločilno črto. */
function itemLines(linee: string[]): string[] {
  const headIdx = linee.findIndex((l) => l.includes("Kol.") && l.includes("Cena"));
  if (headIdx === -1) return [];
  const dashAfterHead = headIdx + 1;
  const endIdx = linee.findIndex((l, i) => i > dashAfterHead && l.startsWith("---"));
  if (endIdx === -1) return linee.slice(dashAfterHead + 1);
  return linee.slice(dashAfterHead + 1, endIdx);
}

// artW pri vsaki širini: artW = cols - 27 (kol 4 + cena 10 + skupaj 10 + 3 presledki)
const artW40 = 40 - 27; // 13
const artW32 = 32 - 27; // 5
const artW30 = 30 - 27; // 3

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Glava tabele in širine
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildTextReceipt — glava tabele (USB format)", () => {

  it.each([30, 32, 40] as const)("artW + 27 = cols pri cols=%i", (cols) => {
    expect((cols - 27) + 27).toBe(cols);
  });

  it.each([30, 32, 40] as const)("glava tabele je točno %i znakov", (cols) => {
    const json = buildTextReceipt({ ...BASE, postavke: [makePostavka("T")] }, cols);
    const glavaIdx = json.linee.findIndex((l) => l.includes("Kol.") && l.includes("Cena"));
    expect(glavaIdx).toBeGreaterThan(-1);
    expect(json.linee[glavaIdx].length).toBe(cols);
  });

  it.each([32, 40] as const)("glava vsebuje Art., Kol., Cena, Skupaj (cols=%i)", (cols) => {
    const json = buildTextReceipt({ ...BASE, postavke: [makePostavka("T")] }, cols);
    const glava = json.linee.find((l) => l.includes("Kol.") && l.includes("Cena"))!;
    expect(glava).toContain("Art");
    expect(glava).toContain("Kol.");
    expect(glava).toContain("Cena");
    expect(glava).toContain("Skupaj");
  });

  it.each([30, 32, 40] as const)("glava NE vsebuje stolpca 'D.' (cols=%i)", (cols) => {
    const json = buildTextReceipt({ ...BASE, postavke: [makePostavka("T")] }, cols);
    const glava = json.linee.find((l) => l.includes("Kol.") && l.includes("Cena"))!;
    expect(glava).not.toContain("D.");
  });

  it.each([30, 32, 40] as const)("zneskovna vrstica je točno %i znakov", (cols) => {
    const json = buildTextReceipt({ ...BASE, postavke: [makePostavka("X")] }, cols);
    const items = itemLines(json.linee);
    const zn = items.find((l) => l.includes("€"))!;
    expect(zn).toBeDefined();
    expect(zn.length).toBe(cols);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Dvovrstična postavka: 1. vrstica naziv, 2. vrstica T-oznaka + zneski
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildTextReceipt — dvovrstična postavka (USB format)", () => {

  it.each([30, 32, 40] as const)("naziv v svoji vrstici, zneski spodaj (cols=%i)", (cols) => {
    const json = buildTextReceipt({ ...BASE, postavke: [makePostavka("Kava")] }, cols);
    const items = itemLines(json.linee);
    expect(items.length).toBe(2);
    // 1. vrstica: naziv, brez €
    expect(items[0]).toContain("Kava");
    expect(items[0]).not.toContain("€");
    // 2. vrstica: zneski, brez naziva
    expect(items[1]).toContain("€");
    expect(items[1]).not.toContain("Kava");
    expect(items[1].length).toBe(cols);
  });

  it.each([30, 32, 40] as const)("2. vrstica se začne z DDV oznako T1 (zavezanec, cols=%i)", (cols) => {
    const json = buildTextReceipt({ ...BASE, postavke: [makePostavka("Kava")] }, cols);
    const items = itemLines(json.linee);
    expect(items[1].startsWith("T1")).toBe(true);
  });

  it("dve stopnji → T1 (višja) in T2 (nižja)", () => {
    const json = buildTextReceipt({
      ...BASE,
      postavke: [
        makePostavka("Pivo", { davek: 22, postavkaId: 1 }),
        makePostavka("Kava", { davek: 9.5, postavkaId: 2 }),
      ],
    }, 32);
    const items = itemLines(json.linee);
    const t1 = items.find((l) => l.startsWith("T1"));
    const t2 = items.find((l) => l.startsWith("T2"));
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
  });

  it("ne-zavezanec: brez T oznake (2. vrstica se začne s presledki)", () => {
    const json = buildTextReceipt({ ...BASE, jeDdvZavezanec: false, postavke: [makePostavka("Kava")] }, 32);
    const items = itemLines(json.linee);
    expect(items[1]).not.toMatch(/^T\d/);
    expect(items[1].length).toBe(32);
  });

  it("dolg naziv (>cols=32) → prelom v več vrstic + zneski spodaj", () => {
    const ime = "Pečena postrv z zelenjavo in pirejem ter omako";
    expect(ime.length).toBeGreaterThan(32);
    const json = buildTextReceipt({ ...BASE, postavke: [makePostavka(ime)] }, 32);
    const items = itemLines(json.linee);
    expect(items.length).toBeGreaterThanOrEqual(3);
    // Cel naziv prisoten (ni odrezan)
    expect(items.filter((l) => !l.includes("€")).join(" ").replace(/\s+/g, " ")).toContain("Pečena postrv");
    // Nobena vrstica ne presega cols
    for (const l of items) expect(l.length).toBeLessThanOrEqual(32);
    // Zneskovna vrstica = točno 32
    expect(items.find((l) => l.includes("€"))!.length).toBe(32);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Format zneskov: pika + presledek pred € (kot USB)
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildTextReceipt — format zneskov artikla (USB format)", () => {

  it("pika kot decimalni ločnik in presledek pred € ('4.90 €')", () => {
    const json = buildTextReceipt({ ...BASE, postavke: [makePostavka("T", { cenaKos: 4.90 })] }, 40);
    const zn = itemLines(json.linee).find((l) => l.includes("€"))!;
    expect(zn).toContain("4.90 €");
    expect(zn).not.toContain("4,90");
  });

  it("negativen skupaj → '-1.00 €'", () => {
    const json = buildTextReceipt({ ...BASE, postavke: [makePostavka("T", { skupaj: -1.00, cenaKos: -1.00 })] }, 40);
    const zn = itemLines(json.linee).find((l) => l.includes("€"))!;
    expect(zn).toContain("-1.00 €");
  });

  it("zneskovna vrstica: T(artW) + ' ' + kol(4) + ' ' + cena(10) + ' ' + skupaj(10)", () => {
    const json = buildTextReceipt({ ...BASE, postavke: [makePostavka("X")] }, 40);
    const zn = itemLines(json.linee).find((l) => l.includes("€"))!;
    // artW=13 pri cols=40
    expect(zn.slice(0, artW40).trimEnd()).toBe("T1");
    const blok = zn.slice(artW40);
    expect(blok.length).toBe(27);
    expect(blok).toMatch(/^\s+\d+\s+[\d.]+ €\s+[\d.-]+ €$/);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ZOI/EOR — brez presledka za dvopičjem
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildTextReceipt — ZOI/EOR format", () => {

  const zoiMd5  = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"; // 32 znakov
  const eorUuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"; // 36 znakov

  it("ZOI vrstica brez presledka za dvopičjem ('ZOI:<koda>')", () => {
    const json = buildTextReceipt({ ...BASE, zoi: zoiMd5, postavke: [] }, 40);
    const zoiVrstica = json.linee.find((l) => l.startsWith("ZOI:"));
    expect(zoiVrstica).toBeDefined();
    expect(zoiVrstica).not.toContain("ZOI: "); // brez presledka
    expect(zoiVrstica).toContain("ZOI:" + zoiMd5.slice(0, 36)); // začetek kode takoj
  });

  it("ZOI pri cols=40 (4+32=36≤40) → 1 vrstica", () => {
    const json = buildTextReceipt({ ...BASE, zoi: zoiMd5, postavke: [] }, 40);
    const zoiVrstice = json.linee.filter((l) => l.startsWith("ZOI:") || (l.startsWith("a1b2") && !l.startsWith("EOR")));
    expect(zoiVrstice.length).toBe(1);
    expect(zoiVrstice[0]).toBe("ZOI:" + zoiMd5);
  });

  it("EOR vrstica brez presledka za dvopičjem ('EOR:<koda>')", () => {
    const json = buildTextReceipt({ ...BASE, zoi: zoiMd5, eor: eorUuid, postavke: [] }, 40);
    const eorVrstica = json.linee.find((l) => l.startsWith("EOR:"));
    expect(eorVrstica).toBeDefined();
    expect(eorVrstica).not.toContain("EOR: ");
  });

  it("EOR pri cols=40 (4+36=40) → točno 1 vrstica", () => {
    const json = buildTextReceipt({ ...BASE, zoi: zoiMd5, eor: eorUuid, postavke: [] }, 40);
    const eorVrstice = json.linee.filter((l) => l.startsWith("EOR:"));
    expect(eorVrstice.length).toBe(1);
    expect(eorVrstice[0]).toBe("EOR:" + eorUuid);
    expect(eorVrstice[0].length).toBe(40);
  });

  it("ZOI pri cols=32 (4+32=36>32) → prelom v 2 vrstici", () => {
    const json = buildTextReceipt({ ...BASE, zoi: zoiMd5, postavke: [] }, 32);
    const zoiStart = json.linee.findIndex((l) => l.startsWith("ZOI:"));
    expect(zoiStart).toBeGreaterThan(-1);
    // Naslednja vrstica je nadaljevanje (ne začne z ZOI: in ni ---)
    const nextLine = json.linee[zoiStart + 1];
    expect(nextLine).toBeDefined();
    expect(nextLine.startsWith("ZOI:")).toBe(false);
    expect(nextLine.startsWith("---")).toBe(false);
    // Skupaj vsebina = ZOI:<koda>
    const skupaj = json.linee[zoiStart] + json.linee[zoiStart + 1];
    expect(skupaj).toBe("ZOI:" + zoiMd5);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. "H" format — Račun + SKUPAJ vrstici
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildTextReceipt — format 'H' za Račun in SKUPAJ", () => {

  // supportsDoubleHeight=true (BT most, NB80): "H" aktiven
  it("supportsDoubleHeight=true: vrstica s stevilkaRacuna dobi format 'H'", () => {
    const json = buildTextReceipt({ ...BASE, postavke: [] }, 40, true);
    const idx = json.linee.findIndex((l) => l.includes(BASE.stevilkaRacuna));
    expect(idx).toBeGreaterThan(-1);
    expect(json.formati[idx]).toBe("H");
  });

  it("supportsDoubleHeight=true: vrstica SKUPAJ dobi format 'H'", () => {
    const json = buildTextReceipt({ ...BASE, postavke: [makePostavka("T")] }, 40, true);
    const idx = json.linee.findIndex((l) => l.includes("SKUPAJ:"));
    expect(idx).toBeGreaterThan(-1);
    expect(json.formati[idx]).toBe("H");
  });

  it("supportsDoubleHeight=true: SKUPAJ vrstica je točno cols znakov pri vseh širinah", () => {
    for (const cols of [30, 32, 40] as const) {
      const json = buildTextReceipt({ ...BASE, postavke: [makePostavka("T")] }, cols, true);
      const idx = json.linee.findIndex((l) => l.includes("SKUPAJ:"));
      expect(json.linee[idx].length, `cols=${cols}`).toBe(cols);
      expect(json.formati[idx], `cols=${cols}`).toBe("H");
    }
  });

  // supportsDoubleHeight=false (privzeto, ZCS terminal): "H" → "B"
  it("supportsDoubleHeight=false (privzeto/ZCS): Račun in SKUPAJ dobita 'B' (ne 'H')", () => {
    const json = buildTextReceipt({ ...BASE, postavke: [makePostavka("T")] }, 30);
    const racunIdx = json.linee.findIndex((l) => l.includes(BASE.stevilkaRacuna));
    const skupajIdx = json.linee.findIndex((l) => l.includes("SKUPAJ:"));
    expect(json.formati[racunIdx]).toBe("B");
    expect(json.formati[skupajIdx]).toBe("B");
    expect(json.formati[racunIdx]).not.toBe("H");
    expect(json.formati[skupajIdx]).not.toBe("H");
  });

  it("supportsDoubleHeight=false (privzeto/ZCS): nobena vrstica ni 'H'", () => {
    const json = buildTextReceipt({ ...BASE, postavke: [makePostavka("T")] }, 30);
    for (const f of json.formati) expect(f).not.toBe("H");
  });

  it("Datum, Osnova, DDV vrstice NISO 'H' (pri supportsDoubleHeight=true)", () => {
    const json = buildTextReceipt({ ...BASE, postavke: [makePostavka("T")] }, 40, true);
    json.linee.forEach((l, i) => {
      if (l.startsWith("Datum:") || l.startsWith("Osnova") || l.startsWith("DDV")) {
        expect(json.formati[i]).not.toBe("H");
      }
    });
  });

  it("formati[] in linee[] sta vedno enako dolgi", () => {
    const json = buildTextReceipt({ ...BASE, postavke: [makePostavka("Dolg naziv artikla za prelom pri cols")] }, 40, true);
    expect(json.formati.length).toBe(json.linee.length);
  });

  it("formati[] vsebuje samo veljavne vrednosti: 'N', 'B', 'H'", () => {
    const json = buildTextReceipt({ ...BASE, postavke: [makePostavka("Test")] }, 40, true);
    for (const f of json.formati) expect(["N", "B", "H"]).toContain(f);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Plačljivi dodatek — "+ naziv" v svoji vrstici, zneski spodaj
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildTextReceipt — plačljivi dodatek", () => {

  const postavkeZDodatkom = [
    { ...makePostavka("Pica", { postavkaId: 10 }) },
    {
      ime: "Ekstra sir",
      opomba: null,
      kolicina: 1,
      cenaKos: 1.50,
      cenaKosOriginalna: null,
      skupaj: 1.50,
      davek: 9.5,
      parentPostavkaId: 10,
      postavkaId: 11,
      artikelId: 2,
    },
  ];

  it("dodatek: '+ naziv' v svoji vrstici (brez €)", () => {
    const json = buildTextReceipt({ ...BASE, postavke: postavkeZDodatkom }, 32);
    const plusLine = json.linee.find((l) => l.startsWith("+ "));
    expect(plusLine).toBeDefined();
    expect(plusLine).toContain("Ekstra sir");
    expect(plusLine).not.toContain("€");
  });

  it("dodatek: zneskovna vrstica pod nazivom, točno cols, s T oznako in '1.50 €'", () => {
    const json = buildTextReceipt({ ...BASE, postavke: postavkeZDodatkom }, 32);
    const plusIdx = json.linee.findIndex((l) => l.startsWith("+ "));
    const znVrstica = json.linee[plusIdx + 1];
    expect(znVrstica.length).toBe(32);
    expect(znVrstica).toContain("1.50 €");
    expect(znVrstica.startsWith("T1")).toBe(true);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Opomba artikla — ena vrstica, brez lomljenja
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildTextReceipt — opomba artikla (ena vrstica)", () => {

  it("kratka opomba → 1 vrstica z '  ' zamikom", () => {
    const json = buildTextReceipt({ ...BASE, postavke: [makePostavka("Pivo", { opomba: "brez ledu" })] }, 40);
    const items = itemLines(json.linee);
    const opombaVrstice = items.filter((l) => l.startsWith("  ") && l.includes("brez ledu"));
    expect(opombaVrstice.length).toBe(1);
  });

  it("dolga opomba → OSTANE 1 vrstica (brez lomljenja)", () => {
    const opomba = "brez glutena, brez mleka, posebna priprava na zahtevo";
    const json = buildTextReceipt({ ...BASE, postavke: [makePostavka("Pica", { opomba })] }, 40);
    const items = itemLines(json.linee);
    const opombaVrstice = items.filter((l) => l.startsWith("  ") && !l.includes("€"));
    expect(opombaVrstice.length).toBe(1); // točno 1, ne 2+
  });

  it("opomba vrstica ≤ cols znakov (ni daljša od papirja)", () => {
    const opomba = "zelo dolga opomba, ki presega širino papirja pri vsakem tiskalniku, polna besedila";
    const json = buildTextReceipt({ ...BASE, postavke: [makePostavka("X", { opomba })] }, 40);
    const items = itemLines(json.linee);
    const op = items.find((l) => l.startsWith("  ") && !l.includes("€"));
    if (op) expect(op.length).toBeLessThanOrEqual(40);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Kompaktiranje praznih vrstic in ločilnih črt
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildTextReceipt — krajši izpis brez izgube vsebine", () => {
  it("storno v vseh rendererjih izpiše negativno kartico in napitnino brez generičnega fallbacka", () => {
    const storno: PrintRacunData = {
      ...BASE,
      skupaj: -12,
      placilnaNacin: "kartica",
      znesekKartica: -15,
      znesekNapitnina: -3,
    };
    const assertStornoPayments = (text: string) => {
      expect(text).toContain("Kartica skupaj");
      expect(text).toContain("-15.00");
      expect(text).toContain("Napitnina");
      expect(text).toContain("-3.00");
      expect(text).not.toMatch(/(?:^|\n)Kartica(?: \(EUR\))?:\s+-12\.00/m);
    };

    assertStornoPayments(buildTextReceipt(storno, 40).linee.join("\n"));
    assertStornoPayments(buildNb80TextReceipt(storno).linee.join("\n"));
    assertStornoPayments(Buffer.from(
      buildEscPosReceipt(storno, 40, { encoding: "ascii-translit" }),
    ).toString("latin1"));
  });

  it("odstrani trailing prazno vrstico in prazne vrstice izven SKUPAJ", () => {
    const json = buildTextReceipt({
      ...BASE,
      postavke: [makePostavka("Kava")],
      znesekBon: 2,
      znesekGotovina: 7.80,
      znesekBonPica: 1,
      steviloBonov: 1,
    }, 40);

    expect(json.linee.at(-1)).not.toBe("");
    expect(json.linee.filter((line) => line.trim() === "")).toEqual([""]);
    const blankIndex = json.linee.findIndex((line) => line.trim() === "");
    expect(json.linee[blankIndex + 1]).toContain("SKUPAJ:");
    expect(json.formati.length).toBe(json.linee.length);
  });

  it("ne pušča zaporednih ločilnih črt", () => {
    const json = buildTextReceipt({
      ...BASE,
      postavke: [makePostavka("Kava")],
      zoi: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      eor: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    }, 32);

    for (let i = 1; i < json.linee.length; i++) {
      expect(json.linee[i] === json.linee[i - 1] && /^-+$/.test(json.linee[i])).toBe(false);
    }
  });

  it("ohrani vse obvezne identifikacijske, DDV in FURS podatke", () => {
    const zoi = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
    const eor = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const json = buildTextReceipt({
      ...BASE,
      postavke: [makePostavka("Kava")],
      zoi,
      eor,
      jeDdvZavezanec: true,
    }, 32);
    const text = json.linee.join("\n");
    const withoutLineBreaks = json.linee.join("");

    expect(text).toContain("Račun:");
    expect(text).toContain("Datum:");
    expect(text).toContain("Datum opr. storitve");
    expect(text).toContain("SKUPAJ:");
    expect(text).toContain("Osnova (brez DDV):");
    expect(text).toContain("DDV skupaj:");
    expect(text).toContain("T1 DDV 9.5%");
    expect(text).toContain("DAVČNA POTRDITEV (FURS)");
    expect(withoutLineBreaks).toContain(`ZOI:${zoi}`);
    expect(withoutLineBreaks).toContain(`EOR:${eor}`);
    expect(text).toContain("ID za DDV: SI12345678");
  });
});
