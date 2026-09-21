/**
 * osUvoz.test.ts — Testi za uvozno funkcijo OS
 */

import { describe, it, expect } from "vitest";
import {
  parseSloCurrency,
  parseSloDate,
  resolveAccountId,
  resolveCostCenterId,
  resolvePartnerId,
  buildObogatitvePlan,
  buildSredstvoStatus,
  parseBoolean,
  parseDoknjizba,
  groupByInventarna,
  type SredstvoVrstica,
  type UvozNapaka,
} from "./osUvoz";

// ─── parseSloCurrency ─────────────────────────────────────────────────────────

describe("parseSloCurrency — slovensko številsko oblikovanje", () => {
  it('"1.790,19" → 1790.19', () => expect(parseSloCurrency("1.790,19")).toBeCloseTo(1790.19));
  it('"21.907,86" → 21907.86', () => expect(parseSloCurrency("21.907,86")).toBeCloseTo(21907.86));
  it('"1.234.567,89" → 1234567.89', () => expect(parseSloCurrency("1.234.567,89")).toBeCloseTo(1234567.89));
  it('"0,00" → 0', () => expect(parseSloCurrency("0,00")).toBe(0));
  it('"100" (brez decimalk) → 100', () => expect(parseSloCurrency("100")).toBe(100));
  it('"1234,56" (samo vejica) → 1234.56', () => expect(parseSloCurrency("1234,56")).toBeCloseTo(1234.56));
  it("že število 100.5 → 100.5", () => expect(parseSloCurrency(100.5)).toBe(100.5));
  it("že število 0 → 0", () => expect(parseSloCurrency(0)).toBe(0));
  it('prazna vrstica "" → null', () => expect(parseSloCurrency("")).toBeNull());
  it("null → null", () => expect(parseSloCurrency(null)).toBeNull());
  it("undefined → null", () => expect(parseSloCurrency(undefined)).toBeNull());
  it('"ni vrednost" → null', () => expect(parseSloCurrency("ni vrednost")).toBeNull());
  it("Infinity → null", () => expect(parseSloCurrency(Infinity)).toBeNull());
});

// ─── parseSloDate ─────────────────────────────────────────────────────────────

describe("parseSloDate — slovensko obliko datuma", () => {
  it('"31.12.2022" → "2022-12-31"', () => expect(parseSloDate("31.12.2022")).toBe("2022-12-31"));
  it('"1.1.2020" → "2020-01-01" (brez vodilnih ničel)', () => expect(parseSloDate("1.1.2020")).toBe("2020-01-01"));
  it('"15.3.2019" → "2019-03-15"', () => expect(parseSloDate("15.3.2019")).toBe("2019-03-15"));
  it('"2022-12-31" (ISO) → "2022-12-31"', () => expect(parseSloDate("2022-12-31")).toBe("2022-12-31"));
  it("Date objekt → ISO string", () => {
    const d = new Date("2023-06-15T00:00:00Z");
    expect(parseSloDate(d)).toBe("2023-06-15");
  });
  it('prazna vrstica "" → null', () => expect(parseSloDate("")).toBeNull());
  it("null → null", () => expect(parseSloDate(null)).toBeNull());
  it('"neveljavno" → null', () => expect(parseSloDate("neveljavno")).toBeNull());
});

// ─── resolveAccountId ─────────────────────────────────────────────────────────

describe("resolveAccountId — iskanje ID konta po šifri", () => {
  const map = new Map([
    ["0030000", "id-003-long"],
    ["0050000", "id-005-long"],
    ["040", "id-040-short"],
    ["0400000", "id-040-long"],
    ["022", "id-022-short"],
  ]);

  it("natančno ujemanje 7-mestne šifre", () => expect(resolveAccountId("0030000", map)).toBe("id-003-long"));
  it("natančno ujemanje 7-mestne (040)", () => expect(resolveAccountId("0400000", map)).toBe("id-040-long"));
  it("fallback 7-mestna → 3-mestna (ko ni 7-mestne, je pa 3-mestna)", () => {
    const shortOnly = new Map([["040", "id-040-short"]]);
    expect(resolveAccountId("0400000", shortOnly)).toBe("id-040-short");
  });
  it("fallback 3-mestna → 7-mestna (ko ni 3-mestne, je pa 7-mestna)", () => {
    const longOnly = new Map([["0050000", "id-005-long"]]);
    expect(resolveAccountId("005", longOnly)).toBe("id-005-long");
  });
  it("neznana šifra → null", () => expect(resolveAccountId("9999999", map)).toBeNull());
  it("null → null", () => expect(resolveAccountId(null, map)).toBeNull());
  it("undefined → null", () => expect(resolveAccountId(undefined, map)).toBeNull());
  it('prazna vrstica "" → null', () => expect(resolveAccountId("", map)).toBeNull());
  it("natančno ujemanje 3-mestne", () => expect(resolveAccountId("040", map)).toBe("id-040-short"));
});

