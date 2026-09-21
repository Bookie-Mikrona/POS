/**
 * Testi za resolveSifrantAccess — centraliziran dostop do šifrantnih rut.
 *
 * Scenariji (spec točka D):
 * (a) mojca os_admin   → vidi šifrante; ureja vse tri (partnerji + StM + kontni plan)
 * (b) GLK owner        → ureja vse
 * (c) POS admin        → ureja partnerje, StM in KontniPlan; drugi POS vlogi sta read-only
 * (d) superadmin brez vlog → 403 (ni bypass)
 * Bonus: ERP viewer → ureja partnerje, StM read-only; OS viewer → StM read-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Response } from "express";

// ── Mock @workspace/db ─────────────────────────────────────────────────────────
const mockDb = {
  select: vi.fn(),
};

vi.mock("@workspace/db", () => ({
  db: mockDb,
  accountingRolesTable: { clerkUserId: "clerkUserId", companyId: "companyId", role: "role" },
  osRolesTable: { clerkUserId: "clerkUserId", companyId: "companyId", role: "role" },
  posUporabnikiTable: { clerkUserId: "clerkUserId", companyId: "companyId", vloga: "vloga", aktiven: "aktiven" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

// ── Helper za mockanje zaporednih DB klicev ────────────────────────────────────
/**
 * Nastavi tri zaporedne DB klice: erpResult, osResult, posResult.
 * undefined = vrstica ne obstaja (prazen array).
 */
function setupDbMocks(
  erpRow: { role: string } | undefined,
  osRow: { role: string } | undefined,
  posRow: { vloga: string } | undefined,
) {
  let callCount = 0;
  const rows = [
    erpRow ? [erpRow] : [],
    osRow ? [osRow] : [],
    posRow ? [posRow] : [],
  ];

  mockDb.select.mockImplementation(() => {
    const idx = callCount++;
    const result = rows[idx] ?? [];
    return {
      from: () => ({ where: () => ({ limit: () => Promise.resolve(result) }) }),
    };
  });
}

function makeMockRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { status, json, _statusJson: (s: number, body: unknown) => { status(s); json(body); } } as unknown as Response & { status: typeof status; json: typeof json };
}

// ── Dynamický import AFTER mocking ────────────────────────────────────────────
let resolveSifrantAccess: typeof import("./resolveSifrantAccess").resolveSifrantAccess;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  // Re-import po resetModules da dobimo svežo instanco
  const mod = await import("./resolveSifrantAccess");
  resolveSifrantAccess = mod.resolveSifrantAccess;
});

