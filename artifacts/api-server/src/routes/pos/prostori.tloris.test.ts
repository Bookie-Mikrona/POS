import { randomUUID } from "node:crypto";
import express from "express";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { companiesTable, db, enoteTable, mizeTable, prostoriTable, tlorisPostavkeTable, tlorisiTable } from "@workspace/db";
import prostoriRouter from "./prostori";
import mizeRouter from "./mize";

vi.mock("../../lib/pos-sse", () => ({
  broadcastToUnit: vi.fn(),
  broadcastToDevice: vi.fn(),
}));

const run = randomUUID().slice(0, 8);
let companyId: string, otherCompanyId: string, enotaId: number, otherEnotaId: number;

function app(enota: number, vloga = "admin") {
  const server = express();
  server.use(express.json({ limit: "1mb" }));
  server.use((req, _res, next) => {
    Object.assign(req, { enotaId: enota, vloga, companyId, log: { warn: vi.fn() } });
    next();
  });
  server.use(prostoriRouter);
  server.use(mizeRouter);
  return server;
}

async function room(enota = enotaId) {
  const [row] = await db.insert(prostoriTable).values({ enotaId: enota, ime: `Tloris ${run} ${Math.random()}` }).returning();
  return row!;
}
async function table(prostorId: number, enota = enotaId, archived = false) {
  const [row] = await db.insert(mizeTable).values({ enotaId: enota, prostorId, stevilka: Math.floor(Math.random() * 1_000_000), arhivirana: archived }).returning();
  return row!;
}

function layout(tableId: number, version = 0) {
  const common = { width: 600, height: 400, gridSize: 20 };
  return {
    version, ...common, items: [
      { id: `table_${tableId}`, kind: "table", tableId, x: 20, y: 30, width: 90, height: 60, rotation: 15, zIndex: 1, locked: false, visible: true, style: { fill: "#fff" }, data: { oblika: "okrogla" } },
      { id: `wall_${tableId}`, kind: "wall", x: 0, y: 0, width: 200, height: 10, rotation: 0, zIndex: 2, locked: true, visible: true, style: { strokeWidth: 5 }, data: {} },
      { id: `door_${tableId}`, kind: "door", x: 210, y: 0, width: 50, height: 15, rotation: 0, zIndex: 3, locked: false, visible: true, style: {}, data: { side: "top" } },
      { id: `opening_${tableId}`, kind: "opening", x: 270, y: 0, width: 50, height: 15, rotation: 0, zIndex: 3, locked: false, visible: true, style: {}, data: { side: "top" } },
      { id: `label_${tableId}`, kind: "label", x: 30, y: 110, width: 100, height: 25, rotation: 0, zIndex: 4, locked: false, visible: true, style: {}, data: { text: "Vhod" } },
      { id: `zone_${tableId}`, kind: "zone", x: 10, y: 160, width: 200, height: 120, rotation: 0, zIndex: -1, locked: false, visible: true, style: {}, data: { name: "Terasa" } },
      { id: `decoration_${tableId}`, kind: "decoration", x: 350, y: 100, width: 40, height: 40, rotation: 0, zIndex: 4, locked: false, visible: true, style: {}, data: { type: "plant" } },
    ],
  };
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({ podjetjeDavcna: `SI_TL_${run}`, naziv: `Tloris ${run}` }).returning();
  companyId = company!.id;
  const [unit] = await db.insert(enoteTable).values({ companyId, ime: `Enota ${run}` }).returning();
  enotaId = unit!.id;
  const [other] = await db.insert(companiesTable).values({ podjetjeDavcna: `SI_TL_O_${run}`, naziv: `Drugi ${run}` }).returning();
  otherCompanyId = other!.id;
  const [otherUnit] = await db.insert(enoteTable).values({ companyId: otherCompanyId, ime: `Druga enota ${run}` }).returning();
  otherEnotaId = otherUnit!.id;
});

afterAll(async () => {
  const rooms = await db.select({ id: prostoriTable.id }).from(prostoriTable)
    .where(inArray(prostoriTable.enotaId, [enotaId, otherEnotaId]));
  const layouts = rooms.length ? await db.select({ id: tlorisiTable.id }).from(tlorisiTable)
    .where(inArray(tlorisiTable.prostorId, rooms.map((row) => row.id))) : [];
  if (layouts.length) await db.delete(tlorisPostavkeTable).where(inArray(tlorisPostavkeTable.tlorisId, layouts.map((row) => row.id)));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await db.delete(companiesTable).where(eq(companiesTable.id, otherCompanyId));
});

