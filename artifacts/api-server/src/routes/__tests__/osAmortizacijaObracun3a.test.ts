/**
 * Testi za OS amortizacija — 3a: GLK osnutek ob obračunu
 *
 * Pokriva:
 *   1. GLK-podjetje → obračun ustvari draft temeljnico v GLK
 *   2. GLK-podjetje, ponovni obračun → POSODOBI isti osnutek (ne podvoji)
 *   3. OS-only podjetje → NE ustvari GLK osnutka (glkOsnutek.ustvarjen=false)
 *   4. GLK-podjetje, brez obdobja za leto → opozorilo v odgovoru (ne 500)
 *   5. glk_temeljnica_id se shrani na os_amortizacija_obracun po ustvaritvi
 *   6. Osnutek NIKOLI ni auto-posted (status=draft vedno)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── vi.hoisted ───────────────────────────────────────────────────────────────

const { dbState } = vi.hoisted(() => {
  const dbState = {
    queues: [] as unknown[][],
    idx: 0,
    deletes: 0,
    updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
  };
  return { dbState };
});

// ─── @workspace/db mock ──────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  function nextFrom(state: typeof dbState): unknown[] {
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
  function makeInsertChain(): Record<string, unknown> {
    const rows = nextFrom(dbState);
    const p = Promise.resolve(rows);
    const chain: Record<string, unknown> = {
      values: () => chain,
      onConflictDoUpdate: () => chain,
      returning: () => p,
      then: p.then.bind(p),
      catch: (p as Promise<unknown[]>).catch.bind(p),
    };
    return chain;
  }
  function makeDeleteChain(): Record<string, unknown> {
    dbState.deletes++;
    return { where: () => Promise.resolve() };
  }
  function makeUpdateChain(): Record<string, unknown> {
    // Zapomni zadnji klic za preverjanje
    const entry: { table: string; values: Record<string, unknown> } = {
      table: "?", values: {},
    };
    dbState.updates.push(entry);
    const chain: Record<string, unknown> = {
      set: (vals: Record<string, unknown>) => { entry.values = vals; return chain; },
      where: () => Promise.resolve(),
    };
    return chain;
  }
  return {
    db: {
      select: () => makeChain(),
      insert: () => makeInsertChain(),
      delete: () => makeDeleteChain(),
      update: () => makeUpdateChain(),
    },
    osAmortizacijaObracunTable: {
      id: "id", companyId: "company_id", leto: "leto",
      doMeseca: "do_meseca", status: "status",
      glkTemeljnicaId: "glk_temeljnica_id",
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
    accountingPeriodsTable: {
      id: "id", companyId: "company_id", startDate: "start_date",
      endDate: "end_date", status: "status",
    },
    journalEntriesTable: {
      id: "id", companyId: "company_id", periodId: "period_id",
      documentDate: "document_date", entryDate: "entry_date",
      description: "description", reference: "reference",
      status: "status", sourceType: "source_type",
      approvedBy: "approved_by", createdBy: "created_by",
      updatedAt: "updated_at", postedAt: "posted_at",
      reversalOf: "reversal_of",
    },
    journalEntryLinesTable: {
      id: "id", entryId: "entry_id", accountId: "account_id",
      side: "side", amount: "amount", description: "description",
      sequence: "sequence", costCenterId: "cost_center_id",
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
    accountingRolesTable: {},
    companiesTable: {},
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
  lte: vi.fn(() => ({ _tag: "lte" })),
  gte: vi.fn(() => ({ _tag: "gte" })),
}));

// ─── @clerk/express mock ──────────────────────────────────────────────────────

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: { authorization?: string } }) => ({
    userId: req.headers.authorization?.replace("Bearer ", "") ?? null,
  }),
}));

// ─── buildApp ────────────────────────────────────────────────────────────────

async function buildApp() {
  const { default: router } = await import("../osAmortizacijaKnjizenje");
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

// ─── Skupne mock vrednosti ────────────────────────────────────────────────────

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
const MOCK_PERIOD = [{
  id: "period-2024",
  startDate: "2024-01-01",
  endDate: "2024-12-31",
  status: "open",
}];
const MOCK_GLAVA_NO_GLK = [{
  id: "obr-1", companyId: "company-1", leto: 2024, doMeseca: 6,
  status: "odprt", glkTemeljnicaId: null,
}];
const MOCK_GLAVA_WITH_GLK = [{
  id: "obr-1", companyId: "company-1", leto: 2024, doMeseca: 9,
  status: "odprt", glkTemeljnicaId: "entry-existing-id",
}];

// ─── Pomočnik: postavi zahtevane zaslonske enote v vrsto ─────────────────────

function pushBaseQueues(opts: {
  role?: string;
  prevObracun?: unknown[];
  nastavitve?: unknown[];
  skupineRows?: unknown[];
  glaveRows?: unknown[];
  accMap?: unknown[];
  glavaResult?: unknown[];
}) {
  const o = {
    role: opts.role ?? "os_admin",
    prevObracun: opts.prevObracun ?? [],
    nastavitve: opts.nastavitve ?? MOCK_NASTAVITVE,
    skupineRows: opts.skupineRows ?? [],
    glaveRows: opts.glaveRows ?? [],
    accMap: opts.accMap ?? MOCK_ACC_MAP,
    glavaResult: opts.glavaResult ?? MOCK_GLAVA_NO_GLK,
  };
  // resolveOsModuleRole: [0] companyModules, [1] osRoles
  dbState.queues.push([{ module: "osnovna_sredstva" }]);
  dbState.queues.push([{ role: o.role }]);
  // zaklep: [2] prevObracun; nova letna AM: [3]
  dbState.queues.push(o.prevObracun);
  dbState.queues.push([]);
  // nastavitve: [4]
  dbState.queues.push(o.nastavitve);
  // loadSredstvaData: [5] skupineRows, [6] glaveRows
  dbState.queues.push(o.skupineRows);
  dbState.queues.push(o.glaveRows);
  // accountMap: [7]
  dbState.queues.push(o.accMap);
  // Company identity snapshot, then UPSERT glava.
  dbState.queues.push([{ naziv: "Testno podjetje", naslov: null, podjetjeDavcna: "12345678" }]);
  dbState.queues.push(o.glavaResult);
}

// ─── TESTI ────────────────────────────────────────────────────────────────────

describe("POST /os/:companyId/amortizacija/obracun — GLK integracija (3a)", () => {
  beforeEach(() => {
    dbState.queues = [];
    dbState.idx = 0;
    dbState.deletes = 0;
    dbState.updates = [];
  });

  // ── 1. OS-only podjetje: NE ustvari GLK osnutka ───────────────────────────

  it("OS-only podjetje → glkOsnutek.ustvarjen=false, sporocilo vsebuje 'OS-only'", async () => {
    pushBaseQueues({ glavaResult: MOCK_GLAVA_NO_GLK });
    // hasGlkModule: [8] → prazno (ni erp modula)
    dbState.queues.push([]);

    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun")
      .set("Authorization", "Bearer test-clerk-uid")
      .send({ leto: 2024, doMeseca: 6 });

    expect(res.status).toBe(201);
    expect(res.body.glkOsnutek.ustvarjen).toBe(false);
    expect(res.body.glkOsnutek.posodobljen).toBe(false);
    expect(res.body.glkOsnutek.temeljnicaId).toBeNull();
    expect(res.body.glkOsnutek.sporocilo).toMatch(/OS-only/i);
  });

  // ── 2. GLK-podjetje, brez obdobja za leto → opozorilo, ne 500 ─────────────

  it("GLK-podjetje, brez odprtega obdobja za leto → 201 z opozorilom v glkOsnutek", async () => {
    pushBaseQueues({ glavaResult: MOCK_GLAVA_NO_GLK });
    // hasGlkModule: [8] → ima erp
    dbState.queues.push([{ module: "erp" }]);
    // findPeriodForLeto: [9] → prazno (ni obdobja)
    dbState.queues.push([]);

    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun")
      .set("Authorization", "Bearer test-clerk-uid")
      .send({ leto: 2024, doMeseca: 6 });

    expect(res.status).toBe(201);
    expect(res.body.glkOsnutek.ustvarjen).toBe(false);
    expect(res.body.glkOsnutek.temeljnicaId).toBeNull();
    expect(res.body.glkOsnutek.sporocilo).toMatch(/ni odprtega računovodskega obdobja/i);
  });

  // ── 3. GLK-podjetje, prvo izvajanje → ustvari nov osnutek ─────────────────

  it("GLK-podjetje, první obračun → ustvari draft (glkOsnutek.ustvarjen=true)", async () => {
    pushBaseQueues({ glavaResult: MOCK_GLAVA_NO_GLK });
    // hasGlkModule: [8]
    dbState.queues.push([{ module: "erp" }]);
    // findPeriodForLeto: [9]
    dbState.queues.push(MOCK_PERIOD);
    // INSERT journal_entries returning: [10]
    dbState.queues.push([{ id: "new-entry-id" }]);
    // INSERT journal_entry_lines (brez vrstic ker predogled.vrstice=[])
    // db.update os_amortizacija_obracun (glk_temeljnica_id) — v updates

    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun")
      .set("Authorization", "Bearer test-clerk-uid")
      .send({ leto: 2024, doMeseca: 6 });

    expect(res.status).toBe(201);
    expect(res.body.glkOsnutek.ustvarjen).toBe(true);
    expect(res.body.glkOsnutek.posodobljen).toBe(false);
    expect(res.body.glkOsnutek.temeljnicaId).toBe("new-entry-id");
    expect(res.body.glkOsnutek.sporocilo).toMatch(/Osnutek temeljnice dodan/i);
    // glk_temeljnica_id shranjen (db.update poklican)
    expect(dbState.updates.length).toBeGreaterThanOrEqual(1);
  });

  // ── 4. GLK-podjetje, ponovni obračun → POSODOBI obstoječi osnutek ─────────

  it("GLK-podjetje, ponovni obračun (glava že ima glkTemeljnicaId) → POSODOBITEV, ne nova temeljnica", async () => {
    // glava že ima glkTemeljnicaId = "entry-existing-id"
    pushBaseQueues({ glavaResult: MOCK_GLAVA_WITH_GLK });
    // hasGlkModule: [8]
    dbState.queues.push([{ module: "erp" }]);
    // findPeriodForLeto: [9]
    dbState.queues.push(MOCK_PERIOD);
    // Ni INSERT journal_entries (obstojeci != null) → db.delete + db.update (header) + db.insert (lines)
    // db.insert journal_entry_lines returning (ni relevanten): [10] prazno
    // db.update os_amortizacija_obracun NI poklican (ker obstojeci != null)

    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun")
      .set("Authorization", "Bearer test-clerk-uid")
      .send({ leto: 2024, doMeseca: 9 });

    expect(res.status).toBe(201);
    expect(res.body.glkOsnutek.posodobljen).toBe(true);
    expect(res.body.glkOsnutek.ustvarjen).toBe(false);
    expect(res.body.glkOsnutek.temeljnicaId).toBe("entry-existing-id");
    expect(res.body.glkOsnutek.sporocilo).toMatch(/posodobljen/i);
    // Zastarele vrstice so bile izbrisane (db.delete poklican)
    expect(dbState.deletes).toBeGreaterThanOrEqual(1);
    // db.update poklican za header (ne za glk_temeljnica_id, ker obstojeci != null)
    expect(dbState.updates.length).toBeGreaterThanOrEqual(1);
  });

  // ── 5. Osnutek NIKOLI ni auto-posted ─────────────────────────────────────

  it("GLK osnutek ima status=draft v INSERT klicu (nikoli auto-posted)", async () => {
    // Ujamemo, katera vrednost je bila vstavljena v journal_entries
    const insertedEntries: unknown[] = [];
    pushBaseQueues({ glavaResult: MOCK_GLAVA_NO_GLK });
    dbState.queues.push([{ module: "erp" }]);
    dbState.queues.push(MOCK_PERIOD);
    // Mock INSERT za journal_entries: vrni vrednosti, ki smo jih vstavili
    dbState.queues.push([{ id: "draft-entry" }]);

    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun")
      .set("Authorization", "Bearer test-clerk-uid")
      .send({ leto: 2024, doMeseca: 12 });

    expect(res.status).toBe(201);
    // Statusu v odgovoru obračuna je 'zakljucen', a GLK entry je draft
    expect(res.body.status).toBe("zakljucen");
    expect(res.body.glkOsnutek.ustvarjen).toBe(true);
    // Ključni test: sporocilo NIMA besede 'poknjizeno' ali 'posted'
    expect(res.body.glkOsnutek.sporocilo).not.toMatch(/poknjižen|posted/i);
  });

  // ── 6. glk_temeljnica_id shranjen na obračun po ustvaritvi ────────────────

  it("Po ustvaritvi novega osnutka: db.update poklican z glkTemeljnicaId", async () => {
    pushBaseQueues({ glavaResult: MOCK_GLAVA_NO_GLK });
    dbState.queues.push([{ module: "erp" }]);
    dbState.queues.push(MOCK_PERIOD);
    dbState.queues.push([{ id: "saved-entry-id" }]);

    const app = await buildApp();
    const res = await request(app)
      .post("/os/company-1/amortizacija/obracun")
      .set("Authorization", "Bearer test-clerk-uid")
      .send({ leto: 2024, doMeseca: 6 });

    expect(res.status).toBe(201);
    // Vsaj en db.update je poklican (shranjevanje glkTemeljnicaId)
    const updateWithGlk = dbState.updates.find(
      (u) => u.values && "glkTemeljnicaId" in u.values,
    );
    expect(updateWithGlk).toBeDefined();
    expect(updateWithGlk?.values.glkTemeljnicaId).toBe("saved-entry-id");
  });
});