// ══════════════════════════════════════════════════════════════════════════════
// (a) OS admin (mojca) — ureja vse tri šifrante
// ══════════════════════════════════════════════════════════════════════════════
describe("OS admin", () => {
  it("partnerji → accountant (sme pisati)", async () => {
    setupDbMocks(undefined, { role: "os_admin" }, undefined);
    const res = makeMockRes();
    const result = await resolveSifrantAccess("mojca", "comp1", "partnerji", res);
    expect(result).toEqual({ role: "accountant" });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("stm_or_kontni → accountant (sme pisati)", async () => {
    setupDbMocks(undefined, { role: "os_admin" }, undefined);
    const res = makeMockRes();
    const result = await resolveSifrantAccess("mojca", "comp1", "stm_or_kontni", res);
    expect(result).toEqual({ role: "accountant" });
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("OS user", () => {
  it("partnerji → accountant", async () => {
    setupDbMocks(undefined, { role: "os_user" }, undefined);
    const res = makeMockRes();
    const result = await resolveSifrantAccess("os_user1", "comp1", "partnerji", res);
    expect(result).toEqual({ role: "accountant" });
  });

  it("stm_or_kontni → accountant", async () => {
    setupDbMocks(undefined, { role: "os_user" }, undefined);
    const res = makeMockRes();
    const result = await resolveSifrantAccess("os_user1", "comp1", "stm_or_kontni", res);
    expect(result).toEqual({ role: "accountant" });
  });
});

describe("OS viewer", () => {
  it("partnerji → accountant (spec: vsi urejajo)", async () => {
    setupDbMocks(undefined, { role: "os_viewer" }, undefined);
    const res = makeMockRes();
    const result = await resolveSifrantAccess("os_viewer1", "comp1", "partnerji", res);
    expect(result).toEqual({ role: "accountant" });
  });

  it("stm_or_kontni → viewer (read-only)", async () => {
    setupDbMocks(undefined, { role: "os_viewer" }, undefined);
    const res = makeMockRes();
    const result = await resolveSifrantAccess("os_viewer1", "comp1", "stm_or_kontni", res);
    expect(result).toEqual({ role: "viewer" });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// (b) GLK vloge
// ══════════════════════════════════════════════════════════════════════════════
describe("GLK owner", () => {
  it("partnerji → accountant (vse ERP vloge pišejo)", async () => {
    setupDbMocks({ role: "owner" }, undefined, undefined);
    const res = makeMockRes();
    const result = await resolveSifrantAccess("erp_owner", "comp1", "partnerji", res);
    expect(result).toEqual({ role: "accountant" });
  });

  it("stm_or_kontni → owner", async () => {
    setupDbMocks({ role: "owner" }, undefined, undefined);
    const res = makeMockRes();
    const result = await resolveSifrantAccess("erp_owner", "comp1", "stm_or_kontni", res);
    expect(result).toEqual({ role: "owner" });
  });
});

describe("GLK accountant", () => {
  it("stm_or_kontni → accountant", async () => {
    setupDbMocks({ role: "accountant" }, undefined, undefined);
    const res = makeMockRes();
    const result = await resolveSifrantAccess("erp_acc", "comp1", "stm_or_kontni", res);
    expect(result).toEqual({ role: "accountant" });
  });
});

describe("GLK viewer", () => {
  it("partnerji → accountant (spec: vsi ERP vloge pišejo)", async () => {
    setupDbMocks({ role: "viewer" }, undefined, undefined);
    const res = makeMockRes();
    const result = await resolveSifrantAccess("erp_view", "comp1", "partnerji", res);
    expect(result).toEqual({ role: "accountant" });
  });

  it("stm_or_kontni → viewer (read-only)", async () => {
    setupDbMocks({ role: "viewer" }, undefined, undefined);
    const res = makeMockRes();
    const result = await resolveSifrantAccess("erp_view", "comp1", "stm_or_kontni", res);
    expect(result).toEqual({ role: "viewer" });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// (c) POS vloge — partnerji: vsi pišejo; stm_or_kontni: admin piše, ostali berejo
// ══════════════════════════════════════════════════════════════════════════════
describe("POS admin", () => {
  it("partnerji → accountant (sme pisati)", async () => {
    setupDbMocks(undefined, undefined, { vloga: "admin" });
    const res = makeMockRes();
    const result = await resolveSifrantAccess("pos_admin", "comp1", "partnerji", res);
    expect(result).toEqual({ role: "accountant" });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("stm_or_kontni → accountant (POS admin sme pisati)", async () => {
    setupDbMocks(undefined, undefined, { vloga: "admin" });
    const res = makeMockRes();
    const result = await resolveSifrantAccess("pos_admin", "comp1", "stm_or_kontni", res);
    expect(result).toEqual({ role: "accountant" });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("ostale_dimenzije → viewer (projekti in oddelki ostanejo read-only)", async () => {
    setupDbMocks(undefined, undefined, { vloga: "admin" });
    const res = makeMockRes();
    const result = await resolveSifrantAccess("pos_admin", "comp1", "ostale_dimenzije", res);
    expect(result).toEqual({ role: "viewer" });
  });
});

describe("POS admin_enote", () => {
  it("partnerji → accountant (vsi POS pišejo partnerje)", async () => {
    setupDbMocks(undefined, undefined, { vloga: "admin_enote" });
    const res = makeMockRes();
    const result = await resolveSifrantAccess("pos_ae", "comp1", "partnerji", res);
    expect(result).toEqual({ role: "accountant" });
  });

  it("stm_or_kontni → viewer (read-only)", async () => {
    setupDbMocks(undefined, undefined, { vloga: "admin_enote" });
    const res = makeMockRes();
    const result = await resolveSifrantAccess("pos_ae", "comp1", "stm_or_kontni", res);
    expect(result).toEqual({ role: "viewer" });
  });
});

describe("POS uporabnik", () => {
  it("partnerji → accountant", async () => {
    setupDbMocks(undefined, undefined, { vloga: "uporabnik" });
    const res = makeMockRes();
    const result = await resolveSifrantAccess("pos_u", "comp1", "partnerji", res);
    expect(result).toEqual({ role: "accountant" });
  });

  it("stm_or_kontni → viewer (read-only)", async () => {
    setupDbMocks(undefined, undefined, { vloga: "uporabnik" });
    const res = makeMockRes();
    const result = await resolveSifrantAccess("pos_u2", "comp1", "stm_or_kontni", res);
    expect(result).toEqual({ role: "viewer" });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// (d) Superadmin brez vlog → 403 (načelo: superadmin dodeljuje, ne uporablja)
// ══════════════════════════════════════════════════════════════════════════════
describe("Superadmin brez dodeljenih vlog", () => {
  it("partnerji → 403 (ni superadmin bypass)", async () => {
    setupDbMocks(undefined, undefined, undefined);
    const res = makeMockRes();
    const result = await resolveSifrantAccess("superadmin_id", "comp1", "partnerji", res);
    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("stm_or_kontni → 403", async () => {
    setupDbMocks(undefined, undefined, undefined);
    const res = makeMockRes();
    const result = await resolveSifrantAccess("superadmin_id", "comp1", "stm_or_kontni", res);
    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Brez vloge → 403
// ══════════════════════════════════════════════════════════════════════════════
describe("Uporabnik brez vloge", () => {
  it("vrne null in pošlje 403", async () => {
    setupDbMocks(undefined, undefined, undefined);
    const res = makeMockRes();
    const result = await resolveSifrantAccess("nobody", "comp1", "partnerji", res);
    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });
});
