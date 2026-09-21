/**
 * osAmortizacijaPregled.test.ts — Testi za GET /os/:companyId/amortizacija (zastarelost)
 *
 * Pokriva (Faza 3d — usklajenost izpis ↔ pregled):
 *   1. Ni shranjenega obračuna → predogled=true, zastarel=false
 *   2. Obračun brez podpisa (NULL, stari zapis) → zastarel=false, brez primerjave
 *   3. Obračun z ujemajočim pravilom + podpisom → zastarel=false
 *   4. Pravilo se je spremenilo po obračunu → zastarel=true, razlog vsebuje pravilo
 *   5. Podatki sredstev so se spremenili (različen hash) → zastarel=true, razlog vsebuje "Podatki"
 *   6. Dostop brez OS vloge → 403
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── vi.hoisted ───────────────────────────────────────────────────────────────

const { dbState } = vi.hoisted(() => {
  const dbState = { queues: [] as unknown[][], idx: 0 };
  return { dbState };
});

// ─── @workspace/db mock ───────────────────────────────────────────────────────

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
      limit: () => p,
      orderBy: () => p,
      then: p.then.bind(p),
      catch: (p as Promise<unknown[]>).catch.bind(p),
    };
    return chain;
  }
  return {
    db: { select: () => makeChain() },
    osAmortizacijskeSkupineTable: {
      id: "id", companyId: "company_id", koda: "koda", naziv: "naziv",
      racunovodskaStonja: "racunovodska_stonja", davcnaStonja: "davcna_stonja",
    },
    osnovnaSredstvaTable: {
      id: "id", companyId: "company_id", inventarnaSt: "inventarna_st",
      naziv: "naziv", skupinaId: "skupina_id", costCenterId: "cost_center_id",
      accountId: "account_id", status: "status",
    },
    osDoknjizbeTable: {
      id: "id", sredstvoId: "sredstvo_id", seq: "seq",
      nabavnaVrednost: "nabavna_vrednost", odpisanaVrednost: "odpisana_vrednost",
      neamortizljiviDelPct: "neamortizljivi_del_pct",
      datumAktivacije: "datum_aktivacije", datumIzpisa: "datum_izpisa", status: "status",
    },
    osRolesTable: { clerkUserId: "clerk_user_id", companyId: "company_id", role: "role" },
    companyModulesTable: { companyId: "company_id", module: "module" },
    accountsTable: { id: "id", code: "code", name: "name" },
    costCentersTable: { id: "id", code: "code", name: "name" },
    osAmortizacijaObracunTable: {
      id: "id", companyId: "company_id", leto: "leto",
      doMeseca: "do_meseca", status: "status",
      praviloZacetkaAmortizacije: "pravilo_zacetka_amortizacije",
      vhodniPodpis: "vhodni_podpis",
    },
    osAmortizacijaObracunSredstvoTable: {
      id: "id", obracunId: "obracun_id", sredstvoId: "sredstvo_id",
      obracunano: "obracunano",
    },
    osAmortizacijaNastavitveTable: {
      companyId: "company_id",
      praviloZacetkaAmortizacije: "pravilo_zacetka_amortizacije",
    },
  };
});

// ─── drizzle-orm mock ─────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({ _tag: "eq" })),
  and: vi.fn((...args: unknown[]) => ({ _tag: "and", args })),
  inArray: vi.fn(() => ({ _tag: "inArray" })),
  asc: vi.fn((a: unknown) => a),
}));

// ─── @clerk/express mock ──────────────────────────────────────────────────────

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: { authorization?: string } }) => ({
    userId: req.headers.authorization?.replace("Bearer ", "") ?? null,
  }),
}));

// ─── buildApp ────────────────────────────────────────────────────────────────

async function buildApp() {
  const { default: router } = await import("../osAmortizacija");
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

// ─── computeVhodniPodpis za test izračun pričakovanega hash ──────────────────

import { computeVhodniPodpis } from "../osAmortizacijaEngine";

// ─── Pomožniki ────────────────────────────────────────────────────────────────

/** Doda OS dostopne queue (companyModules + osRoles). */
function pushAccessQueues(role = "os_admin") {
  dbState.queues.push([{ module: "osnovna_sredstva" }]);
  dbState.queues.push([{ role }]);
}

/**
 * Doda standardne queue za GET /amortizacija z praznim registrom (brez sredstev).
 * Vrstni red: skupineRows, glaveRows, savedObracun, nastavitveRow, (savedVrstice?).
 */
