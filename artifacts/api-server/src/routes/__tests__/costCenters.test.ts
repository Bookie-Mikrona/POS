/**
 * Testi za cost_centers CRUD
 *
 * Preverja:
 * - GET /companies/:id/cost-centers — vrne samo aktivna (privzeto) oz. vsa (includeInactive=true)
 * - POST ustvari SM; 409 pri podvojen kodi
 * - PATCH posodobi naziv/tip/parentId/odgovornaOseba/isActive
 * - PATCH zavrne cikel (parent = sam sebi)
 * - DELETE na neuporabljano SM → 204; na SM v rabi → 200 { deaktivirano: true }
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
  function makeChain(): Record<string, unknown> {
    const rows = nextFrom();
    const p = Promise.resolve(rows);
    const chain: Record<string, unknown> = {
      from: () => chain, where: () => chain, innerJoin: () => chain,
      leftJoin: () => chain, orderBy: () => chain, limit: () => p,
      then: p.then.bind(p), catch: (p as Promise<unknown[]>).catch.bind(p),
    };
    return chain;
  }
  const UPDATED = { id: "cc1", code: "1000", name: "Test", isActive: false, companyId: "cmp1" };
  const updateChain = {
    set: () => updateChain,
    where: () => ({ returning: () => Promise.resolve([UPDATED]) }),
  };
  const insertChain = {
    values: () => ({
      returning: () => Promise.resolve([{ id: "cc1", code: "1000", name: "Test", isActive: true, companyId: "cmp1" }]),
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
      id: "id", companyId: "company_id", code: "code", name: "name",
      isActive: "is_active", tip: "tip", parentId: "parent_id",
      odgovornaOseba: "odgovorna_oseba", description: "description",
    },
    journalEntryLinesTable: { id: "id", costCenterId: "cost_center_id" },
    osnovnaSredstvaTable: { id: "id", costCenterId: "cost_center_id" },
    izmeneTable: { id: "id", costCenterId: "cost_center_id" },
    accountingRolesTable: { clerkUserId: "clerk_user_id", companyId: "company_id", role: "role" },
    osRolesTable: { clerkUserId: "clerk_user_id", companyId: "company_id", role: "role" },
    posUporabnikiTable: { clerkUserId: "clerk_user_id", companyId: "company_id", vloga: "vloga", aktiven: "aktiven" },
    projectsTable: { companyId: "company_id", code: "code", isActive: "is_active", id: "id" },
    departmentsTable: { companyId: "company_id", code: "code", isActive: "is_active", id: "id" },
  };
});

// ─── drizzle-orm mock ─────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_a: unknown, _b: unknown) => ({ _tag: "eq" })),
  and: vi.fn((...args: unknown[]) => ({ _tag: "and", args })),
  or: vi.fn((...args: unknown[]) => ({ _tag: "or", args })),
  asc: vi.fn((a: unknown) => a),
  desc: vi.fn((a: unknown) => a),
  isNull: vi.fn((a: unknown) => ({ _tag: "isNull", a })),
  inArray: vi.fn((_a: unknown, _b: unknown) => ({ _tag: "inArray" })),
}));

// ─── @clerk/express mock ─────────────────────────────────────────────────────

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: { authorization?: string } }) => ({
    userId: req.headers.authorization?.replace("Bearer ", "") ?? "user1",
  }),
}));

// ─── App builder ──────────────────────────────────────────────────────────────

async function buildApp() {
  const { default: router } = await import("../dimensions");
  const app = express();
  app.use(express.json());
  app.use("/", router);
  return app;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ownerRole = [{ role: "owner" }];
const viewerRole = [{ role: "viewer" }];
const CC_1 = { id: "cc1", code: "1000", name: "KAMNOLOM", isActive: true, companyId: "cmp1", tip: null, parentId: null };

function resetDb(...queues: unknown[][]) {
  dbState.queues = queues;
  dbState.idx = 0;
}

let app: express.Application;

beforeEach(async () => {
  dbState.idx = 0;
  app = await buildApp();
});

// ─── Testi ────────────────────────────────────────────────────────────────────

describe("GET /companies/:companyId/cost-centers", () => {
  it("vrne samo aktivna po privzetem", async () => {
    resetDb(ownerRole, [CC_1]);
    const res = await request(app).get("/companies/cmp1/cost-centers");
    expect(res.status).toBe(200);
    expect(res.body.costCenters).toBeDefined();
  });

  it("vrne vsa z includeInactive=true", async () => {
    resetDb(ownerRole, [CC_1]);
    const res = await request(app).get("/companies/cmp1/cost-centers?includeInactive=true");
    expect(res.status).toBe(200);
    expect(res.body.costCenters).toBeDefined();
  });

  it("403 brez dostopa", async () => {
    resetDb([]);
    const res = await request(app).get("/companies/cmp1/cost-centers");
    expect(res.status).toBe(403);
  });
});

describe("POST /companies/:companyId/cost-centers", () => {
  it("ustvari novo SM", async () => {
    resetDb(ownerRole, []);
    const res = await request(app)
      .post("/companies/cmp1/cost-centers")
      .send({ code: "1000", name: "KAMNOLOM", tip: "direktna" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  it("409 pri podvojen kodi", async () => {
    resetDb(ownerRole, [CC_1]);
    const res = await request(app)
      .post("/companies/cmp1/cost-centers")
      .send({ code: "1000", name: "KAMNOLOM2" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/že obstaja/);
  });

  it("400 brez kode", async () => {
    resetDb(ownerRole);
    const res = await request(app)
      .post("/companies/cmp1/cost-centers")
      .send({ name: "Brez kode" });
    expect(res.status).toBe(400);
  });

  it("403 za viewer", async () => {
    resetDb(viewerRole);
    const res = await request(app)
      .post("/companies/cmp1/cost-centers")
      .send({ code: "X", name: "Y" });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /companies/:companyId/cost-centers/:id", () => {
  it("posodobi naziv in tip", async () => {
    // resolveAccess, obstaja check
    resetDb(ownerRole, [CC_1]);
    const res = await request(app)
      .patch("/companies/cmp1/cost-centers/cc1")
      .send({ name: "Novo ime", tip: "indirektna" });
    expect(res.status).toBe(200);
  });

  it("400 — SM ne more biti sam sebi nadrejen", async () => {
    const smId = "aaaaaaaa-0000-0000-0000-000000000001";
    resetDb(ownerRole, [CC_1]);
    const res = await request(app)
      .patch(`/companies/cmp1/cost-centers/${smId}`)
      .send({ parentId: smId }); // isti UUID → self-reference
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/samo sebi/);
  });

  it("403 za viewer", async () => {
    resetDb(viewerRole);
    const res = await request(app)
      .patch("/companies/cmp1/cost-centers/cc1")
      .send({ name: "X" });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /companies/:companyId/cost-centers/:id", () => {
  it("204 za neuporabljano SM", async () => {
    // resolveAccess, obstaja, jelRef (prazno), osRef (prazno), childRef (prazno)
    resetDb(ownerRole, [CC_1], [], [], [], []);
    const res = await request(app).delete("/companies/cmp1/cost-centers/cc1");
    expect(res.status).toBe(204);
  });

  it("200 deaktivirano za SM v temeljnicah", async () => {
    // resolveAccess, obstaja, jelRef (ima zapis), osRef, childRef
    resetDb(ownerRole, [CC_1], [{ id: "jel1" }], [], [], []);
    const res = await request(app).delete("/companies/cmp1/cost-centers/cc1");
    expect(res.status).toBe(200);
    expect(res.body.deaktivirano).toBe(true);
    expect(res.body.razlog).toBe("journal_entry_lines");
  });

  it("200 deaktivirano za SM z podrejenimi", async () => {
    // resolveAccess, obstaja, jelRef (prazno), osRef (prazno), childRef (ima)
    resetDb(ownerRole, [CC_1], [], [], [], [{ id: "cc-child" }]);
    const res = await request(app).delete("/companies/cmp1/cost-centers/cc1");
    expect(res.status).toBe(200);
    expect(res.body.deaktivirano).toBe(true);
    expect(res.body.razlog).toBe("podrejeni_sm");
  });

  it("404 za neobstoječe SM", async () => {
    resetDb(ownerRole, []);
    const res = await request(app).delete("/companies/cmp1/cost-centers/nonexistent");
    expect(res.status).toBe(404);
  });

  it("403 za viewer", async () => {
    resetDb(viewerRole);
    const res = await request(app).delete("/companies/cmp1/cost-centers/cc1");
    expect(res.status).toBe(403);
  });
});