// ─── buildSredstvoStatus ─────────────────────────────────────────────────────

describe("buildSredstvoStatus — določitev statusa iz podatkov", () => {
  it("odpisan=true + odpisana≥nabavna → odpisano", () =>
    expect(buildSredstvoStatus(true, 10000, 10000, null)).toBe("odpisano"));
  it("odpisan=true + odpisana>nabavna → odpisano", () =>
    expect(buildSredstvoStatus(true, 10000, 10001, null)).toBe("odpisano"));
  it("odpisan=true + odpisana<nabavna → še vedno odpisano (flag zadosten)", () =>
    expect(buildSredstvoStatus(true, 10000, 5000, null)).toBe("odpisano"));
  it("odpisan=false + datum_aktivacije → v_uporabi", () =>
    expect(buildSredstvoStatus(false, 10000, 2000, "2020-01-01")).toBe("v_uporabi"));
  it("odpisan=false + brez datuma → v_teku", () =>
    expect(buildSredstvoStatus(false, 10000, 0, null)).toBe("v_teku"));
  it("odpisan=false + vrednosti null + brez datuma → v_teku", () =>
    expect(buildSredstvoStatus(false, null, null, null)).toBe("v_teku"));
  it("odpisan=true + vrednosti null → odpisano (flag zadosten)", () =>
    expect(buildSredstvoStatus(true, null, null, null)).toBe("odpisano"));
});

// ─── parseBoolean ─────────────────────────────────────────────────────────────

describe("parseBoolean — DA/NE in variante", () => {
  it('"DA" → true', () => expect(parseBoolean("DA")).toBe(true));
  it('"da" → true', () => expect(parseBoolean("da")).toBe(true));
  it('"x" → true', () => expect(parseBoolean("x")).toBe(true));
  it('"1" → true', () => expect(parseBoolean("1")).toBe(true));
  it('"NE" → false', () => expect(parseBoolean("NE")).toBe(false));
  it('"" → false', () => expect(parseBoolean("")).toBe(false));
  it("null → false", () => expect(parseBoolean(null)).toBe(false));
  it("0 → false", () => expect(parseBoolean(0)).toBe(false));
  it("1 (number) → true", () => expect(parseBoolean(1)).toBe(true));
});

// ─── parseSloCurrency — negativne vrednosti ───────────────────────────────────

describe("parseSloCurrency — negativne vrednosti (reklamacije, storno)", () => {
  it('"-709,88" → -709.88', () => expect(parseSloCurrency("-709,88")).toBeCloseTo(-709.88));
  it('"-1.709,88" → -1709.88', () => expect(parseSloCurrency("-1.709,88")).toBeCloseTo(-1709.88));
  it('"-0,01" → -0.01', () => expect(parseSloCurrency("-0,01")).toBeCloseTo(-0.01));
  it("že število -100.5 → -100.5", () => expect(parseSloCurrency(-100.5)).toBe(-100.5));
});

// ─── parseDoknjizba ───────────────────────────────────────────────────────────

describe("parseDoknjizba — int ≥ 0, privzeto 0", () => {
  it('"" (prazno) → 0', () => expect(parseDoknjizba("")).toBe(0));
  it("null → 0", () => expect(parseDoknjizba(null)).toBe(0));
  it("undefined → 0", () => expect(parseDoknjizba(undefined)).toBe(0));
  it('"0" → 0', () => expect(parseDoknjizba("0")).toBe(0));
  it('"1" → 1', () => expect(parseDoknjizba("1")).toBe(1));
  it('"3" → 3', () => expect(parseDoknjizba("3")).toBe(3));
  it("število 2 → 2", () => expect(parseDoknjizba(2)).toBe(2));
  it("število 0 → 0", () => expect(parseDoknjizba(0)).toBe(0));
  it("negativno -1 → 0 (varnostni fallback)", () => expect(parseDoknjizba(-1)).toBe(0));
  it('"neveljavno" → 0', () => expect(parseDoknjizba("neveljavno")).toBe(0));
  it("decimalno 1.9 → 1 (floor)", () => expect(parseDoknjizba(1.9)).toBe(1));
});

