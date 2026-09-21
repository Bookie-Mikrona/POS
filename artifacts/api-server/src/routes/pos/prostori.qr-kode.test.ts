import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { and, eq } from "drizzle-orm";
import {
  companiesTable,
  db,
  enoteTable,
  mizeTable,
  pool,
  prostoriTable,
} from "@workspace/db";
import prostoriRouter from "./prostori";

const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();

let companyId: string;
let enotaId: number;
let drugaEnotaId: number;
let prostorId: number;
let prazenProstorId: number;
let tujProstorId: number;
let mizaIds: number[];
let tujaMizaId: number;
let stariTokeni: string[];
let tujStariToken: string;
const previousPublicMenuOrigin = process.env.PUBLIC_MENU_ORIGIN;

function prostoriApp(izbranaEnotaId: number, vloga: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).enotaId = izbranaEnotaId;
    (req as any).vloga = vloga;
    next();
  });
  app.use(prostoriRouter);
  return app;
}

beforeAll(async () => {
  process.env.PUBLIC_MENU_ORIGIN = "https://qr.example.test";
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_QR_PROSTOR_${RUN_ID}`,
    naziv: `QR prostor lokal ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = company!.id;

  const [enota, drugaEnota] = await db.insert(enoteTable).values([
    { companyId, ime: `QR prostor enota ${RUN_ID}` },
    { companyId, ime: `Druga QR prostor enota ${RUN_ID}` },
  ]).returning({ id: enoteTable.id });
  enotaId = enota!.id;
  drugaEnotaId = drugaEnota!.id;

  const [prostor, prazenProstor] = await db.insert(prostoriTable).values([
    { enotaId, ime: `Terasa ${RUN_ID}`, vrstniRed: 1 },
    { enotaId, ime: `Prazno ${RUN_ID}`, vrstniRed: 2 },
  ]).returning({ id: prostoriTable.id });
  prostorId = prostor!.id;
  prazenProstorId = prazenProstor!.id;

  const [tujProstor] = await db.insert(prostoriTable).values({
    enotaId: drugaEnotaId,
    ime: `Tuja terasa ${RUN_ID}`,
    vrstniRed: 1,
  }).returning({ id: prostoriTable.id });
  tujProstorId = tujProstor!.id;

  stariTokeni = [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")];
  tujStariToken = randomBytes(32).toString("base64url");
  const mize = await db.insert(mizeTable).values([
    { enotaId, stevilka: 11, ime: "Miza ob ograji", prostorId, qrToken: stariTokeni[0] },
    { enotaId, stevilka: 12, prostorId, qrToken: stariTokeni[1] },
    { enotaId: drugaEnotaId, stevilka: 99, prostorId: tujProstorId, qrToken: tujStariToken },
  ]).returning({ id: mizeTable.id, enotaId: mizeTable.enotaId });
  mizaIds = mize.filter((m) => m.enotaId === enotaId).map((m) => m.id);
  tujaMizaId = mize.find((m) => m.enotaId === drugaEnotaId)!.id;
});

afterAll(async () => {
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId)).catch(() => {});
  if (previousPublicMenuOrigin === undefined) delete process.env.PUBLIC_MENU_ORIGIN;
  else process.env.PUBLIC_MENU_ORIGIN = previousPublicMenuOrigin;
  await pool.end();
});

