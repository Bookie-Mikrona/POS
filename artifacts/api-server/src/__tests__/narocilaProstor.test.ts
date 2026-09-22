/**
 * Testi za prostor (prostorId/prostorIme) v naročilnih API-jih.
 *
 * DB je zamockiran (queue rezultatov po vrstnem redu select klicev),
 * sheme tabel so realne (importOriginal), zato drizzle eq/leftJoin delujejo.
 *
 * Preverja:
 * 1. GET /narocila/aktivna vrne prostorId + prostorIme, kadar ima miza prostor
 * 2. GET /narocila/aktivna vrne prostorId=null + prostorIme=null za mizo brez prostora
 * 3. Poizvedba za aktivna naročila izbere prostor stolpca (JOIN na prostore)
 * 4. PATCH /narocila/:id/postavke/:postavkaId/pripravljeno — SSE payload vsebuje prostorIme
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── vi.hoisted stanje ────────────────────────────────────────────────────────

const { dbState } = vi.hoisted(() => {
  const dbState = {
    /** Rezultati za zaporedne db.select() klice (FIFO) */
    selectQueue: [] as unknown[][],
    /** Zabeleženi selection objekti (za preverjanje izbranih stolpcev) */
    selections: [] as Record<string, unknown>[],
  };
  return { dbState };
});

// ─── @workspace/db mock — realne sheme, zamockiran db ────────────────────────

vi.mock("@workspace/db", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@workspace/db")>();

  function makeChain(): Record<string, unknown> {
    const rows = dbState.selectQueue.length > 0 ? dbState.selectQueue.shift()! : [];
    const p = Promise.resolve(rows);
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      orderBy: () => chain,
      limit: () => p,
      then: p.then.bind(p),
      catch: p.catch.bind(p),
    };
    return chain;
  }

  return {
    ...orig,
    db: {
      select: (sel?: Record<string, unknown>) => {
        if (sel) dbState.selections.push(sel);
        return makeChain();
      },
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
      insert: () => ({ values: () => Promise.resolve([]) }),
      transaction: async (fn: (tx: unknown) => unknown) => fn({
        select: (sel?: Record<string, unknown>) => {
          if (sel) dbState.selections.push(sel);
          return makeChain();
        },
        update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
      }),
    },
  };
});

// ─── pos-sse mock — zajem broadcast payloadov ────────────────────────────────

const broadcastMock = vi.hoisted(() => vi.fn());
const broadcastToMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/pos-sse", () => ({
  broadcastToUnit: broadcastMock,
  broadcastToDevice: broadcastToMock,
  addClient: vi.fn(),
  removeClient: vi.fn(),
}));

vi.mock("../lib/rezervacijeMiz", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/rezervacijeMiz")>();
  return {
    ...original,
    assertOpenOrderCanChange: vi.fn(async () => undefined),
    jeMizaBlokiranaZaNarocilo: vi.fn(async () => false),
  };
});

import narocilaRouter from "../routes/pos/narocila";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { enotaId: number }).enotaId = 1;
    next();
  });
  app.use(narocilaRouter);
  return app;
}

beforeEach(() => {
  dbState.selectQueue = [];
  dbState.selections = [];
  broadcastMock.mockClear();
  broadcastToMock.mockClear();
});

// ─── GET /narocila/aktivna ────────────────────────────────────────────────────