// ─── groupByInventarna ────────────────────────────────────────────────────────

function makeVrstica(overrides: Partial<SredstvoVrstica> & { inventarna: string; doknjizba: number }): SredstvoVrstica {
  return {
    vrstica: 2,
    naziv: "Test",
    skupina: "I",
    konto: "0400000",
    stm: "",
    kontoPopravka: "",
    kontoStroska: "",
    partnerDavcna: "",
    partnerNaziv: "",
    nabavna: 10000,
    odpisana: 0,
    datumNabave: "2020-01-01",
    datumAktivacije: "2020-01-01",
    odpisan: false,
    ...overrides,
  };
}

// ─── resolveCostCenterId ───────────────────────────────────────────────────────

describe("resolveCostCenterId — iskanje ID stroškovnega mesta", () => {
  const codeIndex = new Map([
    ["100", "id-100"],
    ["200", "id-200"],
    ["UPRAVA", "id-uprava"],
  ]);
  const nameIndex = new Map([
    ["uprava", "id-uprava-by-name"],
    ["prodaja", "id-prodaja"],
  ]);

  it("natančno ujemanje po kodi", () => expect(resolveCostCenterId("100", "", codeIndex, nameIndex)).toBe("id-100"));
  it("natančno ujemanje po kodi 200", () => expect(resolveCostCenterId("200", "", codeIndex, nameIndex)).toBe("id-200"));
  it("fallback po nazivu (case-insensitive)", () => expect(resolveCostCenterId("XXX", "Prodaja", codeIndex, nameIndex)).toBe("id-prodaja"));
  it("fallback po nazivu — ujemanje z imenom", () => expect(resolveCostCenterId("", "uprava", codeIndex, nameIndex)).toBe("id-uprava-by-name"));
  it("koda ima prednost pred nazivom", () => expect(resolveCostCenterId("UPRAVA", "uprava", codeIndex, nameIndex)).toBe("id-uprava"));
  it("neujemanje → null", () => expect(resolveCostCenterId("999", "neznano", codeIndex, nameIndex)).toBeNull());
  it("prazni nizi → null", () => expect(resolveCostCenterId("", "", codeIndex, nameIndex)).toBeNull());
});

// ─── resolvePartnerId ─────────────────────────────────────────────────────────

describe("resolvePartnerId — iskanje ID dobavitelja", () => {
  const taxIdIndex = new Map([
    ["12345678", "id-partner-a"],
    ["87654321", "id-partner-b"],
  ]);
  const nameIndex = new Map([
    ["acme d.o.o.", "id-acme"],
    ["beta d.d.", "id-beta"],
  ]);

  it("natančno ujemanje po davčni (brez SI)", () => expect(resolvePartnerId("12345678", "", taxIdIndex, nameIndex)).toBe("id-partner-a"));
  it("ujemanje po davčni s SI prefiksom → strippa in najde", () => expect(resolvePartnerId("SI12345678", "", taxIdIndex, nameIndex)).toBe("id-partner-a"));
  it("ujemanje po davčni z malimi si", () => expect(resolvePartnerId("si87654321", "", taxIdIndex, nameIndex)).toBe("id-partner-b"));
  it("fallback po nazivu (case-insensitive) — lowercase pred primerjavo", () => expect(resolvePartnerId("", "Acme D.O.O.", taxIdIndex, nameIndex)).toBe("id-acme"));
  it("fallback po nazivu (lowercase)", () => expect(resolvePartnerId("", "acme d.o.o.", taxIdIndex, nameIndex)).toBe("id-acme"));
  it("davčna ima prednost pred nazivom", () => {
    const taxIdx = new Map([["11111111", "id-by-tax"]]);
    const nameIdx = new Map([["acme d.o.o.", "id-by-name"]]);
    expect(resolvePartnerId("11111111", "acme d.o.o.", taxIdx, nameIdx)).toBe("id-by-tax");
  });
  it("neujemanje → null", () => expect(resolvePartnerId("99999999", "neznano", taxIdIndex, nameIndex)).toBeNull());
  it("prazni nizi → null", () => expect(resolvePartnerId("", "", taxIdIndex, nameIndex)).toBeNull());
});

