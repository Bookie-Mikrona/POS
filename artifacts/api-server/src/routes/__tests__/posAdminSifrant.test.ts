/**
 * Regresijski testi — POS admin sme pisati v stm_or_kontni šifrante.
 *
 * Pokritost:
 *  - POS admin → piše stroškovana mesta (POST, PATCH, DELETE)
 *  - POS admin → piše kontni plan (POST, PATCH/deactivate)
 *  - POS admin_enote → 403 na pisanje (viewer)
 *  - POS uporabnik  → 403 na pisanje (viewer)
 *  - Napačno podjetje (POS brez vrstice za companyId) → 403
 *  - Neaktiven POS uporabnik (aktiven=false → brez vrstice) → 403
 *
 * Opomba: kontni plan nima DELETE — deactivate poteka prek PATCH { isActive: false }.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── vi.hoisted ───────────────────────────────────────────────────────────────

const { dbState } = vi.hoisted(() => {
  const dbState = {
    queues: [] as unknown[][],
    idx: 0,
    whereCalls: [] as unknown[],
    lastUpdate: null as Record<string, unknown> | null,
  };
  return { dbState };
});

// ─── @workspace/db mock ───────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  function nextFrom(): unknown[] {
    const r = dbState.queues[dbState.idx++];
    return r ?? [];
  }
  function makeChain(): Record<string, unknown> {
    const rows = nextFrom();
    const p = Promise.resolve(rows);
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (condition: unknown) => {
        dbState.whereCalls.push(condition);
        return chain;
      },
      innerJoin: () => chain,
      leftJoin: () => chain,
      orderBy: () => chain,
      limit: () => p,
      then: p.then.bind(p),
      catch: (p as Promise<unknown[]>).catch.bind(p),
    };
    return chain;
  }

  const UPDATED_CC = { id: "cc1", code: "CC01", name: "Test SM", isActive: true, companyId: "cmp1" };
  const updateChain = {
    set: (values: Record<string, unknown>) => {
      dbState.lastUpdate = values;
      return updateChain;
    },
    where: (condition: unknown) => {
      dbState.whereCalls.push(condition);
      return { returning: () => Promise.resolve([UPDATED_CC]) };
    },
  };

  const INSERTED_CC = { id: "cc1", code: "CC01", name: "Test SM", isActive: true, companyId: "cmp1" };
  const insertChain = {
    values: () => ({
      returning: () => Promise.resolve([INSERTED_CC]),
    }),
  };

  const deleteChain = { where: () => Promise.resolve([]) };

  return {
    db: {
      select: () => makeChain(),
      update: () => updateChain,
      insert: () => insertChain,
      delete: () => deleteChain,
    },
    costCentersTable: {
      id: "id",
      companyId: "company_id",
      code: "code",
      name: "name",
      isActive: "is_active",
      tip: "tip",
      parentId: "parent_id",
      odgovornaOseba: "odgovorna_oseba",
      description: "description",
    },
    accountsTable: {
      id: "id",
      companyId: "company_id",
      code: "code",
      name: "name",
      isActive: "is_active",
      type: "type",
      parentId: "parent_id",
      allowsPosting: "allows_posting",
      requiresPartner: "requires_partner",
      requiresCostCenter: "requires_cost_center",
      requiresProject: "requires_project",
      taxBehavior: "tax_behavior",
      isCash: "is_cash",
      isOpenItem: "is_open_item",
      description: "description",
    },
    journalEntryLinesTable: { id: "id", costCenterId: "cost_center_id" },
    osnovnaSredstvaTable: { id: "id", costCenterId: "cost_center_id" },
    izmeneTable: { id: "id", costCenterId: "cost_center_id" },
    accountingRolesTable: { clerkUserId: "clerk_user_id", companyId: "company_id", role: "role" },
    osRolesTable: { clerkUserId: "clerk_user_id", companyId: "company_id", role: "role" },
    posUporabnikiTable: { clerkUserId: "clerk_user_id", companyId: "company_id", vloga: "vloga", aktiven: "aktiven" },
    projectsTable: { companyId: "company_id", code: "code", isActive: "is_active", id: "id" },
    departmentsTable: { companyId: "company_id", code: "code", isActive: "is_active", id: "id" },
    BUDGET_CHART_OF_ACCOUNTS: [],
  };
});

// ─── drizzle-orm mock ─────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ _tag: "eq", column, value })),
  and: vi.fn((...args: unknown[]) => ({ _tag: "and", args })),
  or: vi.fn((...args: unknown[]) => ({ _tag: "or", args })),
  asc: vi.fn((a: unknown) => a),
  desc: vi.fn((a: unknown) => a),
  isNull: vi.fn((a: unknown) => ({ _tag: "isNull", a })),
  inArray: vi.fn((_a: unknown, _b: unknown) => ({ _tag: "inArray" })),
}));

// ─── @clerk/express mock ──────────────────────────────────────────────────────

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: { authorization?: string } }) => ({
    userId: req.headers.authorization?.replace("Bearer ", "") ?? "pos_admin_user",
  }),
}));

// ─── slovenianChartOfAccounts mock (nie rabimo za te teste) ──────────────────

vi.mock("../lib/slovenianChartOfAccounts", () => ({
  BUDGET_CHART_OF_ACCOUNTS: [],
  getBudgetParentCodeMap: () => new Map(),
}));

vi.mock("../lib/companyChartOfAccounts", () => ({
  COMPANY_CHART_OF_ACCOUNTS: [],
  getCompanyParentCodeMap: () => new Map(),
}));

// ─── App builders ─────────────────────────────────────────────────────────────

async function buildDimensionsApp() {
  const { default: router } = await import("../dimensions");
  const app = express();
  app.use(express.json());
  app.use("/", router);
  return app;
}

async function buildAccountsApp() {
  const { default: router } = await import("../accounts");
  const app = express();
  app.use(express.json());
  app.use("/", router);
  return app;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * DB queue format:
 *   slot 0 → ERP row (resolveSifrantAccess — accounting_roles)
 *   slot 1 → OS row  (resolveSifrantAccess — os_roles)
 *   slot 2 → POS row (resolveSifrantAccess — pos_uporabniki)
 *   slot 3+ → route-specific queries
 */
