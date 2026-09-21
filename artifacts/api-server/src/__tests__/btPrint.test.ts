/**
 * Testi za BT tiskanje — kodna stran in transliteracija
 *
 * Preverja:
 * - transliterateToAscii: šumniki → ASCII, € → EUR, latinski razširjeni → ASCII
 * - GET /print/racun/:id (BT pot): upošteva tiskalnikCodePage iz naprave
 * - GET /print/racun/:id: privzetek cp1250 (brez naprave)
 * - Agent pot: nespremenjena (prek resolveEncodingFromSettings)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { transliterateToAscii, buildEscPosReceipt } from "../lib/pos-escpos";
import type { PrintRacunData } from "../lib/pos-escpos";

// ─── vi.hoisted ───────────────────────────────────────────────────────────────

const { dbState } = vi.hoisted(() => {
  const dbState = { napraveRows: [] as unknown[] };
  return { dbState };
});

// ─── @workspace/db mock ───────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  function makeChain(): Record<string, unknown> {
    const rows = dbState.napraveRows;
    const p = Promise.resolve(rows);
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      orderBy: () => chain,
      limit: () => p,
      then: p.then.bind(p),
      catch: (p as Promise<unknown[]>).catch.bind(p),
    };
    return chain;
  }
  return {
    db: {
      select: () => makeChain(),
      insert: () => ({ values: () => Promise.resolve([]) }),
    },
    racuniTable:         { id: "id", enotaId: "enota_id" },
    postavkeTable:       { racunId: "racun_id", enotaId: "enota_id" },
    blagajneTable:       { enotaId: "enota_id" },
    enoteTable:          { id: "id" },
    natakariTable:       { id: "id", enotaId: "enota_id" },
    mizeTable:           { enotaId: "enota_id" },
    izmeneTable:         { id: "id", enotaId: "enota_id" },
    napraveTable:        { enotaId: "enota_id", nastavitveJson: "nastavitve_json" },
    tiskalneNalogeTable: { enotaId: "enota_id", racunId: "racun_id", bajti: "bajti" },
    artikliTable:        { id: "id" },
    zalogaGibiTable:     { id: "id" },
    modNormativiTable:   { id: "id" },
    normativiTable:      { id: "id" },
    narocilaTable:       { id: "id" },
    partnerCenikiTable:  { id: "id" },
    vivaVracilaTable:    { id: "id" },
  };
});

// ─── Transliteracija ──────────────────────────────────────────────────────────

describe("transliterateToAscii", () => {
  it("pretvori slovenske šumnike v ASCII", () => {
    expect(transliterateToAscii("čšž")).toBe("csz");
    expect(transliterateToAscii("ČŠŽ")).toBe("CSZ");
  });

  it("pretvori đ/Đ", () => {
    expect(transliterateToAscii("đĐ")).toBe("dD");
  });

  it("€ postane EUR", () => {
    expect(transliterateToAscii("12,50 €")).toBe("12,50 EUR");
    expect(transliterateToAscii("€ 5.00")).toBe("EUR 5.00");
  });

  it("razširjeni latinski znaki", () => {
    expect(transliterateToAscii("àáâãäå")).toBe("aaaaaa");
    expect(transliterateToAscii("éèê")).toBe("eee");
    expect(transliterateToAscii("öüä")).toBe("oua");
    expect(transliterateToAscii("ñ")).toBe("n");
    expect(transliterateToAscii("ß")).toBe("ss");
    expect(transliterateToAscii("æ")).toBe("ae");
    expect(transliterateToAscii("œ")).toBe("oe");
  });

  it("čisti ASCII ostane nespremenjen", () => {
    const s = "Hvala za obisk! 12.50 - ABC 0123";
    expect(transliterateToAscii(s)).toBe(s);
  });

  it("ne-ASCII brez preslikave se izpusti", () => {
    // Kitajski, arabski, cirilica — ni v tabeli → izpust
    expect(transliterateToAscii("你好")).toBe("");
    expect(transliterateToAscii("Abc你好Def")).toBe("AbcDef");
  });

  it("realistična vsebina računa", () => {
    const vhod = "Restavracija Čopič — Šiška\nPivaški vrč 0,5 l\n12,50 €";
    const izhod = transliterateToAscii(vhod);
    expect(izhod).toContain("Restavracija Copic");
    expect(izhod).toContain("Siska");
    expect(izhod).toContain("12,50 EUR");
    // brez ne-ASCII znakov (razen LF, ki je ASCII 0x0A)
    for (const ch of izhod) {
      expect(ch.charCodeAt(0)).toBeLessThan(128);
    }
  });
});

// ─── resolveEncodingFromSettings (prek BT endpointa) ──────────────────────────
// Testiramo samo pomočniško logiko, ne celotnega HTTP stacka
// (buildEscPosData zahteva obsežen DB mock — to pokrijemo z unit testom funkcije)

describe("resolveEncodingFromSettings — vrnjena kodna stran", () => {
  beforeEach(() => {
    dbState.napraveRows = [];
  });

  it("cp1250 (privzeto) ko ni nobene naprave", async () => {
    dbState.napraveRows = [];
    const { resolveEncodingForTest } = await import("../routes/pos/btPrintTestHelper");
    const result = await resolveEncodingForTest(1);
    expect(result.encoding).toBe("cp1250");
    expect(result.cols).toBe(32);
  });

  it("cp852 ko naprava nastavi tiskalnikCodePage=cp852", async () => {
    dbState.napraveRows = [
      { nastavitveJson: JSON.stringify({ agentTiskalnikIme: "Printer1", tiskalnikCodePage: "cp852" }) },
    ];
    const { resolveEncodingForTest } = await import("../routes/pos/btPrintTestHelper");
    const result = await resolveEncodingForTest(1);
    expect(result.encoding).toBe("cp852");
  });

  it("wpc1250 ko naprava nastavi tiskalnikCodePage=wpc1250", async () => {
    dbState.napraveRows = [
      { nastavitveJson: JSON.stringify({ agentTiskalnikIme: "Printer1", tiskalnikCodePage: "wpc1250" }) },
    ];
    const { resolveEncodingForTest } = await import("../routes/pos/btPrintTestHelper");
    const result = await resolveEncodingForTest(1);
    expect(result.encoding).toBe("wpc1250");
  });

  it("ascii-translit ko naprava nastavi tiskalnikCodePage=ascii-translit", async () => {
    dbState.napraveRows = [
      { nastavitveJson: JSON.stringify({ agentTiskalnikIme: "Printer1", tiskalnikCodePage: "ascii-translit" }) },
    ];
    const { resolveEncodingForTest } = await import("../routes/pos/btPrintTestHelper");
    const result = await resolveEncodingForTest(1);
    expect(result.encoding).toBe("ascii-translit");
  });

  it("cols=40 pri tiskalnikSirina=80", async () => {
    dbState.napraveRows = [
      { nastavitveJson: JSON.stringify({ agentTiskalnikIme: "Printer1", tiskalnikSirina: 80 }) },
    ];
    const { resolveEncodingForTest } = await import("../routes/pos/btPrintTestHelper");
    const result = await resolveEncodingForTest(1);
    expect(result.cols).toBe(40);
  });

  it("naprave brez agentTiskalnikIme se preskočijo", async () => {
    dbState.napraveRows = [
      { nastavitveJson: JSON.stringify({ tiskalnikCodePage: "cp852" }) }, // nima agentTiskalnikIme
      { nastavitveJson: JSON.stringify({ agentTiskalnikIme: "P2", tiskalnikCodePage: "wpc1250" }) },
    ];
    const { resolveEncodingForTest } = await import("../routes/pos/btPrintTestHelper");
    const result = await resolveEncodingForTest(1);
    expect(result.encoding).toBe("wpc1250"); // P2 je prva veljavna
  });

  it("pokvarjen JSON v nastavitveJson se mirno preskoči", async () => {
    dbState.napraveRows = [
      { nastavitveJson: "NEVELJAVNO{{{" },
      { nastavitveJson: JSON.stringify({ agentTiskalnikIme: "P1", tiskalnikCodePage: "cp852" }) },
    ];
    const { resolveEncodingForTest } = await import("../routes/pos/btPrintTestHelper");
    const result = await resolveEncodingForTest(1);
    expect(result.encoding).toBe("cp852");
  });

  it("BT naprava brez agentTiskalnikIme — tiskalnikCodePage se upošteva kot fallback", async () => {
    // Simulira Q10 BT napravo: nima agentTiskalnikIme, ima tiskalnikCodePage
    dbState.napraveRows = [
      { nastavitveJson: JSON.stringify({ tiskalnikCodePage: "wpc1250" }) },
    ];
    const { resolveEncodingForTest } = await import("../routes/pos/btPrintTestHelper");
    const result = await resolveEncodingForTest(1);
    expect(result.encoding).toBe("wpc1250");
  });
});

// ─── buildEscPosReceipt — inicializacijsko zaporedje bajtov ───────────────────
// Potrdi: ESC @ (1B 40) → FS . (1C 2E) → ESC t n (kodna stran)
// FS . mora biti PRED ESC t n — sicer kitajski GBK način ignorira kodna stran
// ─────────────────────────────────────────────────────────────────────────────

const minimalData: PrintRacunData = {
  stevilkaRacuna: "0001-001-0001",
  datum: new Date("2026-08-10T10:00:00Z"),
  postavke: [{ ime: "Test artikel", kolicina: 1, cenaKos: 1.00, skupaj: 1.22, davek: 22 }],
  skupaj: 1.22,
  ddv: 0.22,
  placilnaNacin: "gotovina",
  status: "testni",
  nazivRestvracije: "Test",
};

describe("buildEscPosReceipt — inicializacijsko zaporedje", () => {
  it("začne z ESC @ (1B 40)", () => {
    const buf = Buffer.from(buildEscPosReceipt(minimalData));
    expect(buf[0]).toBe(0x1B);
    expect(buf[1]).toBe(0x40);
  });

  it("takoj za ESC @ sledi FS . (1C 2E) — izklop kitajskega načina", () => {
    const buf = Buffer.from(buildEscPosReceipt(minimalData));
    expect(buf[2]).toBe(0x1C); // FS
    expect(buf[3]).toBe(0x2E); // .
  });

  it("za FS . sledi ESC t n (cp1250 → n=0x2D)", () => {
    const buf = Buffer.from(buildEscPosReceipt(minimalData, 32, { encoding: "cp1250" }));
    expect(buf[4]).toBe(0x1B); // ESC
    expect(buf[5]).toBe(0x74); // t
    expect(buf[6]).toBe(0x2D); // n=45 CP1250
  });

  it("za FS . sledi ESC t n (wpc1250 → n=0x0C)", () => {
    const buf = Buffer.from(buildEscPosReceipt(minimalData, 32, { encoding: "wpc1250" }));
    expect(buf[4]).toBe(0x1B);
    expect(buf[5]).toBe(0x74);
    expect(buf[6]).toBe(0x0C); // n=12 WPC1250
  });

  it("za FS . sledi ESC t n (cp852 → n=0x12)", () => {
    const buf = Buffer.from(buildEscPosReceipt(minimalData, 32, { encoding: "cp852" }));
    expect(buf[4]).toBe(0x1B);
    expect(buf[5]).toBe(0x74);
    expect(buf[6]).toBe(0x12); // n=18 CP852
  });

  it("za FS . sledi ESC t n (ascii-translit → n=0x00 PC437)", () => {
    const buf = Buffer.from(buildEscPosReceipt(minimalData, 32, { encoding: "ascii-translit" }));
    expect(buf[4]).toBe(0x1B);
    expect(buf[5]).toBe(0x74);
    expect(buf[6]).toBe(0x00); // n=0 PC437
  });
});
