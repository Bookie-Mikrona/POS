/**
 * Testi za GET/PATCH /os/:companyId/amortizacija/nastavitve
 *
 * Preverja:
 * - GET vrne osLeto (null, kadar ni nastavljen)
 * - PATCH shrani osLeto (integer) in ga GET vrne
 * - PATCH z null počisti osLeto
 * - PATCH zavrne neveljavno leto (niz, 0, 1000, 9999)
 * - OS-only vloga (os_admin) brez ERP accounting_roles dobi dostop (ne 403)
 * - os_viewer ne sme urejati nastavitev (403)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── vi.hoisted ───────────────────────────────────────────────────────────────

const { dbState } = vi.hoisted(() => {
  const dbState = { queues: [] as unknown[][], idx: 0 };
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
      from: () => chain, where: () => chain, innerJoin: () => chain,
      leftJoin: () => chain, orderBy: () => chain, limit: () => p,
      then: p.then.bind(p), catch: (p as Promise<unknown[]>).catch.bind(p),
    };
    return chain;
  }

  const upsertChain = {
    set: () => upsertChain, where: () => upsertChain, values: () => Promise.resolve([]),
  };
  const insertChain = { values: () => Promise.resolve([]) };

  return {
    db: {
      select: () => makeChain(),
      update: () => upsertChain,
      insert: () => insertChain,
    },
    osAmortizacijaNastavitveTable: {
      companyId: "company_id", kontoStroskaId: "konto_stroska_id",
      kontoPopravkaId: "konto_popravka_id", osLeto: "os_leto", id: "id",
    },
    osAmortizacijaObracunTable: { companyId: "company_id", leto: "leto" },
    accountsTable: { id: "id", companyId: "company_id", code: "code", name: "name", isActive: "is_active", allowsPosting: "allows_posting" },
    accountingPeriodsTable: {},
    companyModulesTable: { companyId: "company_id", moduleName: "module_name" },
    osRolesTable: { companyId: "company_id", clerkUserId: "clerk_user_id", role: "role" },
    accountingRolesTable: {},
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_a: unknown, _b: unknown) => ({ _tag: "eq" })),
  and: vi.fn((...args: unknown[]) => ({ _tag: "and", args })),
  asc: vi.fn((a: unknown) => a),
  desc: vi.fn((a: unknown) => a),
  lt: vi.fn((_a: unknown, _b: unknown) => ({ _tag: "lt" })),
  inArray: vi.fn((_a: unknown, _b: unknown) => ({ _tag: "inArray" })),
}));

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: { authorization?: string } }) => ({
    userId: req.headers.authorization?.replace("Bearer ", "") ?? null,
  }),
}));

// ─── App builder ─────────────────────────────────────────────────────────────

async function buildApp() {
  const { default: router } = await import("../osAmortizacijaKnjizenje");
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

// ─── Pomožni builders ─────────────────────────────────────────────────────────

const CID = "aaaaaaaa-0000-0000-0000-000000000001";
const MOD_OK = [{ moduleName: "osnovna_sredstva" }];
const ROLE_ADMIN = [{ role: "os_admin" }];
const ROLE_VIEWER = [{ role: "os_viewer" }];
const ACC_STROSKA = { id: "acc-str", code: "4320000", name: "AM.OPREME" };
const ACC_POP     = { id: "acc-pop", code: "0500000", name: "POP.VR.OPR" };

// Nastavitve vrstica brez osLeto
const ROW_NO_LETO = { kontoStroskaId: "acc-str", kontoPopravkaId: "acc-pop", osLeto: null };
// Nastavitve vrstica z osLeto=2024
const ROW_WITH_LETO = { kontoStroskaId: "acc-str", kontoPopravkaId: "acc-pop", osLeto: 2024 };

// ─── Testi ────────────────────────────────────────────────────────────────────

describe("GET /os/:companyId/amortizacija/nastavitve — osLeto", () => {
  let app: express.Application;
  beforeEach(async () => {
    dbState.idx = 0;
    app = await buildApp();
  });

  it("vrne osLeto: null, ko ni nastavljeno", async () => {
    dbState.queues = [
      MOD_OK,                  // resolveOsModuleRole #1
      ROLE_ADMIN,              // resolveOsModuleRole #2
      [ROW_NO_LETO],           // select nastavitve
      [],                      // zadnjiObracunLeto → ni obračuna
      [ACC_STROSKA, ACC_POP],  // loadAccountDisplayInfo
    ];

    const res = await request(app)
      .get(`/os/${CID}/amortizacija/nastavitve`)
      .set("Authorization", "Bearer user_test");

    expect(res.status).toBe(200);
    expect(res.body.osLeto).toBeNull();
    expect(res.body.zadnjiObracunLeto).toBeNull();
  });

  it("vrne osLeto: 2024, ko je nastavljeno", async () => {
    dbState.queues = [
      MOD_OK, ROLE_ADMIN,
      [ROW_WITH_LETO],
      [{ leto: 2024 }],        // zadnjiObracunLeto → 2024
      [ACC_STROSKA, ACC_POP],
    ];

    const res = await request(app)
      .get(`/os/${CID}/amortizacija/nastavitve`)
      .set("Authorization", "Bearer user_test");

    expect(res.status).toBe(200);
    expect(res.body.osLeto).toBe(2024);
    expect(res.body.zadnjiObracunLeto).toBe(2024);
  });

  it("os_viewer (brez ERP vloge) dobi 200 — OS-only dostop", async () => {
    dbState.queues = [
      MOD_OK, ROLE_VIEWER,
      [ROW_NO_LETO],
      [],                      // zadnjiObracunLeto → ni obračuna
      [ACC_STROSKA, ACC_POP],
    ];

    const res = await request(app)
      .get(`/os/${CID}/amortizacija/nastavitve`)
      .set("Authorization", "Bearer user_test");

    // GET nastavitve je dostopen vsem OS vlogam (ne zahteva ERP)
    expect(res.status).toBe(200);
  });
});

describe("PATCH /os/:companyId/amortizacija/nastavitve — osLeto", () => {
  let app: express.Application;
  beforeEach(async () => {
    dbState.idx = 0;
    app = await buildApp();
  });

  // Skupni mock za uspešni PATCH (existing row → update)
  function patchQueues(returnedLeto: number | null) {
    return [
      MOD_OK, ROLE_ADMIN,        // resolveOsModuleRole
      // kode→ID lookup (kontoStroskaKoda + kontoPopravkaKoda)
      [ACC_STROSKA, ACC_POP],
      // idsToValidate (allowsPosting check)
      [ACC_STROSKA, ACC_POP],
      // existing check
      [{ id: "existing-id" }],
      // re-select po update
      [{ kontoStroskaId: "acc-str", kontoPopravkaId: "acc-pop", osLeto: returnedLeto }],
      // loadAccountDisplayInfo
      [ACC_STROSKA, ACC_POP],
    ];
  }

  it("shrani osLeto=2024 in ga vrne v odgovoru", async () => {
    dbState.queues = patchQueues(2024);

    const res = await request(app)
      .patch(`/os/${CID}/amortizacija/nastavitve`)
      .set("Authorization", "Bearer user_test")
      .send({ kontoStroskaKoda: "4320000", kontoPopravkaKoda: "0500000", osLeto: 2024 });

    expect(res.status).toBe(200);
    expect(res.body.osLeto).toBe(2024);
  });

  it("shrani osLeto=null (počisti) in ga vrne kot null", async () => {
    dbState.queues = patchQueues(null);

    const res = await request(app)
      .patch(`/os/${CID}/amortizacija/nastavitve`)
      .set("Authorization", "Bearer user_test")
      .send({ kontoStroskaKoda: "4320000", kontoPopravkaKoda: "0500000", osLeto: null });

    expect(res.status).toBe(200);
    expect(res.body.osLeto).toBeNull();
  });

  it("zavrne osLeto=1000 (preleto) z 400", async () => {
    dbState.queues = [MOD_OK, ROLE_ADMIN];

    const res = await request(app)
      .patch(`/os/${CID}/amortizacija/nastavitve`)
      .set("Authorization", "Bearer user_test")
      .send({ osLeto: 1000 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/os leto/i);
  });

  it("zavrne osLeto=9999 (previsoko) z 400", async () => {
    dbState.queues = [MOD_OK, ROLE_ADMIN];

    const res = await request(app)
      .patch(`/os/${CID}/amortizacija/nastavitve`)
      .set("Authorization", "Bearer user_test")
      .send({ osLeto: 9999 });

    expect(res.status).toBe(400);
  });

  it("zavrne osLeto='abc' (niz) z 400", async () => {
    dbState.queues = [MOD_OK, ROLE_ADMIN];

    const res = await request(app)
      .patch(`/os/${CID}/amortizacija/nastavitve`)
      .set("Authorization", "Bearer user_test")
      .send({ osLeto: "abc" });

    expect(res.status).toBe(400);
  });

  it("os_viewer dobi 403 pri PATCH (ne sme urejati nastavitev)", async () => {
    dbState.queues = [MOD_OK, ROLE_VIEWER];

    const res = await request(app)
      .patch(`/os/${CID}/amortizacija/nastavitve`)
      .set("Authorization", "Bearer user_test")
      .send({ osLeto: 2024 });

    expect(res.status).toBe(403);
  });
});