describe("groupByInventarna — grupiranje po inventarni", () => {
  it("ena vrstica doknjizba=0 → ena grupa, ni sirota, ni dograditev", () => {
    const napake: UvozNapaka[] = [];
    const rows = [makeVrstica({ inventarna: "001", doknjizba: 0 })];
    const grupe = groupByInventarna(rows, napake);
    expect(grupe).toHaveLength(1);
    expect(grupe[0]?.sirota).toBe(false);
    expect(grupe[0]?.dograditve).toHaveLength(0);
    expect(grupe[0]?.glava.doknjizba).toBe(0);
    expect(napake).toHaveLength(0);
  });

  it("dve vrstici iste inventarne (0 + 1) → ena glava + ena dograditev", () => {
    const napake: UvozNapaka[] = [];
    const rows = [
      makeVrstica({ inventarna: "001", doknjizba: 0, nabavna: 5000, naziv: "Nakup" }),
      makeVrstica({ inventarna: "001", doknjizba: 1, nabavna: 3000, naziv: "Dograditev" }),
    ];
    const grupe = groupByInventarna(rows, napake);
    expect(grupe).toHaveLength(1);
    expect(grupe[0]?.sirota).toBe(false);
    expect(grupe[0]?.glava.doknjizba).toBe(0);
    expect(grupe[0]?.glava.naziv).toBe("Nakup");
    expect(grupe[0]?.dograditve).toHaveLength(1);
    expect(grupe[0]?.dograditve[0]?.doknjizba).toBe(1);
    expect(grupe[0]?.dograditve[0]?.naziv).toBe("Dograditev");
    expect(napake).toHaveLength(0);
  });

  it("dograditev prevzame skupino GLAVE (ne svojo) — skupina na dograditvi ni relevantna", () => {
    const napake: UvozNapaka[] = [];
    const rows = [
      makeVrstica({ inventarna: "001", doknjizba: 0, skupina: "I" }),
      makeVrstica({ inventarna: "001", doknjizba: 1, skupina: "II" }), // skupina dograditve ignorirana
    ];
    const grupe = groupByInventarna(rows, napake);
    // Skupino bere klicatelj iz glava.skupina — tu samo preverimo, da glava ostane "I"
    expect(grupe[0]?.glava.skupina).toBe("I");
  });

  it("tri vrstice (0, 1, 2) → ena glava + dve dograditvi, sortirani naraščajoče", () => {
    const napake: UvozNapaka[] = [];
    const rows = [
      makeVrstica({ inventarna: "AAA", doknjizba: 2, vrstica: 4 }),
      makeVrstica({ inventarna: "AAA", doknjizba: 0, vrstica: 2 }),
      makeVrstica({ inventarna: "AAA", doknjizba: 1, vrstica: 3 }),
    ];
    const grupe = groupByInventarna(rows, napake);
    expect(grupe).toHaveLength(1);
    expect(grupe[0]?.glava.doknjizba).toBe(0);
    expect(grupe[0]?.dograditve.map(d => d.doknjizba)).toEqual([1, 2]);
    expect(napake).toHaveLength(0);
  });

  it("sirota (ni seq=0) → najnižji seq postane glava, opozorilo v napake[], sirota=true", () => {
    const napake: UvozNapaka[] = [];
    const rows = [
      makeVrstica({ inventarna: "SIR", doknjizba: 2, vrstica: 5 }),
      makeVrstica({ inventarna: "SIR", doknjizba: 1, vrstica: 4 }),
    ];
    const grupe = groupByInventarna(rows, napake);
    expect(grupe).toHaveLength(1);
    expect(grupe[0]?.sirota).toBe(true);
    expect(grupe[0]?.glava.doknjizba).toBe(1); // najnižji seq
    expect(grupe[0]?.dograditve).toHaveLength(1);
    expect(grupe[0]?.dograditve[0]?.doknjizba).toBe(2);
    expect(napake).toHaveLength(1);
    expect(napake[0]?.opis).toMatch(/sirota/i);
  });

  it("podvojen seq → napaka, drugi preskoči, prvi ostane", () => {
    const napake: UvozNapaka[] = [];
    const rows = [
      makeVrstica({ inventarna: "X", doknjizba: 0, vrstica: 2, naziv: "prvi" }),
      makeVrstica({ inventarna: "X", doknjizba: 0, vrstica: 3, naziv: "drugi" }), // duplikat
      makeVrstica({ inventarna: "X", doknjizba: 1, vrstica: 4 }),
    ];
    const grupe = groupByInventarna(rows, napake);
    expect(grupe).toHaveLength(1);
    expect(grupe[0]?.glava.naziv).toBe("prvi"); // prvi zmaga
    expect(grupe[0]?.dograditve).toHaveLength(1);
    expect(napake).toHaveLength(1);
    expect(napake[0]?.polje).toBe("doknjizba");
  });

  it("dve različni inventarni → dve grupi", () => {
    const napake: UvozNapaka[] = [];
    const rows = [
      makeVrstica({ inventarna: "A01", doknjizba: 0 }),
      makeVrstica({ inventarna: "B02", doknjizba: 0 }),
    ];
    const grupe = groupByInventarna(rows, napake);
    expect(grupe).toHaveLength(2);
    expect(napake).toHaveLength(0);
  });
});