describe("POST /prostori/:id/qr-kode", () => {
  it("zavrne uporabnika brez admin pravic", async () => {
    const response = await supertest(prostoriApp(enotaId, "uporabnik"))
      .post(`/prostori/${prostorId}/qr-kode`);
    expect(response.status).toBe(403);
  });

  it("zavrne sočasno pripravo, da veljaven PDF ne postane takoj zastarel", async () => {
    const client = await pool.connect();
    const lockKey = `qr-kode-prostor:${enotaId}:${prostorId}`;
    try {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey]);
      const response = await supertest(prostoriApp(enotaId, "admin"))
        .post(`/prostori/${prostorId}/qr-kode`);
      expect(response.status).toBe(409);
      expect(response.body.error).toContain("že pripravljajo");
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
      client.release();
    }
  });

  it("zamenja žetone vseh miz prostora, izolira drugo enoto in vrne PDF", async () => {
    const response = await supertest(prostoriApp(enotaId, "admin_enote"))
      .post(`/prostori/${prostorId}/qr-kode`)
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "qr.example.test");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toContain("qr-kode-");
    expect(response.body.subarray(0, 5).toString("ascii")).toBe("%PDF-");

    const posodobljeneMize = await db.select({ id: mizeTable.id, qrToken: mizeTable.qrToken })
      .from(mizeTable)
      .where(and(eq(mizeTable.enotaId, enotaId), eq(mizeTable.prostorId, prostorId)));
    expect(posodobljeneMize).toHaveLength(2);
    expect(posodobljeneMize.map((m) => m.id).sort()).toEqual([...mizaIds].sort());
    for (const miza of posodobljeneMize) {
      expect(miza.qrToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(stariTokeni).not.toContain(miza.qrToken);
    }

    const [tujaMiza] = await db.select({ qrToken: mizeTable.qrToken })
      .from(mizeTable)
      .where(eq(mizeTable.id, tujaMizaId));
    expect(tujaMiza!.qrToken).toBe(tujStariToken);
  });

  it("ne izda praznega PDF-ja za prostor brez miz", async () => {
    const response = await supertest(prostoriApp(enotaId, "admin"))
      .post(`/prostori/${prazenProstorId}/qr-kode`);
    expect(response.status).toBe(409);
    expect(response.body.error).toContain("ni miz");
  });

  it("ne razkrije prostora druge enote", async () => {
    const response = await supertest(prostoriApp(enotaId, "admin"))
      .post(`/prostori/${tujProstorId}/qr-kode`);
    expect(response.status).toBe(404);
  });
});

describe("POST /qr-admin/mize/:id/predogled", () => {
  it("adminu izda kratkotrajno QR sejo za isto mizo in brskalnik", async () => {
    const response = await supertest(prostoriApp(enotaId, "admin"))
      .post(`/qr-admin/mize/${mizaIds[0]}/predogled`)
      .send({ qrNapravaId: "12345678-1234-4123-8123-123456789abc" });

    expect(response.status).toBe(200);
    expect(response.body.javniUrl).toMatch(/^https:\/\/qr\.example\.test\/meni\//);
    expect(response.headers["set-cookie"]?.[0]).toContain("bookie_qr_activation=");
  });

  it("ne izda predogleda mize druge enote", async () => {
    const response = await supertest(prostoriApp(enotaId, "admin"))
      .post(`/qr-admin/mize/${tujaMizaId}/predogled`)
      .send({ qrNapravaId: "12345678-1234-4123-8123-123456789abc" });

    expect(response.status).toBe(404);
  });
});

describe("POST /qr-admin/import", () => {
  const validBackup = {
    version: 1,
    exportedAt: "2025-01-01T12:00:00.000Z",
    tables: [{ stevilka: 80001, ime: "Prenosna miza", prostor: `Uvoz ${RUN_ID}` }],
  };

  it("strogo zavrne žeton ali drugo skrivnost v prenosni datoteki", async () => {
    const response = await supertest(prostoriApp(enotaId, "admin"))
      .post("/qr-admin/import").send({
        mode: "dry-run", backup: { ...validBackup, qrToken: "ne-sme-biti-tu" },
      });
    expect(response.status).toBe(400);
    expect(response.body.valid).toBe(false);
  });

  it("suhi preizkus ničesar ne spremeni, potrditev pa uvozi samo aktivno enoto", async () => {
    const dryRun = await supertest(prostoriApp(enotaId, "admin_enote"))
      .post("/qr-admin/import").send({ mode: "dry-run", backup: validBackup });
    expect(dryRun.status).toBe(200);
    expect(dryRun.body).toMatchObject({ valid: true, applied: false, createdRooms: 1, createdTables: 1 });
    const before = await db.select({ id: mizeTable.id }).from(mizeTable)
      .where(and(eq(mizeTable.enotaId, enotaId), eq(mizeTable.stevilka, 80001)));
    expect(before).toHaveLength(0);

    const apply = await supertest(prostoriApp(enotaId, "admin_enote"))
      .post("/qr-admin/import").send({ mode: "apply", backup: validBackup });
    expect(apply.status).toBe(200);
    expect(apply.body).toMatchObject({ valid: true, applied: true, createdRooms: 1, createdTables: 1 });
    const [imported] = await db.select({ qrToken: mizeTable.qrToken, enotaId: mizeTable.enotaId }).from(mizeTable)
      .where(and(eq(mizeTable.enotaId, enotaId), eq(mizeTable.stevilka, 80001)));
    expect(imported).toBeDefined();
    expect(imported!.qrToken).toBeNull();
    const foreign = await db.select({ id: mizeTable.id }).from(mizeTable)
      .where(and(eq(mizeTable.enotaId, drugaEnotaId), eq(mizeTable.stevilka, 80001)));
    expect(foreign).toHaveLength(0);
  });
});