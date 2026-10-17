import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  queues: [] as unknown[][],
  select: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...original,
    db: {
      select: state.select.mockImplementation(() => {
        const rows = state.queues.shift() ?? [];
        const chain = {
          from: () => chain,
          leftJoin: () => chain,
          where: (condition: unknown) => { state.where(condition); return chain; },
          groupBy: (column: unknown) => { state.groupBy(column); return chain; },
          orderBy: (order: unknown) => { state.orderBy(order); return Promise.resolve(rows); },
          limit: () => Promise.resolve(rows),
        };
        return chain;
      }),
    },
  };
});
vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: { authorization?: string } }) => ({
    userId: req.headers.authorization?.replace("Bearer ", "") ?? null,
  }),
}));
vi.mock("../../middlewares/requireSuperAdmin", () => ({ isSuperAdmin: () => false }));

const companyId = "11111111-1111-4111-8111-111111111111";
const url = `/os/${companyId}/amortizacija/obracun`;
const updatedAt = new Date("2026-06-30T12:00:00.000Z");

async function app() {
  const { default: router } = await import("../osAmortizacijaKnjizenje");
  return express().use(express.json()).use(router);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.queues = [];
});

describe("GET arhiv obračunov amortizacije", () => {
  it("requires authentication before accessing the database", async () => {
    const res = await request(await app()).get(url);
    expect(res.status).toBe(401);
    expect(state.select).not.toHaveBeenCalled();
  });

  it("rejects invalid company IDs", async () => {
    const res = await request(await app()).get("/os/not-a-uuid/amortizacija/obracun").set("Authorization", "Bearer user");
    expect(res.status).toBe(400);
    expect(state.select).not.toHaveBeenCalled();
  });

  it("requires the company OS module and a role in that same company", async () => {
    state.queues = [[]];
    expect((await request(await app()).get(url).set("Authorization", "Bearer user")).status).toBe(403);
    expect(state.select).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();
    state.queues = [[{ module: "osnovna_sredstva" }], []];
    expect((await request(await app()).get(url).set("Authorization", "Bearer user")).status).toBe(403);
    expect(state.select).toHaveBeenCalledTimes(2);
  });

  it.each(["os_admin", "os_user", "os_viewer"])("allows %s to read saved heads, including zero totals", async (role) => {
    const heads = [
      { id: "new", leto: 2026, doMeseca: 6, status: "odprt", skupajAmortizacija: "1234.56", updatedAt },
      { id: "old", leto: 2025, doMeseca: 12, status: "zakljucen", skupajAmortizacija: "0.00", updatedAt },
    ];
    state.queues = [[{ module: "osnovna_sredstva" }], [{ role }], heads];
    const res = await request(await app()).get(url).set("Authorization", "Bearer user");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(heads.map((head) => ({ ...head, updatedAt: updatedAt.toISOString() })));

    const dialect = new PgDialect();
    // Every permission query and the archive itself must remain company-scoped.
    for (const [condition] of state.where.mock.calls) {
      expect(dialect.sqlToQuery(condition).params).toContain(companyId);
    }
    expect(dialect.sqlToQuery(state.orderBy.mock.calls[0][0]).sql).toContain('"leto" desc');
    expect(state.groupBy).toHaveBeenCalledTimes(1);
    const projection = state.select.mock.calls[2][0];
    const totalSql = dialect.sqlToQuery(projection.skupajAmortizacija).sql;
    expect(totalSql).toContain('coalesce(sum("os_amortizacija_obracun_sredstvo"."obracunano"), 0)');
  });

  it("returns an empty archive without creating any calculations", async () => {
    state.queues = [[{ module: "osnovna_sredstva" }], [{ role: "os_viewer" }], []];
    const res = await request(await app()).get(url).set("Authorization", "Bearer user");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