describe("GET /narocila/aktivna — prostor", () => {
  const base = {
    id: 1,
    stevilkaNarocila: "N-001",
    mizaId: 5,
    mizaStevilka: 5,
    mizaIme: "Miza 5",
    status: "odprto",
    skupaj: "10.00",
    opomba: null,
    toGo: false,
    ustvarjeno: new Date("2026-08-13T10:00:00Z"),
    posodobljeno: null,
  };

  it("vrne prostorId + prostorIme, kadar ima miza prostor", async () => {
    dbState.selectQueue = [
      [{ ...base, prostorId: 3, prostorIme: "Terasa" }],
      [], // fetchPostavke
    ];
    const res = await request(makeApp()).get("/narocila/aktivna");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].prostorId).toBe(3);
    expect(res.body[0].prostorIme).toBe("Terasa");
  });

  it("vrne prostorId=null + prostorIme=null za mizo brez prostora", async () => {
    dbState.selectQueue = [
      [{ ...base, prostorId: null, prostorIme: null }],
      [], // fetchPostavke
    ];
    const res = await request(makeApp()).get("/narocila/aktivna");
    expect(res.status).toBe(200);
    expect(res.body[0].prostorId).toBeNull();
    expect(res.body[0].prostorIme).toBeNull();
  });

  it("poizvedba izbere prostorId in prostorIme stolpca (JOIN na prostore)", async () => {
    dbState.selectQueue = [[], []];
    await request(makeApp()).get("/narocila/aktivna");
    const sel = dbState.selections[0];
    expect(sel).toBeDefined();
    expect(Object.keys(sel)).toContain("prostorId");
    expect(Object.keys(sel)).toContain("prostorIme");
  });
});

// ─── PATCH pripravljeno — SSE payload ────────────────────────────────────────

describe("PATCH /narocila/:id/postavke/:postavkaId/pripravljeno — SSE payload", () => {
  const postavkaRow = {
    id: 11,
    narociloId: 1,
    ime: "Pica",
    kolicina: 1,
    opomba: null,
    mizaId: 5,
    napravaId: null,
  };

  it("payload vsebuje prostorIme, kadar ima miza prostor", async () => {
    dbState.selectQueue = [
      [{ mizaId: null, status: "odprto" }],
      [postavkaRow],
      [{ ime: "Miza 5", stevilka: 5, prostorId: 3, prostorIme: "Terasa" }],
    ];
    const res = await request(makeApp())
      .patch("/narocila/1/postavke/11/pripravljeno")
      .send({ pripravljeno: true, vir: "kuhinja" });
    expect(res.status).toBe(200);

    const call = broadcastMock.mock.calls.find(([, event]) => event === "postavkaPripravljena");
    expect(call).toBeDefined();
    expect(call![0]).toBe(1);
    const payload = call![2] as Record<string, unknown>;
    expect(payload.mizaIme).toBe("Miza 5");
    expect(payload.prostorId).toBe(3);
    expect(payload.prostorIme).toBe("Terasa");
  });

  it("payload ima prostorIme=null za mizo brez prostora", async () => {
    dbState.selectQueue = [
      [{ mizaId: null, status: "odprto" }],
      [postavkaRow],
      [{ ime: "Miza 5", stevilka: 5, prostorId: null, prostorIme: null }],
    ];
    const res = await request(makeApp())
      .patch("/narocila/1/postavke/11/pripravljeno")
      .send({ pripravljeno: true, vir: "kuhinja" });
    expect(res.status).toBe(200);

    const call = broadcastMock.mock.calls.find(([, event]) => event === "postavkaPripravljena");
    expect(call).toBeDefined();
    expect(call![0]).toBe(1);
    const payload = call![2] as Record<string, unknown>;
    expect(payload.prostorId).toBeNull();
    expect(payload.prostorIme).toBeNull();
  });

  it("tuja postavka ni dosegljiva iz aktivne enote in ne sproži KDS obvestila", async () => {
    // Poizvedba zdaj vsebuje narocila.enotaId = req.enotaId. Za postavko druge
    // enote zato baza ne vrne vrstice.
    dbState.selectQueue = [[]];

    const res = await request(makeApp())
      .patch("/narocila/99/postavke/199/pripravljeno")
      .send({ pripravljeno: true, vir: "kuhinja" });

    expect(res.status).toBe(404);
    expect(broadcastMock).not.toHaveBeenCalled();
    expect(broadcastToMock).not.toHaveBeenCalled();
  });
});