function resetDb(...queues: unknown[][]) {
  dbState.queues = queues;
  dbState.idx = 0;
  dbState.whereCalls = [];
  dbState.lastUpdate = null;
}

/** POS admin row — vloga "admin", aktiven implied by query condition */
const posAdminRow = [{ vloga: "admin" }];
/** POS admin_enote row */
const posAdminEnoteRow = [{ vloga: "admin_enote" }];
/** POS uporabnik row */
const posUporabnikRow = [{ vloga: "uporabnik" }];
/** No row — user not found / wrong company / inactive */
const noRow: unknown[] = [];

/** Existing cost-center for PATCH/DELETE tests */
const CC_1 = { id: "cc1", code: "CC01", name: "Test SM", isActive: true, companyId: "cmp1" };
/** Existing account for PATCH tests */
const ACC_1 = { id: "acc1", code: "1000", name: "Blagajna", type: "asset", isActive: true, companyId: "cmp1" };
const FOREIGN_PARENT_ID = "bbbbbbbb-0000-0000-0000-000000000002";

function expectCompanyScopedParentLookup(parentId: string) {
  expect(dbState.whereCalls).toContainEqual({
    _tag: "and",
    args: [
      { _tag: "eq", column: "id", value: parentId },
      { _tag: "eq", column: "company_id", value: "cmp1" },
    ],
  });
}

let dimApp: express.Application;
let accApp: express.Application;

beforeEach(async () => {
  dbState.idx = 0;
  dimApp = await buildDimensionsApp();
  accApp = await buildAccountsApp();
});

// ══════════════════════════════════════════════════════════════════════════════
// STROŠKOVANA MESTA — POS admin piše (accountant)
// ══════════════════════════════════════════════════════════════════════════════

