/**
 * osAmortizacijaStorno.test.ts — Testi za POST /os/:companyId/amortizacija/obracun/storno
 *
 * Scenariji (Korak 3b — stornacija, popravljena smer):
 *   Logika: storno dovoljen samo za ZADNJE (NAJVIŠJE) leto.
 *   Varovalo: ekspliciten gt check (ali obstaja obračun z letom > zahtevanega).
 *
 *   1. Stornacija 2025 ob 2024+2025 → DOVOLJENA (ni višjega) → 200
 *   2. Stornacija 2024 ob 2024+2025 → ZAVRNJENA 409 (obstaja 2025) → sporočilo navaja 2025
 *   3. Samo 2024 obstaja → stornacija 2024 DOVOLJENA (ni višjega) → 200
 *   4. Ni nobenega obračuna (visji=[], konkreten=[]) → 404
 *   5. GLK-podjetje z DRAFT osnutkom → 200, glkOsnutekObrisan=true
 *   6. GLK-podjetje s POSTED osnutkom → 409 GLK_POSTED
 *   7. OS-only podjetje (brez GLK) → 200, glkOsnutekObrisan=false
 *   8. Dostop brez os_admin vloge → 403
 *   9. Neveljavno leto → 400
 *  10. Race condition: temeljnica izginila → 200, glkOsnutekObrisan=false
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
  function nextFrom(): unknown[] {
    const r = dbState.queues[dbState.idx++];
    return r ?? [];
  }

  function makeSelectChain(): Record<string, unknown> {
    const rows = nextFrom();
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

  function makeDeleteChain(): Record<string, unknown> {
    const p = Promise.resolve({ rowCount: 1 });
    const chain: Record<string, unknown> = {
      where: () => p,
      then: p.then.bind(p),
      catch: (p as Promise<unknown>).catch.bind(p),
    };
    return chain;
  }

  return {
    db: {
      select: () => makeSelectChain(),
      delete: () => makeDeleteChain(),
    },
    osAmortizacijaObracunTable: {
      id: "id", companyId: "company_id", leto: "leto",
      glkTemeljnicaId: "glk_temeljnica_id", status: "status",
    },
    osAmortizacijaObracunSredstvoTable: { id: "id", obracunId: "obracun_id" },
    osRolesTable: { clerkUserId: "clerk_user_id", companyId: "company_id", role: "role" },
    companyModulesTable: { companyId: "company_id", module: "module" },
    journalEntriesTable: { id: "id", companyId: "company_id", status: "status" },
    journalEntryLinesTable: { id: "id", entryId: "entry_id" },
    // Nerabljeni v tej ruti, ampak importirani na ravni modula
    osAmortizacijskeSkupineTable: { id: "id", companyId: "company_id" },
    osnovnaSredstvaTable: { id: "id", companyId: "company_id" },
    osDoknjizbeTable: { id: "id" },
    osAmortizacijaNastavitveTable: {
      companyId: "company_id", kontoStroskaId: "konto_stroska_id",
      kontoPopravkaId: "konto_popravka_id", praviloZacetkaAmortizacije: "pravilo_zacetka_amortizacije",
    },
    companiesTable: { id: "id" },
    accountsTable: { id: "id" },
    accountingPeriodsTable: { id: "id" },
    costCentersTable: { id: "id" },
  };
});

// ─── drizzle-orm mock ─────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq:      vi.fn(() => ({ _tag: "eq" })),
  and:     vi.fn((...args: unknown[]) => ({ _tag: "and", args })),
  or:      vi.fn((...args: unknown[]) => ({ _tag: "or", args })),
  gt:      vi.fn(() => ({ _tag: "gt" })),
  inArray: vi.fn(() => ({ _tag: "inArray" })),
  like:    vi.fn(() => ({ _tag: "like" })),
  sql:     vi.fn(() => ({ _tag: "sql" })),
  lte:     vi.fn(() => ({ _tag: "lte" })),
  gte:     vi.fn(() => ({ _tag: "gte" })),
  desc:    vi.fn((col: unknown) => ({ _tag: "desc", col })),
  asc:     vi.fn((col: unknown) => col),
}));

// ─── @clerk/express mock ──────────────────────────────────────────────────────

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: { authorization?: string } }) => ({
    userId: req.headers.authorization?.replace("Bearer ", "") ?? null,
  }),
}));

// ─── buildApp ─────────────────────────────────────────────────────────────────

async function buildApp() {
  const { default: router } = await import("../osAmortizacijaKnjizenje");
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

// ─── Pomožniki ────────────────────────────────────────────────────────────────

/** Access check: companyModules (OS modul) + osRoles */
function pushAccess(role = "os_admin") {
  dbState.queues.push([{ module: "osnovna_sredstva" }]);
  dbState.queues.push([{ role }]);
}