// ─── buildObogatitvePlan — per-field IS NULL eligibility ─────────────────────

describe("buildObogatitvePlan — napolni samo IS NULL polja", () => {
  const allNull = { id: "s1", costCenterId: null, kontoPopravkaId: null, kontoStroskaId: null };
  const allFilled = { id: "s1", costCenterId: "cc1", kontoPopravkaId: "kp1", kontoStroskaId: "ks1" };
  const partnerNull = { id: "d1", partnerId: null };
  const partnerFilled = { id: "d1", partnerId: "p1" };

  const resolved = {
    costCenterId: "cc-new",
    kontoPopravkaId: "kp-new",
    kontoStroskaId: "ks-new",
    partnerId: "p-new",
  };

  it("existing=null → vrne null", () => {
    expect(buildObogatitvePlan(null, resolved, partnerNull)).toBeNull();
  });

  it("vsa polja null → plan napolni vsa polja", () => {
    const plan = buildObogatitvePlan(allNull, resolved, partnerNull);
    expect(plan?.costCenterId).toBe("cc-new");
    expect(plan?.kontoPopravkaId).toBe("kp-new");
    expect(plan?.kontoStroskaId).toBe("ks-new");
    expect(plan?.partnerId).toBe("p-new");
  });

  it("vsa polja že napolnjena → plan ne napolni ničesar", () => {
    const plan = buildObogatitvePlan(allFilled, resolved, partnerFilled);
    expect(plan?.costCenterId).toBeNull();
    expect(plan?.kontoPopravkaId).toBeNull();
    expect(plan?.kontoStroskaId).toBeNull();
    expect(plan?.partnerId).toBeNull();
  });

  it("samo kontoPopravkaId prazen → napolni samo kontoPopravkaId", () => {
    const partial = { id: "s1", costCenterId: "cc1", kontoPopravkaId: null, kontoStroskaId: "ks1" };
    const plan = buildObogatitvePlan(partial, resolved, partnerFilled);
    expect(plan?.costCenterId).toBeNull();         // že napolnjen
    expect(plan?.kontoPopravkaId).toBe("kp-new");  // prazen → napolni
    expect(plan?.kontoStroskaId).toBeNull();        // že napolnjen
    expect(plan?.partnerId).toBeNull();             // že napolnjen
  });

  it("costCenterId napolnjen, partner null → napolni samo partner", () => {
    const partial = { id: "s1", costCenterId: "cc1", kontoPopravkaId: "kp1", kontoStroskaId: "ks1" };
    const plan = buildObogatitvePlan(partial, resolved, partnerNull);
    expect(plan?.costCenterId).toBeNull();
    expect(plan?.partnerId).toBe("p-new");
  });

  it("resolved.costCenterId=null → ne napolni costCenterId (ni podatka v XLSX)", () => {
    const noStm = { ...resolved, costCenterId: null };
    const plan = buildObogatitvePlan(allNull, noStm, partnerNull);
    expect(plan?.costCenterId).toBeNull();
    expect(plan?.kontoPopravkaId).toBe("kp-new"); // ostala polja še vedno
  });

  it("seq0=null (ni seq=0 doknjižbe) → partnerId ostane null v planu", () => {
    const plan = buildObogatitvePlan(allNull, resolved, null);
    expect(plan?.partnerId).toBeNull();
    expect(plan?.doknjizbaId).toBeNull();
    expect(plan?.costCenterId).toBe("cc-new"); // glava se še napolni
  });

  it("sredstvoId je pravilno prenesen v plan", () => {
    const plan = buildObogatitvePlan(allNull, resolved, partnerNull);
    expect(plan?.sredstvoId).toBe("s1");
    expect(plan?.doknjizbaId).toBe("d1");
  });
});
