/**
 * Testi za OS amortizacija — mesečni obračun (Faza 3c/3)
 *
 * Pokriva:
 *   1. Engine: calcMeseci z doMeseca, znesek raste z doMeseca
 *   2. STATUS: december ali prazen obračun → zakljucen; sicer odprt
 *   3. ZAKLEP: prevLeto odprt → 409; ne obstaja ali zakljucen → dovoli
 *   4. os_viewer → 403
 *   5. Neveljaven vhod → 400
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── vi.hoisted ───────────────────────────────────────────────────────────────

const { dbState } = vi.hoisted(() => {
  const dbState = {
    queues: [] as unknown[][], idx: 0,
    inserted: [] as Record<string, unknown>[],
    updated: [] as Record<string, unknown>[],
  };
  return { dbState };
});

// ─── @workspace/db mock ──────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  function nextFrom(state: { queues: unknown[][], idx: number }): unknown[] {
    const r = state.queues[state.idx++];
    return r ?? [];
  }
  function makeChain(): Record<string, unknown> {
    const rows = nextFrom(dbState);
    const p = Promise.resolve(rows);
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      groupBy: () => p,
      limit: () => p,
      orderBy: () => p,
      then: p.then.bind(p),
      catch: (p as Promise<unknown[]>).catch.bind(p),
    };
    return chain;
  }
  function makeInsertChain(): Record<string, unknown> {
    const rows = nextFrom(dbState);
    const p = Promise.resolve(rows);
    const chain: Record<string, unknown> = {
      values: (values: Record<string, unknown>) => {
        dbState.inserted.push(values);
        return chain;
      },
      onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
        dbState.updated.push(set);
        return chain;
      },
      returning: () => p,
      then: p.then.bind(p),
      catch: (p as Promise<unknown[]>).catch.bind(p),
    };
    return chain;
  }
  return {
    db: {
      select: () => makeChain(),
      insert: () => makeInsertChain(),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          dbState.updated.push(values);
          return { where: () => Promise.resolve() };
        },
      }),
    },
    // Tabele — string vrednosti so dovolj (Drizzle mock)
    osAmortizacijaObracunTable: {
      id: "id", companyId: "company_id", leto: "leto",
      doMeseca: "do_meseca", status: "status",
    },
    osAmortizacijaObracunSredstvoTable: {
      id: "id", obracunId: "obracun_id", sredstvoId: "sredstvo_id",
      osnova: "osnova", stopnja: "stopnja", obracunano: "obracunano",
    },
    osAmortizacijaNastavitveTable: {
      companyId: "company_id", kontoStroskaId: "konto_stroska_id",
      kontoPopravkaId: "konto_popravka_id", osLeto: "os_leto",
    },
    companyModulesTable: { companyId: "company_id", module: "module" },
    osRolesTable: { clerkUserId: "clerk_user_id", companyId: "company_id", role: "role" },
    accountsTable: {
      id: "id", companyId: "company_id", code: "code", name: "name",
      isActive: "is_active", allowsPosting: "allows_posting",
      requiresCostCenter: "requires_cost_center",
      requiresPartner: "requires_partner", requiresProject: "requires_project",
    },
    osAmortizacijskeSkupineTable: {
      id: "id", companyId: "company_id", koda: "koda", naziv: "naziv",
      racunovodskaStonja: "racunovodska_stonja", davcnaStonja: "davcna_stonja",
    },
    osnovnaSredstvaTable: {
      id: "id", companyId: "company_id", inventarnaSt: "inventarna_st",
      naziv: "naziv", skupinaId: "skupina_id", costCenterId: "cost_center_id",
      accountId: "account_id", kontoStroskaId: "konto_stroska_id",
      kontoPopravkaId: "konto_popravka_id", status: "status",
    },
    osDoknjizbeTable: {
      id: "id", sredstvoId: "sredstvo_id", seq: "seq",
      nabavnaVrednost: "nabavna_vrednost", odpisanaVrednost: "odpisana_vrednost",
      neamortizljiviDelPct: "neamortizljivi_del_pct",
      datumAktivacije: "datum_aktivacije", datumIzpisa: "datum_izpisa", status: "status",
    },
    accountingPeriodsTable: {},
    companiesTable: { id: "id", naziv: "naziv", podjetjeDavcna: "podjetje_davcna" },
    journalEntriesTable: {}, journalEntryLinesTable: {},
  };
});

// ─── drizzle-orm mock ─────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({ _tag: "eq" })),
  and: vi.fn((...args: unknown[]) => ({ _tag: "and", args })),
  inArray: vi.fn(() => ({ _tag: "inArray" })),
  asc: vi.fn((a: unknown) => a),
  desc: vi.fn((a: unknown) => a),
  like: vi.fn(() => ({ _tag: "like" })),
  sql: vi.fn(() => ({ _tag: "sql" })),
  or: vi.fn(() => ({ _tag: "or" })),
  lt: vi.fn(() => ({ _tag: "lt" })),
  gt: vi.fn(() => ({ _tag: "gt" })),
}));

// ─── @clerk/express mock ──────────────────────────────────────────────────────

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: { authorization?: string } }) => ({
    userId: req.headers.authorization?.replace("Bearer ", "") ?? null,
  }),
}));

// ─── import after mocks ───────────────────────────────────────────────────────

async function buildApp() {
  const { default: router } = await import("../osAmortizacijaKnjizenje");
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

// ─── Engine testi (pure functions, no DB) ─────────────────────────────────────

import { calcMeseci, calcAmortizacijaObracun, calcObracunana, type SredstvoInput } from "../osAmortizacijaEngine";

describe("calcMeseci z doMeseca", () => {
  it("brez doMeseca → polno leto (12 mesecev za sredstvo aktivirano pred letom)", () => {
    expect(calcMeseci("2023-01-01", null, 2024)).toBe(12);
  });

  it("doMeseca=6 → samo 6 mesecev", () => {
    expect(calcMeseci("2023-01-01", null, 2024, 6)).toBe(6);
  });

  it("doMeseca=9 → 9 mesecev", () => {
    expect(calcMeseci("2023-01-01", null, 2024, 9)).toBe(9);
  });

  it("doMeseca=12 → 12 mesecev (ekvivalent brez doMeseca)", () => {
    expect(calcMeseci("2023-01-01", null, 2024, 12)).toBe(12);
  });

  // PRAVILO: amortizacija se začne v mesecu PO aktivaciji (ne v mesecu aktivacije)

  it("aktivacija v aprilu, doMeseca=6 → 3 meseci (apr,maj,jun): prviDan=2.4 → apr", () => {
    // +1 dan = 2024-04-02 → april → startMonth=4, endMonth=min(12,6)=6 → 6-4+1=3
    expect(calcMeseci("2024-04-01", null, 2024, 6)).toBe(3);
  });

  it("aktivacija v septembru, doMeseca=6 → 0 (prviMesec=okt(10) > doMeseca=6)", () => {
    // prviMesec=okt(10) > endMonth=6 → 0
    expect(calcMeseci("2024-09-01", null, 2024, 6)).toBe(0);
  });

  it("izpis v maju, doMeseca=8 → cap na izpis (4 mesece, jan–apr) — mesec maj se NE šteje (SRS)", () => {
    // aktivirano 2023 (prejšnje leto) → startMonth=1
    // izpisano 31.5.2024 → endMonth = maj−1 = 4 → min(4,8) = 4 → 4 mesecev (jan–apr)
    expect(calcMeseci("2023-06-01", "2024-05-31", 2024, 8)).toBe(4);
  });

  // ── Scenarij 0001454: aktivacija 2024-10-31 (POTRJENI PRIMERI) ───────────
  // Pravilo: prviMesec = november(11), torej:
  //   celoletno → nov(11)–dec(12) = 2 meseca
  //   do 10/2024 → prviMesec(11) > endMonth(10) → 0
  //   do 11/2024 → 1 mesec (november)

  it("aktivacija 2024-10-31, leto=2024, celoletno (do 12) → 2 meseca (nov, dec)", () => {
    expect(calcMeseci("2024-10-31", null, 2024)).toBe(2);
  });

  it("aktivacija 2024-10-31, leto=2024, doMeseca=12 → 2 meseca (nov, dec)", () => {
    expect(calcMeseci("2024-10-31", null, 2024, 12)).toBe(2);
  });

  it("aktivacija 2024-10-31, leto=2024, doMeseca=10 → 0 (prviMesec=nov za mejo okt)", () => {
    expect(calcMeseci("2024-10-31", null, 2024, 10)).toBe(0);
  });

  it("aktivacija 2024-10-31, leto=2024, doMeseca=11 → 1 mesec (november)", () => {
    expect(calcMeseci("2024-10-31", null, 2024, 11)).toBe(1);
  });

  // ── KLJUČNA RAZLIKA: 31.10 (zadnji dan) vs 30.10 (predzadnji dan) ──────────

  it("aktivacija 30.10.2024 → 3 meseci (okt,nov,dec): prviDan=31.10 → oktober", () => {
    // +1 dan = 2024-10-31 → mesec oktober → startMonth=10 → 12-10+1=3
    expect(calcMeseci("2024-10-30", null, 2024)).toBe(3);
  });

  it("aktivacija 30.10.2024, do 10/2024 → 1 mesec: oktober se šteje (startMonth=10, endMonth=10)", () => {
    expect(calcMeseci("2024-10-30", null, 2024, 10)).toBe(1);
  });

  it("aktivacija 30.10.2024, do 9/2024 → 0: startMonth=10 > endMonth=9", () => {
    expect(calcMeseci("2024-10-30", null, 2024, 9)).toBe(0);
  });

  it("aktivacija 31.12.2024, leto=2024 → 0: prviDan=1.1.2025 → prviMesecLeto=2025 > 2024", () => {
    // +1 dan = 2025-01-01 → prviMesecLeto=2025 > 2024 → return 0
    expect(calcMeseci("2024-12-31", null, 2024)).toBe(0);
  });

  it("aktivacija 31.12.2024, leto=2025 → 12: prviDan=1.1.2025 → prviMesecLeto=2025 == leto", () => {
    // prviMesecLeto=2025 === leto=2025, prviMesec=1 → startMonth=1 → 12
    expect(calcMeseci("2024-12-31", null, 2025)).toBe(12);
  });

  // ── Aktivacija v istem letu (razni meseci) ────────────────────────────────

  it("aktivacija 2024-03-15, leto=2024, celoletno → 10 mesecev (mar–dec): prviDan=16.3 → mar", () => {
    // +1 dan = 2024-03-16 → mesec marc → startMonth=3 → 12-3+1=10
    expect(calcMeseci("2024-03-15", null, 2024)).toBe(10);
  });

  it("aktivacija 2024-12-20, leto=2024 → 1 mesec (dec): prviDan=21.12 → december", () => {
    // +1 dan = 2024-12-21 → december → startMonth=12 → 12-12+1=1
    expect(calcMeseci("2024-12-20", null, 2024)).toBe(1);
  });

  it("aktivacija 2024-12-20, leto=2025 → 12 mesecev (v letu 2025 je celo leto)", () => {
    // aktivYear(2024) < leto(2025) → startMonth=1 → 12
    expect(calcMeseci("2024-12-20", null, 2025)).toBe(12);
  });

  // ── Prior-year sredstvo ───────────────────────────────────────────────────

  it("aktivacija 2024-10-31, leto=2025 → 12 mesecev (prior year → jan–dec)", () => {
    expect(calcMeseci("2024-10-31", null, 2025)).toBe(12);
  });

  it("aktivacija 2024-10-31, leto=2026 → 12 mesecev (prior year → jan–dec)", () => {
    expect(calcMeseci("2024-10-31", null, 2026)).toBe(12);
  });

  // ── Robustnost ────────────────────────────────────────────────────────────

  it("isNaN zaščita: prazen string → 0 mesecev", () => {
    expect(calcMeseci("" as string, null, 2024)).toBe(0);
  });

  it("isNaN zaščita: neveljaven datum format → 0 mesecev", () => {
    expect(calcMeseci("ni-datum" as string, null, 2024)).toBe(0);
  });

  it("Date objekt: new Date('2024-10-31') kot runtime vrednost → 2 meseca (nov, dec)", () => {
    // Simulira primer, ko pg/drizzle pri izvajanju vrne Date objekt namesto stringa
    const dateObj = new Date("2024-10-31") as unknown as string;
    expect(calcMeseci(dateObj, null, 2024)).toBe(2);
  });

  it("Date objekt: new Date('2024-10-31'), doMeseca=10 → 0", () => {
    const dateObj = new Date("2024-10-31") as unknown as string;
    expect(calcMeseci(dateObj, null, 2024, 10)).toBe(0);
  });

  it("Date objekt: new Date('2024-10-31'), doMeseca=11 → 1 mesec", () => {
    const dateObj = new Date("2024-10-31") as unknown as string;
    expect(calcMeseci(dateObj, null, 2024, 11)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// calcMeseci: oba pravili — naslednji_dan vs naslednji_mesec
// ═══════════════════════════════════════════════════════════════════════════════
describe("calcMeseci — naslednji_dan vs naslednji_mesec", () => {
  // ── Aktivacija 30.10.2024: edina razlika med praviloma ───────────────────
  // naslednji_dan: prviDan = 31.10 → mesec = oktober → startMonth = 10
  // naslednji_mesec: prviMesec = 11 (november) → startMonth = 11
  it("akt. 30.10, leto 2024 | naslednji_dan  → 3 mesece (okt, nov, dec)", () => {
    expect(calcMeseci("2024-10-30", null, 2024, 12, "naslednji_dan")).toBe(3);
  });
  it("akt. 30.10, leto 2024 | naslednji_mesec → 2 meseca (nov, dec)", () => {
    expect(calcMeseci("2024-10-30", null, 2024, 12, "naslednji_mesec")).toBe(2);
  });
  it("akt. 30.10, doMeseca=10 | naslednji_dan  → 1 mesec (okt se šteje)", () => {
    expect(calcMeseci("2024-10-30", null, 2024, 10, "naslednji_dan")).toBe(1);
  });
  it("akt. 30.10, doMeseca=10 | naslednji_mesec → 0 (prviMesec=11 > endMonth=10)", () => {
    expect(calcMeseci("2024-10-30", null, 2024, 10, "naslednji_mesec")).toBe(0);
  });

  // ── Aktivacija 31.10.2024: oba pravili dasta enak rezultat ───────────────
  // naslednji_dan: prviDan = 1.11 → mesec = november
  // naslednji_mesec: prviMesec = 11 → mesec = november
  it("akt. 31.10, leto 2024 | naslednji_dan   → 2 meseca (nov, dec)", () => {
    expect(calcMeseci("2024-10-31", null, 2024, 12, "naslednji_dan")).toBe(2);
  });
  it("akt. 31.10, leto 2024 | naslednji_mesec → 2 meseca (nov, dec)", () => {
    expect(calcMeseci("2024-10-31", null, 2024, 12, "naslednji_mesec")).toBe(2);
  });
  it("akt. 31.10, doMeseca=10 | naslednji_dan  → 0 (prviDan=1.11 > okt)", () => {
    expect(calcMeseci("2024-10-31", null, 2024, 10, "naslednji_dan")).toBe(0);
  });
  it("akt. 31.10, doMeseca=10 | naslednji_mesec → 0 (prviMesec=11 > okt)", () => {
    expect(calcMeseci("2024-10-31", null, 2024, 10, "naslednji_mesec")).toBe(0);
  });

  // ── Aktivacija 31.12.2024: oba pravili → 0 v 2024, 12 v 2025 ────────────
  it("akt. 31.12.2024, leto 2024 | naslednji_dan   → 0 (prviDan=1.1.2025)", () => {
    expect(calcMeseci("2024-12-31", null, 2024, 12, "naslednji_dan")).toBe(0);
  });
  it("akt. 31.12.2024, leto 2024 | naslednji_mesec → 0 (prviMesecLeto=2025)", () => {
    expect(calcMeseci("2024-12-31", null, 2024, 12, "naslednji_mesec")).toBe(0);
  });
  it("akt. 31.12.2024, leto 2025 | naslednji_dan   → 12 (prviDan=1.1.2025 → jan)", () => {
    expect(calcMeseci("2024-12-31", null, 2025, 12, "naslednji_dan")).toBe(12);
  });
  it("akt. 31.12.2024, leto 2025 | naslednji_mesec → 12 (prviMesec=jan 2025)", () => {
    expect(calcMeseci("2024-12-31", null, 2025, 12, "naslednji_mesec")).toBe(12);
  });

  // ── Prior-year: oba pravili → 12 mesecev ────────────────────────────────
  it("akt. 2023-06-15, leto 2024 | naslednji_dan   → 12 (prviMesecLeto < leto)", () => {
    expect(calcMeseci("2023-06-15", null, 2024, 12, "naslednji_dan")).toBe(12);
  });
  it("akt. 2023-06-15, leto 2024 | naslednji_mesec → 12 (prviMesecLeto < leto)", () => {
    expect(calcMeseci("2023-06-15", null, 2024, 12, "naslednji_mesec")).toBe(12);
  });

  // ── Privzeto (brez 5. parametra) = naslednji_dan ────────────────────────
  it("privzeto (brez parametra) za akt. 30.10 → 3 mesece (= naslednji_dan)", () => {
    expect(calcMeseci("2024-10-30", null, 2024, 12)).toBe(3);
  });
});

describe("calcAmortizacijaObracun z doMeseca", () => {
  // Sredstvo: nabavna=12000, stopnja=10%, letna amort=1200 = 100/mesec
  const sredstvo: SredstvoInput = {
    id: "s1",
    inventarnaSt: "OS-001",
    naziv: "Test sredstvo",
    skupinaId: "g1",
    skupinaNaziv: "Skupina A",
    skupinaKoda: "A",
    racunovodskaStonja: "10",
    davcnaStonja: "10",
    accountId: null, accountCode: null, accountName: null,
    costCenterId: null, costCenterCode: null, costCenterName: null,
    status: "v_uporabi",
    doknjizbe: [{
      id: "d1", seq: 0,
      nabavnaVrednost: "12000",
      odpisanaVrednost: "0",
      neamortizljiviDelPct: "0",
      datumAktivacije: "2023-01-01",
      datumIzpisa: null,
      status: "v_uporabi",
    }],
  };

  it("do 6/2024 < do 9/2024 < do 12/2024 (znesek raste z doMeseca)", () => {
    const r6  = calcAmortizacijaObracun([sredstvo], 2024, 6);
    const r9  = calcAmortizacijaObracun([sredstvo], 2024, 9);
    const r12 = calcAmortizacijaObracun([sredstvo], 2024, 12);
    const v6  = parseFloat(r6.skupajRacunovodska);
    const v9  = parseFloat(r9.skupajRacunovodska);
    const v12 = parseFloat(r12.skupajRacunovodska);
    expect(v6).toBeLessThan(v9);
    expect(v9).toBeLessThan(v12);
    expect(v6).toBeCloseTo(600, 1);
    expect(v9).toBeCloseTo(900, 1);
    expect(v12).toBeCloseTo(1200, 1);
  });

  it("brez doMeseca → ekvivalent doMeseca=12", () => {
    const r1 = calcAmortizacijaObracun([sredstvo], 2024);
    const r2 = calcAmortizacijaObracun([sredstvo], 2024, 12);
    expect(r1.skupajRacunovodska).toBe(r2.skupajRacunovodska);
  });
});

// ─── Negativna NV (korekcijske doknjižbe) ─────────────────────────────────────

describe("calcObracunana — negativna letna amortizacija → 0", () => {
  it("negativna letna → 0.00 (ne negativna vrednost)", () => {
    expect(calcObracunana("-873.10", 12, "11350.33")).toBe("0.00");
  });

  it("negativna letna, delno leto → 0.00", () => {
    expect(calcObracunana("-500.00", 6, "9999.00")).toBe("0.00");
  });

  it("nič letna → 0.00", () => {
    expect(calcObracunana("0.00", 12, "1000.00")).toBe("0.00");
  });

  it("pozitivna letna ostane nespremenjena", () => {
    // 1200 × 6/12 = 600; preostalo 5000 → 600
    expect(calcObracunana("1200.00", 6, "5000.00")).toBe("600.00");
  });
});

describe("calcAmortizacijaObracun — negativna NV doknjižba (korekcija)", () => {
  // Realni primer: 0000184 — seq=0 polno odpisano, seq=1 negativna NV (korekcija)
  const sredstvo0000184: SredstvoInput = {
    id: "s-0000184",
    inventarnaSt: "0000184",
    naziv: "Test korekcija",
    skupinaId: "g1",
    skupinaNaziv: "Skupina",
    skupinaKoda: "A",
    racunovodskaStonja: "20",
    davcnaStonja: "20",
    accountId: null, accountCode: null, accountName: null,
    costCenterId: null, costCenterCode: null, costCenterName: null,
    status: "odpisano",
    doknjizbe: [
      {
        id: "d-seq0", seq: 0,
        nabavnaVrednost: "42650.00",
        odpisanaVrednost: "42650.00",   // preostalo = 0 → polno_odpisano
        neamortizljiviDelPct: "0",
        datumAktivacije: "2007-06-30",
        datumIzpisa: null,
        status: "odpisano",
      },
      {
        id: "d-seq1", seq: 1,
        nabavnaVrednost: "-4365.51",    // NEGATIVNA NV = korekcija
        odpisanaVrednost: "-15715.84",
        neamortizljiviDelPct: "0",
        datumAktivacije: "2010-02-28",
        datumIzpisa: null,
        status: "odpisano",
      },
    ],
  };

  it("0000184: skupna obračunana = 0.00 (seq=0 polno_odpisano, seq=1 negativna_osnova)", () => {
    const r = calcAmortizacijaObracun([sredstvo0000184], 2024, 12);
    expect(r.skupajRacunovodska).toBe("0.00");
  });

  it("0000184: seq=0 opomba = polno_odpisano", () => {
    const r = calcAmortizacijaObracun([sredstvo0000184], 2024, 12);
    expect(r.sredstva[0].doknjizbe[0].opomba).toBe("polno_odpisano");
    expect(r.sredstva[0].doknjizbe[0].obracunanaRacunovodska).toBe("0.00");
  });

  it("0000184: seq=1 opomba = negativna_osnova, obracunano = 0.00 (ne −873.10)", () => {
    const r = calcAmortizacijaObracun([sredstvo0000184], 2024, 12);
    expect(r.sredstva[0].doknjizbe[1].opomba).toBe("negativna_osnova");
    expect(r.sredstva[0].doknjizbe[1].obracunanaRacunovodska).toBe("0.00");
  });

  it("obracunano je vedno >= 0 (nikoli negativno)", () => {
    const r = calcAmortizacijaObracun([sredstvo0000184], 2024, 12);
    for (const s of r.sredstva) {
      for (const d of s.doknjizbe) {
        expect(parseFloat(d.obracunanaRacunovodska)).toBeGreaterThanOrEqual(0);
        expect(parseFloat(d.obracunanaDavcna)).toBeGreaterThanOrEqual(0);
      }
      expect(parseFloat(s.skupnaObracunanaRacunovodska)).toBeGreaterThanOrEqual(0);
    }
  });

  it("0001238-vzorec: samostojna negativna NV doknjižba → 0.00", () => {
    // Samo seq=1 (negativna NV, brez seq=0)
    const sr: SredstvoInput = {
      id: "s-0001238",
      inventarnaSt: "0001238",
      naziv: "Test korekcija 2",
      skupinaId: "g1", skupinaNaziv: "Skupina", skupinaKoda: "A",
      racunovodskaStonja: "20", davcnaStonja: "20",
      accountId: null, accountCode: null, accountName: null,
      costCenterId: null, costCenterCode: null, costCenterName: null,
      status: "odpisano",
      doknjizbe: [{
        id: "d1", seq: 1,
        nabavnaVrednost: "-709.88",   // neg. NV
        odpisanaVrednost: "-851.86",
        neamortizljiviDelPct: "0",
        datumAktivacije: "2010-01-01",
        datumIzpisa: null,
        status: "odpisano",
      }],
    };
    const r = calcAmortizacijaObracun([sr], 2024, 12);
    expect(r.skupajRacunovodska).toBe("0.00");
    expect(r.sredstva[0].doknjizbe[0].opomba).toBe("negativna_osnova");
  });
});

// ─── Endpoint testi ───────────────────────────────────────────────────────────

const MOCK_NASTAVITVE = [{ kontoStroskaId: "ks-1", kontoPopravkaId: "kp-1", osLeto: 2024 }];
const MOCK_ACC_MAP = [
  {
    id: "ks-1", code: "4300", name: "Amort. stroški",
    isActive: true, allowsPosting: true, requiresCostCenter: false,
    requiresPartner: false, requiresProject: false,
  },
  {
    id: "kp-1", code: "0190", name: "Popravek vrednosti",
    isActive: true, allowsPosting: true, requiresCostCenter: false,
    requiresPartner: false, requiresProject: false,
  },
];

describe("POST /os/:companyId/amortizacija/obracun", () => {
  beforeEach(() => {
    dbState.queues = [];
    dbState.idx = 0;
    dbState.inserted = [];
    dbState.updated = [];
  });

  function pushAccessQueues(role = "os_admin") {
    dbState.queues.push([{ module: "osnovna_sredstva" }]); // companyModules
    dbState.queues.push([{ role }]); // osRoles
  }

  function pushObracunQueues(prevObracun: unknown[], glavaResult: unknown[], withAsset = false) {
    dbState.queues.push(prevObracun);    // prevObracun select
    if ((prevObracun[0] as { id?: string } | undefined)?.id) {
      dbState.queues.push([]); // oslabitev preteklega leta
    }
    dbState.queues.push([]);              // novaLetnaRows (oslabitev preteklih let)
    dbState.queues.push(MOCK_NASTAVITVE); // nastavitve
    dbState.queues.push([]);              // skupineRows (loadSredstvaData)
    dbState.queues.push(withAsset ? [{
      id: "s-1", inventarnaSt: "001", naziv: "Test sredstvo", status: "v_uporabi",
      skupinaId: null, costCenterId: null, accountId: null,
      kontoStroskaId: null, kontoPopravkaId: null,
    }] : []);                            // glaveRows
    if (withAsset) dbState.queues.push([]); // doknjizbeRows
    dbState.queues.push(MOCK_ACC_MAP);    // accountMap (loadValidatedAccountMap)
    dbState.queues.push([{ naziv: "Testno podjetje", naslov: null, podjetjeDavcna: "12345678" }]);
    dbState.queues.push(glavaResult);     // UPSERT glava returning
  }

  it("os_viewer → 403", async () => {
    pushAccessQueues("os_viewer");
    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun")
      .set("Authorization", "Bearer test-clerk-uid")
      .send({ leto: 2024, doMeseca: 6 });
    expect(res.status).toBe(403);
  });

  it("manjkajoče leto → 400", async () => {
    pushAccessQueues("os_admin");
    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun")
      .set("Authorization", "Bearer test-clerk-uid")
      .send({ doMeseca: 6 });
    expect(res.status).toBe(400);
  });

  it("manjkajoči doMeseca → 400", async () => {
    pushAccessQueues("os_admin");
    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun")
      .set("Authorization", "Bearer test-clerk-uid")
      .send({ leto: 2024 });
    expect(res.status).toBe(400);
  });

  it("zaklep: prevLeto obstaja in je odprt → 409", async () => {
    pushAccessQueues("os_admin");
    dbState.queues.push([{ id: "prev-obr", status: "odprt", doMeseca: 6 }]); // prevObracun
    dbState.queues.push([{ id: "prev-vrstica" }], [{ id: "s-1" }]);
    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun")
      .set("Authorization", "Bearer test-clerk-uid")
      .send({ leto: 2024, doMeseca: 6 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PREV_YEAR_NOT_CLOSED");
    expect(res.body.error).toContain("2023");
  });

  it.each([
    [[{ id: "prev-vrstica" }], []],
    [[], [{ id: "s-1" }]],
  ])("stara odprta glava ostane zaklenjena, če obstaja vrstica ali sredstvo", async (vrstice, sredstva) => {
    pushAccessQueues();
    dbState.queues.push(
      [{ id: "prev-obr", status: "odprt", doMeseca: 6 }],
      vrstice,
      sredstva,
    );
    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun")
      .set("Authorization", "Bearer test-clerk-uid")
      .send({ leto: 2024, doMeseca: 6 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PREV_YEAR_NOT_CLOSED");
    expect(dbState.inserted).toHaveLength(0);
  });

  it("stara prazna odprta glava ne blokira naslednjega leta brez ponovnega obračuna", async () => {
    pushAccessQueues();
    const accessCount = dbState.queues.length;
    pushObracunQueues(
      [{ id: "prev-empty", status: "odprt", doMeseca: 6 }],
      [{ id: "obr-next" }],
    );
    dbState.queues.splice(accessCount + 1, 0, [], []); // brez vrstic in brez sredstev
    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun")
      .set("Authorization", "Bearer test-clerk-uid")
      .send({ leto: 2024, doMeseca: 6 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("zakljucen");
  });

  it("zaklep: prevLeto ne obstaja → dovoli (baseline)", async () => {
    pushAccessQueues("os_admin");
    pushObracunQueues(
      [],   // prevObracun: ne obstaja
      [{ id: "obr-1", companyId: "company-1", leto: 2024, doMeseca: 6, status: "odprt" }],
    );
    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun")
      .set("Authorization", "Bearer test-clerk-uid")
      .send({ leto: 2024, doMeseca: 6 });
    expect(res.status).toBe(201);
    expect(res.body.leto).toBe(2024);
    expect(res.body.doMeseca).toBe(6);
  });

  it("zaklep: prevLeto obstaja in je zakljucen → dovoli", async () => {
    pushAccessQueues("os_admin");
    pushObracunQueues(
      [{ status: "zakljucen", doMeseca: 12 }], // prevObracun je zakljucen
      [{ id: "obr-2", companyId: "company-1", leto: 2025, doMeseca: 12, status: "zakljucen" }],
    );
    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun")
      .set("Authorization", "Bearer test-clerk-uid")
      .send({ leto: 2025, doMeseca: 12 });
    expect(res.status).toBe(201);
  });

  it("doMeseca=12 → status='zakljucen' v odgovoru", async () => {
    pushAccessQueues("os_admin");
    pushObracunQueues(
      [],
      [{ id: "obr-3", companyId: "company-1", leto: 2024, doMeseca: 12, status: "zakljucen" }],
    );
    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun")
      .set("Authorization", "Bearer test-clerk-uid")
      .send({ leto: 2024, doMeseca: 12 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("zakljucen");
    expect(res.body.doMeseca).toBe(12);
  });

  it.each([1, 6, 9, 12])("obračun s sredstvom do meseca %i loči status obračuna od knjiženja", async (doMeseca) => {
    const status = doMeseca === 12 ? "zakljucen" : "odprt";
    pushAccessQueues("os_admin");
    pushObracunQueues(
      [],
      [{ id: "obr-4", companyId: "company-1", leto: 2024, doMeseca, status }],
      true,
    );
    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun")
      .set("Authorization", "Bearer test-clerk-uid")
      .send({ leto: 2024, doMeseca });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe(status);
    expect(dbState.inserted[0].status).toBe(status);
    expect(dbState.updated[0].status).toBe(status);
    expect(res.body.glkOsnutek).toMatchObject({
      ustvarjen: false, posodobljen: false, temeljnicaId: null,
    });
  });

  it.each([1, 6, 9, 12])("prazen obračun do meseca %i se shrani kot zakljucen tudi pri posodobitvi", async (doMeseca) => {
    pushAccessQueues();
    pushObracunQueues([], [{ id: "obr-empty" }]);
    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun")
      .set("Authorization", "Bearer test-clerk-uid")
      .send({ leto: 2024, doMeseca });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("zakljucen");
    expect(res.body.steviloSredstev).toBe(0);
    expect(res.body.doMeseca).toBe(doMeseca);
    expect(dbState.inserted[0]).toMatchObject({ leto: 2024, doMeseca, status: "zakljucen" });
    expect(dbState.updated[0]).toMatchObject({ doMeseca, status: "zakljucen" });
  });

  it("prazen delni obračun ne blokira obračuna naslednjega leta", async () => {
    const app = await buildApp();
    pushAccessQueues();
    pushObracunQueues([], [{ id: "obr-empty" }]);
    const first = await request(app)
      .post("/os/company-1/amortizacija/obracun")
      .set("Authorization", "Bearer test-clerk-uid")
      .send({ leto: 2024, doMeseca: 6 });

    expect(first.status).toBe(201);
    const savedHeader: Record<string, unknown> = { id: first.body.obracunId, ...dbState.inserted[0] };
    expect(savedHeader.status).toBe("zakljucen");
    // Zavržemo neporabljene rezultate prvega klica; drugi prebere dejansko shranjeni status.
    dbState.queues = [];
    dbState.idx = 0;
    pushAccessQueues();
    pushObracunQueues([savedHeader], [{ id: "obr-next" }]);
    const next = await request(app)
      .post("/os/company-1/amortizacija/obracun")
      .set("Authorization", "Bearer test-clerk-uid")
      .send({ leto: 2025, doMeseca: 6 });

    expect(next.status).toBe(201);
    expect(next.body.leto).toBe(2025);
  });
});