function pushAccessNoRole() {
  dbState.queues.push([{ module: "osnovna_sredstva" }]);
  dbState.queues.push([]); // brez vloge → 403
}

/**
 * Nova logika: 2 select-a za varovalo in iskanje.
 *
 * @param visjiObracun  Rezultat gt-poizvedbe (ali obstaja višje leto). [] = ni višjega → dovoli.
 * @param konkreten     Rezultat iskanja konkretnega leta. Ignored kadar visji je neprazen.
 */
function pushStornoQueues(
  visjiObracun: unknown[],
  konkreten: unknown[],
) {
  dbState.queues.push(visjiObracun); // gt check (leto > zahtevano)
  if (visjiObracun.length === 0) {
    dbState.queues.push(konkreten); // specifični obračun za zahtevano leto
  }
}

function pushGlkStatus(status: "draft" | "posted" | null) {
  dbState.queues.push(status === null ? [] : [{ status }]);
}

// ─── TESTI ────────────────────────────────────────────────────────────────────

describe("POST /os/:companyId/amortizacija/obracun/storno — pravilna smer (zadnje leto najprej)", () => {
  beforeEach(() => {
    dbState.queues = [];
    dbState.idx = 0;
  });

  // ── 1. Stornacija 2025 ob 2024+2025 → DOVOLJENA ───────────────────────────

  it("stornacija 2025 (ob obstoju 2024+2025) → 200, dovoljena", async () => {
    pushAccess();
    // gt check: ali obstaja leto > 2025? → ne (prazno)
    // konkreten: obračun za 2025 → najdeno
    pushStornoQueues([], [{ id: "obr-2025", glkTemeljnicaId: null }]);

    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun/storno")
      .set("Authorization", "Bearer test-uid")
      .send({ leto: 2025 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.storniranLeto).toBe(2025);
    expect(res.body.glkOsnutekObrisan).toBe(false);
  });

  // ── 2. Stornacija 2024 ob 2024+2025 → ZAVRNJENA 409 ─────────────────────

  it("stornacija 2024 (ob obstoju 2025) → 409 NOT_LAST_OBRACUN, sporočilo navaja 2025", async () => {
    pushAccess();
    // gt check: ali obstaja leto > 2024? → DA (2025 obstaja)
    // konkreten: ne bo klican (takoj 409)
    pushStornoQueues([{ leto: 2025 }], []);

    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun/storno")
      .set("Authorization", "Bearer test-uid")
      .send({ leto: 2024 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_LAST_OBRACUN");
    expect(res.body.zadnjeLeto).toBe(2025);
    expect(res.body.zahtevanoLeto).toBe(2024);
    // Sporočilo mora navesti 2025 kot tisto, ki ga je treba stornirati NAJPREJ
    expect(res.body.error).toMatch(/2025/);
    expect(res.body.error).toMatch(/2024/);
    expect(res.body.error).not.toMatch(/Najprej stornirajte.*2024.*stornirate.*2025/); // obrnjeno bi bilo napačno
  });

  // ── 3. Samo 2024 obstaja → stornacija 2024 DOVOLJENA ─────────────────────

  it("samo 2024 obstaja → stornacija 2024 dovoljena (ni višjega)", async () => {
    pushAccess();
    // gt check: ali obstaja leto > 2024? → ne
    // konkreten: obračun za 2024 → najdeno
    pushStornoQueues([], [{ id: "obr-2024", glkTemeljnicaId: null }]);

    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun/storno")
      .set("Authorization", "Bearer test-uid")
      .send({ leto: 2024 });

    expect(res.status).toBe(200);
    expect(res.body.storniranLeto).toBe(2024);
  });

  // ── 4. Ni nobenega obračuna → 404 ────────────────────────────────────────

  it("ni obračuna za zahtevano leto → 404", async () => {
    pushAccess();
    // gt check: nič višjega
    // konkreten: tudi ne najdeno
    pushStornoQueues([], []);

    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun/storno")
      .set("Authorization", "Bearer test-uid")
      .send({ leto: 2024 });

    expect(res.status).toBe(404);
  });

  // ── 5. GLK-podjetje, draft osnutek → 200, glkOsnutekObrisan=true ─────────

  it("GLK draft osnutek → 200, glkOsnutekObrisan=true", async () => {
    pushAccess();
    pushStornoQueues([], [{ id: "obr-2025", glkTemeljnicaId: "glk-789" }]);
    pushGlkStatus("draft");

    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun/storno")
      .set("Authorization", "Bearer test-uid")
      .send({ leto: 2025 });

    expect(res.status).toBe(200);
    expect(res.body.glkOsnutekObrisan).toBe(true);
  });

  // ── 6. GLK-podjetje, posted osnutek → 409 GLK_POSTED ────────────────────

  it("GLK posted osnutek → 409 GLK_POSTED (fiksirano)", async () => {
    pushAccess();
    pushStornoQueues([], [{ id: "obr-2025", glkTemeljnicaId: "glk-789" }]);
    pushGlkStatus("posted");

    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun/storno")
      .set("Authorization", "Bearer test-uid")
      .send({ leto: 2025 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("GLK_POSTED");
  });

  // ── 7. OS-only (brez GLK) → 200, glkOsnutekObrisan=false ────────────────

  it("OS-only podjetje (brez GLK temeljnice) → 200, glkOsnutekObrisan=false", async () => {
    pushAccess();
    pushStornoQueues([], [{ id: "obr-2024", glkTemeljnicaId: null }]);

    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun/storno")
      .set("Authorization", "Bearer test-uid")
      .send({ leto: 2024 });

    expect(res.status).toBe(200);
    expect(res.body.glkOsnutekObrisan).toBe(false);
  });

  // ── 8. Brez os_admin → 403 ───────────────────────────────────────────────

  it("brez os_admin vloge → 403", async () => {
    pushAccessNoRole();

    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun/storno")
      .set("Authorization", "Bearer test-uid")
      .send({ leto: 2024 });

    expect(res.status).toBe(403);
  });

  // ── 9. Neveljavno leto → 400 ─────────────────────────────────────────────

  it("neveljavno leto (string) → 400", async () => {
    pushAccess();

    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun/storno")
      .set("Authorization", "Bearer test-uid")
      .send({ leto: "ni-stevilka" });

    expect(res.status).toBe(400);
  });

  // ── 10. Race condition: temeljnica izginila → 200, glkOsnutekObrisan=false

  it("GLK temeljnica ne obstaja v DB (race) → 200, glkOsnutekObrisan=false", async () => {
    pushAccess();
    pushStornoQueues([], [{ id: "obr-2025", glkTemeljnicaId: "glk-izginila" }]);
    pushGlkStatus(null); // temeljnica v DB ne obstaja

    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun/storno")
      .set("Authorization", "Bearer test-uid")
      .send({ leto: 2025 });

    expect(res.status).toBe(200);
    expect(res.body.glkOsnutekObrisan).toBe(false);
  });

  // ── 11. Smer sporočila: zavrnjeno leto < zadnje → sporočilo pravilno ──────

  it("sporočilo ob zavrnitvi navede ZADNJE leto (višje), ne zahtevano", async () => {
    pushAccess();
    // Obstajata 2023 in 2026, storniramo 2023 → zavrnjeno, sporočilo: storniraj 2026 najprej
    pushStornoQueues([{ leto: 2026 }], []);

    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun/storno")
      .set("Authorization", "Bearer test-uid")
      .send({ leto: 2023 });

    expect(res.status).toBe(409);
    // Sporočilo mora reči: "Najprej stornirajte 2026 ... nato 2023"
    expect(res.body.error).toMatch(/2026/);
    expect(res.body.zadnjeLeto).toBe(2026);
    expect(res.body.zahtevanoLeto).toBe(2023);
  });
});
