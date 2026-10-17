import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), select: vi.fn() }));
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, pool: { query: mocks.query }, db: { ...original.db, select: mocks.select } };
});

import terminalRouter from "./terminal";
const endpoint = "/terminal/viva/terminal/refunds/alert-settings";
const companyId = "00000000-0000-4000-8000-000000000001";
function app(role = "admin") {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    Object.assign(req, { enotaId: 9, companyId, vloga: role });
    next();
  });
  server.use(terminalRouter);
  return server;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ rows: [] });
});

describe("Viva starostni pragovi in opozorila HTTP", () => {
  it.each(["uporabnik", "natakar"])("vloga %s ne vidi opozoril in ne spreminja pragov", async role => {
    expect((await supertest(app(role)).get(endpoint)).status).toBe(403);
    expect((await supertest(app(role)).put(endpoint).send({ overdueHours: 2, criticalHours: 4 })).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("vodja enote lahko bere, ne more pa spreminjati pragov podjetja", async () => {
    expect((await supertest(app("admin_enote")).get(endpoint)).status).toBe(200);
    expect((await supertest(app("admin_enote")).put(endpoint).send({ overdueHours: 2, criticalHours: 4 })).status).toBe(403);
  });

  it("vrne privzete pragove in opozorila omeji na podjetje ter aktivno enoto", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [{ id: 1, refundId: 4, threshold: "critical", thresholdHours: 72, createdAt: new Date(), stevilkaRacuna: "R-4" }],
    });
    const result = await supertest(app()).get(endpoint);
    expect(result.status).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body.settings).toEqual({ overdueHours: 24, criticalHours: 72 });
    expect(result.body.alerts).toHaveLength(1);
    expect(mocks.query.mock.calls[0][1]).toEqual([companyId]);
    expect(mocks.query.mock.calls[1][1]).toEqual([9, companyId]);
    expect(mocks.query.mock.calls[1][0]).toContain("a.closed_at IS NULL");
    expect(mocks.query.mock.calls[1][0]).toContain("v.status IN ('unknown', 'awaiting_approval')");
  });

  it.each([
    { overdueHours: 0, criticalHours: 4 },
    { overdueHours: 2.5, criticalHours: 4 },
    { overdueHours: 4, criticalHours: 4 },
    { overdueHours: 5, criticalHours: 4 },
    { overdueHours: 24, criticalHours: 8761 },
    { overdueHours: 1 },
  ])("zavrne neveljavne pragove %j", async body => {
    expect((await supertest(app()).put(endpoint).send(body)).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("shrani samo za podjetje iz preverjene seje, ne iz telesa", async () => {
    const result = await supertest(app()).put(endpoint).send({ overdueHours: 8, criticalHours: 12, companyId: "foreign-company" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ overdueHours: 8, criticalHours: 12 });
    expect(mocks.query.mock.calls[0][1]).toEqual([companyId, 8, 12]);
  });

  it("seznam vrne starost glede na nastavljene pragove podjetja", async () => {
    mocks.query.mockResolvedValue({ rows: [{ overdueHours: 2, criticalHours: 4 }] });
    mocks.select.mockReturnValue({
      from: () => ({
        where: async () => [{ threshold: "100" }],
        innerJoin: () => ({
          where: () => ({
            orderBy: async () => [{
              id: 1, racunId: 4, stevilkaRacuna: "R-4", refundSessionId: "test",
              znesek: "12.00", ustvarjeno: new Date(Date.now() - 5 * 3_600_000),
            }],
          }),
        }),
      }),
    });
    const result = await supertest(app()).get("/terminal/viva/terminal/refunds/unknown");
    expect(result.status).toBe(200);
    expect(result.body.items[0]).toMatchObject({ ageState: "critical", znesek: 12 });
    expect(result.body.items[0].ageHours).toBeGreaterThanOrEqual(5);
  });
});