function pushPregledQueues(opts: {
  savedObracun?: unknown[];
  praviloNastavitve?: string;
  savedVrstice?: unknown[];
}) {
  const savedObracun = opts.savedObracun ?? [];
  const praviloNastavitve = opts.praviloNastavitve ?? "naslednji_dan";
  dbState.queues.push([]); // skupineRows
  dbState.queues.push([]); // glaveRows (prazno → brez doknjižb)
  // Promise.all: savedObracun + nastavitveRow (oba db.select() klicana sinhrono → zaporedni sloti)
  dbState.queues.push(savedObracun);
  dbState.queues.push([{ praviloZacetkaAmortizacije: praviloNastavitve }]);
  if (savedObracun.length > 0) {
    dbState.queues.push(opts.savedVrstice ?? []); // savedVrstice
  }
}

// Konstanten hash za prazne doknjižbe + naslednji_dan (za ujemajoči test)
const HASH_NASLEDNJI_DAN_EMPTY = computeVhodniPodpis("naslednji_dan", []);
const HASH_NASLEDNJI_MESEC_EMPTY = computeVhodniPodpis("naslednji_mesec", []);

// ─── TESTI ────────────────────────────────────────────────────────────────────

describe("GET /os/:companyId/amortizacija — zastarelost in pregled/shranjeno", () => {
  beforeEach(() => {
    dbState.queues = [];
    dbState.idx = 0;
  });

  // ── 1. Ni shranjenega obračuna → predogled, zastarel=false ────────────────

  it("brez shranjenega obračuna → predogled=true, zastarel=false", async () => {
    pushAccessQueues();
    pushPregledQueues({ savedObracun: [] });

    const app = await buildApp();
    const res = await request(app)
      .get("/os/company-1/amortizacija?leto=2024")
      .set("Authorization", "Bearer test-uid");

    expect(res.status).toBe(200);
    expect(res.body.predogled).toBe(true);
    expect(res.body.zastarel).toBe(false);
    expect(res.body.zastarelRazlog).toBeNull();
    expect(res.body.doMeseca).toBeNull();
  });

  // ── 2. Obračun brez podpisa (stari zapis, pravilo=NULL) → zastarel=false ──

  it("obračun z pravilo=NULL (stari zapis pred migracijo) → zastarel=false", async () => {
    pushAccessQueues();
    pushPregledQueues({
      savedObracun: [{
        id: "obr-1", doMeseca: 12,
        praviloZacetkaAmortizacije: null,
        vhodniPodpis: null,
      }],
      praviloNastavitve: "naslednji_dan",
    });

    const app = await buildApp();
    const res = await request(app)
      .get("/os/company-1/amortizacija?leto=2024")
      .set("Authorization", "Bearer test-uid");

    expect(res.status).toBe(200);
    expect(res.body.predogled).toBe(false);
    expect(res.body.zastarel).toBe(false);
    expect(res.body.zastarelRazlog).toBeNull();
  });

  // ── 3. Ujemajoč hash + pravilo → zastarel=false ───────────────────────────

  it("shranjeni obračun s ujemajočim pravilom in hash → zastarel=false", async () => {
    pushAccessQueues();
    pushPregledQueues({
      savedObracun: [{
        id: "obr-1", doMeseca: 12,
        praviloZacetkaAmortizacije: "naslednji_dan",
        vhodniPodpis: HASH_NASLEDNJI_DAN_EMPTY, // doknjizbe=[] → isti hash
      }],
      praviloNastavitve: "naslednji_dan",
    });

    const app = await buildApp();
    const res = await request(app)
      .get("/os/company-1/amortizacija?leto=2024")
      .set("Authorization", "Bearer test-uid");

    expect(res.status).toBe(200);
    expect(res.body.predogled).toBe(false);
    expect(res.body.zastarel).toBe(false);
    expect(res.body.zastarelRazlog).toBeNull();
  });

  // ── 4. Pravilo se je spremenilo → zastarel=true ───────────────────────────

  it("pravilo se je spremenilo iz naslednji_dan v naslednji_mesec → zastarel=true", async () => {
    pushAccessQueues();
    pushPregledQueues({
      savedObracun: [{
        id: "obr-1", doMeseca: 12,
        praviloZacetkaAmortizacije: "naslednji_dan", // shranjeno
        vhodniPodpis: HASH_NASLEDNJI_MESEC_EMPTY,     // tak ali tak zastarel po pravilu
      }],
      praviloNastavitve: "naslednji_mesec", // aktualno
    });

    const app = await buildApp();
    const res = await request(app)
      .get("/os/company-1/amortizacija?leto=2024")
      .set("Authorization", "Bearer test-uid");

    expect(res.status).toBe(200);
    expect(res.body.zastarel).toBe(true);
    expect(res.body.zastarelRazlog).toContain("naslednji_dan");
    expect(res.body.zastarelRazlog).toContain("naslednji_mesec");
  });

  // ── 5. Vhodni podpis se razlikuje (podatki sprememba) → zastarel=true ────

  it("shranjeni hash se ne ujema z aktualnim (podatki posodobljeni) → zastarel=true", async () => {
    pushAccessQueues();
    pushPregledQueues({
      savedObracun: [{
        id: "obr-1", doMeseca: 12,
        praviloZacetkaAmortizacije: "naslednji_dan",
        vhodniPodpis: "napacen-hash-00000000", // drugačen od aktualnega (prazne doknjizbe)
      }],
      praviloNastavitve: "naslednji_dan", // pravilo ujema → samo hash razlika
    });

    const app = await buildApp();
    const res = await request(app)
      .get("/os/company-1/amortizacija?leto=2024")
      .set("Authorization", "Bearer test-uid");

    expect(res.status).toBe(200);
    expect(res.body.zastarel).toBe(true);
    expect(res.body.zastarelRazlog).toMatch(/Podatki/i);
    // Razlog ne sme omeniti spremembe pravila (samo hash razlika)
    expect(res.body.zastarelRazlog).not.toMatch(/pravilo.*spremenilo/i);
  });

  // ── 6. Oba razloga → zastarel=true, razlog vsebuje oba ───────────────────

  it("pravilo in podatki hkrati drugačni → zastarel=true, razlog vsebuje oba razloga", async () => {
    pushAccessQueues();
    pushPregledQueues({
      savedObracun: [{
        id: "obr-1", doMeseca: 6,
        praviloZacetkaAmortizacije: "naslednji_dan",  // shranjeno
        vhodniPodpis: "star-hash-napacen",            // drugačen hash
      }],
      praviloNastavitve: "naslednji_mesec",            // pravilo se je spremenilo
    });

    const app = await buildApp();
    const res = await request(app)
      .get("/os/company-1/amortizacija?leto=2024")
      .set("Authorization", "Bearer test-uid");

    expect(res.status).toBe(200);
    expect(res.body.zastarel).toBe(true);
    expect(res.body.zastarelRazlog).toContain("naslednji_dan");
    expect(res.body.zastarelRazlog).toMatch(/Podatki/i);
  });

  // ── 7. Shranjeni zneski iz os_amortizacija_obracun_sredstvo (skupaj = shranjeno) ─

  it("shranjeni obračun brez zastarelosti → skupajRacunovodska=0 (prazno registro)", async () => {
    pushAccessQueues();
    pushPregledQueues({
      savedObracun: [{
        id: "obr-1", doMeseca: 12,
        praviloZacetkaAmortizacije: "naslednji_dan",
        vhodniPodpis: HASH_NASLEDNJI_DAN_EMPTY,
      }],
      praviloNastavitve: "naslednji_dan",
      savedVrstice: [], // prazno (ni sredstev v testnem registru)
    });

    const app = await buildApp();
    const res = await request(app)
      .get("/os/company-1/amortizacija?leto=2024")
      .set("Authorization", "Bearer test-uid");

    expect(res.status).toBe(200);
    expect(res.body.predogled).toBe(false);
    expect(res.body.zastarel).toBe(false);
    // Brez sredstev: skupaj = 0
    expect(parseFloat(res.body.skupajRacunovodska)).toBeCloseTo(0, 2);
  });

  // ── 8. Brez OS vloge → 403 ───────────────────────────────────────────────

  it("brez OS vloge → 403", async () => {
    dbState.queues.push([{ module: "osnovna_sredstva" }]); // modul obstaja
    dbState.queues.push([]); // brez vloge → 403

    const app = await buildApp();
    const res = await request(app)
      .get("/os/company-1/amortizacija?leto=2024")
      .set("Authorization", "Bearer test-uid");

    expect(res.status).toBe(403);
  });
});