describe("room floor plans", () => {
  it("round trips every item kind and synchronizes legacy table geometry", async () => {
    const prostor = await room(); const miza = await table(prostor.id);
    const put = await supertest(app(enotaId)).put(`/prostori/${prostor.id}/tloris`).send(layout(miza.id));
    expect(put.status).toBe(200); expect(put.body.version).toBe(1); expect(put.body.items.map((item: any) => item.kind)).toHaveLength(7);
    const get = await supertest(app(enotaId, "uporabnik")).get(`/prostori/${prostor.id}/tloris`);
    expect(get.status).toBe(200); expect(get.body).toMatchObject({ version: 1, width: 600, height: 400, gridSize: 20 });
    expect(get.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "label", data: { text: "Vhod" } })]));
    const [synced] = await db.select().from(mizeTable).where(eq(mizeTable.id, miza.id));
    expect(synced).toMatchObject({ posX: 20, posY: 30, oblika: "okrogla", tlorisSirina: 90, tlorisVisina: 60, tlorisRotacija: 15 });
  });

  it("returns 409 on a stale version without replacing the document", async () => {
    const prostor = await room(); const miza = await table(prostor.id);
    const first = layout(miza.id); expect((await supertest(app(enotaId)).put(`/prostori/${prostor.id}/tloris`).send(first)).status).toBe(200);
    const stale = { ...layout(miza.id), width: 700 };
    expect((await supertest(app(enotaId)).put(`/prostori/${prostor.id}/tloris`).send(stale)).status).toBe(409);
    const current = await supertest(app(enotaId)).get(`/prostori/${prostor.id}/tloris`);
    expect(current.body).toMatchObject({ version: 1, width: 600 });
  });

  it("accepts repeated saves using the returned version", async () => {
    const prostor = await room(); const miza = await table(prostor.id);
    const first = await supertest(app(enotaId)).put(`/prostori/${prostor.id}/tloris`).send(layout(miza.id));
    const second = await supertest(app(enotaId)).put(`/prostori/${prostor.id}/tloris`).send({ ...layout(miza.id), version: first.body.version });
    expect(first.status).toBe(200); expect(second.status).toBe(200); expect(second.body.version).toBe(2);
  });

  it("reconciles omitted active tables into automatic canonical items", async () => {
    const prostor = await room(); const included = await table(prostor.id); const omitted = await table(prostor.id);
    const response = await supertest(app(enotaId)).put(`/prostori/${prostor.id}/tloris`).send(layout(included.id));
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "table", tableId: included.id }),
      expect.objectContaining({ kind: "table", tableId: omitted.id, data: expect.objectContaining({ automatic: true }) }),
    ]));
  });

  it("fully resets non-table geometry and atomically restores active tables", async () => {
    const prostor = await room(); const miza = await table(prostor.id);
    const saved = await supertest(app(enotaId)).put(`/prostori/${prostor.id}/tloris`).send(layout(miza.id));
    const reset = await supertest(app(enotaId)).post(`/prostori/${prostor.id}/tloris/reset`).send({ version: saved.body.version });
    expect(reset.status).toBe(200); expect(reset.body).toMatchObject({ version: 2, width: 1200, height: 800, gridSize: 20 });
    expect(reset.body.items).toEqual([expect.objectContaining({ kind: "table", tableId: miza.id, data: expect.objectContaining({ automatic: true }) })]);
    expect((await supertest(app(enotaId)).post(`/prostori/${prostor.id}/tloris/reset`).send({ version: saved.body.version })).status).toBe(409);
  });

  it("denies cross-tenant rooms and table IDs", async () => {
    const foreignRoom = await room(otherEnotaId); const foreignTable = await table(foreignRoom.id, otherEnotaId);
    expect((await supertest(app(enotaId)).get(`/prostori/${foreignRoom.id}/tloris`)).status).toBe(404);
    const localRoom = await room();
    expect((await supertest(app(enotaId)).put(`/prostori/${localRoom.id}/tloris`).send(layout(foreignTable.id))).status).toBe(400);
  });

  it("permits authenticated scoped reads but denies non-admin writes", async () => {
    const prostor = await room(); const miza = await table(prostor.id);
    expect((await supertest(app(enotaId, "uporabnik")).get(`/prostori/${prostor.id}/tloris`)).status).toBe(200);
    expect((await supertest(app(enotaId, "uporabnik")).put(`/prostori/${prostor.id}/tloris`).send(layout(miza.id))).status).toBe(403);
  });

  it("allows superadmin writes and keeps canonical document stable across legacy bulk updates", async () => {
    const prostor = await room(); const miza = await table(prostor.id);
    const saved = await supertest(app(enotaId, "superadmin")).put(`/prostori/${prostor.id}/tloris`).send(layout(miza.id));
    expect(saved.status).toBe(200);
    expect((await supertest(app(enotaId, "superadmin")).patch("/mize/bulk-pozicija")
      .send({ pozicije: [{ id: miza.id, posX: 333, posY: 222 }] })).status).toBe(409);
    const current = await supertest(app(enotaId)).get(`/prostori/${prostor.id}/tloris`);
    expect(current.body).toMatchObject({ version: saved.body.version });
    expect(current.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ tableId: miza.id, x: 20, y: 30 })]));
  });

  it("rejects legacy single-table geometry while preserving non-geometry updates", async () => {
    const prostor = await room(); const miza = await table(prostor.id);
    const rejected = await supertest(app(enotaId)).put(`/mize/${miza.id}`).send({
      stevilka: miza.stevilka, kapaciteta: 8, posX: 100, posY: 100,
    });
    expect(rejected.status).toBe(409);
    const allowed = await supertest(app(enotaId)).put(`/mize/${miza.id}`).send({
      stevilka: miza.stevilka, kapaciteta: 8,
    });
    expect(allowed.status).toBe(200);
    expect((await db.select().from(mizeTable).where(eq(mizeTable.id, miza.id)))[0]).toMatchObject({ kapaciteta: 8, posX: null, posY: null });
  });

  it("reconciles both canonical rooms when a table is reassigned", async () => {
    const oldRoom = await room(); const destination = await room(); const miza = await table(oldRoom.id);
    const oldSaved = await supertest(app(enotaId)).put(`/prostori/${oldRoom.id}/tloris`).send(layout(miza.id));
    expect(oldSaved.status).toBe(200);

    const moved = await supertest(app(enotaId)).put(`/mize/${miza.id}`).send({
      stevilka: miza.stevilka, kapaciteta: miza.kapaciteta, prostorId: destination.id,
    });
    expect(moved.status).toBe(200);

    const oldAfter = await supertest(app(enotaId)).get(`/prostori/${oldRoom.id}/tloris`);
    const destinationAfter = await supertest(app(enotaId)).get(`/prostori/${destination.id}/tloris`);
    expect(oldAfter.body.version).toBe(2);
    expect(oldAfter.body.items.some((item: any) => item.tableId === miza.id)).toBe(false);
    expect(destinationAfter.body.version).toBe(1);
    expect(destinationAfter.body.items).toEqual([expect.objectContaining({ tableId: miza.id, data: expect.objectContaining({ automatic: true }) })]);

    // Omitting the moved table is reconciled, and deleting all effective table
    // rows first prevents the unique miza_id constraint from failing.
    const destinationSave = await supertest(app(enotaId)).put(`/prostori/${destination.id}/tloris`).send({
      version: destinationAfter.body.version, width: 600, height: 400, gridSize: 20, items: [],
    });
    expect(destinationSave.status).toBe(200);
    expect(destinationSave.body.version).toBe(2);
    expect(destinationSave.body.items).toEqual([expect.objectContaining({ tableId: miza.id })]);
  });

  it("sizes a reset canvas so more than one hundred generated tables are in bounds", async () => {
    const prostor = await room();
    await db.insert(mizeTable).values(Array.from({ length: 101 }, (_, index) => ({
      enotaId, prostorId: prostor.id, stevilka: 700_000 + index,
    })));
    const reset = await supertest(app(enotaId)).post(`/prostori/${prostor.id}/tloris/reset`).send({ version: 0 });
    expect(reset.status).toBe(200); expect(reset.body.items).toHaveLength(101);
    expect(reset.body.height).toBeGreaterThan(800);
    expect(reset.body.items.every((item: any) => item.x >= 0 && item.y >= 0 && item.x + item.width <= reset.body.width && item.y + item.height <= reset.body.height)).toBe(true);
  });

  it("resets and remains canonically editable at the 500-table boundary", async () => {
    const prostor = await room();
    await db.insert(mizeTable).values(Array.from({ length: 500 }, (_, index) => ({
      enotaId, prostorId: prostor.id, stevilka: 710_000 + index,
    })));
    const reset = await supertest(app(enotaId)).post(`/prostori/${prostor.id}/tloris/reset`).send({ version: 0 });
    expect(reset.status).toBe(200);
    expect(reset.body.items).toHaveLength(500);
    expect(reset.body.width).toBeLessThanOrEqual(10_000);
    expect(reset.body.height).toBeLessThanOrEqual(10_000);
    expect(reset.body.items.every((item: any) =>
      item.x >= 0 && item.y >= 0
      && item.x + item.width <= reset.body.width
      && item.y + item.height <= reset.body.height
    )).toBe(true);
    const edited = { ...reset.body, items: reset.body.items.map((item: any, index: number) => index === 0 ? { ...item, rotation: 45 } : item) };
    const saved = await supertest(app(enotaId)).put(`/prostori/${prostor.id}/tloris`).send(edited);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ version: 2, width: reset.body.width, height: reset.body.height });
  }, 30_000);

  it("rejects 501 active tables before mutating an existing layout", async () => {
    const prostor = await room();
    const initial = await supertest(app(enotaId)).put(`/prostori/${prostor.id}/tloris`).send({
      version: 0, width: 600, height: 400, gridSize: 20,
      items: [{ id: `label_limit_${prostor.id}`, kind: "label", x: 10, y: 10, width: 100, height: 30, rotation: 0, zIndex: 1, locked: false, visible: true, style: {}, data: { text: "Ohrani" } }],
    });
    expect(initial.status).toBe(200);
    await db.insert(mizeTable).values(Array.from({ length: 501 }, (_, index) => ({
      enotaId, prostorId: prostor.id, stevilka: 720_000 + index,
    })));
    const rejected = await supertest(app(enotaId)).post(`/prostori/${prostor.id}/tloris/reset`).send({ version: initial.body.version });
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({ version: 1, limit: 500, count: 501 });
    const unchanged = await supertest(app(enotaId)).get(`/prostori/${prostor.id}/tloris`);
    expect(unchanged.body).toEqual(initial.body);
  }, 30_000);

  it("rejects invalid bounds, non-finite values and large text/payloads", async () => {
    const prostor = await room(); const miza = await table(prostor.id);
    const outside = layout(miza.id); outside.items[0]!.x = 550;
    expect((await supertest(app(enotaId)).put(`/prostori/${prostor.id}/tloris`).send(outside)).status).toBe(400);
    const infinity = JSON.stringify(layout(miza.id)).replace('"width":600', '"width":1e999');
    expect((await supertest(app(enotaId)).put(`/prostori/${prostor.id}/tloris`).set("Content-Type", "application/json").send(infinity)).status).toBe(400);
    const oversized = layout(miza.id); (oversized.items[4]!.data as any).text = "x".repeat(1001);
    expect((await supertest(app(enotaId)).put(`/prostori/${prostor.id}/tloris`).send(oversized)).status).toBe(400);
    const payload = layout(miza.id); (payload.items[6]!.data as any).blob = "x".repeat(10_001);
    expect((await supertest(app(enotaId)).put(`/prostori/${prostor.id}/tloris`).send(payload)).status).toBe(400);
  });

  it("rejects a table from another local room and an archived table", async () => {
    const prostor = await room(); const otherRoom = await room(); const wrongTable = await table(otherRoom.id);
    expect((await supertest(app(enotaId)).put(`/prostori/${prostor.id}/tloris`).send(layout(wrongTable.id))).status).toBe(400);
    const archived = await table(prostor.id, enotaId, true);
    expect((await supertest(app(enotaId)).put(`/prostori/${prostor.id}/tloris`).send(layout(archived.id))).status).toBe(400);
  });
});