describe("POS admin — stroškovana mesta (stm_or_kontni)", () => {
  it("POST ustvari novo SM — 201", async () => {
    // ERP=no, OS=no, POS=admin, obstaja-check=empty
    resetDb(noRow, noRow, posAdminRow, noRow);
    const res = await request(dimApp)
      .post("/companies/cmp1/cost-centers")
      .send({ code: "CC01", name: "Test SM" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  it("POST zavrne parentId iz tujega podjetja — 400", async () => {
    resetDb(noRow, noRow, posAdminRow, noRow);
    const res = await request(dimApp)
      .post("/companies/cmp1/cost-centers")
      .send({ code: "CC01", name: "Test SM", parentId: FOREIGN_PARENT_ID });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/v tem podjetju/);
    expectCompanyScopedParentLookup(FOREIGN_PARENT_ID);
  });

  it("POST zavrne prazen parentId — 400", async () => {
    resetDb(noRow, noRow, posAdminRow, noRow);
    const res = await request(dimApp)
      .post("/companies/cmp1/cost-centers")
      .send({ code: "CC01", name: "Test SM", parentId: "" });
    expect(res.status).toBe(400);
  });

  it("PATCH posodobi SM — 200", async () => {
    // ERP=no, OS=no, POS=admin, obstaja-check=CC_1
    resetDb(noRow, noRow, posAdminRow, [CC_1]);
    const res = await request(dimApp)
      .patch("/companies/cmp1/cost-centers/cc1")
      .send({ name: "Novo ime" });
    expect(res.status).toBe(200);
  });

  it("PATCH zavrne parentId iz tujega podjetja — 400", async () => {
    resetDb(noRow, noRow, posAdminRow, [CC_1], noRow);
    const res = await request(dimApp)
      .patch("/companies/cmp1/cost-centers/cc1")
      .send({ parentId: FOREIGN_PARENT_ID });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/v tem podjetju/);
    expectCompanyScopedParentLookup(FOREIGN_PARENT_ID);
  });

  it("PATCH zavrne prazen parentId — 400", async () => {
    resetDb(noRow, noRow, posAdminRow, [CC_1], noRow);
    const res = await request(dimApp)
      .patch("/companies/cmp1/cost-centers/cc1")
      .send({ parentId: "" });
    expect(res.status).toBe(400);
  });

  it("DELETE neuporabljano SM — 204", async () => {
    // ERP=no, OS=no, POS=admin, obstaja=CC_1, jelRef=[], osRef=[], childRef=[]
    resetDb(noRow, noRow, posAdminRow, [CC_1], noRow, noRow, noRow, noRow);
    const res = await request(dimApp)
      .delete("/companies/cmp1/cost-centers/cc1");
    expect(res.status).toBe(204);
  });

  it("DELETE SM v rabi → soft-delete 200 deaktivirano", async () => {
    // ERP=no, OS=no, POS=admin, obstaja=CC_1, jelRef=[jel1], osRef=[], childRef=[]
    resetDb(noRow, noRow, posAdminRow, [CC_1], [{ id: "jel1" }], noRow, noRow, noRow);
    const res = await request(dimApp)
      .delete("/companies/cmp1/cost-centers/cc1");
    expect(res.status).toBe(200);
    expect(res.body.deaktivirano).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// KONTNI PLAN — POS admin piše (accountant); ni DELETE → deactivate prek PATCH
// ══════════════════════════════════════════════════════════════════════════════

describe("POS admin — kontni plan (stm_or_kontni)", () => {
  it("POST ustvari nov konto — 201", async () => {
    // ERP=no, OS=no, POS=admin, obstaja-check=empty
    resetDb(noRow, noRow, posAdminRow, noRow);
    const res = await request(accApp)
      .post("/companies/cmp1/accounts")
      .send({ code: "1000", name: "Blagajna", type: "asset" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  it("POST zavrne parentId iz tujega podjetja — 400", async () => {
    resetDb(noRow, noRow, posAdminRow, noRow);
    const res = await request(accApp)
      .post("/companies/cmp1/accounts")
      .send({ code: "1000", name: "Blagajna", type: "asset", parentId: FOREIGN_PARENT_ID });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/v tem podjetju/);
    expectCompanyScopedParentLookup(FOREIGN_PARENT_ID);
  });

  it("POST zavrne prazen parentId — 400", async () => {
    resetDb(noRow, noRow, posAdminRow, noRow);
    const res = await request(accApp)
      .post("/companies/cmp1/accounts")
      .send({ code: "1000", name: "Blagajna", type: "asset", parentId: "" });
    expect(res.status).toBe(400);
  });

  it("PATCH posodobi konto — 200", async () => {
    // ERP=no, OS=no, POS=admin, obstaja=ACC_1
    resetDb(noRow, noRow, posAdminRow, [ACC_1]);
    const res = await request(accApp)
      .patch("/companies/cmp1/accounts/acc1")
      .send({ name: "Novo ime konta" });
    expect(res.status).toBe(200);
  });

  it("PATCH res shrani isCash in isOpenItem — 200", async () => {
    resetDb(noRow, noRow, posAdminRow, [ACC_1]);
    const res = await request(accApp)
      .patch("/companies/cmp1/accounts/acc1")
      .send({ isCash: true, isOpenItem: true });
    expect(res.status).toBe(200);
    expect(dbState.lastUpdate).toMatchObject({ isCash: true, isOpenItem: true });
  });

  it("PATCH zavrne parentId iz tujega podjetja — 400", async () => {
    resetDb(noRow, noRow, posAdminRow, [ACC_1], noRow);
    const res = await request(accApp)
      .patch("/companies/cmp1/accounts/acc1")
      .send({ parentId: FOREIGN_PARENT_ID });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/v tem podjetju/);
    expectCompanyScopedParentLookup(FOREIGN_PARENT_ID);
  });

  it("PATCH zavrne prazen parentId — 400", async () => {
    resetDb(noRow, noRow, posAdminRow, [ACC_1], noRow);
    const res = await request(accApp)
      .patch("/companies/cmp1/accounts/acc1")
      .send({ parentId: "" });
    expect(res.status).toBe(400);
  });

  it("PATCH deaktivira konto (isActive: false) — 200", async () => {
    // Kontni plan nima DELETE; deactivate prek PATCH
    resetDb(noRow, noRow, posAdminRow, [ACC_1]);
    const res = await request(accApp)
      .patch("/companies/cmp1/accounts/acc1")
      .send({ isActive: false });
    expect(res.status).toBe(200);
  });

  it("POST seed uvozi privzeti plan za d.o.o. — 201", async () => {
    resetDb(noRow, noRow, posAdminRow, noRow);
    const res = await request(accApp)
      .post("/companies/cmp1/accounts/seed");
    expect(res.status).toBe(201);
  });
});

describe("POS admin — projekti in oddelki ostanejo read-only", () => {
  it("POST project → 403", async () => {
    resetDb(noRow, noRow, posAdminRow);
    const res = await request(dimApp)
      .post("/companies/cmp1/projects")
      .send({ code: "PR1", name: "Projekt" });
    expect(res.status).toBe(403);
  });

  it("PATCH project → 403", async () => {
    resetDb(noRow, noRow, posAdminRow);
    const res = await request(dimApp)
      .patch("/companies/cmp1/projects/project1")
      .send({ name: "Spremenjen projekt" });
    expect(res.status).toBe(403);
  });

  it("POST department → 403", async () => {
    resetDb(noRow, noRow, posAdminRow);
    const res = await request(dimApp)
      .post("/companies/cmp1/departments")
      .send({ code: "OD1", name: "Oddelek" });
    expect(res.status).toBe(403);
  });

  it("PATCH department → 403", async () => {
    resetDb(noRow, noRow, posAdminRow);
    const res = await request(dimApp)
      .patch("/companies/cmp1/departments/department1")
      .send({ name: "Spremenjen oddelek" });
    expect(res.status).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POS admin_enote — 403 na pisanje
// ══════════════════════════════════════════════════════════════════════════════

describe("POS admin_enote — stm_or_kontni bere, ne piše (403)", () => {
  it("GET cost-centers → 200", async () => {
    resetDb(noRow, noRow, posAdminEnoteRow, [CC_1]);
    const res = await request(dimApp)
      .get("/companies/cmp1/cost-centers");
    expect(res.status).toBe(200);
  });

  it("POST cost-center → 403", async () => {
    resetDb(noRow, noRow, posAdminEnoteRow);
    const res = await request(dimApp)
      .post("/companies/cmp1/cost-centers")
      .send({ code: "CC01", name: "Test" });
    expect(res.status).toBe(403);
  });

  it("PATCH cost-center → 403", async () => {
    resetDb(noRow, noRow, posAdminEnoteRow);
    const res = await request(dimApp)
      .patch("/companies/cmp1/cost-centers/cc1")
      .send({ name: "X" });
    expect(res.status).toBe(403);
  });

  it("DELETE cost-center → 403", async () => {
    resetDb(noRow, noRow, posAdminEnoteRow);
    const res = await request(dimApp)
      .delete("/companies/cmp1/cost-centers/cc1");
    expect(res.status).toBe(403);
  });

  it("POST account → 403", async () => {
    resetDb(noRow, noRow, posAdminEnoteRow);
    const res = await request(accApp)
      .post("/companies/cmp1/accounts")
      .send({ code: "1000", name: "Blagajna", type: "asset" });
    expect(res.status).toBe(403);
  });

  it("PATCH account → 403", async () => {
    resetDb(noRow, noRow, posAdminEnoteRow);
    const res = await request(accApp)
      .patch("/companies/cmp1/accounts/acc1")
      .send({ name: "X" });
    expect(res.status).toBe(403);
  });

  it("POST account seed → 403", async () => {
    resetDb(noRow, noRow, posAdminEnoteRow);
    const res = await request(accApp)
      .post("/companies/cmp1/accounts/seed");
    expect(res.status).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POS uporabnik — 403 na pisanje
// ══════════════════════════════════════════════════════════════════════════════

describe("POS uporabnik — stm_or_kontni bere, ne piše (403)", () => {
  it("GET accounts → 200", async () => {
    resetDb(noRow, noRow, posUporabnikRow, [ACC_1]);
    const res = await request(accApp)
      .get("/companies/cmp1/accounts");
    expect(res.status).toBe(200);
  });

  it("POST cost-center → 403", async () => {
    resetDb(noRow, noRow, posUporabnikRow);
    const res = await request(dimApp)
      .post("/companies/cmp1/cost-centers")
      .send({ code: "CC01", name: "Test" });
    expect(res.status).toBe(403);
  });

  it("PATCH cost-center → 403", async () => {
    resetDb(noRow, noRow, posUporabnikRow);
    const res = await request(dimApp)
      .patch("/companies/cmp1/cost-centers/cc1")
      .send({ name: "X" });
    expect(res.status).toBe(403);
  });

  it("POST account → 403", async () => {
    resetDb(noRow, noRow, posUporabnikRow);
    const res = await request(accApp)
      .post("/companies/cmp1/accounts")
      .send({ code: "1000", name: "Blagajna", type: "asset" });
    expect(res.status).toBe(403);
  });

  it("PATCH account (deactivate) → 403", async () => {
    resetDb(noRow, noRow, posUporabnikRow);
    const res = await request(accApp)
      .patch("/companies/cmp1/accounts/acc1")
      .send({ isActive: false });
    expect(res.status).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Napačno podjetje — POS admin v drugem podjetju → 403
// ══════════════════════════════════════════════════════════════════════════════

describe("POS admin — napačno podjetje (brez vrstice za cmp2) → 403", () => {
  it("POST cost-center za cmp2 → 403", async () => {
    // Vsi trije selekti vrnejo prazen rezultat (POS admin je le v cmp1, ne cmp2)
    resetDb(noRow, noRow, noRow);
    const res = await request(dimApp)
      .post("/companies/cmp2/cost-centers")
      .send({ code: "CC01", name: "Test" });
    expect(res.status).toBe(403);
  });

  it("POST account za cmp2 → 403", async () => {
    resetDb(noRow, noRow, noRow);
    const res = await request(accApp)
      .post("/companies/cmp2/accounts")
      .send({ code: "1000", name: "Blagajna", type: "asset" });
    expect(res.status).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Neaktiven POS admin — aktiven=false → ni vrstice iz DB → 403
// ══════════════════════════════════════════════════════════════════════════════

describe("Neaktiven POS admin (aktiven=false → ni vrstice) → 403", () => {
  it("POST cost-center → 403", async () => {
    // WHERE aktiven=true ne ujame neaktivnega → prazen array
    resetDb(noRow, noRow, noRow);
    const res = await request(dimApp)
      .post("/companies/cmp1/cost-centers")
      .send({ code: "CC01", name: "Test" });
    expect(res.status).toBe(403);
  });

  it("POST account → 403", async () => {
    resetDb(noRow, noRow, noRow);
    const res = await request(accApp)
      .post("/companies/cmp1/accounts")
      .send({ code: "1000", name: "Blagajna", type: "asset" });
    expect(res.status).toBe(403);
  });
});
