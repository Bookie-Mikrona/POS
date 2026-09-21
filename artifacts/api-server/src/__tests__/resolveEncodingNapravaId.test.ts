/**
 * Testi za resolveEncodingFromSettings z napravaId parametrom.
 *
 * DB je zamockiran — brez realnih vnosov, brez FK omejitev.
 *
 * Scenarij simulira enoto 1 (posnetek produkcijskega stanja):
 *   id=14  Windows agent  agentTiskalnikIme="POS58 10.0.0.6"  cp852   sirina=58
 *   id=16  Android BT     (brez agenta)                       cp852
 *
 * Preverja:
 * 1. z napravaId → bere config TOČNO te naprave
 * 2. brez napravaId → stara logika (agent prioriteta)
 * 3. napravaId → ascii-translit deluje neodvisno od Windows agenta
 * 4. napravaId naprave brez kodne strani → privzetek cp1250
 * 5. napravaId → 80mm tiskalnik → cols=40
 * 6. napravaId → 30mm tiskalnik → cols=30
 * 7. napravaId ki ne obstaja v enoti → privzetek cp1250
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── DB stanje: per-naprava in per-enota tabele ───────────────────────────────

type Row = { id?: number; enotaId?: number; nastavitveJson: string | null };

const { dbState } = vi.hoisted(() => {
  const dbState = {
    // Za per-naprava klic (where id=X AND enotaId=Y → limit 1)
    perNapravaRows: [] as Row[],
    // Za per-enota klic (where enotaId=Y → vse)
    perEnotaRows: [] as Row[],
    // Kateri klic pričakujemo: "naprava" | "enota"
    mode: "enota" as "naprava" | "enota",
  };
  return { dbState };
});

vi.mock("@workspace/db", () => {
  function makeChain(getRows: () => Row[]): Record<string, unknown> {
    let _limit: number | null = null;
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      limit: (n: number) => { _limit = n; return chain; },
      then: (resolve: (v: Row[]) => unknown) => {
        const rows = getRows();
        return Promise.resolve(_limit != null ? rows.slice(0, _limit) : rows).then(resolve);
      },
    };
    void chain; // TS: chain je zgrajen, Symbol.toStringTag ni potreben
    return chain;
  }

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (n: number) => {
            // Per-naprava klic: vedno limit(1)
            const rows = dbState.perNapravaRows;
            return Promise.resolve(rows.slice(0, n));
          },
          // Per-enota klic: brez limit (vrne vse)
          then: (resolve: (v: Row[]) => unknown) =>
            Promise.resolve(dbState.perEnotaRows).then(resolve),
        }),
        // Per-enota klic brez limit
        then: (resolve: (v: Row[]) => unknown) =>
          Promise.resolve(dbState.perEnotaRows).then(resolve),
      }),
    }),
  };

  return {
    db,
    napraveTable: { nastavitveJson: "nastavitveJson", id: "id", enotaId: "enotaId" },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...args: unknown[]) => ({ op: "and", args }),
}));

import { resolveEncodingForTest } from "../routes/pos/btPrintTestHelper";

// ─── Helper: nastavi mock stanje ──────────────────────────────────────────────

function setupPerNaprava(rows: Row[]) {
  dbState.perNapravaRows = rows;
}

function setupPerEnota(rows: Row[]) {
  dbState.perEnotaRows = rows;
}

const AGENT_CP852 = JSON.stringify({ agentTiskalnikIme: "POS58 10.0.0.6", tiskalnikCodePage: "cp852", tiskalnikSirina: 58 });
const AGENT_WPC80 = JSON.stringify({ agentTiskalnikIme: "POS80 10.0.0.2", tiskalnikCodePage: "wpc1250", tiskalnikSirina: 80 });
const BT_CP852    = JSON.stringify({ tiskalnikCodePage: "cp852" });
const BT_TRANSLIT = JSON.stringify({ tiskalnikCodePage: "ascii-translit" });
const BT_WPC1250  = JSON.stringify({ tiskalnikCodePage: "wpc1250" });
const BT_BREZ_CP  = JSON.stringify({ tiskalnikSirina: 58 });

// ─── Testi: z napravaId — per-naprava lookup ──────────────────────────────────

describe("resolveEncoding z napravaId — per-naprava lookup", () => {
  it("Q10 BT (cp852): vrne cp852, ne Windows agenta", async () => {
    // Setup: perNaprava vrne Q10; perEnota bi vrnila agenta (ne sme biti klican)
    setupPerNaprava([{ nastavitveJson: BT_CP852 }]);
    setupPerEnota([{ nastavitveJson: AGENT_CP852 }]); // ne sme biti prebran

    const r = await resolveEncodingForTest(1, 16);
    expect(r.encoding).toBe("cp852");
    expect(r.cols).toBe(32);
  });

  it("Q10 BT (ascii-translit): vrne ascii-translit neodvisno od agenta", async () => {
    setupPerNaprava([{ nastavitveJson: BT_TRANSLIT }]);
    setupPerEnota([{ nastavitveJson: AGENT_CP852 }]);

    const r = await resolveEncodingForTest(1, 16);
    expect(r.encoding).toBe("ascii-translit");
    expect(r.cols).toBe(32);
  });

  it("Windows agent z napravaId=14: vrne cp852 (direktno, ne prek iteracije)", async () => {
    setupPerNaprava([{ nastavitveJson: AGENT_CP852 }]);
    const r = await resolveEncodingForTest(1, 14);
    expect(r.encoding).toBe("cp852");
  });

  it("BT naprava brez tiskalnikCodePage: privzetek cp1250", async () => {
    setupPerNaprava([{ nastavitveJson: BT_BREZ_CP }]);
    const r = await resolveEncodingForTest(1, 5);
    expect(r.encoding).toBe("cp1250");
    expect(r.cols).toBe(32);
  });

  it("80mm tiskalnik z napravaId: cols=40", async () => {
    setupPerNaprava([{ nastavitveJson: AGENT_WPC80 }]);
    const r = await resolveEncodingForTest(1, 99);
    expect(r.encoding).toBe("wpc1250");
    expect(r.cols).toBe(40);
  });

  it("30mm tiskalnik z napravaId: cols=30", async () => {
    setupPerNaprava([{ nastavitveJson: JSON.stringify({ tiskalnikCodePage: "cp852", tiskalnikSirina: 30 }) }]);
    const r = await resolveEncodingForTest(1, 13);
    expect(r.encoding).toBe("cp852");
    expect(r.cols).toBe(30);
  });

  it("napravaId ki ne obstaja v enoti (prazni perNapravaRows): privzetek cp1250", async () => {
    setupPerNaprava([]); // naprava ni najdena
    const r = await resolveEncodingForTest(1, 999999);
    expect(r.encoding).toBe("cp1250");
    expect(r.cols).toBe(32);
  });

  it("cp1250 eksplicitno nastavljen: vrne cp1250", async () => {
    setupPerNaprava([{ nastavitveJson: JSON.stringify({ tiskalnikCodePage: "cp1250" }) }]);
    const r = await resolveEncodingForTest(1, 7);
    expect(r.encoding).toBe("cp1250");
  });

  it("wpc1250 nastavljen: vrne wpc1250", async () => {
    setupPerNaprava([{ nastavitveJson: JSON.stringify({ tiskalnikCodePage: "wpc1250" }) }]);
    const r = await resolveEncodingForTest(1, 8);
    expect(r.encoding).toBe("wpc1250");
  });

  it("pokvarjen JSON v napravi: privzetek cp1250 (brez izjeme)", async () => {
    setupPerNaprava([{ nastavitveJson: "{POKVARJEN" }]);
    const r = await resolveEncodingForTest(1, 9);
    expect(r.encoding).toBe("cp1250");
  });
});

// ─── Testi: brez napravaId — stara logika ────────────────────────────────────

describe("resolveEncoding brez napravaId — stara logika (agent prioriteta)", () => {
  it("Windows agent prisoten: takoj vrni agentovo kodna stran (cp852)", async () => {
    setupPerEnota([
      { nastavitveJson: null },                             // preskoči
      { nastavitveJson: BT_TRANSLIT },                     // fallback kandidat
      { nastavitveJson: AGENT_CP852 },                     // agent → return takoj
      { nastavitveJson: AGENT_WPC80 },                     // nikoli dosežen
    ]);
    const r = await resolveEncodingForTest(1);
    expect(r.encoding).toBe("cp852");
  });

  it("brez agenta: fallback na BT napravo z nastavljenim CP (ascii-translit)", async () => {
    setupPerEnota([
      { nastavitveJson: BT_BREZ_CP },   // brez CP → preskoči fallback
      { nastavitveJson: BT_TRANSLIT },  // fallback → ascii-translit
      { nastavitveJson: BT_WPC1250 },   // drugi fallback — ne bi smel prepisati prvega
    ]);
    const r = await resolveEncodingForTest(1);
    expect(r.encoding).toBe("ascii-translit");
  });

  it("brez agenta, brez CP v vseh napravah: privzetek cp1250", async () => {
    setupPerEnota([
      { nastavitveJson: BT_BREZ_CP },
      { nastavitveJson: JSON.stringify({ tiskalnikSirina: 30 }) },
    ]);
    const r = await resolveEncodingForTest(1);
    expect(r.encoding).toBe("cp1250");
  });

  it("enota brez naprav (prazno): privzetek cp1250", async () => {
    setupPerEnota([]);
    const r = await resolveEncodingForTest(1);
    expect(r.encoding).toBe("cp1250");
    expect(r.cols).toBe(32);
  });

  it("Windows agent z 80mm: cols=40", async () => {
    setupPerEnota([{ nastavitveJson: AGENT_WPC80 }]);
    const r = await resolveEncodingForTest(1);
    expect(r.encoding).toBe("wpc1250");
    expect(r.cols).toBe(40);
  });
});
